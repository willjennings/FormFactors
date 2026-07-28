# Missing-Information Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent stops acting on information it doesn't have — it asks for authorial content it was never given, and refuses honestly when the data can't answer the question.

**Architecture:** Two pure modules first (unit-aware column arithmetic, then a validator that classifies a call three ways), then the ask tool, then the gate goes live in `App.tsx` alongside removing `applyAction`'s inventing fallbacks, then the answer-chip surface, then a browser drive. The classification — `{ ok }` / `{ needsContent }` / `{ error }` — is the spine: **whose** information is missing decides who gets addressed.

**Tech Stack:** TypeScript, React 19, vitest (pure tests, colocated `*.test.ts`), `tsc --noEmit` as lint. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-missing-information-gate-design.md`

## Global Constraints

- **EVERY NEW TEST BINDS TO `seedCorpus()`, NEVER `initialMockDoc`.** A dead feature passed a green suite for eleven days because the tests used a fixture the app does not boot. A test needing a numeric column constructs one explicitly rather than reaching for the old fixture. This is the phase's defining rule.
- **Run the FULL suite on every task** — `npx vitest run`, never a directory subset. Baseline: **745 tests / 95 files passing**. Treat stated counts as minimums.
- `npx tsc --noEmit` clean and `npx vite build` succeeds before every commit.
- **An ask is not an error.** `{ needsContent }` and `{ error }` are distinct return shapes with distinct telemetry. Never collapse them — this is a measurement testbed and conflating them corrupts every register arm's error rate.
- **Derive, never assert.** Any message naming columns, cells, or valid options computes them from live state.
- **Candidates are suggestions, never defaults.** No candidate is ever applied because the user stayed silent.
- This repo does not unit-test component/DOM rendering — component work is verified by `tsc`, `vite build`, and the Task 6 drive. No DOM harness.
- No new npm dependencies. Commit per task, conventional-commit style.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/actions/columnTotal.ts` | **Create** — `parseCellValue`, `formatTotal`, `totalColumn`. | 1 |
| `src/actions/validate.ts` | **Create** — `validateActionCall` returning the three shapes. | 2 |
| `src/actions/askContent.ts` | **Create** — `ASK_CONTENT_TOOL`, `askCallToState`. | 3 |
| `src/scenarios.ts` | Modify — remove the four `\|\|` fallbacks; aggregate delegates to `totalColumn`; `insert_object` description. | 4, 5 |
| `src/App.tsx` | Modify — validator in the action branch (4); ask routing, ask state, chip override, telemetry (5). | 4, 5 |
| `src/telemetry.ts` | Modify — `unspecifiedAsk`. | 5 |
| `src/prompt/instructions.ts` | Modify — the authorial-content rule. | 5 |

---

### Task 1: Unit-aware column arithmetic

**Files:**
- Create: `src/actions/columnTotal.ts`, `src/actions/columnTotal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ParsedCell { n: number; unit: string }`; `parseCellValue(raw: string): ParsedCell | null`; `formatTotal(value: number, unit: string): string`; `TotalResult = { value: number; unit: string; usedRefs: string[] } | { error: string }`; `totalColumn(cells: Record<string,string>, column: string, mode: 'sum' | 'average'): TotalResult`; `COLUMN_ROWS = [1,2,3,4,5,6]`.

- [ ] **Step 1: Write the failing test**

