# Typed Input Parity (R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed-command input with strict pipeline parity to speech — same local grammar (deixis/repair/number), same live session, same policy/feedback — plus a `modality` telemetry dimension so voice vs typed vs direct manipulation is measurable.

**Architecture:** A pure `parseTypedSubmit` guard; a pure `frames.ts` module holding the realtime protocol frames; `sendUserText(text)` added to `VoiceProvider` and all three providers (OpenAI/Azure: user-message item + `response.create`; Gemini: `sendClientContent` with `turnComplete`); App gains `sendTypedInput` (echo → `processInputTranscript` → `sendUserText`, auto-starting a session with a pending-turn stash when none is live) and an input row in the existing Listening box. Telemetry `deixis`/`action` events gain optional `modality` with a `byModality` slice.

**Tech Stack:** TypeScript, React 19, vitest; no new dependencies.

## Global Constraints

- Branch: work on `honest-mode`. Verify `git branch --show-current` before each commit.
- Parity is the constraint: typed text runs the SAME `processInputTranscript` as speech; do not add a parallel grammar or a separate text-model path.
- `sendUserText` forces a model response (unlike `sendTextHint`, which must not). Null-safe no-op when the session is closed, same pattern as `sendTextHint`.
- Fail-soft: session-start failure restores the typed text to the box (nothing lost); empty/whitespace submissions no-op (no session start on stray Enter).
- The `modality` telemetry field is OPTIONAL with default `'voice'` so existing call sites keep compiling (same pattern as the earlier `resolution` extension).
- Voice-only behavior is untouched; the input box is purely additive. No new dependencies.

---

## File Structure

- Create `src/input/typedInput.ts` + `src/input/typedInput.test.ts` — pure submission guard.
- Create `src/voice/frames.ts` + `src/voice/frames.test.ts` — pure realtime frame builders (shared by openai+azure) + the gemini turns shape.
- Modify `src/voice/types.ts` — add `sendUserText` to `VoiceProvider`.
- Modify `src/voice/openai.ts`, `src/voice/azure.ts`, `src/voice/gemini.ts` — implement it.
- Modify `src/voice/sendUserText.test.ts` (Create) — pre-connect no-throw tests via the real factories.
- Modify `src/telemetry.ts` + Create `src/telemetry.modality.test.ts` — `modality` field + `byModality` slice.
- Modify `src/App.tsx` — `sendTypedInput`, pending-turn stash, modality ref + tagging, input row UI.

---

### Task 1: Pure submission guard

**Files:**
- Create: `src/input/typedInput.ts`, `src/input/typedInput.test.ts`

**Interfaces:**
- Produces: `parseTypedSubmit(raw: string): string` — trimmed text, `''` for empty/whitespace, capped at 500 chars.

- [ ] **Step 1: Write the failing test**

Create `src/input/typedInput.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTypedSubmit } from './typedInput';

describe('parseTypedSubmit', () => {
  it('trims and passes through normal commands', () => {
    expect(parseTypedSubmit('  make this bold  ')).toBe('make this bold');
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(parseTypedSubmit('')).toBe('');
    expect(parseTypedSubmit('   ')).toBe('');
  });
  it('caps at 500 characters', () => {
    expect(parseTypedSubmit('x'.repeat(600))).toHaveLength(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/input/typedInput.test.ts`
Expected: FAIL — `Cannot find module './typedInput'`.

- [ ] **Step 3: Write the implementation**

Create `src/input/typedInput.ts`:
```ts
const MAX_TYPED_CHARS = 500;

/** Normalize a typed submission: trim; '' for empty/whitespace; cap length. */
export function parseTypedSubmit(raw: string): string {
  if (!raw) return '';
  return raw.trim().slice(0, MAX_TYPED_CHARS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/input/typedInput.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/input/typedInput.ts src/input/typedInput.test.ts
git commit -m "feat(input): pure typed-submission guard"
```

---

### Task 2: `sendUserText` across the three providers

**Files:**
- Create: `src/voice/frames.ts`, `src/voice/frames.test.ts`, `src/voice/sendUserText.test.ts`
- Modify: `src/voice/types.ts`, `src/voice/openai.ts`, `src/voice/azure.ts`, `src/voice/gemini.ts`

