# Word-Level Interaction — Phase B (Word-Grounded Editing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user point at a word/span and have the agent change it and iterate the text — via a witnessed, reversible `revise_text` span edit — while hardening word measurement for the longer/edited text that editing makes real.

**Architecture:** First harden `measureWords` for the two honesty vectors the Phase A final review flagged as Phase-B-blocking (internal scroll #1, live-draft staleness #2). Then add a `revise_text` verb: `applyAction` splices `[charStart, charEnd)` in the Word doc; the model — grounded on the pointed word (Phase A) + `DOCUMENT STATE` — computes the span and replacement; the App witness-renders a before→after diff (reusing the pending-action mechanism) and commits on confirm, covered by undo. Iteration is repeated witnessed calls.

**Tech Stack:** React 19, TypeScript, Vitest (node — pure tests only), the DOM `Range` API, the existing `applyAction`/`pendingAction`/`confirmPendingAction`/`decideCommit` witness-commit grammar.

**Spec:** `docs/superpowers/specs/2026-07-09-word-level-interaction-design.md` (Part B / §3). Phase B of 3 (A landed: `375496d..136ae62`; C = `act_on` outward, next plan). Consumes Phase A's `measureWords`/`WordBox`/`wordBoxesRef`/`hoveredWordBoxRef`.

## Global Constraints

- **Honest measurement:** word boxes must track what the user actually sees — after this phase, a scrolled or mid-edit textarea must NOT resolve a word the user isn't pointing at (Phase A review #1/#2). Fail-soft to `[]` on any error stays intact.
- **Witnessed + reversible edits:** `revise_text` ALWAYS witness-renders a before→after diff and commits only on explicit user confirm; every commit pushes an undo memento. No silent text mutation.
- **Span splice is honest + clamped:** `text.slice(0,s) + newText + text.slice(e)` with `s`/`e` clamped to `[0, text.length]`, `s ≤ e`.
- **Word-doc only:** `revise_text` applies to `doc.kind === 'word'`; on any other program or an invalid span it returns an honest tool error, no mutation.
- **Node test env:** pure cores (`wordInFrame`, the `applyAction` splice) are unit-tested; DOM glue + App wiring gate on tsc + full suite + build.
- Reuse the existing witness UI (`pendingAction` card, `confirmPendingAction`, `cancelPendingAction`, the undo stack) — do not build a parallel witness surface.

---

### Task 1: Harden `measureWords` for scroll + off-screen words (review #1)

**Files:**
- Modify: `src/perception/measureWords.ts`
- Test: `src/perception/measureWords.test.ts` (add cases)

**Interfaces:**
- Produces: `wordInFrame(box, frame): boolean` (pure, exported); `measureWords` now offsets by the textarea's scroll and clips words outside the visible frame.

**Context:** Phase A's `buildMirror` positions the mirror at the textarea's rect but ignores `scrollTop`/`scrollLeft`, and `measureWords` returns boxes for every word including those scrolled out of view — so on a long/scrolled doc a word the user can't see could resolve under the cursor. Fix: shift the mirror up/left by the scroll offset (so visible words land at their true viewport position) and drop any word whose box centre falls outside the textarea's visible frame.

- [ ] **Step 1: Write the failing test (add to the existing describe block)**

Append to `src/perception/measureWords.test.ts`:

```ts
import { wordInFrame } from './measureWords';

describe('wordInFrame', () => {
  const frame: [number, number, number, number] = [100, 100, 300, 900]; // ymin,xmin,ymax,xmax

  it('keeps a word whose centre is inside the frame', () => {
    expect(wordInFrame([150, 200, 180, 260], frame)).toBe(true);
  });

  it('drops a word scrolled above the frame', () => {
    expect(wordInFrame([40, 200, 70, 260], frame)).toBe(false); // centre y=55 < 100
  });

  it('drops a word below the frame', () => {
    expect(wordInFrame([320, 200, 360, 260], frame)).toBe(false); // centre y=340 > 300
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/perception/measureWords.test.ts`
Expected: FAIL — `wordInFrame` is not exported.

- [ ] **Step 3: Implement `wordInFrame` + wire scroll offset + clip**

In `src/perception/measureWords.ts`, add the pure helper (near `rectToBox`):

```ts
/** True if the word box's centre lies within the visible frame (both boxes in 0-1000 plane space). */
export function wordInFrame(box: [number, number, number, number], frame: [number, number, number, number]): boolean {
  const cy = (box[0] + box[2]) / 2;
  const cx = (box[1] + box[3]) / 2;
  return cy >= frame[0] && cy <= frame[2] && cx >= frame[1] && cx <= frame[3];
}
```

In `buildMirror`, change the position lines to subtract the textarea's scroll so on-screen text aligns:

```ts
  mirror.style.top = `${r.top - textarea.scrollTop}px`;
  mirror.style.left = `${r.left - textarea.scrollLeft}px`;
```

(Replace the existing `mirror.style.top = \`${r.top}px\`;` / `mirror.style.left = \`${r.left}px\`;` lines.)

In `measureWords`, compute the visible frame from the textarea's own rect and clip after building boxes. Replace the `return boxes;` line with:

```ts
    const frame = rectToBox(
      { top: textarea.getBoundingClientRect().top, left: textarea.getBoundingClientRect().left,
        bottom: textarea.getBoundingClientRect().bottom, right: textarea.getBoundingClientRect().right },
      plane,
    );
    return boxes.filter((b) => wordInFrame(b.box, frame));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/perception/measureWords.test.ts`
Expected: PASS (8 tests — 5 from Phase A + 3 new).

- [ ] **Step 5: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/perception/measureWords.ts src/perception/measureWords.test.ts
git commit -m "fix(perception): scroll-offset the word mirror + clip off-screen words (C2b review #1)"
```

---

### Task 2: Re-measure on live typing + scroll (review #2)

**Files:**
- Modify: `src/App.tsx` (the word-measurement refresh effect added in Phase A)

**Context:** The Word textarea renders `value={draft ?? m.text}` with local `draft` state not committed to `mockDoc` until blur, so mid-typing the word boxes lag the visible text. Fix: within the refresh effect, also re-measure on the textarea's `input` and `scroll` events (live layout), not just on `mockDoc` change. Integration wiring — gate is tsc + suite + build.

- [ ] **Step 1: Attach input/scroll listeners in the refresh effect**

In `src/App.tsx`, find the Phase A refresh effect (comment "C2b Part A: keep wordBoxesRef in sync with the Word textarea's live layout"). Replace its body with the version that also listens on the textarea:

```ts
  useEffect(() => {
    const ta = surfaceRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;
    const measure = () => {
      const planeEl = mainContainerRef.current;
      if (activeProgram !== 'word' || !ta || !planeEl) { wordBoxesRef.current = []; return; }
      const r = planeEl.getBoundingClientRect();
      wordBoxesRef.current = measureWords(ta, { top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    ta?.addEventListener('input', measure);   // live draft (value = draft ?? text), not yet in mockDoc
    ta?.addEventListener('scroll', measure);  // long doc scrolled → re-measure visible words
    return () => {
      window.removeEventListener('resize', measure);
      ta?.removeEventListener('input', measure);
      ta?.removeEventListener('scroll', measure);
    };
  }, [activeProgram, mockDoc, windowRect, windowOpen]);
```

- [ ] **Step 2: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix(perception): re-measure words on live typing + scroll (C2b review #2)"
```

---

### Task 3: `revise_text` reducer + verb + tool

**Files:**
- Modify: `src/scenarios.ts`
- Test: `src/scenarios.test.ts` (add; or create `src/scenarios.revise.test.ts` if the file is unwieldy — check first)

**Interfaces:**
- Produces: `applyAction` accepts `{ charStart?, charEnd?, newText? }`; a `revise_text` word-doc splice; `VERB_CLASS.revise_text = 'mutate'`; an exported `REVISE_TOOL: VoiceTool`.
- Consumes: existing `MockDoc`, `VoiceTool`.

- [ ] **Step 1: Write the failing test**

Add to `src/scenarios.test.ts` (import `applyAction` + `initialMockDoc` if not already):

```ts
import { describe, it, expect } from 'vitest';
import { applyAction, initialMockDoc } from './scenarios';
import type { MockDoc } from './scenarios';

describe('revise_text splice', () => {
  // narrowed so { ...d, text } is the word variant → assignable to MockDoc (no `as const`).
  const word = (): MockDoc => {
    const d = initialMockDoc('word');
    return d.kind === 'word' ? { ...d, text: 'The quarterly report summary.' } : d;
  };

  it('replaces a mid-text span', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 4, charEnd: 13, newText: 'annual' });
    expect((d as { text: string }).text).toBe('The annual report summary.');
  });

  it('clamps a span past the end and treats start>len as end', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 100, charEnd: 200, newText: '!' });
    expect((d as { text: string }).text).toBe('The quarterly report summary.!');
  });

  it('empty newText deletes the span', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 3, charEnd: 13, newText: '' });
    expect((d as { text: string }).text).toBe('The report summary.');
  });

  it('leaves non-word docs unchanged', () => {
    const excel = initialMockDoc('excel');
    expect(applyAction(excel, 'revise_text', { charStart: 0, charEnd: 1, newText: 'x' })).toEqual(excel);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scenarios.test.ts`
Expected: FAIL — `revise_text` not handled (text unchanged / wrong).

- [ ] **Step 3: Extend `applyAction` + add the verb metadata + tool**

In `src/scenarios.ts`, widen the `applyAction` args type:

```ts
export function applyAction(
  doc: MockDoc, verb: string,
  args: { target?: string; detail?: string; charStart?: number; charEnd?: number; newText?: string } = {},
): MockDoc {
```

In the `case 'word':` block, add (before the final `return doc;`):

```ts
      if (verb === 'revise_text') {
        const t = doc.text;
        const s = Math.max(0, Math.min(args.charStart ?? 0, t.length));
        const e = Math.max(s, Math.min(args.charEnd ?? s, t.length));
        return { ...doc, text: t.slice(0, s) + (args.newText ?? '') + t.slice(e) };
      }
```

Add to `VERB_CLASS`:

```ts
  revise_text: 'mutate',
```

Export the tool (near the other tool/verb exports):

```ts
export const REVISE_TOOL: VoiceTool = {
  name: 'revise_text',
  description: 'Rewrite a span of the Word document the user is pointing at — change a word, rephrase a sentence, or make it more formal/casual. Provide charStart and charEnd (the character range to replace, from the [CONTEXT] word span the user is pointing at, expanded to the sentence/phrase they mean) and newText (your replacement). HIGH-COMMITMENT: it is witness-rendered as a before→after diff and applied only after the user confirms. To iterate, call again with a new newText.',
  parameters: { type: 'object', properties: {
    charStart: { type: 'number', description: 'Start character offset (inclusive) of the span to replace.' },
    charEnd: { type: 'number', description: 'End character offset (exclusive) of the span to replace.' },
    newText: { type: 'string', description: 'The replacement text.' },
  }, required: ['charStart', 'charEnd', 'newText'] },
};
```

(If `VoiceTool` isn't already imported in `scenarios.ts`, it is — see the existing `import type { VoiceTool } from './voice/types';`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scenarios.test.ts`
Expected: PASS (4 new + existing green).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/scenarios.ts src/scenarios.test.ts
git commit -m "feat(scenarios): revise_text span-splice reducer + verb + REVISE_TOOL (TDD)"
```

---

### Task 4: `revise_text` App wiring — witness, commit, tool, prompt

**Files:**
- Modify: `src/App.tsx`

**Context:** `revise_text` carries a char span (not the `{target,detail}` other verbs use), so it needs: (a) the `pendingAction` state to carry the span, (b) `confirmPendingAction` to thread it to `applyAction`, (c) a dedicated `revise_text` branch in `handleVoiceToolCall` that ALWAYS witness-renders a before→after diff, (d) `REVISE_TOOL` added to the live tool set for the Word program, (e) a prompt note. Integration — gate tsc + suite + build.

- [ ] **Step 1: Import `REVISE_TOOL`**

In `src/App.tsx`, add `REVISE_TOOL` to the existing `import { ... } from './scenarios';` list (alongside `buildActionTools`, `applyAction`, etc.).

- [ ] **Step 2: Extend `pendingAction` to carry the span**

In `src/App.tsx`, widen the `pendingAction` state type (~line 515) to add optional span fields:

```ts
  const [pendingAction, setPendingAction] = useState<{ verb: string; label: string; target: string; detail?: string; confirmed: boolean; note?: string; charStart?: number; charEnd?: number; newText?: string } | null>(null);
```

- [ ] **Step 3: Thread the span through `confirmPendingAction`**

In `confirmPendingAction` (~line 1268), pass the span fields to `applyAction`:

```ts
    const nextDoc = applyAction(prevDoc, p.verb, { target: p.target, detail: p.detail, charStart: p.charStart, charEnd: p.charEnd, newText: p.newText });
```

(Only that one `applyAction(...)` line changes; the rest of `confirmPendingAction` is unchanged. `classOf('revise_text')` returns `'mutate'` from Task 3, so telemetry/feedback work.)

- [ ] **Step 4: Add the `revise_text` routing branch**

In `src/App.tsx` `handleVoiceToolCall`, add a branch (place it beside the other named-verb branches, before the `annotate_` branch):

```ts
    } else if (fc.name === 'revise_text') {
      // C2b Part B: witnessed, reversible span edit. Always witness-render the before→after diff;
      // the user confirms via the pending-action card (confirmPendingAction applies + undo memento).
      const a = (fc.args ?? {}) as { charStart?: number; charEnd?: number; newText?: string };
      const doc = mockDocRef.current;
      const cs = Number(a.charStart), ce = Number(a.charEnd);
      if (doc.kind !== 'word' || !Number.isFinite(cs) || !Number.isFinite(ce)) {
        addLog('tool', `Tool Call: revise_text REJECTED — needs a valid span in the Word document`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: 'revise_text needs a valid character span in the Word document.' });
      } else {
        const s = Math.max(0, Math.min(cs, doc.text.length));
        const e = Math.max(s, Math.min(ce, doc.text.length));
        const oldText = doc.text.slice(s, e);
        const newText = String(a.newText ?? '');
        addLog('tool', `Tool Call: revise_text(witness) — "${oldText}" → "${newText}"`);
        setPendingAction({ verb: 'revise_text', label: 'Revise', target: `"${oldText}"`, detail: `→ "${newText}"`, confirmed: false, charStart: s, charEnd: e, newText });
        emitFeedback({ outcome: 'needs-confirm', verbClass: 'mutate', label: `Confirm revise: "${oldText}" → "${newText}"` });
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, witnessed: true });
      }
```

- [ ] **Step 5: Add `REVISE_TOOL` to the Word tool set**

In `src/App.tsx`, update the `voiceTools` memo to include `REVISE_TOOL` only for the Word program:

```ts
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : [])],
```

(Leave the memo dep array as-is — `activeProgram` is already a dep.)

- [ ] **Step 6: Add the prompt note**

In `src/prompt/instructions.ts`, add one sentence to the instruction string (near the annotation note added in C2a-illustrate, matching the file's existing assembly style):

```
When the user points at a word in the Word document and asks to change it or make it read differently, call revise_text with the character span from the [CONTEXT] hint (expand it to the sentence or phrase they mean) and your rewritten text — it is shown as a before→after diff and applied only after they confirm; call it again to iterate.
```

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (194 + the 3 new measureWords + 4 new revise_text tests).
Run: `npx vite build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/prompt/instructions.ts
git commit -m "feat(editing): revise_text witness/commit wiring + Word tool + prompt (C2b Part B)"
```

---

## Human smoke (owed — needs an API key)

- Hover a word, say "change this to X" → a before→after diff witness card appears; confirm → the word changes; ⌘Z undoes it.
- "Make this sentence more formal" → the model expands the span and witness-renders the rewrite; iterate with "more formal still" → a new witnessed diff each time.
- Scroll a long doc / type mid-word → word boxes track the visible text (no stale/off-screen word resolves under the cursor).
- Try `revise_text` on a non-Word program (shouldn't be offered; if forced, returns an honest error).
