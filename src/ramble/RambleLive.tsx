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
    if (stalled && !prevStalledRef.current) { telemetry.stall(); playEarcon('error'); }
    prevStalledRef.current = stalled;
  }, [stalled]);

  useEffect(() => () => providerRef.current?.close(), []); // teardown on unmount

  const handleToolCall = (call: { id: string; name: string; args: any }) => {
    // G9 idempotency (all scribe tools carry args; recap/submit repeats are idempotent phase changes).
    if (deduperRef.current.seen(call.name, argsKey(call.args), Date.now())) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: true, deduped: true });
      return;
    }
    const mapped = scribeCallToEvents(call, RFI_SCHEMA);
    if ('error' in mapped) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: false, error: mapped.error });
      return;
    }
    const prev = stateRef.current;
    if (call.name === 'fill_slot') {
      // A re-fill over an existing draft = a patched read-back (spec §7 readback accepted-vs-patched).
      if (prev.fills.find((f) => f.slotId === call.args?.slotId)?.status === 'draft') telemetry.readback(false);
      telemetry.fill(String(call.args?.slotId), String(call.args?.source ?? 'heard'), Number(call.args?.confidence ?? 0.5));
    }
    if (call.name === 'ask_gap') { telemetry.gapQuestion(String(call.args?.slotId)); playEarcon('confirm-needed'); }
    if (call.name === 'confirm_slot') { telemetry.readback(true); playEarcon('commit-mutate'); }
    if (call.name === 'submit') playEarcon('confirm-needed');
    for (const ev of mapped) apply(ev);
    providerRef.current?.sendToolResponse(call.id, call.name, { success: true });
  };

  const start = async () => {
    if (isLive || isConnecting) return;
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
        },
        {
          onOpen: () => {
            setIsLive(true); setIsConnecting(false);
            startedAtRef.current = Date.now();
            telemetry.start({ backend, autonomy: 'witnessed', feedback: 'earcon', program: 'rfi-ramble', honest: true, device: detectDevice() });
            playEarcon('listening');
            apply({ type: 'heartbeat' });
          },
          onClose: () => { setIsLive(false); setIsConnecting(false); providerRef.current = null; },
          onError: (m) => { setIsConnecting(false); setLastError(m); telemetry.error(m); },
          onInputTranscript: () => apply({ type: 'heartbeat' }),
          onToolCall: handleToolCall,
        },
      );
    } catch (e: any) {
      setIsConnecting(false); setLastError(e?.message ?? String(e)); providerRef.current = null;
    }
  };

  const stop = () => providerRef.current?.close();

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
    setTimeout(() => {
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
        schema={RFI_SCHEMA} state={state} now={now}
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
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center" role="dialog" aria-label="Submit consent">
          <div className="bg-white rounded-xl shadow-lg p-5 w-80">
            <h3 className="text-sm font-semibold">Submit this {RFI_SCHEMA.title}?</h3>
            <p className="text-xs text-slate-500 mt-1.5">You just heard the recap. Nothing is sent without your OK.</p>
            <div className="flex gap-2 mt-4 justify-end">
              <Button size="sm" variant="outline" onClick={declineSubmit}>Not yet</Button>
              <Button size="sm" onClick={confirmSubmit}>Submit</Button>
            </div>
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
