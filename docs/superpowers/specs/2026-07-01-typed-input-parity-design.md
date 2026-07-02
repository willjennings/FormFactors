# Typed Input Parity (R1) — Design Spec

*Add "type" to "talk or type": a text input that enters the exact same
Intent→Command→Policy→Effect→Feedback pipeline as speech. R1 of the virtual-desktop architecture
review (`2026-07-01-virtual-desktop-architecture-review.md`).*

Date: 2026-07-01
Branch: `honest-mode`
Status: Approved design — ready for implementation planning

---

## 1. Purpose — a UX-balance experiment, not just plumbing

FormFactors is a UX exploration of the **balance between speed, UX patterns, direct manipulation,
and heads-up tips** in agent-assisted interaction. The app already has two input modalities:
- **voice** (the realtime session), and
- **direct manipulation** (tap a tile / press a number → `selectTargetByNumber`).

This feature adds the third — **typed commands** — with strict pipeline parity, so the three can be
compared on the same scenarios with the same telemetry: which is faster, which grounds better,
which gets corrected less, when does each feel right. Secondary payoff: typed input enables
**scripted end-to-end testing** of the whole loop with no audio and no human voice.

Parity is the design constraint: a typed "make this bold" while pointing must behave *identically*
to the spoken one — deixis binds to the pointer at type-time, repair phrases work, the same policy
gates fire, the same feedback channels answer.

## 2. Non-goals

- No chat history UI, multiline composer, or message threading (YAGNI — it's a command line, not a
  chat).
- No separate text-model path — typed text rides the live realtime session (Approach A; a parallel
  `generateContent` chat would be a second brain with divergent state).
- No change to the voice path, the grammar (`processInputTranscript`), or the policy layer.

## 3. Architecture (Approach A — type-as-transcript)

```
input box ──► sendTypedInput(text)
                ├─► echo to transcript panel + addLog('user', …)
                ├─► processInputTranscript(text)        ← same local grammar as speech:
                │     deixis keyword→pointer binding, repair (undo/cancel/other),
                │     number selection ("number two")
                └─► providerRef.current.sendUserText(text)   ← forces a model turn
                        (no live session? → stash in pendingTypedRef, auto-start session,
                         send on onOpen as the first turn)
```

### 3.1 Provider seam — `sendUserText` on `VoiceProvider`

Add to `src/voice/types.ts`:
```ts
/** Inject a typed user turn and force a model response (unlike sendTextHint, which must not). */
sendUserText: (text: string) => void;
```
Per provider:
- **openai.ts / azure.ts** (same realtime protocol): `conversation.item.create` with
  `{ type:'message', role:'user', content:[{ type:'input_text', text }] }` followed by
  `{ type:'response.create' }`. Both files already emit exactly these frame types for tool
  responses (openai.ts:204-234, azure.ts:200-217) — this reuses their `send()` helpers.
- **gemini.ts**: `session.sendClientContent({ turns: [{ role:'user', parts:[{ text }] }],
  turnComplete: true })` — the client-content API that forces a turn (distinct from
  `sendRealtimeInput({ text })`, which is the non-forcing hint path).
- All three: null-safe no-op when the session is closed (same pattern as `sendTextHint`).

### 3.2 App wiring — `sendTypedInput`

In `App.tsx`:
- `pendingTypedRef = useRef<string | null>(null)`.
- `sendTypedInput(text)`: guard via pure `parseTypedSubmit` (§3.4); echo to the transcript panel and
  `addLog`; run `processInputTranscript(text)`; if a session is live, `sendUserText(text)`; else
  `pendingTypedRef.current = text` and invoke the existing start-session path.
- In the session `onOpen` callback: if `pendingTypedRef.current`, send it via `sendUserText` and
  clear the ref.
- Telemetry: extend the `deixis` and `action` events in `src/telemetry.ts` with an optional
  `modality?: 'voice' | 'typed' | 'direct'` field (optional ⇒ existing call sites keep compiling,
  same pattern as the Task-6 `resolution` extension). A `lastInputModalityRef` in App is set to
  `'typed'` at `sendTypedInput` entry, `'voice'` when a speech transcript arrives, `'direct'` in
  `selectTargetByNumber`, and passed at the `telemetry.deixis`/`telemetry.action` call sites.
  `metrics()` gains a `byModality` slice mirroring `byResolution`.

### 3.3 UI

A single-line input + send button in the existing bottom-right transcript/LISTENING box (already
the conversation surface). Enter submits; box clears on successful handoff; on session-start
failure the text is restored to the box so nothing is lost. Placeholder copy: `type a command —
point while you type`. Disabled only while a session is mid-connecting to avoid double-starts.

### 3.4 Pure guard — `parseTypedSubmit`

New tiny module `src/input/typedInput.ts` (pure, unit-tested):
```ts
/** Normalize a typed submission: trim; '' for empty/whitespace; cap at 500 chars. */
export function parseTypedSubmit(raw: string): string
```
Empty result ⇒ `sendTypedInput` no-ops (no session start on stray Enter).

## 4. Error handling & degradation

- No key / session-start failure → existing error path (`addLog` + toast); typed text restored to
  the box.
- `sendUserText` on a closed/absent provider → no-op (null-safe), consistent with `sendTextHint`.
- Voice-only usage is untouched; the box is purely additive.

## 5. What the exploration measures (success criteria)

With `inputModality` on turns, the existing telemetry export can compare per modality:
deixis accuracy + calibration, commit/witness ratio, correction rate, and time-in-turn — voice vs
typed vs direct manipulation, per form factor. The UX questions this feeds: when is typing *faster*
than speaking (short precise commands?), when does pointing+typing beat pointing+speaking
(noisy rooms, precision), and where direct manipulation should simply win (single-target taps).

## 6. Testing

- **Pure (vitest):** `parseTypedSubmit` (trim/empty/whitespace/cap).
- **Provider frame tests (vitest, stubbed transport):** for each provider, assert `sendUserText`
  emits exactly the frames above (openai/azure: item.create + response.create; gemini:
  sendClientContent with turnComplete) and no-ops when closed.
- **Manual smoke:** type "make this bold" while pointing at a tile → identical behavior to speaking
  it (deixis hint fires, policy gates, earcon feedback); type with no session → session auto-starts
  and the command executes; repair phrase "undo that" typed → undo fires.

## 7. Build order (informs the plan)

1. `parseTypedSubmit` + tests.
2. `sendUserText` across the three providers + frame tests.
3. Telemetry `modality` field + `byModality` slice + tests (mirrors the `resolution` extension).
4. App wiring (`sendTypedInput`, pending-send-on-open, modality tagging) + input box UI; manual
   smoke.