Create `src/actions/columnTotal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCellValue, formatTotal, totalColumn } from './columnTotal';
import { seedCorpus } from '../artifacts/seeds';

const excelCells = () => (seedCorpus().excel as { kind: 'excel'; cells: Record<string, string> }).cells;

describe('parseCellValue', () => {
  it('reads bare numbers', () => {
    expect(parseCellValue('42')).toEqual({ n: 42, unit: '' });
    expect(parseCellValue('-3.5')).toEqual({ n: -3.5, unit: '' });
  });
  it('reads currency, expanding magnitude suffixes', () => {
    expect(parseCellValue('$4.2M')).toEqual({ n: 4_200_000, unit: '$' });
    expect(parseCellValue('$900K')).toEqual({ n: 900_000, unit: '$' });
    expect(parseCellValue('$1.2B')).toEqual({ n: 1_200_000_000, unit: '$' });
    expect(parseCellValue('$500')).toEqual({ n: 500, unit: '$' });
  });
  it('reads percent', () => {
    expect(parseCellValue('18%')).toEqual({ n: 18, unit: '%' });
  });
  it('returns null for everything the REAL corpus actually holds that is not a number', () => {
    for (const raw of ['Metric', 'Q3', 'Riverside Tower', '2 wks behind', '', '   ']) {
      expect(parseCellValue(raw)).toBeNull();
    }
  });
});

describe('formatTotal', () => {
  it('round-trips every numeric value in the shipped corpus', () => {
    for (const raw of Object.values(excelCells())) {
      const p = parseCellValue(raw);
      if (p) expect(formatTotal(p.n, p.unit)).toBe(raw);
    }
  });
  it('re-applies the largest magnitude that leaves a value >= 1', () => {
    expect(formatTotal(7_600_000, '$')).toBe('$7.6M');
    expect(formatTotal(900, '$')).toBe('$900');
    expect(formatTotal(18, '%')).toBe('18%');
    expect(formatTotal(60, '')).toBe('60');
  });
  it('trims trailing zeros', () => {
    expect(formatTotal(7_000_000, '$')).toBe('$7M');
    expect(formatTotal(2.5, '')).toBe('2.5');
  });
});

describe('totalColumn', () => {
  const clean = { B1: 'Widgets', B2: '10', B3: '20', B4: '30' };

  it('sums a clean column, skipping the text header', () => {
    expect(totalColumn(clean, 'B', 'sum')).toEqual({ value: 60, unit: '', usedRefs: ['B2', 'B3', 'B4'] });
  });
  it('averages a clean column', () => {
    expect(totalColumn(clean, 'B', 'average')).toEqual({ value: 20, unit: '', usedRefs: ['B2', 'B3', 'B4'] });
  });

  it('column A of the REAL seed corpus has no numbers — and the error says what IS there', () => {
    const r = totalColumn(excelCells(), 'A', 'sum') as { error: string };
    expect(r.error).toContain('no numbers');
    for (const label of ['Metric', 'Revenue', 'Costs', 'Margin']) expect(r.error).toContain(label);
  });

  it('column B of the REAL seed corpus mixes units — and the error names both groups', () => {
    // This is the exact column the user pointed at. $4.2M + $3.4M + 18% is meaningless.
    const r = totalColumn(excelCells(), 'B', 'sum') as { error: string };
    expect(r.error).toContain('$4.2M');
    expect(r.error).toContain('18%');
  });

  it('preserves magnitude across a real currency sum', () => {
    const r = totalColumn({ B2: '$4.2M', B3: '$3.4M' }, 'B', 'sum') as { value: number; unit: string };
    expect(formatTotal(r.value, r.unit)).toBe('$7.6M');
  });

  it('an empty column reports having nothing, not a zero total', () => {
    const r = totalColumn({}, 'C', 'sum') as { error: string };
    expect(r.error).toContain('no numbers');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/actions/columnTotal.test.ts`
Expected: FAIL — `Failed to resolve import "./columnTotal"`.

- [ ] **Step 3: Write the implementation**

Create `src/actions/columnTotal.ts`:

```ts
// Unit-aware column arithmetic (spec §5). A total is only honest if it knows WHICH cells it came
// from and refuses when the units don't agree — $4.2M + 18% is a number nobody should be shown.
export interface ParsedCell { n: number; unit: string }   // unit: '' | '$' | '%'

export const COLUMN_ROWS = [1, 2, 3, 4, 5, 6];            // mirrors ROWS in widgets/spreadsheetGrid

const MAGNITUDES: [string, number][] = [['B', 1e9], ['M', 1e6], ['K', 1e3]];

/** Parse what a spreadsheet plausibly holds; null for anything else (headers, prose, blanks). */
export function parseCellValue(raw: string): ParsedCell | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = /^(-?)(\$?)(\d+(?:\.\d+)?)([KMB]?)(%?)$/.exec(s);
  if (!m) return null;
  const [, sign, dollar, digits, mag, pct] = m;
  if (dollar && pct) return null;                          // "$5%" is not a thing
  const factor = MAGNITUDES.find(([k]) => k === mag)?.[1] ?? 1;
  const n = Number(`${sign}${digits}`) * factor;
  if (!Number.isFinite(n)) return null;
  return { n, unit: dollar ? '$' : pct ? '%' : '' };
}

/** The inverse: render back into the column's own idiom, so a total looks like its column. */
export function formatTotal(value: number, unit: string): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let body = String(Number(abs.toFixed(2)));
  if (unit === '$') {
    for (const [suffix, factor] of MAGNITUDES) {
      if (abs >= factor) { body = `${Number((abs / factor).toFixed(2))}${suffix}`; break; }
    }
    return `${sign}$${body}`;
  }
  return unit === '%' ? `${sign}${body}%` : `${sign}${body}`;
}

export type TotalResult =
  | { value: number; unit: string; usedRefs: string[] }
  | { error: string };

const list = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function totalColumn(
  cells: Record<string, string>, column: string, mode: 'sum' | 'average',
): TotalResult {
  const col = column.toUpperCase();
  const parsed: { ref: string; p: ParsedCell }[] = [];
  const skipped: string[] = [];
  for (const row of COLUMN_ROWS) {
    const ref = `${col}${row}`;
    const raw = (cells[ref] ?? '').trim();
    if (!raw) continue;
    const p = parseCellValue(raw);
    if (p) parsed.push({ ref, p }); else skipped.push(raw);
  }
  if (!parsed.length) {
    // Name what IS there — a refusal that describes the obstacle is actionable; "can't" is not.
    return { error: skipped.length
      ? `Column ${col} has no numbers to total — it holds ${list(skipped)}.`
      : `Column ${col} has no numbers to total — it is empty.` };
  }
  const units = Array.from(new Set(parsed.map((x) => x.p.unit)));
  if (units.length > 1) {
    const groups = units.map((u) => {
      const vals = parsed.filter((x) => x.p.unit === u).map((x) => cells[x.ref].trim());
      const name = u === '$' ? 'currency' : u === '%' ? 'percent' : 'plain numbers';
      return `${name} (${list(vals)})`;
    });
    return { error: `Column ${col} mixes ${list(groups)} — totalling them would be meaningless. Which cells did you mean?` };
  }
  const nums = parsed.map((x) => x.p.n);
  const total = nums.reduce((a, b) => a + b, 0);
  return {
    value: mode === 'average' ? total / nums.length : total,
    unit: units[0],
    usedRefs: parsed.map((x) => x.ref),
  };
}
```

