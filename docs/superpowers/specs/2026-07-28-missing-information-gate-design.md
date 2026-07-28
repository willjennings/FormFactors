# Missing-Information Gate — Design Spec

*The agent must never act on information it does not have. When the payload is missing it asks;
when the data cannot answer the question it says why. Both refusals are structured, derived from
live state, and impossible for the model to paper over. Found by driving the app: "Add a heading
here" wrote the literal word "heading", and "Total this column" silently did nothing.*

Date: 2026-07-28
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: One phase, two halves of one claim — the payload gate across all four content verbs, and
the honest-and-working column total.

---

## 1. Purpose & scope

Two defects observed in a live session, both proven by running the real code against the real
booted corpus:

**A. Content verbs invent or no-op when the payload is missing.** `applyAction` has the same hole
in four places:

| Verb / target | Current behaviour with no `detail` |
|---|---|
| Word heading (`scenarios.ts:443`) | `heading: detail \|\| 'Heading'` — writes a placeholder |
| Word body (`:444`) | `text: detail \|\| doc.text` — silent no-op |
| Excel cell (`:454`) | `detail \|\| '100'` — **invents the number 100** |
| PowerPoint slide title (`:479`) | `detail \|\| slides[last]` — silent no-op |

Observed: pressing "Add a heading here" produced a document heading reading `heading` — the model
passed `detail: "heading"` because nothing required real content and nothing rejected a placeholder.
The prompt's clarification rules (`instructions.ts:26`) govern *which element* the user means; no
rule anywhere governs *missing content*.

**B. "Total this column" is a silent no-op on the corpus the app actually ships.** `applyAction`'s
aggregate path reads `A_CELLS` — hardcoded to column A. The Meridian seed corpus (booted since
2026-07-16) puts labels in A (`Metric`, `Revenue`, `Costs`, `Margin`) and values in B. So `nums` is
empty and the branch does `return doc` — **the identical object**, verified by probe (`after === doc`
is `true`). The app then reports a successful commit and the screen never moves.

Two compounding defects on the same path: `insert_object` is described to the model as *"Insert a
new object (a chart, a new slide, a shape)"* — it never mentions totals, so the capability is
invisible; and any `insert_object` whose `detail` misses the `'sum'/'aver'/'avg'` substrings falls
through to `chart: true`, so the natural phrasing `detail: "total"` silently **inserts a chart**
(also probe-verified).

**Why the suite stayed green:** the tests use `initialMockDoc` (`{A1:'10',A2:'20',A3:'30'}`), where
the same call correctly writes `A4: '60'`. The feature works against the fixture the tests use and
is dead against the corpus the app runs.

**In scope:** a pure action-call validator gating all four content verbs and the aggregate path;
column-total parsing with unit awareness; the `insert_object` description; one prompt rule; tests
bound to the shipped corpus.

**Out of scope:** a new ask/answer channel (the existing speech-and-retry loop suffices — see §5);
formula objects in the document model (the total writes a value, as today); multi-column or
row-wise aggregates; changing `initialMockDoc` (other tests depend on its strings — §8 instead
binds *new* tests to the seed corpus).

## 2. Architecture

A new self-contained `src/actions/` subsystem beside the others, plus small edits at the seams.

| Module | Responsibility |
|---|---|
| `src/actions/columnTotal.ts` | **New, pure.** `parseCellValue`, `totalColumn` — unit-aware column arithmetic. |
| `src/actions/validate.ts` | **New, pure.** `validateActionCall(verb, args, doc)` → `{ ok: true } \| { error: string }`. The gate. |
| `src/scenarios.ts` | `insert_object` description; the aggregate branch delegates to `totalColumn`; the four `detail \|\|` fallbacks become non-fallbacks (the validator guarantees a payload). |
| `src/prompt/instructions.ts` | One rule: content verbs need real content; ask for it. |
| `src/App.tsx` | Call the validator in the action-verb branch, before `decideCommit`. |

The validator knows nothing about React; `columnTotal` knows nothing about verbs. Both are pure and
testable without a DOM.

## 3. `columnTotal.ts` — unit-aware arithmetic

```ts
export interface ParsedCell { n: number; unit: string }   // unit: '' | '$' | '%'
export function parseCellValue(raw: string): ParsedCell | null;

export type TotalResult =
  | { value: number; unit: string; usedRefs: string[] }
  | { error: string };
export function totalColumn(
  cells: Record<string, string>, column: string, mode: 'sum' | 'average',
): TotalResult;

/** Render a total back into the cell's own idiom — the inverse of parseCellValue, so a
 *  totalled column reads like the column it came from. `$7,600,000` in a column of `$4.2M`
 *  would be technically true and visually foreign. */
export function formatTotal(value: number, unit: string): string;
```

