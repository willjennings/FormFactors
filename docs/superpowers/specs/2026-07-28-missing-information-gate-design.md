# Missing-Information Gate — Design Spec

*The agent must never act on information it does not have. Two situations, deliberately kept
distinct: when the USER left the content unspecified, that is a first-class **unspecified ask** —
the agent asks back, with candidate answers you can fire, type or speak. When the MODEL called
wrong, that is an error the model fixes without bothering you. Found by driving the app: "Add a
heading here" wrote the literal word "heading", and "Total this column" silently did nothing.*

Date: 2026-07-28
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: One phase. The unspecified-ask classification and its answer surface; the malformed-call
errors behind it; the honest-and-working column total.

---

## 1. Purpose & scope

Two defects observed in a live session, both proven by probe against the real booted corpus:

**A. Content verbs invent or no-op when the payload is missing.** The same hole in four places:

| Verb / target | Current behaviour with no `detail` |
|---|---|
| Word heading (`scenarios.ts:443`) | `heading: detail \|\| 'Heading'` — writes a placeholder |
| Word body (`:444`) | `text: detail \|\| doc.text` — silent no-op |
| Excel cell (`:454`) | `detail \|\| '100'` — **invents the number 100** |
| PowerPoint slide title (`:479`) | `detail \|\| slides[last]` — silent no-op |

Observed: "Add a heading here" produced a heading reading `heading` — the model passed
`detail: "heading"` because nothing required real content and nothing rejected a placeholder. The
prompt's clarification rules (`instructions.ts:26`) govern *which element* the user means; nothing
governs *missing content*.

**B. "Total this column" is a silent no-op on the shipped corpus.** The aggregate path reads
`A_CELLS` — hardcoded to column A. The Meridian corpus (booted since 2026-07-16) puts labels in A
and values in B, so `nums` is empty and the branch does `return doc` — the identical object,
verified by probe (`after === doc` is `true`). The app reports a successful commit; the screen never
moves. Compounding: `insert_object` is described as *"a chart, a new slide, a shape"* — totals are
invisible to the model; and any `detail` missing the `'sum'/'aver'/'avg'` substrings falls through
to `chart: true`, so `detail: "total"` silently **inserts a chart** (also probe-verified).

**Why the suite stayed green:** the tests use `initialMockDoc` (`{A1:'10',A2:'20',A3:'30'}`), where
the same call correctly writes `A4: '60'`. The feature is alive against the fixture the tests use
and dead against the corpus the app runs.

**In scope:** the `ask_content` tool and its answer-chip surface; a pure validator classifying
unspecified asks vs. malformed calls; unit-aware column totals; the `insert_object` description; one
prompt rule; separate telemetry for asks and errors; tests bound to the shipped corpus.

**Out of scope:** asks for non-authorial payloads (a cell value is the user's stated number, not the
agent's prose — see §4.1); formula objects in the document model (the total writes a value, as
today); multi-column or row-wise aggregates; changing `initialMockDoc` (other tests depend on its
strings — §9 binds *new* tests to the seed corpus instead).

## 2. The classification

Everything here follows from one question: **whose information is missing?**

| | The USER underspecified | The MODEL called wrong |
|---|---|---|
| Example | "Add a heading here" — no heading text | `edit_content` on a cell with no value; `insert_object` with `detail: "widget"` |
| Name | **unspecified ask** | malformed call |
| Validator returns | `{ needsContent: { field, question } }` | `{ error: string }` |
| Who is addressed | the user, via a spoken question + answer chips | the model, via errors-as-data |
| Is it a failure? | **No** — it is correct collaborative behaviour | Yes |
| Telemetry | `unspecified_ask` | existing error counters |

Keeping these apart matters beyond taste. This is a measurement testbed: logging an unspecified ask
as an error would pollute every register arm's error rate with what is actually the agent doing its
job, and would make the honest arms look worse than the reckless ones.

## 3. Architecture