- [ ] **Step 4: Run the target test, then the full gates**

Run: `npx vitest run src/actions/columnTotal.test.ts` → PASS.
Run: `npx vitest run && npx tsc --noEmit` → PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/actions/columnTotal.ts src/actions/columnTotal.test.ts
git commit -m "feat(actions): unit-aware column totals that refuse mixed units and name their cells"
```

---

### Task 2: The validator — three shapes, split by whose information is missing

**Files:**
- Create: `src/actions/validate.ts`, `src/actions/validate.test.ts`

**Interfaces:**
- Consumes: `totalColumn` (Task 1); `MockDoc` from `src/scenarios.ts`; `normText` from `src/entities/registry.ts`.
- Produces: `ActionValidation = { ok: true } | { needsContent: { field: string; question: string } } | { error: string }`; `validateActionCall(verb: string, args: { target?: string; detail?: string; confirm?: boolean }, doc: MockDoc): ActionValidation`; `INSERT_KINDS: readonly string[]`; `aggregateMode(detail?: string): 'sum' | 'average' | null`.

- [ ] **Step 1: Write the failing test**

Create `src/actions/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateActionCall, aggregateMode, INSERT_KINDS } from './validate';
import { totalColumn } from './columnTotal';
import { seedCorpus } from '../artifacts/seeds';
import type { MockDoc } from '../scenarios';

const word = () => seedCorpus().word;
const excel = () => seedCorpus().excel;
const ppt = () => seedCorpus().powerpoint;
const cells = () => (excel() as { kind: 'excel'; cells: Record<string, string> }).cells;

describe('unspecified asks — authorial content only', () => {
  it('a heading with no text ASKS the user', () => {
    const v = validateActionCall('edit_content', { target: 'heading' }, word());
    expect(v).toEqual({ needsContent: { field: 'heading', question: 'What would you like the heading to say?' } });
  });
  it('the literal placeholder "heading" is not content', () => {
    const v = validateActionCall('edit_content', { target: 'Document body', detail: 'heading' }, word()) as any;
    expect(v.needsContent?.field).toBe('heading');
  });
  it('blank and whitespace detail ask too', () => {
    expect((validateActionCall('edit_content', { target: 'heading', detail: '   ' }, word()) as any).needsContent).toBeTruthy();
  });
  it('real heading text passes', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Q3 Summary' }, word())).toEqual({ ok: true });
  });
  it('body text and slide titles ask with their own field and question', () => {
    expect((validateActionCall('edit_content', { target: 'Document body' }, word()) as any).needsContent.field).toBe('body');
    expect((validateActionCall('edit_content', { target: 'Slide canvas' }, ppt()) as any).needsContent.field).toBe('slideTitle');
  });
  it('CONFIRM OVERRIDES the placeholder check — the user has seen the witness card', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'heading', confirm: true }, word())).toEqual({ ok: true });
  });
});

describe('malformed calls — the model is addressed, never the user', () => {
  it('an Excel cell with no value is an ERROR, not an ask — the classification is the point', () => {
    const v = validateActionCall('edit_content', { target: 'Cell B5' }, excel()) as any;
    expect(v.error).toBeTruthy();
    expect(v.needsContent).toBeUndefined();   // a number the user stated is not authorial
    expect(v.error).toContain('B5');
  });
  it('an unknown object kind names the valid set, derived from the same constant', () => {
    const v = validateActionCall('insert_object', { target: 'grid', detail: 'widget' }, excel()) as any;
    for (const k of INSERT_KINDS) expect(v.error).toContain(k);
  });
  it('aggregate errors match totalColumn EXACTLY, so validator and reducer cannot drift', () => {
    const v = validateActionCall('insert_object', { target: 'Cell A2', detail: 'sum' }, excel()) as any;
    const direct = totalColumn(cells(), 'A', 'sum') as { error: string };
    expect(v.error).toBe(direct.error);
  });
  it('an ambiguous column asks which one', () => {
    const twoNumeric: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '1', A2: '2', B1: '3', B2: '4' } };
    const v = validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'total' }, twoNumeric) as any;
    expect(v.error).toContain('Which column');
  });
  it('a single numeric column is resolved without asking', () => {
    const one: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: 'Label', B1: 'n', B2: '10', B3: '20' } };
    expect(validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'sum' }, one)).toEqual({ ok: true });
  });
});

