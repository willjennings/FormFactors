# Word-Level Interaction — Phase A (Word Referent Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an individual word in the Word document a first-class pointable, groundable referent — via honest mirror-div DOM measurement — so "point at a word and ask about it" works through the existing grammar.

**Architecture:** A new `src/perception/measureWords.ts` measures per-word boxes from the Word `<textarea>` using a hidden mirror div + `Range.getClientRects()` (real layout, not OCR/perception). App swaps the dead OCR-fed word seam (`ocrWordsRef`) for a live `wordBoxesRef`, points `wordAt` at it, and extends the proactive-grounding deixis hint to name the hovered word + its character span.

**Tech Stack:** React 19, TypeScript, Vitest (node env — pure tests only), the DOM `Range` API, the existing `wordAt`/`hoveredWord`/deixis-hint seam.

**Spec:** `docs/superpowers/specs/2026-07-09-word-level-interaction-design.md` (Part A; §2). This is Phase A of a 3-phase build (A: referent → B: `revise_text` editing → C: `act_on` outward). Phases B and C are separate plans.

## Global Constraints

- **Measured, not perceived/OCR'd:** word geometry comes only from `Range` measurement of the real textarea text layout. Do NOT use `src/ocr.ts` (retired image-OCR). No pixel perception, no faked coordinates.
- **Fail-soft:** any measurement failure → `measureWords` returns `[]` → the app falls back to whole-element pointing (today's behavior when `ocrWordsRef` is empty). The word referent is strictly additive — never a regression.
- **0–1000 plane space, `[ymin,xmin,ymax,xmax]`:** `rectToBox` must match the existing `toBBox` convention in `updateLayout` exactly — `((r.top - plane.top) / plane.height) * 1000`, etc. The plane rect is `mainContainerRef.current.getBoundingClientRect()`.
- **Preserve the seam consumers:** `wordAt` keeps returning an object with a `.word` string (consumed at the voice-keyword handler and the hover handler); it MAY add `charStart`/`charEnd`.
- **Node test env:** pure cores (`tokenizeWords`, `rectToBox`) are unit-tested; the DOM `Range` glue (`measureWords`) has no jsdom test — its gate is tsc + full suite + build, and it's verified by human smoke.

---

### Task 1: Pure cores — `tokenizeWords` + `rectToBox`

**Files:**
- Create: `src/perception/measureWords.ts` (pure exports only in this task)
- Test: `src/perception/measureWords.test.ts`

**Interfaces:**
- Produces:
  - `type WordBox = { text: string; charStart: number; charEnd: number; box: [number, number, number, number] }`
  - `tokenizeWords(text: string): { text: string; charStart: number; charEnd: number }[]`
  - `rectToBox(rect: { top: number; left: number; bottom: number; right: number }, plane: { top: number; left: number; width: number; height: number }): [number, number, number, number]`

- [ ] **Step 1: Write the failing test**

Create `src/perception/measureWords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tokenizeWords, rectToBox } from './measureWords';

describe('tokenizeWords', () => {
  it('splits into non-whitespace runs with exact char offsets', () => {
    expect(tokenizeWords('The quarterly report')).toEqual([
      { text: 'The', charStart: 0, charEnd: 3 },
      { text: 'quarterly', charStart: 4, charEnd: 13 },
      { text: 'report', charStart: 14, charEnd: 20 },
    ]);
  });

  it('handles padded/irregular whitespace and keeps punctuation attached', () => {
    expect(tokenizeWords('  Hello,  world!  ')).toEqual([
      { text: 'Hello,', charStart: 2, charEnd: 8 },
      { text: 'world!', charStart: 10, charEnd: 16 },
    ]);
  });

  it('returns [] for empty or whitespace-only text', () => {
    expect(tokenizeWords('')).toEqual([]);
    expect(tokenizeWords('   \n  ')).toEqual([]);
  });
});

describe('rectToBox', () => {
  const plane = { top: 100, left: 200, width: 1000, height: 800 };

  it('maps a client rect into 0-1000 plane space (matches toBBox)', () => {
    // a rect flush with the plane origin, 100px wide x 80px tall
    const box = rectToBox({ top: 100, left: 200, bottom: 180, right: 300 }, plane);
    // ymin=(0/800)*1000=0, xmin=(0/1000)*1000=0, ymax=(80/800)*1000=100, xmax=(100/1000)*1000=100
    expect(box).toEqual([0, 0, 100, 100]);
  });

  it('maps an interior rect proportionally on both axes', () => {
    // rect at (left+500px, top+400px) size 100x80 within a 1000x800 plane
    const box = rectToBox({ top: 500, left: 700, bottom: 580, right: 800 }, plane);
    // ymin=(400/800)*1000=500, xmin=(500/1000)*1000=500, ymax=(480/800)*1000=600, xmax=(600/1000)*1000=600
    expect(box).toEqual([500, 500, 600, 600]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/perception/measureWords.test.ts`
Expected: FAIL — cannot resolve `./measureWords`.

- [ ] **Step 3: Write the pure implementation**

Create `src/perception/measureWords.ts`:

```ts
// Honest per-word geometry for the Word textarea (C2b Part A). The pure cores here are unit-tested;
// the DOM Range glue (measureWords, added in the next task) reads the REAL text layout — no OCR,
// no perception model.

/** A measured word: its text, character span in the source value, and 0-1000 plane-space box. */
export interface WordBox {
  text: string;
  charStart: number;
  charEnd: number;
  box: [number, number, number, number]; // ymin, xmin, ymax, xmax
}

/** Split text into non-whitespace word runs with exact character offsets. Pure. */
export function tokenizeWords(text: string): { text: string; charStart: number; charEnd: number }[] {
  const out: { text: string; charStart: number; charEnd: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], charStart: m.index, charEnd: m.index + m[0].length });
  }
  return out;
}

/** Map a viewport client rect into 0-1000 plane space — matches updateLayout's toBBox convention. */
export function rectToBox(
  rect: { top: number; left: number; bottom: number; right: number },
  plane: { top: number; left: number; width: number; height: number },
): [number, number, number, number] {
  return [
    ((rect.top - plane.top) / plane.height) * 1000,
    ((rect.left - plane.left) / plane.width) * 1000,
    ((rect.bottom - plane.top) / plane.height) * 1000,
    ((rect.right - plane.left) / plane.width) * 1000,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/perception/measureWords.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/perception/measureWords.ts src/perception/measureWords.test.ts
git commit -m "feat(perception): tokenizeWords + rectToBox — pure cores of word measurement (TDD)"
```

---

### Task 2: DOM glue — `measureWords`

**Files:**
- Modify: `src/perception/measureWords.ts` (add the DOM function; the pure cores stay)

**Interfaces:**
- Consumes: `tokenizeWords`, `rectToBox`, `WordBox` (Task 1).
- Produces: `measureWords(textarea: HTMLTextAreaElement, plane: { top: number; left: number; width: number; height: number }): WordBox[]`

**Context:** No unit test (jsdom cannot run `getClientRects`; the project's vitest env is `node`). The pure math is already tested in Task 1. Gate: tsc + full suite green + build. Verified by human smoke (Task 3 wires it live).

The mirror div must overlay the textarea EXACTLY (same viewport position and box metrics) so the Range rects land where the textarea's text visually is; then `rectToBox` maps them into the same plane space entities use.

- [ ] **Step 1: Add the DOM function**

Append to `src/perception/measureWords.ts`:

```ts
// Build a hidden div that reproduces the textarea's text layout at its exact on-screen position,
// so Range.getClientRects() over its text node yields the words' real viewport rects.
function buildMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const r = textarea.getBoundingClientRect();
  const cs = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const copy = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
    'lineHeight', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
  ] as const;
  for (const p of copy) mirror.style[p as any] = cs[p as any];
  mirror.style.position = 'fixed';
  mirror.style.top = `${r.top}px`;
  mirror.style.left = `${r.left}px`;
  mirror.style.width = `${r.width}px`;
  mirror.style.height = `${r.height}px`;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordWrap = 'break-word';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.zIndex = '-1';
  mirror.textContent = textarea.value;
  return mirror;
}

/**
 * Measure per-word boxes for a textarea via a transient mirror div + Range. Returns [] on any
 * failure (fail-soft → whole-element pointing). Boxes are in 0-1000 plane space.
 */
export function measureWords(
  textarea: HTMLTextAreaElement,
  plane: { top: number; left: number; width: number; height: number },
): WordBox[] {
  const tokens = tokenizeWords(textarea.value);
  if (!tokens.length) return [];
  let mirror: HTMLDivElement | null = null;
  try {
    mirror = buildMirror(textarea);
    document.body.appendChild(mirror);
    const node = mirror.firstChild;
    if (!node) return [];
    const range = document.createRange();
    const boxes: WordBox[] = [];
    for (const t of tokens) {
      range.setStart(node, t.charStart);
      range.setEnd(node, t.charEnd);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const r = rects[0]; // first fragment if the word wraps a line
      boxes.push({ text: t.text, charStart: t.charStart, charEnd: t.charEnd, box: rectToBox(r, plane) });
    }
    return boxes;
  } catch {
    return [];
  } finally {
    if (mirror && mirror.parentNode) mirror.parentNode.removeChild(mirror);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If `mirror.style[p as any] = cs[p as any]` trips strict indexing, keep the `as any` casts shown — they're the pragmatic seam for copying computed styles.)

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all existing tests + Task 1's tests green (this task adds no tests).

- [ ] **Step 4: Verify the build**

Run: `npx vite build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/perception/measureWords.ts
git commit -m "feat(perception): measureWords — mirror-div Range measurement of textarea words (fail-soft)"
```

---

### Task 3: Swap the word seam + word deixis referent

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `measureWords`, `WordBox` from `./perception/measureWords`.
- Produces: a live `wordBoxesRef`; `wordAt` returning `{ word, charStart, charEnd }`; a deixis hint that names the hovered word + span.

**Context:** Today `wordAt` (App ~line 500) reads `ocrWordsRef` (fed by retired image OCR — now always empty, so word pointing is dead). This task points it at a live `wordBoxesRef` filled by `measureWords` from the Word textarea, and extends the hover deixis hint (~line 2094) to name the word. The Word body textarea lives inside the program surface; get it via `surfaceRef.current?.querySelector('textarea')`. The plane rect is `mainContainerRef.current?.getBoundingClientRect()`.

Do NOT rip out the broader OCR module (`src/ocr.ts`, the `ocrEnabled` toggle, the retired OCR effect) in this task — that cleanup is orthogonal and risky (touches the debug drawer + unmount). Only replace what `wordAt` needs and remove references that become unused *and* that tsc/lint flags. Leaving `src/ocr.ts` in place is fine; note it as a follow-up.

- [ ] **Step 1: Add the imports + refs**

In `src/App.tsx`, near the perception imports (the `import type { PerceivedCache } from './perception/perceiveTile';` line ~41), add:

```ts
import { measureWords, type WordBox } from './perception/measureWords';
```

Immediately after the `hoveredWordRef` declaration (~line 496), add:

```ts
  // C2b Part A: live per-word boxes measured from the Word textarea (replaces the retired OCR
  // source). hoveredWordBoxRef carries the full referent (text + char span) for deixis + editing.
  const wordBoxesRef = useRef<WordBox[]>([]);
  const hoveredWordBoxRef = useRef<WordBox | null>(null);
```

- [ ] **Step 2: Rewrite `wordAt` to hit-test `wordBoxesRef`**

In `src/App.tsx`, replace the entire `wordAt` function (~lines 500-518, the one that loops `entitiesRef.current` and reads `ocrWordsRef`) with:

```ts
  // C2b: the measured word (if any) under a normalized 0-1000 point — smallest containing box.
  const wordAt = (x: number, y: number): WordBox | null => {
    let best: WordBox | null = null;
    for (const w of wordBoxesRef.current) {
      const [ymin, xmin, ymax, xmax] = w.box;
      if (x < xmin || x > xmax || y < ymin || y > ymax) continue;
      if (!best) { best = w; continue; }
      const area = (b: WordBox) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
      if (area(w) < area(best)) best = w;
    }
    return best;
  };
```

- [ ] **Step 3: Update the two `wordAt` consumers for the new `WordBox` return**

`wordAt` now returns a `WordBox` (`.text`/`.charStart`/`.charEnd`/`.box`) instead of the old `{ word, photoTitle }`. Two call sites read the old shape and must be updated (tsc will flag them otherwise).

**Consumer 1 — the voice-keyword handler (~line 1551):** find

```ts
          // G3: if an OCR word sits under the focus point, refine the referent to that word.
          const sub = wordAt(hX, hY);
          const subTag = sub && sub.photoTitle === foundObject.title ? ` (specifically the word "${sub.word}")` : '';
```

and, further down, the referent note:

```ts
          if (sub && sub.photoTitle === foundObject.title) referents.note(`"${sub.word}"`, 'pointed');
```

Replace both. Since `measureWords` only measures the single Word textarea, a measured word is inherently the document body's — the old `photoTitle === foundObject.title` cross-check is obsolete, so drop it and use `.text`:

```ts
          // C2b: if a measured word sits under the focus point, refine the referent to that word.
          const sub = wordAt(hX, hY);
          const subTag = sub ? ` (specifically the word "${sub.text}")` : '';
```

```ts
          if (sub) referents.note(`"${sub.text}"`, 'pointed');
```

**Consumer 2 — the hover handler (~line 2072):** find the hover handler's word block:

```ts
    // G3: which OCR word (if any) is under the cursor — finer-grained referent + feedforward.
    const sub = hovered ? wordAt(hX, hY) : null;
    const wordName = sub?.word ?? null;
    if (wordName !== hoveredWordRef.current) {
      hoveredWordRef.current = wordName;
      setHoveredWord(wordName);
    }
```

Replace it with (keeps `.word` semantics, also stores the full box for the hint + later phases):

```ts
    // C2b: which measured word (if any) is under the cursor — finer-grained referent + feedforward.
    const sub = hovered ? wordAt(hX, hY) : null;
    hoveredWordBoxRef.current = sub;
    const wordName = sub?.text ?? null;
    if (wordName !== hoveredWordRef.current) {
      hoveredWordRef.current = wordName;
      setHoveredWord(wordName);
    }
```

- [ ] **Step 4: Extend the deixis hint with the word + span**

In `src/App.tsx`, find the proactive-grounding hint (~line 2094):

```ts
      const hoveredResolved = displayName(found);
      providerRef.current.sendTextHint(`[CONTEXT: the cursor is currently over "${hoveredResolved}". If the user says "this", "here", or "that", they are pointing at ${hoveredResolved}. This is silent context — DO NOT RESPOND OR SPEAK.]`);
```

Replace with:

```ts
      const hoveredResolved = displayName(found);
      const w = hoveredWordBoxRef.current;
      const wordClause = w
        ? ` — specifically the word "${w.text}" (chars ${w.charStart}–${w.charEnd} in the document text)`
        : '';
      providerRef.current.sendTextHint(`[CONTEXT: the cursor is currently over "${hoveredResolved}"${wordClause}. If the user says "this", "here", or "that", they are pointing at ${w ? `the word "${w.text}"` : hoveredResolved}. This is silent context — DO NOT RESPOND OR SPEAK.]`);
```

- [ ] **Step 5: Add the word-measurement refresh effect**

In `src/App.tsx`, near the other live-gated refresh effects (e.g. the C2a instruction-snapshot effect or the spreadsheet-hint effect ~line 2440), add a new effect. It re-measures on mount, program/doc change, and window resize; clears when not on the Word program:

```ts
  // C2b Part A: keep wordBoxesRef in sync with the Word textarea's live layout. Cleared for
  // non-word programs so stale word boxes never leak. Fail-soft: measureWords returns [] on error.
  useEffect(() => {
    const measure = () => {
      const ta = surfaceRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;
      const planeEl = mainContainerRef.current;
      if (activeProgram !== 'word' || !ta || !planeEl) { wordBoxesRef.current = []; return; }
      const r = planeEl.getBoundingClientRect();
      wordBoxesRef.current = measureWords(ta, { top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeProgram, mockDoc, windowRect, windowOpen]);
```

- [ ] **Step 6: Remove now-dead OCR word references that tsc/lint flags**

`ocrWordsRef` is no longer read by `wordAt`. If tsc/lint flags it (or `OcrWord`) as unused, remove the `ocrWordsRef` declaration (~line 494) and its assignments (e.g. in `handleProgramChange` ~line 2476 `ocrWordsRef.current = {}`). Do NOT remove `terminateOcr`/`clearOcrCache`/`ocrImage`/`ocrEnabled` or delete `src/ocr.ts` — that broader cleanup is a noted follow-up. If nothing is flagged, leave it. The goal is a clean tsc, not a full OCR teardown.

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (no regressions; this task adds no unit tests).
Run: `npx vite build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(perception): live word measurement seam + word deixis referent (C2b Part A)"
```

---

## Human smoke (owed — not a task; some needs an API key)

- Load the Word program, hover a word in the document body → the "Pointing at" pill reads `"word" in Document body` (or the element name) and tracks word-by-word as you move.
- With a live session: hover a word and say "what's this?" → the model grounds to the word (the deixis hint names it + its char span).
- Edit the document text, then re-hover → word boxes track the new layout (the refresh effect re-measured on `mockDoc` change).
- Switch to a non-Word program → no stale word boxes (pill falls back to element pointing).
