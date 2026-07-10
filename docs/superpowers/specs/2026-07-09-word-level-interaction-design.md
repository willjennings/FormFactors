# Word-Level Interaction (Project C2b) — Design Spec

*Make an individual word a first-class thing the user can point at and ground "this/that" to, then
run the whole grammar on it: ask about it, edit it and iterate the text, or act outward on what it
names. Word geometry comes from honest DOM text measurement (the mirror-div technique), never OCR
or a perception model. Fourth foundation of Project C; builds on C1 (entities), C2a (perception),
and C2a-illustrate (the annotation seam).*

Date: 2026-07-09
Branch: `honest-mode`
Status: Approved design — ready for implementation planning (phased).
Decision record:
- **Scope = foundation + editing + outward** (all three layers the user chose).
- **Word geometry is MEASURED, not perceived.** The Word body is a `<textarea>` (no per-word DOM
  nodes); the mirror-div + `Range.getClientRects()` technique reads the *actual* text layout to
  produce per-word boxes and caret positions. This is measurement — it fakes nothing — which is
  what makes word-pointing honest without a perception model. (The old `src/ocr.ts` Tesseract path
  was for the retired picsum tiles and is not used here.)
- **The word seam already exists** (`wordAt`/`hoveredWord`/the "Pointing at" pill consume
  `ocrWordsRef`); C2b swaps the dead OCR data source for live measurement, so most consumers keep
  working.
- **Edits are witnessed + undoable; outward actions are simulated + witnessed** (like `share` —
  no real integration). Honesty is preserved by labeling the simulation and showing every change
  before it commits.
- **Phased implementation:** one spec, but 2–3 plans (A → B → C), each landing + pushing
  independently.

---

## 1. Principle: the word as a first-class referent