describe('exempt verbs and vocabulary', () => {
  it('format_content and save_file never gate', () => {
    expect(validateActionCall('format_content', { target: 'Document body' }, word())).toEqual({ ok: true });
    expect(validateActionCall('save_file', { target: 'Save' }, word())).toEqual({ ok: true });
  });
  it('"total" and "mean" are aggregate words — the observed near-miss that inserted a chart', () => {
    expect(aggregateMode('total')).toBe('sum');
    expect(aggregateMode('sum')).toBe('sum');
    expect(aggregateMode('mean')).toBe('average');
    expect(aggregateMode('avg')).toBe('average');
    expect(aggregateMode('chart')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/actions/validate.test.ts` → FAIL, unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/actions/validate.ts`:

```ts
// The gate (spec §4). Everything here follows one question: WHOSE information is missing?
//   the USER underspecified  -> { needsContent } -> ask them, with candidate answers
//   the MODEL called wrong   -> { error }        -> tell the model; never bother the user
// Keeping these apart is not taste: this is a measurement testbed, and logging an ask as an
// error would inflate every register arm's error rate with correct collaborative behaviour.
import { normText } from '../entities/registry';
import type { MockDoc } from '../scenarios';
import { totalColumn } from './columnTotal';

export type ActionValidation =
  | { ok: true }
  | { needsContent: { field: string; question: string } }
  | { error: string };

export const INSERT_KINDS = ['chart', 'slide', 'shape', 'sum', 'average'] as const;

const SUM_WORDS = ['sum', 'total'];
const AVG_WORDS = ['average', 'avg', 'mean'];

/** Which aggregate the detail asks for, or null. `total`/`mean` included: the observed
 *  near-miss was `detail: "total"` silently inserting a chart. */
export function aggregateMode(detail?: string): 'sum' | 'average' | null {
  const d = normText(detail ?? '');
  if (!d) return null;
  if (AVG_WORDS.some((w) => d.includes(w))) return 'average';
  if (SUM_WORDS.some((w) => d.includes(w))) return 'sum';
  return null;
}

/** AUTHORIAL fields only — words that become the user's document. A cell value the user already
 *  stated ("put 100 here") is NOT authorial; asking for it would be nagging. */
function authorialField(doc: MockDoc, target?: string, detail?: string): { field: string; question: string } | null {
  const t = normText(target ?? ''), d = normText(detail ?? '');
  if (doc.kind === 'word') {
    return t.includes('head') || d.includes('head')
      ? { field: 'heading', question: 'What would you like the heading to say?' }
      : { field: 'body', question: 'What would you like it to say?' };
  }
  if (doc.kind === 'powerpoint') {
    return { field: 'slideTitle', question: 'What would you like the slide title to say?' };
  }
  return null;                                   // excel cells, photos: not authorial
}

const PLACEHOLDERS = ['heading', 'title', 'text', 'body', 'content', 'value'];

function isPlaceholder(detail: string | undefined, field: string): boolean {
  const d = normText(detail ?? '');
  if (!d) return true;                           // absent or blank
  return PLACEHOLDERS.includes(d) || d === normText(field);
}

/** Column for an aggregate: the target's letter, else the only numeric column, else ask. */
function resolveColumn(cells: Record<string, string>, target?: string): string | null {
  const fromTarget = target?.match(/\b([A-Da-d])\s*\d/)?.[1] ?? target?.match(/\bcolumn\s+([A-Da-d])\b/i)?.[1];
  if (fromTarget) return fromTarget.toUpperCase();
  const numeric = ['A', 'B', 'C', 'D'].filter((c) => 'value' in totalColumn(cells, c, 'sum'));
  return numeric.length === 1 ? numeric[0] : null;
}

export function validateActionCall(
  verb: string, args: { target?: string; detail?: string; confirm?: boolean }, doc: MockDoc,
): ActionValidation {
  // format_content / save_file / photo_edit have honest defaults or no payload.
  if (verb !== 'edit_content' && verb !== 'insert_object') return { ok: true };

  if (verb === 'edit_content') {
    const field = authorialField(doc, args.target, args.detail);
    if (!field) {
      // Not authorial. A missing value is the MODEL's omission — it had the number.
      const detail = (args.detail ?? '').trim();
      if (!detail) {
        const where = args.target?.trim() || 'that cell';
        return { error: `edit_content on ${where} needs the value to enter — the user said it; pass it as detail.` };
      }
      return { ok: true };
    }
    // The user has SEEN the witness card and confirmed: their words win, placeholder or not.
    if (args.confirm === true) return { ok: true };
    return isPlaceholder(args.detail, field.field) ? { needsContent: field } : { ok: true };
  }

  // insert_object
  const mode = aggregateMode(args.detail);
  if (!mode) {
    const d = normText(args.detail ?? '');
    if (!d || !INSERT_KINDS.some((k) => d.includes(k))) {
      return { error: `insert_object doesn't know "${args.detail ?? ''}". Valid: ${INSERT_KINDS.join(', ')}.` };
    }
    return { ok: true };
  }
  if (doc.kind !== 'excel') return { ok: true };
  const column = resolveColumn(doc.cells, args.target);
  if (!column) return { error: 'Which column should I total? Point at a cell in it, or name it.' };
  const r = totalColumn(doc.cells, column, mode);
  return 'error' in r ? { error: r.error } : { ok: true };
}
```

- [ ] **Step 4: Run tests, then full gates**

Run: `npx vitest run src/actions/validate.test.ts` → PASS.
Run: `npx vitest run && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/validate.ts src/actions/validate.test.ts
git commit -m "feat(actions): validateActionCall — asks the user, errors the model, never confuses the two"
```

---

### Task 3: The ask tool

**Files:**
- Create: `src/actions/askContent.ts`, `src/actions/askContent.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `src/voice/types.ts`.
- Produces: `ASK_CONTENT_TOOL: VoiceTool`; `AskState { field: string; question: string; candidates: string[] }`; `askCallToState(args: unknown): { ask: AskState } | { error: string }`; `MAX_CANDIDATES = 3`.

- [ ] **Step 1: Write the failing test**

Create `src/actions/askContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { askCallToState, ASK_CONTENT_TOOL, MAX_CANDIDATES } from './askContent';

describe('ASK_CONTENT_TOOL', () => {
  it('has flat parameters — nested object-arrays are the d24abef schema hazard', () => {
    for (const p of Object.values(ASK_CONTENT_TOOL.parameters.properties as Record<string, any>)) {
      expect(p.type === 'object').toBe(false);
    }
    expect(ASK_CONTENT_TOOL.parameters.required).toEqual(['field', 'question']);
  });
});

describe('askCallToState', () => {
  it('accepts a question with candidates', () => {
    const v = askCallToState({ field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] });
    expect(v).toEqual({ ask: { field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] } });
  });
  it('accepts a bare question — the model asks plainly rather than padding', () => {
    const v = askCallToState({ field: 'body', question: 'What should it say?' }) as any;
    expect(v.ask.candidates).toEqual([]);
  });
  it('rejects an empty question', () => {
    expect((askCallToState({ field: 'heading', question: '  ' }) as any).error).toBeTruthy();
  });
  it('rejects an unknown field, naming the valid ones', () => {
    const v = askCallToState({ field: 'nonsense', question: 'What?' }) as any;
    expect(v.error).toContain('heading');
    expect(v.error).toContain('slideTitle');
  });
  it(`caps candidates at ${MAX_CANDIDATES} rather than truncating silently`, () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['a', 'b', 'c', 'd'] }) as any;
    expect(v.error).toContain(String(MAX_CANDIDATES));
  });
  it('drops blank candidates instead of rendering empty chips', () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['Real', '  ', ''] }) as any;
    expect(v.ask.candidates).toEqual(['Real']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/actions/askContent.ts`:

```ts
// The unspecified ask made first-class (spec §6). "Add a heading here" is not a failed call —
// the user deliberately left the content open. The agent asks back, and may offer up to three
// candidates drawn from the document. Candidates are SUGGESTIONS, never defaults: an
// unanswered ask expires into nothing.
import type { VoiceTool } from '../voice/types';

export const MAX_CANDIDATES = 3;
export const ASK_FIELDS = ['heading', 'body', 'slideTitle'] as const;

export interface AskState { field: string; question: string; candidates: string[] }

export const ASK_CONTENT_TOOL: VoiceTool = {
  name: 'ask_content',
  description: 'Ask the user what authorial content should say when they did not tell you — a heading, body text, or a slide title. Call this INSTEAD of guessing or sending a placeholder. Give one short question and up to three candidate answers drawn from the document (omit candidates if you have nothing sensible to suggest). The user answers by picking one, typing, or speaking.',
  parameters: { type: 'object', properties: {
    field: { type: 'string', enum: [...ASK_FIELDS], description: 'Which content you are asking about.' },
    question: { type: 'string', description: 'The short spoken question, e.g. "What would you like the heading to say?"' },
    candidates: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_CANDIDATES} suggested answers. Optional.` },
  }, required: ['field', 'question'] },
};