**Interfaces:**
- Produces:
  - `VoiceProvider.sendUserText(text: string): void` (interface addition)
  - `userTextItemFrame(text: string)` and `responseCreateFrame()` in `frames.ts` (used by openai + azure)
  - `geminiUserTurns(text: string)` in `frames.ts` (used by gemini)

- [ ] **Step 1: Write the failing frame tests**

Create `src/voice/frames.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { userTextItemFrame, responseCreateFrame, geminiUserTurns } from './frames';

describe('realtime frames', () => {
  it('builds the user input_text item frame (openai/azure protocol)', () => {
    expect(userTextItemFrame('make this bold')).toEqual({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'make this bold' }] },
    });
  });
  it('builds the response.create frame', () => {
    expect(responseCreateFrame()).toEqual({ type: 'response.create' });
  });
  it('builds the gemini client-content turns (turnComplete forces a response)', () => {
    expect(geminiUserTurns('undo that')).toEqual({
      turns: [{ role: 'user', parts: [{ text: 'undo that' }] }],
      turnComplete: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/voice/frames.test.ts`
Expected: FAIL — `Cannot find module './frames'`.

- [ ] **Step 3: Write the frames module**

Create `src/voice/frames.ts`:
```ts
// Pure builders for the realtime wire frames used by sendUserText.
// openai.ts and azure.ts speak the same protocol; gemini uses client-content turns.

export function userTextItemFrame(text: string) {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  };
}

export function responseCreateFrame() {
  return { type: 'response.create' };
}

export function geminiUserTurns(text: string) {
  return { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true };
}
```

- [ ] **Step 4: Run frame tests to verify they pass**

Run: `npm test -- src/voice/frames.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `sendUserText` to the interface**

In `src/voice/types.ts`, after the `sendTextHint` member of `VoiceProvider` (line ~36), add:
```ts
  /** Inject a typed user turn and force a model response (unlike sendTextHint, which must not). */
  sendUserText: (text: string) => void;
```

- [ ] **Step 6: Implement in openai.ts**

In `src/voice/openai.ts`: add `import { userTextItemFrame, responseCreateFrame } from './frames';` at the top. After the `sendTextHint` method (ends line ~211), add:
```ts
    sendUserText(text: string) {
      if (latestFrame) { sendImage(latestFrame); lastFrameSentAt = Date.now(); }
      send(userTextItemFrame(text));
      send(responseCreateFrame());
    },
```
(`send()` is already null-safe: it checks `dc.readyState === 'open'`.)

- [ ] **Step 7: Implement in azure.ts**

In `src/voice/azure.ts`: add `import { userTextItemFrame, responseCreateFrame } from './frames';` at the top. After its `sendTextHint` method (ends line ~204), add:
```ts
    sendUserText(text: string) {
      if (latestFrame) { sendImage(latestFrame); lastFrameSentAt = Date.now(); }
      send(userTextItemFrame(text));
      send(responseCreateFrame());
    },
```
(`send()` checks `ws.readyState === WebSocket.OPEN`.)

- [ ] **Step 8: Implement in gemini.ts**

In `src/voice/gemini.ts`: add `import { geminiUserTurns } from './frames';` at the top. After the `sendTextHint` line (line ~99), add:
```ts
    sendUserText(text: string) { session?.sendClientContent(geminiUserTurns(text)); },
```

- [ ] **Step 9: Write the pre-connect no-throw tests**

Create `src/voice/sendUserText.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createGeminiProvider } from './gemini';
import { createOpenAIRealtimeProvider } from './openai';
import { createAzureRealtimeProvider } from './azure';

