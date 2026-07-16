import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { reduce } from './sessionStore';
import { isStalled } from './selectors';
import type { RambleEvent, SessionState } from './types';
import { Monitor } from './Monitor';
import { SCRIBE_TOOLS, scribeCallToEvents } from './scribeTools';
import { buildScribeInstructions } from './scribePrompt';
import type { VoiceProvider, ProviderKind } from '../voice/types';
import { createGeminiProvider } from '../voice/gemini';
import { createOpenAIRealtimeProvider } from '../voice/openai';
import { createAzureRealtimeProvider } from '../voice/azure';
import { CallDeduper, argsKey } from '../coherence';
import { playEarcon, primeEarcons } from '../feedback/earcons';
import { telemetry, detectDevice } from '../telemetry';
import { Button } from '../ui/Button';

const label = (id: string) => RFI_SCHEMA.slots.find((s) => s.id === id)?.label ?? id;

// End-of-speech silence for the scribe: short enough that a breath between ramble clauses
// lets the model fill, long enough not to chop mid-sentence. Tune against live feel.
const RAMBLE_SILENCE_MS = 500;

/** Live ramble-fill: the scribe on a real VoiceProvider driving the glanceable Monitor. */
export function RambleLive() {
  const [state, setState] = useState<SessionState>(() => initialSessionState(RFI_SCHEMA, new Date().toLocaleDateString(), Date.now()));
  const stateRef = useRef(state);
  const [now, setNow] = useState(() => Date.now());
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [backend, setBackend] = useState<ProviderKind>('gemini');
  const providerRef = useRef<VoiceProvider | null>(null);
  const deduperRef = useRef(new CallDeduper());
  const startedAtRef = useRef(0);
  const typedRef = useRef<HTMLInputElement | null>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSubmitTimer = () => {
    if (submitTimerRef.current != null) { clearTimeout(submitTimerRef.current); submitTimerRef.current = null; }
  };

  const apply = (ev: RambleEvent) => {
    setState((prev) => {
      const next = reduce(prev, ev, Date.now());
      stateRef.current = next;
      return next;
    });
  };

  // Liveness tick + stall edge (telemetry + earcon on the flip, spec §5.4/§7).
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const stalled = isStalled(state, now);
  const prevStalledRef = useRef(false);
  useEffect(() => {
    // Gate on isLive: with no session (never started, or after Stop) there's nothing
    // live to be stalled — don't play the error earcon or record telemetry.stall()
    // into a dead session (that would be a lie about what's happening).
    if (isLive && stalled && !prevStalledRef.current) { telemetry.stall(); playEarcon('error'); }
    prevStalledRef.current = stalled;
  }, [stalled, isLive]);

  useEffect(() => () => { clearSubmitTimer(); providerRef.current?.close(); }, []); // teardown on unmount

  const handleToolCall = (call: { id: string; name: string; args: any }) => {
    // Validate FIRST: a call that fails validation never mutated anything, so it
    // must never be recorded in the deduper — otherwise a retry of a genuinely
    // failed call would come back as a false `{success:true, deduped:true}`.
    const mapped = scribeCallToEvents(call, RFI_SCHEMA);
    if ('error' in mapped) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: false, error: mapped.error });
      return;
    }
    const prev = stateRef.current;
    // Yield guard (defense-in-depth for spec §6.2): the reducer silently drops
    // fill_slot/ask_gap/confirm_slot for a user-owned slot, so a structurally valid
    // call here would otherwise still get acked `{success:true}` with earcons and
    // telemetry for a mutation that never happened. Ack the truth instead, and — same
    // reasoning as above — never record a dropped call in the deduper.
    if (call.name === 'fill_slot' || call.name === 'ask_gap' || call.name === 'confirm_slot') {
      const slotId = String(call.args?.slotId ?? '');
      if (prev.fills.find((f) => f.slotId === slotId)?.owner === 'user') {
        providerRef.current?.sendToolResponse(call.id, call.name, {
          success: false,
          error: `"${label(slotId)}" is user-owned — the user filled it themselves; never fill, ask about, or change it.`,
        });
        return;
      }
    }
    // G9 idempotency (all scribe tools carry args; recap/submit repeats are idempotent phase changes).
    if (deduperRef.current.seen(call.name, argsKey(call.args), Date.now())) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: true, deduped: true });
      return;
    }
    if (call.name === 'fill_slot') {
      // A re-fill over an existing draft = a patched read-back (spec §7 readback accepted-vs-patched).
      if (prev.fills.find((f) => f.slotId === call.args?.slotId)?.status === 'draft') telemetry.readback(false);
      // Confidence for telemetry comes from the mapped slot.draft event (already
      // clamped/NaN-guarded) so telemetry matches what actually lands in state,
      // not the raw (possibly unparseable) arg.
      const draft = mapped.find((ev) => ev.type === 'slot.draft');
      const confidence = draft && draft.type === 'slot.draft' ? draft.confidence : 0.5;
      telemetry.fill(String(call.args?.slotId), String(call.args?.source ?? 'heard'), confidence);
    }
    if (call.name === 'ask_gap') { telemetry.gapQuestion(String(call.args?.slotId)); playEarcon('confirm-needed'); }
    if (call.name === 'confirm_slot') { telemetry.readback(true); playEarcon('commit-mutate'); }
    if (call.name === 'submit') playEarcon('confirm-needed');
    for (const ev of mapped) apply(ev);
    providerRef.current?.sendToolResponse(call.id, call.name, { success: true });
  };

  const start = async () => {
    if (isLive || isConnecting) return;
    // Fresh session on every start: stale fills/phase from a prior run must not leak in,
    // and a pending submit timer from a prior session must never fire into this one.
    // Also close any leftover provider (e.g. one that errored before onOpen and never
    // reached onClose) so its mic/socket isn't orphaned — close() is try/catch-safe
    // in all three factories.
    clearSubmitTimer();
    providerRef.current?.close();
    providerRef.current = null;
    const fresh = initialSessionState(RFI_SCHEMA, new Date().toLocaleDateString(), Date.now());
    stateRef.current = fresh;
    setState(fresh);
    deduperRef.current.reset();
    setIsConnecting(true); setLastError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (backend === 'gemini' && !apiKey) throw new Error('Missing GEMINI_API_KEY — set it in .env and restart the dev server.');
      const provider =
        backend === 'azure'
          ? createAzureRealtimeProvider(process.env.AZURE_OPENAI_ENDPOINT || '', process.env.AZURE_REALTIME_DEPLOYMENT || 'gpt-realtime-2', process.env.AZURE_OPENAI_API_KEY || '', process.env.AZURE_TRANSCRIBE_DEPLOYMENT || undefined)
          : backend === 'openai' ? createOpenAIRealtimeProvider()
          : createGeminiProvider(apiKey!);
      providerRef.current = provider;
      primeEarcons();
      await provider.connect(
        {
          instructions: buildScribeInstructions(RFI_SCHEMA, new Date().toLocaleDateString()),
          tools: SCRIBE_TOOLS,
          voice: backend === 'gemini' ? 'Zephyr' : backend === 'azure' ? 'alloy' : 'marin',
          // Ramble turns must end on NATURAL mid-ramble pauses, or the scribe never gets to
          // act (Test 2: continuous speech → zero fills with the server default).
          vad: { silenceDurationMs: RAMBLE_SILENCE_MS },
        },
        {
          // Stale-callback guards: gemini's WS fires onclose unconditionally, so a delayed
          // event from a REPLACED session must not touch the current one's state.
          onOpen: () => {
            if (providerRef.current !== provider) { try { provider.close(); } catch {} return; }
            setIsLive(true); setIsConnecting(false);
            startedAtRef.current = Date.now();
            telemetry.start({ backend, autonomy: 'witnessed', feedback: 'earcon', program: 'rfi-ramble', honest: true, device: detectDevice() });
            playEarcon('listening');
            apply({ type: 'heartbeat' });
          },
          onClose: () => {
            if (providerRef.current !== provider) return; // stale close from a replaced session
            clearSubmitTimer(); setIsLive(false); setIsConnecting(false); providerRef.current = null;
          },
          // NOTE: onError must NOT close/null the provider — Azure routes a non-fatal advisory
          // (missing transcribe deployment) through onError on a session that keeps working.
          // Orphan prevention for errored providers lives at the top of start() instead.
          onError: (m) => {
            if (providerRef.current !== provider) return; // stale error from a replaced session
            setIsConnecting(false); setLastError(m); telemetry.error(m);
          },
          onInputTranscript: () => apply({ type: 'heartbeat' }),
          // Model speech is activity too: without these, the monitor reads "stalled" while
          // the agent is audibly asking a gap question or reading back (live smoke 2026-07-15).
          onModelTranscript: () => apply({ type: 'heartbeat' }),
          onResponseStart: () => apply({ type: 'heartbeat' }),
          onToolCall: handleToolCall,
        },
      );
    } catch (e: any) {
      setIsConnecting(false); setLastError(e?.message ?? String(e)); providerRef.current = null;
    }
  };

  // Explicit teardown: azure/openai suppress cb.onClose on app-initiated close (their
  // `closed` flag), so stop() cannot rely on onClose firing. Idempotent with gemini's onClose.
  const stop = () => {
    clearSubmitTimer();
    providerRef.current?.close();
    providerRef.current = null;
    setIsLive(false);
    setIsConnecting(false);
  };

  // UI→Agent edits: reducer enforces yield; the hint is defense-in-depth (spec §6.2).
  const onEditStart = (id: string) => {
    apply({ type: 'user.editStart', slotId: id });
    providerRef.current?.sendTextHint(`[SYSTEM: the user is editing "${label(id)}" themselves — do NOT fill, ask about, or mention it. Stay silent.]`);
  };
  const onEditCommit = (id: string, value: string) => {
    const prior = stateRef.current.fills.find((f) => f.slotId === id)?.prior;
    const overAgent = prior != null && prior.value != null && prior.owner === 'agent';
    apply({ type: 'user.editCommit', slotId: id, value });
    telemetry.correction(id, overAgent);
    providerRef.current?.sendTextHint(`[SYSTEM: the user set "${label(id)}" to "${value}" themselves. That field is theirs now — never change it. Do not respond.]`);
  };
  const onEditCancel = (id: string) => apply({ type: 'user.editCancel', slotId: id });

  // Submit consent — unconditionally witnessed (spec §6.3); declined → stays awaitingConsent (§8).
  const confirmSubmit = () => {
    apply({ type: 'session.phaseChange', phase: 'submitting' });
    playEarcon('commit-mutate');
    // Scope the timer to THIS session: capture the provider, and bail if the session
    // changed before it fires — a stale "submitted" hint into a new session would be a lie.
    const capturedProvider = providerRef.current;
    clearSubmitTimer();
    submitTimerRef.current = setTimeout(() => {
      submitTimerRef.current = null;
      if (providerRef.current !== capturedProvider) return; // session ended/restarted meanwhile
      apply({ type: 'session.phaseChange', phase: 'done' });
      const st = stateRef.current;
      telemetry.sessionComplete(
        Date.now() - startedAtRef.current,
        st.fills.filter((f) => f.value != null).length,
        st.fills.filter((f) => f.source === 'inferred').length,
      );
      providerRef.current?.sendTextHint('[SYSTEM: the form was submitted with the user\'s consent. The session is done — thank them briefly.]');
    }, 700);
  };
  const declineSubmit = () => {
    providerRef.current?.sendTextHint('[SYSTEM: the user DECLINED the submission — nothing was sent. They may edit fields or tell you what to change; recap again before any new submit.]');
  };

  const sendTyped = (e: FormEvent) => {
    e.preventDefault();
    const v = typedRef.current?.value.trim();
    if (v && providerRef.current) { providerRef.current.sendUserText(v); apply({ type: 'heartbeat' }); }
    if (typedRef.current) typedRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-md mx-auto pt-6 px-4 flex items-center justify-between">
        <a href="/" className="text-xs text-slate-500 hover:text-slate-800">← point-and-speak</a>
        <div className="flex items-center gap-2">
          <select
            aria-label="Voice backend" value={backend} disabled={isLive || isConnecting}
            onChange={(e) => setBackend(e.target.value as ProviderKind)}
            className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white"
          >
            <option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="azure">Azure</option>
          </select>
          <Button size="sm" onClick={isLive ? stop : start} disabled={isConnecting}>
            {isLive ? 'Stop' : isConnecting ? 'Connecting…' : 'Start ramble'}
          </Button>
        </div>
      </div>
      {lastError && <div className="max-w-md mx-auto mt-2 px-4 text-xs text-red-600">{lastError}</div>}

      <Monitor
        schema={RFI_SCHEMA} state={state} now={now} live={isLive}
        onEditStart={onEditStart} onEditCommit={onEditCommit} onEditCancel={onEditCancel}
        onOpenFullEditor={() => { /* the edit pass is a follow-on spec */ }}
      />

      {isLive && (
        <form onSubmit={sendTyped} className="max-w-md mx-auto mt-3 px-4">
          <input
            ref={typedRef} placeholder="Type instead of speaking (dev)"
            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
          />
        </form>
      )}

      {state.phase === 'awaitingConsent' && (
        // Non-blocking: a floating card, not a full-screen backdrop — the model may
        // tell the user "they may edit fields" while this is up (declineSubmit), so
        // every slot row and the Stop/Start button must stay reachable underneath.
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white rounded-xl shadow-lg p-5 w-80"
          role="dialog" aria-label="Submit consent"
        >
          <h3 className="text-sm font-semibold">Submit this {RFI_SCHEMA.title}?</h3>
          <p className="text-xs text-slate-500 mt-1.5">You just heard the recap. Nothing is sent without your OK.</p>
          <div className="flex gap-2 mt-4 justify-end">
            <Button size="sm" variant="outline" onClick={declineSubmit}>Not yet</Button>
            <Button size="sm" onClick={confirmSubmit}>Submit</Button>
          </div>
        </div>
      )}
      {state.phase === 'done' && (
        <div className="max-w-md mx-auto mt-4 px-4 text-center text-sm text-green-700">
          Submitted ✓ — <a className="underline" href="?ramble=live">start another</a>
        </div>
      )}
    </div>
  );
}