export function askCallToState(args: unknown): { ask: AskState } | { error: string } {
  const a = (args ?? {}) as { field?: unknown; question?: unknown; candidates?: unknown };
  const field = String(a.field ?? '');
  if (!(ASK_FIELDS as readonly string[]).includes(field)) {
    return { error: `ask_content field must be one of: ${ASK_FIELDS.join(', ')}.` };
  }
  const question = String(a.question ?? '').trim();
  if (!question) return { error: 'ask_content needs a short question to speak.' };
  const raw = Array.isArray(a.candidates) ? a.candidates.map(String) : [];
  if (raw.length > MAX_CANDIDATES) {
    return { error: `ask_content takes at most ${MAX_CANDIDATES} candidates — pick your best ${MAX_CANDIDATES}.` };
  }
  return { ask: { field, question, candidates: raw.map((c) => c.trim()).filter(Boolean) } };
}
```

- [ ] **Step 4: Run tests + full gates** — target PASS; `npx vitest run && npx tsc --noEmit` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/askContent.ts src/actions/askContent.test.ts
git commit -m "feat(actions): ask_content — the unspecified ask as a first-class tool"
```

---

### Task 4: The gate goes live, and the inventing fallbacks come out

Both halves ship together: removing `applyAction`'s fallbacks without the gate live would write empty strings, and landing the gate without removing them would leave the lie behind a guard.

**Files:**
- Modify: `src/scenarios.ts` (the four `||` fallbacks; the aggregate branch; `A_CELLS` removal)
- Modify: `src/App.tsx` (validator call in the action-verb branch)
- Modify: `src/scenarios.test.ts` if it exists, else create `src/actions/applyAction.test.ts`