| Module | Responsibility |
|---|---|
| `src/actions/columnTotal.ts` | **New, pure.** `parseCellValue`, `totalColumn`, `formatTotal` — unit-aware column arithmetic. |
| `src/actions/validate.ts` | **New, pure.** `validateActionCall(verb, args, doc)` → `{ ok } \| { needsContent } \| { error }`. |
| `src/actions/askContent.ts` | **New.** `ASK_CONTENT_TOOL` + pure `askCallToState(args)` — the unspecified ask made first-class. |
| `src/scenarios.ts` | `insert_object` description; aggregate branch delegates to `totalColumn`; the four `detail \|\|` fallbacks removed. |
| `src/prompt/instructions.ts` | One rule: authorial content you don't have → `ask_content` first. |
| `src/shell/Omnibox.tsx` | Render answer chips when an ask is open (reuses the existing chip row). |
| `src/App.tsx` | Validator call in the action-verb branch; `ask_content` routing; ask state; answer dispatch. |
| `src/telemetry.ts` | `unspecifiedAsk(field, answered, viaChip)`. |

## 4. `validate.ts` — the gate

```ts
export type ActionValidation =
  | { ok: true }
  | { needsContent: { field: string; question: string } }   // ask the USER
  | { error: string };                                       // tell the MODEL

export function validateActionCall(
  verb: string, args: { target?: string; detail?: string; confirm?: boolean }, doc: MockDoc,
): ActionValidation;
```

Called in `App.tsx`'s `ACTION_VERB_NAMES` branch **before** `decideCommit`, so nothing is witnessed
or committed on missing information.

### 4.1 Unspecified asks — authorial content only

The ask fires only when the missing payload is **words that become the user's document**:

| doc kind | target | field | question |
|---|---|---|---|
| word | heading | `heading` | "What would you like the heading to say?" |
| word | body | `body` | "What would you like it to say?" |
| powerpoint | slide | `slideTitle` | "What would you like the slide title to say?" |

An Excel cell value is **not** authorial — "put 100 here" already carries its content, and prompting
for a number the user just said would be nagging. A cell edit missing its value is a malformed call
(§4.2), not an ask.

Fires when `detail` is absent, blank after trim, **or a placeholder** — `normText(detail)` equal to
the field's own noun (`heading`, `title`, `text`, `body`, `content`) or the target's noun.

**The override (deliberate):** the check applies **only when `confirm` is not true**. If the user
genuinely wants a heading reading "Heading", the witness card shows `heading → "heading"`, they
confirm, and it writes. A false positive costs one question; a false negative writes garbage into
the user's document.

### 4.2 Malformed calls — errors the user never sees

Plain `{ error }`, errors-as-data, remedies derived from live state:

- **Excel cell edit with no value** — *"edit_content on Cell B5 needs the value to enter."*
- **Unknown object kind** — `insert_object` recognises exactly `chart`, `slide`, `shape`, and the
  aggregate intents `sum`/`total` and `average`/`avg`/`mean`; anything else errors naming the set
  derived from that same constant. This removes the silent `chart: true` fallback, and widening the
  vocabulary to include `total`/`mean` closes the observed near-miss.
- **Aggregate on an unusable column** — the validator calls the same `totalColumn` the reducer will
  use and returns its error verbatim, so validator and reducer can never disagree.

`format_content` and `save_file` are exempt from both: their payloads have honest defaults or none.

### 4.3 Column resolution

In order: the letter from `args.target` (`"Cell B2"` → `B`, via the existing `cellRef` parse); else,
if exactly one column holds parseable numbers, that column (named in the result); else an error
asking which — *"Which column should I total? Point at a cell in it, or name it."*

## 5. `columnTotal.ts` — unit-aware arithmetic