// sendUserText must be a null-safe no-op before/without a live session (same
// contract as sendTextHint). The factories build closures without touching the
// network, so constructing them in node is safe; connect() is never called.
describe('sendUserText before connect', () => {
  it('gemini: no-throw when session is null', () => {
    expect(() => createGeminiProvider('test-key').sendUserText('hi')).not.toThrow();
  });
  it('openai: no-throw when data channel is absent', () => {
    expect(() => createOpenAIRealtimeProvider().sendUserText('hi')).not.toThrow();
  });
  it('azure: no-throw when websocket is absent', () => {
    expect(() => createAzureRealtimeProvider('https://x.example', 'dep', 'key', 'trans').sendUserText('hi')).not.toThrow();
  });
});
```

- [ ] **Step 10: Run all voice tests + typecheck**

Run: `npm test -- src/voice/ && npm run lint`
Expected: frames (3) + sendUserText (3) PASS; `tsc --noEmit` clean (the interface addition compiles in all three providers). If `WebSocket` is undefined in the node test env for azure's pre-connect path, its `send()` guard (`ws && ...`) short-circuits on `ws === null` first — no reference occurs.

- [ ] **Step 11: Commit**

```bash
git add src/voice/frames.ts src/voice/frames.test.ts src/voice/sendUserText.test.ts src/voice/types.ts src/voice/openai.ts src/voice/azure.ts src/voice/gemini.ts
git commit -m "feat(voice): sendUserText — typed user turns that force a response, all providers"
```

---

### Task 3: Telemetry `modality` dimension

**Files:**
- Modify: `src/telemetry.ts`
- Create: `src/telemetry.modality.test.ts`

**Interfaces:**
- Consumes: existing `telemetry` singleton, `deixis`/`action` events.
- Produces: `type InputModality = 'voice' | 'typed' | 'direct'` (exported); `deixis(..., modality?: InputModality)` and `action(..., modality?: InputModality)` defaulting `'voice'`; `metrics().deixis.byModality` and `metrics().actions.byModality` slices.

- [ ] **Step 1: Write the failing test**

Create `src/telemetry.modality.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'word', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('telemetry modality slicing', () => {
  beforeEach(() => telemetry.start(cfg));

  it('slices deixis accuracy by modality and defaults to voice', () => {
    telemetry.deixis('this', 'Save button', 'Save button', 'high', 'typed');
    telemetry.deixis('this', 'Save button', 'Save As button', 'high', 'typed');
    telemetry.deixis('number', 'Save button', 'Save button', 'high', 'direct');
    telemetry.deixis('this', 'Save button', 'Save button', 'high'); // defaults to voice
    const m = telemetry.metrics();
    expect(m.deixis.byModality.typed).toEqual({ n: 2, correct: 1 });
    expect(m.deixis.byModality.direct).toEqual({ n: 1, correct: 1 });
    expect(m.deixis.byModality.voice).toEqual({ n: 1, correct: 1 });
  });

  it('slices actions by modality', () => {
    telemetry.action('format_content', 'transform', 'commit', 'typed');
    telemetry.action('save_file', 'mutate', 'witness'); // defaults to voice
    const m = telemetry.metrics();
    expect(m.actions.byModality.typed).toEqual({ total: 1, commits: 1, witnesses: 0 });
    expect(m.actions.byModality.voice).toEqual({ total: 1, commits: 0, witnesses: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/telemetry.modality.test.ts`
Expected: FAIL — extra arguments rejected / `byModality` undefined.

- [ ] **Step 3: Extend the events and methods**

In `src/telemetry.ts`:

Add the exported type after `export type FormFactor ...` (line ~14):
```ts
export type InputModality = 'voice' | 'typed' | 'direct';
```

Extend the two events in the `TelemetryEvent` union (lines ~36-37). VERIFIED at HEAD: `deixis` is currently 4-arg (`resolution` exists only on the `grounding` event) — `modality` is the 5th param; do NOT add a `resolution` param to deixis (out of scope):
```ts
  | { t: number; type: 'deixis'; keyword: string; resolved: string | null; target: string | null; confidence: 'high' | 'low'; correct: boolean | null; modality: InputModality }
  | { t: number; type: 'action'; verb: string; verbClass: string; decision: 'commit' | 'witness'; modality: InputModality }
```

Change the two methods (lines ~78-84) to accept the optional trailing param:
```ts
  deixis(keyword: string, resolved: string | null, target: string | null, confidence: 'high' | 'low', modality: InputModality = 'voice') {
    const correct = target ? resolved === target : null;
    this.push({ type: 'deixis', keyword, resolved, target, confidence, correct, modality });
  }
  action(verb: string, verbClass: string, decision: 'commit' | 'witness', modality: InputModality = 'voice') {
    this.push({ type: 'action', verb, verbClass, decision, modality });
  }
```

Add the slices in `metrics()`: after the `conf` helper (line ~100), add:
```ts
    const byMod = (mod: InputModality) => {
      const g = graded.filter(d => (d as any).modality === mod);
      return { n: g.length, correct: g.filter(d => d.correct).length };
    };
```
In the returned `deixis: { ... }` object add:
```ts
        byModality: { voice: byMod('voice'), typed: byMod('typed'), direct: byMod('direct') },
```
And after the `actions` filter (line ~101), add:
```ts
    const actByMod = (mod: InputModality) => {
      const a = actions.filter(x => (x as any).modality === mod);
      return { total: a.length, commits: a.filter(x => x.decision === 'commit').length, witnesses: a.filter(x => x.decision === 'witness').length };
    };
```
In the returned `actions: { ... }` object add:
```ts
        byModality: { voice: actByMod('voice'), typed: actByMod('typed'), direct: actByMod('direct') },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run lint`
Expected: new tests PASS; full suite green; `tsc` clean (existing 3-arg/4-arg call sites in App.tsx still compile via the defaults).

- [ ] **Step 5: Commit**

```bash
git add src/telemetry.ts src/telemetry.modality.test.ts
git commit -m "feat(telemetry): modality dimension (voice/typed/direct) with byModality slices"
```

---

### Task 4: App wiring + input box

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `parseTypedSubmit` (Task 1), `provider.sendUserText` (Task 2), `InputModality` + extended telemetry (Task 3); existing `processInputTranscript` (L1671), `startLiveSession` (L1966), the session callbacks (`onOpen` L2045, `onInputTranscript` L2069), `selectTargetByNumber` (L1653), telemetry call sites (L1622, L1666, L1904), the Listening box JSX (L3552-3576), `addLog`, `isLive`, `providerRef`.
- Produces: behavioral change only.

Verified by typecheck + build + manual smoke (typed commands need a key; the human runs the smoke).

- [ ] **Step 1: Add imports and state**

In `src/App.tsx`, after the perception imports (near L57), add:
```tsx
import { parseTypedSubmit } from './input/typedInput';
import type { InputModality } from './telemetry';
```
After `const [liveTranscription, setLiveTranscription] = useState("");` (L378), add:
```tsx
  const [typedDraft, setTypedDraft] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const pendingTypedRef = useRef<string | null>(null);
  const lastInputModalityRef = useRef<InputModality>('voice');
```

- [ ] **Step 2: Add `sendTypedInput`**

Immediately after the `processInputTranscript` function's closing brace (its definition starts at L1671), add:
```tsx
  // R1 TYPED PARITY: a typed command rides the exact same pipeline as speech —
  // local grammar first (deixis binds to the pointer at type-time, repair, numbers),
  // then a forced model turn. No session? Stash the text and auto-start one.
  const sendTypedInput = (raw: string) => {
    const text = parseTypedSubmit(raw);
    if (!text) return;
    lastInputModalityRef.current = 'typed';
    addLog('event', `⌨ ${text}`);
    setLiveTranscription(text);
    processInputTranscript(text);
    if (providerRef.current) {
      providerRef.current.sendUserText(text);
      setTypedDraft("");
    } else {
      pendingTypedRef.current = text;
      setTypedDraft("");
      setIsConnecting(true);
      startLiveSession();
    }
  };
```
NOTE: `startLiveSession` is defined later in the file (L1966) but `sendTypedInput` only *calls* it at event time — no TDZ issue since both are `const` arrow functions in the same component scope and the call happens post-render. If `tsc` complains about use-before-declaration, move `sendTypedInput`'s definition to just after `startLiveSession` instead.

- [ ] **Step 3: Flush the pending turn on session open, clear connecting state**

In the `onOpen` callback (L2045), after the `telemetry.start({ ... });` call, add:
```tsx
            setIsConnecting(false);
            if (pendingTypedRef.current) {
              providerRef.current?.sendUserText(pendingTypedRef.current);
              pendingTypedRef.current = null;
            }
```
In the `onError` callback (starts L2060), add as its first line (restores the draft so nothing is lost):
```tsx
            setIsConnecting(false);
            if (pendingTypedRef.current) { setTypedDraft(pendingTypedRef.current); pendingTypedRef.current = null; }
```
In the `onClose` callback (L2059), add `setIsConnecting(false);` after `setIsLive(false);`.

- [ ] **Step 4: Tag modality at the three sources**

(a) Voice: change the `onInputTranscript` callback (L2069) to set the modality before processing:
```tsx
          onInputTranscript: (text: string) => { lastInputModalityRef.current = 'voice'; processInputTranscript(text); },
```
(b) Direct: in `selectTargetByNumber` (L1653), add as the first line of the function body:
```tsx
    lastInputModalityRef.current = 'direct';
```
(c) Pass it at the telemetry call sites (Task 3's final signature: modality is the 5th deixis arg, 4th action arg):
- L1904: `telemetry.deixis(kw, foundObject.name, focusTitleRef.current ?? null, confidence.level, lastInputModalityRef.current);`
- L1666: `telemetry.deixis('number', img.title, focusTitleRef.current ?? null, 'high', 'direct');`
- L1622: `telemetry.action(fc.name, verbClass, effectiveDecision, lastInputModalityRef.current);`

- [ ] **Step 5: Add the input row to the Listening box**

In the Listening box `<section>` (L3552-3576), after the closing `</p>` of the transcript paragraph (L3574) and before the inner `</div>`, add:
```tsx
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); sendTypedInput(typedDraft); }}
              >
                <input
                  value={typedDraft}
                  onChange={(e) => setTypedDraft(e.target.value)}
                  placeholder="type a command — point while you type"
                  disabled={isConnecting}
                  className="flex-1 bg-transparent border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none focus:border-[var(--accent-color)] disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={isConnecting || !typedDraft.trim()}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wide bg-[var(--accent-color)]/10 text-[var(--accent-color)] border border-[var(--accent-color)]/30 hover:bg-[var(--accent-color)]/20 disabled:opacity-30 transition-colors"
                >
                  {isConnecting ? '…' : 'Send'}
                </button>
              </form>
```

- [ ] **Step 6: Typecheck, build, full suite**

Run: `npm run lint && npm run build && npm test`
Expected: all pass (typed row renders unconditionally; voice-only behavior unchanged).

- [ ] **Step 7: Manual smoke (record evidence — needs GEMINI_API_KEY)**

`npm run dev`, open the app: (1) with NO session, type `what is this?` while pointing at a tile → session auto-starts, the pending command sends, the model answers about the tile (perceived name); (2) with the session live, type `make this bold` while pointing → same deixis hint + witness/commit + earcon as speaking it; (3) type `undo that` → undo fires (repair grammar); (4) press Enter on an empty box → nothing happens; (5) kill the key, restart, type → error toast, text restored to the box. Export session JSON → `byModality.typed` is populated.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(input): typed command box — full pipeline parity with speech, modality-tagged"
```

---

## Self-Review notes

- **Spec coverage:** §3.1 provider seam (Task 2, frames verified against the providers' existing wire code); §3.2 App wiring incl. pending-send + modality ref (Task 4); §3.3 UI in the Listening box with restore-on-failure (Task 4 Steps 3/5); §3.4 pure guard (Task 1); §5 measurement (Task 3 + Task 4 Step 4); §6 tests (pure + frame + no-throw preconnect; grammar parity inherits `coherence.ts` coverage).
- **Signature verified at HEAD:** `telemetry.deixis` is 4-arg (`resolution` lives only on `grounding`), so `modality` is the 5th deixis param / 4th action param, both optional defaulting `'voice'` — existing call sites compile unchanged.
- **Type consistency:** `parseTypedSubmit`, `sendUserText`, `userTextItemFrame`/`responseCreateFrame`/`geminiUserTurns`, `InputModality`, `byModality` used identically across tasks.
- **DebugLog type:** `addLog('event', …)` uses the existing `'event'` member of `DebugLog['type']` (`'info' | 'gemini' | 'tool' | 'event'`) — no type change needed.
```