**Interfaces:**
- Consumes: `validateActionCall` (Task 2), `totalColumn`/`formatTotal` (Task 1).
- Produces: an action-verb path that cannot commit on missing information.

- [ ] **Step 1: Write the failing test**

Create `src/actions/applyAction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyAction } from '../scenarios';
import { seedCorpus } from '../artifacts/seeds';

const excel = () => seedCorpus().excel;

describe('applyAction no longer invents payloads', () => {
  it('an Excel cell edit with no detail writes NOTHING — it must never invent 100', () => {
    const doc = excel();
    const after = applyAction(doc, 'edit_content', { target: 'Cell B5' }) as any;
    expect(after.cells.B5).toBeUndefined();
  });
  it('a heading edit with no detail writes NOTHING — it must never write "Heading"', () => {
    const after = applyAction(seedCorpus().word, 'edit_content', { target: 'heading' }) as any;
    expect(after.heading).toBeUndefined();
  });
});

describe('the aggregate writes into the totalled column, not hardcoded A', () => {
  it('totals column B and lands the result below it, formatted like its column', () => {
    const doc = { kind: 'excel' as const, currency: [], chart: false, saved: false,
      cells: { B1: 'Q3', B2: '$4.2M', B3: '$3.4M' } };
    const after = applyAction(doc, 'insert_object', { target: 'Cell B2', detail: 'sum' }) as any;
    expect(after.cells.B4).toBe('$7.6M');     // below the last used row, in the column's idiom
    expect(after.cells.A4).toBeUndefined();   // NOT column A
  });
  it('a column with nothing summable is left untouched (the validator refuses upstream)', () => {
    const doc = excel();
    const after = applyAction(doc, 'insert_object', { target: 'Cell A2', detail: 'sum' });
    expect(after).toEqual(doc);
  });
  it('an unrecognised insert no longer silently becomes a chart', () => {
    const doc = excel();
    const after = applyAction(doc, 'insert_object', { target: 'grid', detail: 'total' }) as any;
    expect(after.chart).toBe(false);          // "total" is an aggregate, never a chart
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/actions/applyAction.test.ts`
Expected: FAIL — `B5` is `'100'`, `heading` is `'Heading'`, the aggregate writes to column A or nothing, and `detail:'total'` sets `chart: true`.

- [ ] **Step 3: Rework `applyAction`**

In `src/scenarios.ts`, replace the word/excel/powerpoint content branches and the excel aggregate. Delete `A_CELLS` (now unused) and add the import:

```ts
import { totalColumn, formatTotal, COLUMN_ROWS } from './actions/columnTotal';
import { aggregateMode } from './actions/validate';
```

Word (`~:440`):

```ts
    case 'word':
      if (verb === 'format_content') return { ...doc, bold: true };
      if (verb === 'edit_content') {
        // No `|| 'Heading'`, no `|| doc.text`: the validator guarantees a payload before we get
        // here, so an absent one means something upstream is wrong — write nothing rather than
        // inventing the user's prose.
        if (!detail) return doc;
        if (has(args.target, 'head') || has(detail, 'head')) return { ...doc, heading: detail };
        return { ...doc, text: detail };
      }
```

(leave the `revise_text` branch untouched)

Excel (`~:453`):

```ts
    case 'excel':
      if (verb === 'edit_content') {
        if (!detail) return doc;                       // never `|| '100'`
        return { ...doc, cells: { ...doc.cells, [cellRef(args.target)]: detail } };
      }
      if (verb === 'format_content') {
        const ref = cellRef(args.target);
        return { ...doc, currency: doc.currency.includes(ref) ? doc.currency : [...doc.currency, ref] };
      }
      if (verb === 'insert_object') {
        const mode = aggregateMode(detail);
        if (!mode) return has(detail, 'chart') ? { ...doc, chart: true } : doc;
        const column = (args.target?.match(/\b([A-Da-d])\s*\d/)?.[1] ?? 'A').toUpperCase();
        const r = totalColumn(doc.cells, column, mode);
        if ('error' in r) return doc;                  // the validator already refused upstream
        // Land below the column's last used row, in the column's own idiom.
        const lastUsed = Math.max(...r.usedRefs.map((ref) => Number(ref.slice(1))));
        const free = COLUMN_ROWS.find((row) => row > lastUsed && !(doc.cells[`${column}${row}`] ?? '').trim());
        if (!free) return doc;
        return { ...doc, cells: { ...doc.cells, [`${column}${free}`]: formatTotal(r.value, r.unit) } };
      }
      return doc;
```

PowerPoint (`~:477`):

```ts
      if (verb === 'edit_content') {
        if (!detail) return doc;                       // never `|| slides[last]`
        const slides = [...doc.slides];
        slides[slides.length - 1] = detail;
        return { ...doc, slides };
      }
```

- [ ] **Step 4: Wire the validator into the action-verb branch**

In `src/App.tsx`, inside the `ACTION_VERB_NAMES` branch (~line 1715), immediately after `const confirmed = args.confirm === true;` and BEFORE the double-apply guard:

```tsx
      // THE GATE (spec §4). Nothing is witnessed or committed on missing information. An ask is
      // NOT an error: {needsContent} addresses the USER (Task 5 gives it chips; until then the
      // model asks by speech), {error} addresses the MODEL.
      const gate = validateActionCall(fc.name, args, mockDocRef.current);
      if ('error' in gate) {
        addLog('tool', `Tool Call: ${fc.name} REJECTED — ${gate.error}`);
        ack({ success: false, error: gate.error });
        return;
      }
      if ('needsContent' in gate) {
        addLog('info', `${fc.name} needs ${gate.needsContent.field} — asking the user.`);
        ack({ success: false, error: `${gate.needsContent.question} Call ask_content with that question, then act on the user's answer. Do NOT send a placeholder.` });
        return;
      }
```

Add the import: `import { validateActionCall } from './actions/validate';`

- [ ] **Step 5: Run the gates**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS. Pre-existing tests asserting the old inventing behaviour (search for `'100'` and `'Heading'` in `src/**/*.test.ts`) will fail — **update them to assert the new honest behaviour and say so in your report**; do not weaken them.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios.ts src/App.tsx src/actions/applyAction.test.ts
git commit -m "feat(actions): the gate is live — no invented payloads, no silent no-op totals"
```

---

### Task 5: The ask surface — question, candidate chips, telemetry, prompt

**Files:**
- Modify: `src/telemetry.ts`, `src/prompt/instructions.ts`, `src/scenarios.ts` (`insert_object` description), `src/App.tsx`

**Interfaces:**
- Consumes: `ASK_CONTENT_TOOL`, `askCallToState`, `AskState` (Task 3).
- Produces: a live ask surface; `telemetry.unspecifiedAsk(field, answered, viaChip)`.

- [ ] **Step 1: Telemetry — an ask is not an error**

In `src/telemetry.ts`, add to the `TelemetryEvent` union and a method beside `registerSwitch`:

```ts
  | { type: 'unspecified_ask'; field: string; answered: boolean; viaChip: boolean }
```
```ts
  /** An unspecified ask is CORRECT collaborative behaviour, never a failure. Counted separately
   *  so a register arm that asks more does not look like an arm that errors more. */
  unspecifiedAsk(field: string, answered: boolean, viaChip: boolean) { this.push({ type: 'unspecified_ask', field, answered, viaChip }); }
```

- [ ] **Step 2: Advertise the aggregate, add the prompt rule**

In `src/scenarios.ts`, the `insert` verb description becomes:

```ts
    description: 'Insert a new object (a chart, a new slide, a shape), or compute a column aggregate (sum/total, average) into the first free cell below that column. HIGH-COMMITMENT — it adds to the document. Witness-render first, then commit with confirm=true.',
```

In `src/prompt/instructions.ts`, add beside the existing clarification rules (inside the honest-mode block, after the LOW CONFIDENCE rule):

```ts
- AUTHORIAL CONTENT YOU DON'T HAVE: if the user asks for a heading, body text or a slide title without saying what it should say, do NOT guess and do NOT send a placeholder like "heading". Call ask_content with one short question and up to three candidates drawn from the document. Act on their answer. A number or value the user already stated is NOT authorial — just use it.
```

- [ ] **Step 3: Ask state, tool registration and routing in App**

Register the tool in the tool list (beside `REFINE_TOOL`), gated to the programs that have authorial content:

```tsx
    ...(activeProgram === 'word' || activeProgram === 'powerpoint' ? [ASK_CONTENT_TOOL] : []),
```

Add state beside the other shell state:

```tsx
  // An open unspecified ask (spec §6). Candidates become the chip row so they fire by digit;
  // the question becomes the omnibox placeholder so typing is equally first-class.
  const [ask, setAsk] = useState<AskState | null>(null);
```

Route the tool, beside the other tool branches:

```tsx
    } else if (fc.name === 'ask_content') {
      const v = askCallToState(fc.args);
      if ('error' in v) {
        addLog('tool', `Tool Call: ask_content REJECTED — ${v.error}`);
        ack({ success: false, error: v.error });
      } else {
        setAsk(v.ask);
        addLog('info', `Asked: ${v.ask.question}${v.ask.candidates.length ? ` (${v.ask.candidates.length} candidates)` : ''}`);
        ack({ success: true, note: 'The question is on screen; the user will answer by chip, typing or voice.' });
      }
    }
```

Add the imports: `import { ASK_CONTENT_TOOL, askCallToState, type AskState } from './actions/askContent';`

- [ ] **Step 4: Candidate chips + cancellation**

Override the `suggestions` memo (~line 560) so an open ask owns the chip row — this single change gives the ask BOTH the rendered chips and digit quick-fire, because both read this same value:

```tsx
  const suggestions = useMemo(
    () => ask
      // An open ask owns the chip row in EVERY register: declining to invent the user's words is
      // not scaffolding, so no chipDensity gate applies. Both the rendered chips and the
      // quick-fire digit path read this one value.
      ? ask.candidates.map((phrase, i) => ({ key: `ask-${i}`, label: 'Answer', phrase, color: '99,102,241' }))
      : visibleSuggestions(allSuggestions, dials.chipDensity, grounding.length),
    [ask, allSuggestions, dials.chipDensity, grounding.length],
  );
```

Pass the question as the omnibox placeholder — add an `askQuestion` prop to `Omnibox` and use it at the placeholder site (`Omnibox.tsx:162`):