```ts
export interface ParsedCell { n: number; unit: string }   // unit: '' | '$' | '%'
export function parseCellValue(raw: string): ParsedCell | null;

export type TotalResult =
  | { value: number; unit: string; usedRefs: string[] }
  | { error: string };
export function totalColumn(
  cells: Record<string, string>, column: string, mode: 'sum' | 'average',
): TotalResult;

/** Render a total back into the column's own idiom — the inverse of parseCellValue. `$7,600,000`
 *  in a column of `$4.2M` would be technically true and visually foreign. */
export function formatTotal(value: number, unit: string): string;
```

`parseCellValue` accepts bare numbers (`42`, `-3.5`), currency with optional magnitude
(`$4.2M` → `{ n: 4_200_000, unit: '$' }`, `$900K`, `$1.2B`, `$500`), and percent
(`18%` → `{ n: 18, unit: '%' }`). Everything else — `Metric`, `Q3`, `2 wks behind`, `''` — returns
`null` and falls away without ceremony.

`formatTotal` re-applies the largest magnitude leaving a value ≥ 1 (`7_600_000, '$'` → `$7.6M`),
trimming trailing zeros. Round-tripping is unit-tested against every corpus value.

`totalColumn` skips unparseable cells, then:
- **no parseable cells** → `{ error }` naming what IS there — *"Column A has no numbers to total — it holds Metric, Revenue, Costs, Margin."*
- **mixed units** → `{ error }` naming the clash — *"Column B mixes currency ($4.2M, $3.4M) and percent (18%) — totalling them would be meaningless. Which cells did you mean?"*
- **otherwise** → `{ value, unit, usedRefs }`

`usedRefs` is the honesty floor: a produced number always knows which cells it came from.

**Where the result lands:** the first free cell below the column's last used row. If the column is
full, that is missing information like any other — refuse and say so. Never overwrite an occupied
cell to make room.

## 6. The unspecified ask, end to end

### 6.1 `ask_content` — the tool

```
ask_content { field, question, candidates?[] }
```

- `field` — which content is being asked for (`heading` | `body` | `slideTitle`).
- `question` — the short spoken question, e.g. *"What would you like the heading to say?"*
- `candidates` — up to **three** suggested answers the model derives from the document. Optional:
  when the model has nothing sensible to suggest, it asks plainly rather than padding.

Flat parameters, no nested objects (the `d24abef` schema hazard). Registered for word and
powerpoint only.

**The happy path is proactive:** the prompt tells the model to call `ask_content` *instead of*
guessing when authorial content is missing. The validator's `{ needsContent }` is the **backstop**
for when it forgets — structure first, prompt second, the ordering this codebase has settled on.

### 6.2 The answer surface — candidate chips

An open ask replaces the suggestion chip row with its candidates, plus the standing invitation to
answer freely:

- Each candidate renders as a chip with a keycap, firing by digit through the existing
  `quickFireIndex` path — no pointer movement, consistent with the app's slippy idiom.
- The omnibox placeholder becomes the question itself, so typing is an equally first-class answer.
- Voice works unchanged: the question is spoken, the answer is heard.
- Esc, or a program swap, cancels the ask — an abandoned question must not haunt the chip row.

**Firing a chip does not perform the action.** It sends the chosen text as the user's answer; the
model then calls `edit_content` with it and the normal witness/commit path runs. The UI supplies the
*choice*, the model supplies the *call* — the same division the combine tray uses, and the reason
authorship stays honest.

**Register gating:** the ask and its chips render in **every** register. An unspecified ask is not
scaffolding — it is the agent declining to invent the user's words — so no `chipDensity` gate
applies. (Terminal shows the question and accepts typed or spoken answers; only the candidate chips
are a convenience layered on top, and they too render, because the alternative is a register in
which the agent silently guesses.)

## 7. Prompt and description changes

**`insert_object` description** — add the aggregates and the column, since the capability is
currently invisible: *"…or compute a column aggregate (sum/total, average) into the first free cell
below it."*

**One prompt rule**, beside the existing clarification rules:

> AUTHORIAL CONTENT YOU DON'T HAVE: if the user asks for a heading, body text or a slide title without saying what it should say, do NOT guess and do NOT send a placeholder. Call `ask_content` with one short question and up to three candidates drawn from the document. Act on their answer. A number or value the user already stated is not authorial — just use it.

## 8. Honesty rules this design must hold

1. **Never invent a payload.** The `|| '100'` and `|| 'Heading'` fallbacks come out of
   `applyAction` — leaving them would preserve the lie behind a gate.
2. **Never silently no-op.** The aggregate's `return doc` becomes a refusal naming the obstacle.
3. **Derive, never assert.** Every message naming columns, cells or valid options computes them from
   live state.
4. **A number knows where it came from.** `usedRefs` travels with every total.
5. **The user can always override.** The placeholder check yields to an explicit confirm.
6. **An ask is not an error.** Separate return shape, separate telemetry, separate voice.
7. **Candidates are suggestions, never defaults.** An unanswered ask times out into nothing; no
   candidate is ever applied because the user stayed silent.

## 9. Testing

Pure-function TDD per repo convention; component paths by `tsc`/build/drive.

**THE GLOBAL RULE FOR THIS PHASE — every new test binds to `seedCorpus()`, never
`initialMockDoc`.** That divergence is why a dead feature passed a green suite for eleven days.
A test needing a numeric column constructs one explicitly rather than reaching for the old fixture.

- `parseCellValue`: bare, negative, decimal, `$`, `%`, each magnitude suffix; `null` for the real
  corpus's non-numerics (`Metric`, `Q3`, `2 wks behind`, `''`).
- `formatTotal`: round-trip over every shipped corpus value; `$4.2M + $3.4M` renders `$7.6M`.
- `totalColumn`: clean sum and average; header skipped; **column A of the real seed corpus returns
  the no-numbers error naming the labels**; **column B returns the mixed-units error naming both
  groups**; `usedRefs` exact; a full column refuses rather than overwriting.
- `validateActionCall`: each authorial field returns `{ needsContent }` for absent / blank /
  placeholder detail and `{ ok }` for real content; **an Excel cell with no value returns `{ error }`,
  NOT `{ needsContent }`** (the classification is the point — a test asserts the two are not
  confused); the confirm override passes a placeholder; format and save exempt; aggregate errors
  match `totalColumn`'s own output exactly, so the two cannot drift.
- `askCallToState`: field/question/candidates validated; more than three candidates rejected;
  empty question rejected.
- `applyAction` regression: the aggregate writes into the first free cell **below the totalled
  column** (not hardcoded A); no content verb retains a `||` fallback.

**Keyless browser drive:** press "Add a heading here" — a question comes back with candidate chips,
not the word "heading"; fire chip 2 — the heading lands with that text; press it again and type an
answer instead — that lands; press Esc mid-ask — the chips clear and nothing is written; point at a
column-B cell and ask to total it — the mixed-units refusal is spoken; total a clean numeric column
— the value lands with the cells it used.

**Live smoke (owed, needs a key):** both flows by voice; the confirm override (ask for a heading
that literally says "Heading" and confirm it); and an unspecified ask answered by *speaking* rather
than firing a chip.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Placeholder heuristic false-positives | Costs one question; the confirm override always wins |
| Ask loop (model re-sends a placeholder) | `{ needsContent }` names the field and question; `ack(success:false)` already calls `deduper.forget()` so a corrected retry is processed |
| Candidates lead the user | Capped at three, optional, never applied without an explicit fire; the ask reads as a question, not a menu |
| A stale ask haunts the chip row | Esc and program swap both cancel; §9 drives it |
| Magnitude parsing wrong (`$4.2M`) | Unit + magnitude unit-tested against shipped corpus values |
| Validator and reducer disagree | The validator calls the same `totalColumn` the reducer uses |
| The old fixture masks a regression again | §9's global rule |