`formatTotal` re-applies the largest magnitude that leaves a value ≥ 1 (`7_600_000, '$'` → `$7.6M`;
`900, '$'` → `$900`; `18, '%'` → `18%`; `60, ''` → `60`), trimming trailing zeros. Round-tripping is
unit-tested: `formatTotal(parseCellValue(x))` reproduces `x` for every corpus value.

**`parseCellValue`** accepts what a spreadsheet plausibly holds and returns `null` for anything
else:
- bare numbers — `42`, `-3.5` → `{ n, unit: '' }`
- currency, with optional magnitude suffix — `$4.2M` → `{ n: 4_200_000, unit: '$' }`; `$3.4M`,
  `$900K`, `$1.2B`, `$500`
- percent — `18%` → `{ n: 18, unit: '%' }`
- anything else — `Metric`, `Q3`, `2 wks behind`, `''` → `null`

Magnitude suffixes are expanded so `$4.2M + $3.4M = $7.6M`, not `7.6`. The result carries the
magnitude back out for display.

**`totalColumn`** reads `A1..A6`-style refs for the given column, skips every cell that parses to
`null` (headers and prose fall away without ceremony), and then:
- **no parseable cells** → `{ error }` naming what IS there, e.g.
  *"Column A has no numbers to total — it holds Metric, Revenue, Costs, Margin."*
- **mixed units** → `{ error }` naming the clash, e.g.
  *"Column B mixes currency ($4.2M, $3.4M) and percent (18%) — totalling them would be meaningless. Which cells did you mean?"*
- **otherwise** → `{ value, unit, usedRefs }`

`usedRefs` is the honesty floor: a produced number always knows which cells it came from, so the
caller can say so and the user can check.

**Where the result lands:** the first free cell below the totalled column's last used row. If the
column has no free cell (all six rows occupied), that is missing information like any other —
refuse and say so: *"Column B is full — clear a cell or tell me where to put the total."* Never
overwrite an occupied cell to make room.

## 4. `validate.ts` — the gate

```ts
export function validateActionCall(
  verb: string, args: { target?: string; detail?: string; confirm?: boolean }, doc: MockDoc,
): { ok: true } | { error: string };
```

Called in `App.tsx`'s `ACTION_VERB_NAMES` branch **before** `decideCommit`. On `{ error }` the app
`ack({ success: false, error })` — which the existing wrapper already routes through
`callDeduper.forget()`, so a corrected retry is re-processed rather than swallowed — and does not
dispatch, does not witness, does not touch the document.

### 4.1 Rule 1 — content verbs need content

A table maps the target to the payload's own name, so every message can say what it wants:

| doc kind | target | payload name |
|---|---|---|
| word | heading (`target`/`detail` contains "head") | the heading text |
| word | otherwise | the new body text |
| excel | any cell | the cell value |
| powerpoint | any slide | the slide title |

Refuse when `detail` is absent, blank after trim, **or a placeholder** — where placeholder means
`normText(detail)` equals the payload's own noun (`heading`, `title`, `text`, `value`, `content`)
or the target's noun. The error names the remedy:

> `edit_content needs the heading text — "heading" is a placeholder, not content. Ask the user what the heading should say, then call again with detail set to their words.`

**The escape (deliberate):** this check applies **only when `confirm` is not true**. If the user
genuinely wants a heading reading "Heading", the witness card shows `heading → "heading"`, they
confirm, and it writes. A false positive costs one question; a false negative writes garbage into
the user's document — the bias is chosen, not accidental.

`format_content` is exempt: its payload has honest defaults (bold, currency) and no free text.
`save_file` is exempt: it needs no payload.

### 4.2 Rule 2 — aggregates need numbers

For `insert_object` whose intent is a total or average (see §4.3), the validator resolves the
column and calls `totalColumn`; a `{ error }` from it becomes the call's error verbatim. This is
the same discipline the artifact validators follow — the *validator* consults the same function the
*reducer* will use, so it can never promise something the reducer would then refuse.

**Column resolution**, in order: the letter from `args.target` (`"Cell B2"` → `B`, via the existing
`cellRef` parse); else, if exactly one column in the grid contains parseable numbers, that column
(with the choice named in the eventual result); else refuse:

> `Which column should I total? Point at a cell in it, or name it — B holds the values.`

Missing information, asked for. Same rule as everything else here.

### 4.3 Rule 3 — no silent fallback

`insert_object` currently defaults to `chart: true` for any unrecognised `detail`. It must instead
recognise an explicit set — `chart`, `slide`, `shape`, and the aggregate intents `sum`/`total` and
`average`/`avg`/`mean` — and refuse anything else, naming the set:

> `insert_object doesn't know "widget". Valid: chart, slide, shape, sum, average.`

Note `total` and `mean` join the recognised aggregate words: the observed near-miss (`detail:
"total"` inserting a chart) is closed both by widening the vocabulary and by removing the fallback.

## 5. How the answer comes back — nothing new