Today only whole elements (and C1's cells/slides) are pointable. A word inside the Word textarea
is not a referent at all — the existing `wordAt`/`hoveredWord` seam is wired but its data source
(image OCR) was retired with the picsum tiles. Every capability the user described —
"point at a word and ask about it / change it / act on what it names" — depends on one foundation:
a word becomes a thing you can point at, that grounds "this/that," and that carries a stable text +
character span into the grammar. C2b builds that foundation (Part A) and the two application layers
that consume it (Parts B, C).

## 2. Part A — Word measurement + the word referent (foundation)

### 2.1 Measurement (the mirror-div technique)

`src/perception/measureWords.ts`:

```ts
export interface WordBox {
  text: string;                                   // the word as written
  charStart: number; charEnd: number;             // offsets into the textarea value
  box: [number, number, number, number];          // ymin,xmin,ymax,xmax in 0-1000 plane space
}

// Pure, unit-tested: split text into words with their character offsets.
export function tokenizeWords(text: string): { text: string; charStart: number; charEnd: number }[];

// Pure, unit-tested: map a client rect into 0-1000 plane space given the plane's bounding rect.
export function rectToBox(
  rect: { top: number; left: number; bottom: number; right: number },
  plane: { top: number; left: number; width: number; height: number },
): [number, number, number, number];

// DOM glue (human-smoke; jsdom can't run getClientRects): build/refresh a hidden mirror div with
// the textarea's exact box metrics, then Range-measure each token from tokenizeWords into a WordBox.
export function measureWords(textarea: HTMLTextAreaElement, plane: DOMRect): WordBox[];

// DOM glue: the caret point for a character offset (zero-width Range) → 0-1000 plane point.
export function caretPoint(textarea: HTMLTextAreaElement, offset: number, plane: DOMRect): { x: number; y: number } | null;
```

- The mirror div is an absolutely-positioned, `visibility:hidden`, `pointer-events-none` clone
  sharing the textarea's font, size, line-height, padding, border-box width, and
  `white-space: pre-wrap; word-wrap: break-word`. Its single text node is the textarea's value.
  `Range.setStart/​setEnd` around each token's offsets + `getClientRects()` gives the word's rect(s)
  (first rect if a word wraps); `rectToBox` maps to plane space.
- **Fail-soft:** if the textarea/mirror is unavailable or measurement throws, `measureWords`
  returns `[]` and the app falls back to whole-element pointing — exactly today's behavior when
  `ocrWordsRef` is empty.

### 2.2 Swapping the seam + the word referent

- App maintains a `wordBoxesRef` (replacing the OCR-fed `ocrWordsRef`), refreshed when the Word
  surface mounts/changes and on doc text change (throttled, live-gated like the C2a snapshots).
  `wordAt(x, y)` hit-tests `wordBoxesRef` (smallest containing word) — the existing consumer, new
  source. `hoveredWord` + the "Pointing at" pill keep working unchanged.
- **Deixis:** the existing proactive-grounding hint (which grounds "this/here" to the hovered
  *element*) is extended: when a word is hovered, the hint names the word **and its char span**
  (e.g. `the word "Quarterly" (chars 40–49) in the Document body`), so "this word," "change this,"
  "what's this" resolve to the word. The grounding chip mirrors the word 1:1 (the established
  grounding rule).
- Part A alone delivers "point at a word → ask about it" via the existing `explain`/`respond`
  grammar grounded on the word.

## 3. Part B — Word-grounded span editing

### 3.1 The verb + reducer

A new action verb **`revise_text`**: `{ charStart: number; charEnd: number; newText: string }`. The
model, grounded on the pointed word/span (Part A) plus the `DOCUMENT STATE` it already receives,
computes the target span and generates the replacement, then calls the verb.

`applyAction` (in `src/scenarios.ts`) gains a `revise_text` case for the word doc — an honest splice:

```ts
// word doc: replace [charStart, charEnd) with newText, clamped to the current text length.
const s = Math.max(0, Math.min(charStart, doc.text.length));
const e = Math.max(s, Math.min(charEnd, doc.text.length));
return { ...doc, text: doc.text.slice(0, s) + newText + doc.text.slice(e) };
```

- **Span selection is the model's job:** the pointed word gives an anchor offset; "this word" vs
  "this sentence" vs "make this paragraph more formal" — the model expands the span from that offset
  using the doc text and calls `revise_text` with the resolved `charStart`/`charEnd`.
- **Iteration** ("more formal," "more like X") is just repeated `revise_text` calls on the same
  span — each one witnessed (§3.2), so the user sees and approves each change.

### 3.2 Witness + undo

`revise_text` is high-commitment (like `edit_content`): it **witness-renders a before→after diff of
the span** through the existing pending-action mechanism, commits only on explicit confirm, and is
covered by the undo stack (mementos + the pure reducer). The witness card shows the old span text
and the proposed `newText` so the change is visible before it lands.

## 4. Part C — Word-grounded outward action (simulated + witnessed)

A new verb **`act_on`**: `{ target: string; intent: string; details?: string }` — the word's text is
the `target`, the `intent` is what to do with it (e.g. "reserve", "call", "look up"). Witnessed
exactly like `share`:

- Called without confirm → **witness-render** the outward intent (e.g.
  `Reservation request → Nobu: party of 4, 7pm`) via the existing witness path + feedback toast.
- Called with `confirm: true` (after the user approves) → **simulated** commit: the app records the
  intent and emits a committed-feedback toast. **No real integration** — nothing is sent, booked,
  or dialed, and the witness card is explicitly labeled *simulated*, the same honesty stance as the
  existing `share` verb.

This demonstrates the grammar — point at what a word names → outward intent → witness → commit —
without pretending to act in the world.

## 5. Honesty invariants

- **Measured, not perceived:** word geometry comes from `Range` measurement of the real text
  layout — no OCR, no pixel-perception model, no faked coordinates.
- **Fail-soft:** any measurement failure → whole-element pointing (today's behavior); the word
  referent is additive, never a regression.
- **Edits witnessed + reversible:** every `revise_text` shows a before→after diff and is undoable.
- **Outward actions simulated + labeled:** `act_on` sends nothing; the witness card says so.
- **The pointer stays honest:** confidence remains the documented demo-grade proxy; C2b does not
  claim a research perception model — it adds *finer honest measurement*, not a new estimator.

## 6. Perception (reuse C2a)

Words don't need a new perception channel: the surface pixels are already in the vision frame
(C2a), and the hovered word + span reach the model through the extended deixis hint (§2.2). The
witness cards for edits/outward actions render in the existing overlay/rail, already perceivable.
No vision-loop change.

## 7. Testing

- **Pure (vitest, node):** `tokenizeWords` (words + exact char offsets, punctuation/whitespace
  boundaries, empty text → `[]`); `rectToBox` (rect → 0-1000 mapping across plane offsets/sizes);
  the `applyAction` `revise_text` splice (mid-span replace, clamping past end, empty newText =
  delete); the `revise_text` and `act_on` tool mappers (arg validation only — the `act_on`
  witness-vs-commit branch reads the `confirm` flag in `handleVoiceToolCall`, mirroring `share`, and
  is verified by smoke, not the mapper).
- **DOM glue = human smoke** (jsdom can't run `getClientRects`): the mirror-div `measureWords` /
  `caretPoint` — verified by pointing at words in the running app.
- **Human smoke (owed, some need a key):** hover a word → the pill reads `"word" in Document body`;
  "what's this" grounds to the word; "change this word to X" witness-renders a span diff and commits
  on confirm (undo restores); "reserve a table at [pointed name]" witness-renders a simulated
  request.

## 8. Files (across the phases)

| File | Responsibility |
|---|---|
| `src/perception/measureWords.ts` *(new)* | `tokenizeWords`, `rectToBox` (pure) + `measureWords`, `caretPoint` (DOM glue). |
| `src/perception/measureWords.test.ts` *(new)* | Pure-core unit tests. |
| `src/scenarios.ts` | `applyAction` `revise_text` splice; the `revise_text` + `act_on` verb definitions (`buildActionTools`/verb map). |
| `src/App.tsx` | Swap `ocrWordsRef` → `wordBoxesRef` fed by `measureWords`; refresh effect; extend the deixis hint with the word span; route `revise_text` (witness+commit) and `act_on` (share-style witness) in `handleVoiceToolCall`. |
| `src/scenarios.test.ts` (or a new test) | `revise_text` splice + mapper tests. |

The retired `src/ocr.ts` may be deleted once `measureWords` replaces its only consumer (confirm no
other references first); if anything else still imports it, leave it and note the follow-up.

## 9. Out of scope

- **Word pointing in non-textarea surfaces** (spreadsheet cell text, slide text) — C1 already makes
  cells/slides pointable as whole sub-entities; sub-word pointing inside them is deferred.
- **The free-coordinate "whiteboard"** (C2a-illustrate's deferral) — still deferred; it needs
  arbitrary-coordinate perception, which word measurement does not provide.
- **Real outward integrations** (actual OpenTable/telephony) — `act_on` is simulated by design.
- **The task/goal model** (C3).

## 10. Phasing (implementation)

One spec, 2–3 plans, each landing + pushing independently to stay reviewable:
- **Phase A** — `measureWords` + the swapped word seam + the word deixis referent (delivers
  "point at a word → ask about it").
- **Phase B** — `revise_text` + witness/undo (delivers "change this word / iterate the text").
- **Phase C** — `act_on` simulated+witnessed outward action (delivers "act on what the word names").

## 11. Sequencing note

C2b is the last perception foundation of Project C: it makes the honest pointer word-granular and
turns a word into a full participant in the grammar (ask / edit / act). C3 (the goal model) is
separable and follows. The word-as-referent, measured honestly and reversible/simulated where it
touches the world, is the deliverable; the already-wired `wordAt`/`hoveredWord` seam is the proof
the consuming grammar is ready for it.