```tsx
          placeholder={askQuestion ?? (grounding.length ? 'Ask about your selection…' : 'Ask or tell me anything — point while you type')}
```

Clear the ask when it is answered or abandoned. Any submitted text answers it; Esc and a program swap cancel it:

```tsx
  // Answered: whatever the user sent IS the answer — the model reads it and calls the verb.
  const clearAsk = (answered: boolean, viaChip: boolean) => {
    if (!ask) return;
    telemetry.unspecifiedAsk(ask.field, answered, viaChip);
    setAsk(null);
  };
  useEffect(() => { if (ask) setAsk(null); }, [activeProgram]);   // a swap abandons the question
```

Call `clearAsk(true, viaChip)` from the submit path and the quick-fire path (the latter with `viaChip: true`), and `clearAsk(false, false)` from the existing Esc handler. **An expiring ask applies nothing** — no candidate is ever used because the user stayed silent.

- [ ] **Step 5: Run the gates**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS, suite unchanged from Task 4 (component wiring adds no unit tests).

- [ ] **Step 6: Commit**

```bash
git add src/telemetry.ts src/prompt/instructions.ts src/scenarios.ts src/App.tsx src/shell/Omnibox.tsx
git commit -m "feat(actions): the ask surface — question, candidate chips, separate telemetry"
```

---

### Task 6: Browser drive

First time any of this runs. An item you cannot observe is a FAILED item.

- [ ] **Step 1: Launch**

`npx vite --port 3001` (port 3000 belongs to another project). Prior drives in this repo built an ad-hoc CDP driver from Node built-ins — reuse that method. Known quirk: the first CDP click after load misses; prefer JS-driven interaction. **`.env` holds a real API key — do not read or print it.** Write findings to the report incrementally, not at the end.

- [ ] **Step 2: Drive, recording what you OBSERVE**

| # | Check |
|---|---|
| A1 | Word, press "Add a heading here" → a spoken/captioned question appears, NOT the word "heading" in the document |
| A2 | The chip row shows the candidates with digit keycaps; the omnibox placeholder is the question |
| A3 | Fire candidate 2 by pressing `2` → the heading lands with that text |
| A4 | Repeat, but type a different answer instead → that text lands |
| A5 | Repeat, press Esc mid-ask → chips revert to the normal suggestions, nothing is written |
| A6 | Swap program mid-ask → the ask is abandoned, no stale chips |
| T1 | Excel, point at a column-B cell, ask to total it → the mixed-units refusal is spoken, naming `$4.2M` and `18%` |
| T2 | Point at column A, ask to total → the no-numbers refusal naming the labels |
| T3 | Build a clean numeric column (type values into C2, C3), total it → the result lands in the first free C cell |
| T4 | Ask to insert something unknown ("insert a widget") → an honest refusal naming the valid kinds, and NO chart appears |
| G1 | Excel, "put 100 here" pointing at a cell → still works with NO question (a stated value is not authorial) |
| G2 | Journal check: `JSON.parse(localStorage.getItem('ff-journal')).entries` — an answered ask produces a `doc.set`, an abandoned one produces nothing |

- [ ] **Step 3: Fix anything that fails**, re-run all three gates, record failure + fix.

- [ ] **Step 4: Add the owed live-smoke rows**

Append to `docs/superpowers/smokes/2026-07-24-human-smoke-sitting.md` (same table format, Result `pending`): MG-1 both ask flows by voice — question heard, answer spoken, heading lands; MG-2 the confirm override (ask for a heading that literally says "Heading" and confirm it); MG-3 a live column total by voice with the cells it used named back.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(actions): browser drive — the agent asks instead of inventing"
```

---

## Self-Review

**Spec coverage:** §2 classification → Tasks 2, 5 (telemetry) · §3 architecture → the File Structure table · §4.1 authorial asks incl. the confirm override → Task 2 · §4.2 malformed calls → Task 2 · §4.3 column resolution → Task 2 · §5 columnTotal/formatTotal/landing cell → Tasks 1, 4 · §6.1 `ask_content` → Task 3 · §6.2 chips, placeholder, cancellation, register gating, choice-not-action → Task 5 · §7 prompt + description → Task 5 · §8 honesty rules → enforced across 1, 2, 4, 5 · §9 testing incl. the seedCorpus rule → Global Constraints + every task · §10 risks → mitigations land with their risk.

**Deviation, recorded:** the spec's §4.3 says an ambiguous column returns an error asking which; Task 2 implements exactly that, but note the *reducer* (Task 4) defaults to column `A` when the target carries no letter — unreachable in practice because the validator refuses first, and commented as such. If a future caller bypasses the validator, the reducer degrades to a no-op rather than a wrong column, because `totalColumn('A')` on the seed corpus errors.

**Type consistency:** `parseCellValue`/`formatTotal`/`totalColumn`/`COLUMN_ROWS` (Task 1) are consumed under those exact names in Tasks 2 and 4. `ActionValidation`'s three shapes are discriminated by `'error' in`/`'needsContent' in` in Task 4 exactly as Task 2 defines them. `AskState { field, question, candidates }` (Task 3) is the state type in Task 5. `aggregateMode` is shared by the validator and the reducer, so their vocabularies cannot drift.