The loop already exists and is deliberately reused rather than rebuilt:

1. Model calls a content verb without content, or an aggregate on an unusable column.
2. Validator refuses with a message naming what it needs.
3. The prompt already permits — and restricts to — exactly this speech: *"Speak ONLY to: (a) ask a clarifying/disambiguating question … (c) report a problem/error"* (`instructions.ts:46`). The model asks one short question.
4. The user answers **by voice or by typing** — typed input rides the same pipeline (R1 typed-input parity).
5. The model calls again with real content; the validator passes; the normal witness/commit path runs.

No new tool, no new state machine, no new channel. This keeps the phase small and is why `ask_gap`
(the ramble subsystem's equivalent) is cited as precedent rather than extended — ramble needs a slot
machine because it fills a form across many turns; this needs one question and a retry.

## 6. Prompt and description changes

**`insert_object` description** — currently *"Insert a new object (a chart, a new slide, a shape)"*,
which is why the capability is invisible. Add the aggregates and the column: *"…or compute a column
aggregate (sum/total, average) into the first free cell below it."*

**One prompt rule**, beside the existing clarification rules:

> CONTENT YOU DON'T HAVE: a verb that writes content needs the actual words. If the user says "add a heading" without saying what it should say, ASK — one short question — then call with their answer. Never send a placeholder like "heading" or "title" as the content; the app will refuse it.

The validator is the guarantee; the prompt exists only to save a round trip. This codebase has
repeatedly found prompt-only assurances insufficient (the fence, the phase machine, the artifact
validators all exist for that reason), so the ordering is deliberate: structure first, prompt second.

## 7. Honesty rules this design must hold

1. **Never invent a payload.** No `|| '100'`, no `|| 'Heading'`. Once the validator guarantees a
   payload, those fallbacks come out of `applyAction` — leaving them would preserve the lie behind
   a gate.
2. **Never silently no-op.** An action that changes nothing must say so; the aggregate path's
   `return doc` is replaced by a refusal that names what is in the way.
3. **Derive, never assert.** Every message naming columns, cells, or valid options computes them
   from the live document.
4. **A number knows where it came from.** `usedRefs` travels with every total.
5. **The user can always override.** The placeholder check yields to an explicit confirm.

## 8. Testing

Pure-function TDD per repo convention; component paths by `tsc`/build/drive.

**THE GLOBAL RULE FOR THIS PHASE — every new test binds to `seedCorpus()`, never
`initialMockDoc`.** That divergence is the reason a dead feature passed a green suite for eleven
days. Where a test needs a numeric column, it constructs one explicitly rather than reaching for the
old fixture.

- `parseCellValue`: bare, negative, decimal, `$`, `%`, each magnitude suffix, and the `null` cases
  drawn from the real corpus (`Metric`, `Q3`, `2 wks behind`, `''`).
- `totalColumn`: sum and average of a clean column; header skipped; **column A of the real seed
  corpus returns the no-numbers error naming the labels**; **column B of the real seed corpus
  returns the mixed-units error naming both groups**; `usedRefs` exact; a full column refuses
  rather than overwriting.
- `formatTotal`: round-trip — `formatTotal(parseCellValue(x))` reproduces `x` for every value in
  the shipped corpus; magnitude preserved (`$4.2M + $3.4M` renders `$7.6M`, not `7600000`);
  trailing zeros trimmed.
- `validateActionCall`: each of the four content verbs refused for absent / blank / placeholder
  detail, and each accepted with real content; the confirm escape passes a placeholder; format and
  save exempt; the aggregate refusals delegate to `totalColumn` (assert the message matches what
  `totalColumn` returns, so the two can never drift); unknown `insert_object` detail names the valid
  set derived from the same constant the resolver uses.
- `applyAction` regression: the aggregate path writes the total into the first free cell **below the
  totalled column** (not hardcoded A), and no content verb has a `||` fallback left.

**Keyless browser drive:** point at a cell in column B, ask to total it — the honest mixed-units
refusal is spoken; point at a clean numeric column — the total lands with the cells it used; press
"Add a heading here" — a question comes back instead of the word "heading"; answer it by typing —
the heading lands.

**Live smoke (owed, needs a key):** the same two flows by voice, plus the confirm-escape (ask for a
heading that literally says "Heading" and confirm it).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Placeholder heuristic false-positives | Costs one question; the confirm escape always wins |
| Refusal loop (model re-sends the same placeholder) | The error names the remedy explicitly; `ack(success:false)` already calls `deduper.forget()`, so a corrected retry is processed |
| Magnitude parsing wrong (`$4.2M`) | Unit + magnitude are unit-tested against the shipped corpus values |
| Validator and reducer disagree | The validator calls the same `totalColumn` the reducer uses |
| The old fixture masks a regression again | §8's global rule; new tests bind to `seedCorpus()` |
