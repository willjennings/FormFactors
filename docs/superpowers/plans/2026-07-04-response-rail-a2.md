# Response Rail (A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the floating response rail that renders the typed card grammar — the model's instructional/informational output becomes validated cards via a `respond` tool, teaching sequences render as the same cards, and `explain` answers land as ANSWER cards.

**Architecture:** A pure contract core (`src/rail/`): card types + budgets, an honest mapper (`respondCallToRail` — budgets demote to WHY, structural violations fail the whole call as data, targets band via `resolveEchoedTarget`), a pure rail reducer, and a projection from `TeachingState` so teaching and responses share one renderer. The `RailPanel` floats right of the window; `respond` joins the voice tools with a strict-contract prompt section.

**Tech Stack:** React 19 + Vite 6 + Tailwind v4, TypeScript, Vitest, lucide-react. No new dependencies.

**Specs:** `docs/superpowers/specs/2026-07-03-response-grammar-design.md` (the contract — budgets, taxonomy, band, rail semantics) and `docs/superpowers/specs/2026-07-03-desktop-shell-design.md` §4/§9 (placement + A2 scope).

## Global Constraints

- Branch: `honest-mode`, work directly on it.
- **Budgets are the design** (grammar §2, exact): DO action ≤90 / result ≤60; ANSWER ≤80; ORIENT ≤90; CHECK ≤80; CAUTION ≤90; CONCEPT front ≤60 / back ≤160 / analogy ≤80; TRY prompt ≤90 / notice ≤60; RECAP 3 lines × ≤60. Over-budget text DEMOTES to the card's WHY slot (never deleted, never rendered inline); structural violations (unknown type, missing required slot, multi-verb DO, >3 recap lines, unknown CHECK path) fail the WHOLE call with an error returned as data. Never throw.
- **Deliberate divergence (grammar §4):** an unresolvable card target is NOT an error — the card renders with a hollow pointer and refusal-aware copy. Do not "unify" this with `teachCallToEvent`'s whole-call failure; the difference is the design.
- CHECK `verify:'auto'` predicates evaluate against the reducer state (`MockDoc`) — ✓ never lies; a failing auto-check renders ✗ "not yet" and does NOT advance; unknown predicate path = whole-call error at map time.
- guideLine: exactly one sentence per response; cards are persona-free. Voice mode: the model speaks it (prompt-enforced); it always renders as the rail's interstitial text.
- Chips/cards never auto-execute; reducers stay pure (injected `now`, no throwing); teaching store internals are NOT modified (a read-only `onStateChange` seam + projection only).
- 3±1 cards visible; done cards compress to one-line ✓ stubs; future cards dim (hollow if target doesn't exist yet). No progress bars.
- Telemetry: card events extend the guidance rubric; spaced resurfacing is OUT of scope (experiment-gated per grammar §8/§10).
- Verify per task: `npx tsc --noEmit && npx vitest run` (baseline 114 tests, 26 files). Final: `npx vite build`.
- Commit after every task with the message given.

## File Structure

```
src/rail/types.ts                    CREATE  CardType/RailCard/Rail/RailEvent + BUDGETS
src/rail/predicate.ts                CREATE  evaluatePredicate(doc, {path, equals}) dot-path, pure
src/rail/respondCallToRail.ts        CREATE  the honest mapper (validation, demotion, band)
src/rail/respondCallToRail.test.ts   CREATE
src/rail/railStore.ts                CREATE  pure reducer + selectors
src/rail/railStore.test.ts           CREATE
src/rail/projectTeaching.ts          CREATE  TeachingState → Rail projection
src/rail/projectTeaching.test.ts     CREATE
src/rail/CardView.tsx                CREATE  one card (kicker/action/result/why/show-me/band)
src/rail/RailPanel.tsx               CREATE  the floating panel (stubs, guideLine, pill, drag)
src/teaching/TeachingLayer.tsx       MODIFY  optional onStateChange seam; mounted always
src/prompt/instructions.ts           MODIFY  + RESPONSE CONTRACT section
src/prompt/instructions.test.ts      MODIFY  + contract assertions
src/telemetry.ts                     MODIFY  guidance kinds extended with card events
src/App.tsx                          MODIFY  respond tool, rail state/dispatch, mounts, explain→ANSWER
```

Element convention reminder (registry): entity ids are `${programId}-${imageId}`; `resolveEchoedTarget(entities, text)` returns `{ entity, score } | null` with the ≥2-token honesty floor.

---

### Task 1: Contract core — types, predicate, honest mapper (TDD)

**Files:**
- Create: `src/rail/types.ts`, `src/rail/predicate.ts`, `src/rail/respondCallToRail.ts`
- Test: `src/rail/respondCallToRail.test.ts`

**Interfaces:**
- Produces (everything later tasks consume):

```ts
// types.ts
export type CardType = 'do' | 'answer' | 'orient' | 'check' | 'caution' | 'concept' | 'try' | 'recap';
export type Band = 'solid' | 'hollow';
export type CardState = 'pending' | 'active' | 'done' | 'failed';
export interface RailCard {
  t: CardType;
  text?: string;                       // answer/orient/check/caution
  verb?: string; target?: string;      // do
  entityId?: string | null;            // resolved id, null = hollow
  band: Band;
  result?: string;                     // do
  why?: string;                        // collapsed prose (incl. demoted overflow)
  front?: string; back?: string; analogy?: string;   // concept
  prompt?: string; notice?: string;                  // try
  lines?: string[];                    // recap
  verify?: 'auto' | 'user';            // check
  expect?: { path: string; equals: unknown };        // check auto
  state: CardState;
}
export interface Rail { seq: string; cards: RailCard[]; activeIndex: number | null; guideLine?: string; startedAt: number; }
export const BUDGETS = { doAction: 90, doResult: 60, answer: 80, orient: 90, check: 80, caution: 90, conceptFront: 60, conceptBack: 160, conceptAnalogy: 80, tryPrompt: 90, tryNotice: 60, recapLine: 60, recapLines: 3 } as const;
export const DO_VERBS = ['click', 'press', 'type', 'drag', 'open'] as const;
```
- `evaluatePredicate(doc: MockDoc, expect: { path: string; equals: unknown }): boolean | null` — dot-path lookup (`saved`, `cells.A4`); returns `null` when the path doesn't exist on this doc kind (mapper treats null-at-map-time as a whole-call error; the store treats runtime null as fail).
- `respondCallToRail(args: unknown, entities: SceneEntity[], doc: MockDoc, now: number): { rail: Rail; guideLine?: string } | { error: string }` — never throws.

- [ ] **Step 1: Write the failing tests**

`src/rail/respondCallToRail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { respondCallToRail } from './respondCallToRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc } from '../scenarios';

const program = getProgram('word');
const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
const doc = initialMockDoc('word');
const call = (cards: unknown[], guideLine = 'One click and your work is safe.') =>
  respondCallToRail({ seq: 'word.save', cards, guideLine }, entities, doc, 1000);
const ok = (r: ReturnType<typeof call>) => { if ('error' in r) throw new Error(r.error); return r; };

describe('respondCallToRail — the honest mapper', () => {
  it('maps a valid sequence: orient auto-done, first actionable card active, band solid', () => {
    const r = ok(call([
      { t: 'orient', text: 'Nothing saved yet.' },
      { t: 'do', verb: 'click', target: 'Save button', result: 'The title bar reads Saved.' },
      { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'Shows Saved.' },
    ]));
    expect(r.rail.seq).toBe('word.save');
    expect(r.rail.cards[0].state).toBe('done');            // orient is context, never a gate
    expect(r.rail.activeIndex).toBe(1);
    expect(r.rail.cards[1].entityId).toBe('word-2');
    expect(r.rail.cards[1].band).toBe('solid');
    expect(r.rail.guideLine).toBe('One click and your work is safe.');
  });

  it('unresolvable target → hollow band, NOT an error (deliberate divergence from teaching)', () => {
    const r = ok(call([{ t: 'do', verb: 'click', target: 'Transition handle', result: 'It moves.' }]));
    expect(r.rail.cards[0].band).toBe('hollow');
    expect(r.rail.cards[0].entityId).toBeNull();
  });

  it('over-budget action text demotes to WHY, never deleted', () => {
    const long = 'Click the Save button which you will find in the upper left area of the ribbon next to its sibling Save As control'; // >90
    const r = ok(call([{ t: 'do', verb: 'click', target: 'Save button', result: 'Saved.', text: undefined, action: long } as any]));
    // mapper reads DO action text from `text`; see implementation — pass via text:
    const r2 = ok(call([{ t: 'do', verb: 'click', target: 'Save button', text: long, result: 'Saved.' }]));
    expect(r2.rail.cards[0].text!.length).toBeLessThanOrEqual(90);
    expect(r2.rail.cards[0].why).toContain('sibling Save As');
  });

  it('unknown card type fails the WHOLE call as data', () => {
    const r = call([{ t: 'nag', text: 'hi' }]);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/card type/i);
  });

  it('DO with a non-vocabulary verb fails the whole call', () => {
    const r = call([{ t: 'do', verb: 'defenestrate', target: 'Save button', text: 'x', result: 'y' }]);
    expect(r).toHaveProperty('error');
  });

  it('CHECK auto with an unknown predicate path fails the whole call (honesty over helpfulness)', () => {
    const r = call([{ t: 'check', verify: 'auto', expect: { path: 'frobnicated', equals: true }, text: 'x' }]);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/frobnicated/);
  });

  it('recap over 3 lines fails; 3 lines pass with per-line budget demotion intact', () => {
    expect(call([{ t: 'recap', lines: ['a', 'b', 'c', 'd'] }])).toHaveProperty('error');
    const r = ok(call([{ t: 'recap', lines: ['You saved the doc.', 'Save As makes a copy.', 'The ribbon holds both.'] }]));
    expect(r.rail.cards[0].lines).toHaveLength(3);
  });

  it('missing guideLine or empty cards fails the whole call', () => {
    expect(respondCallToRail({ seq: 's', cards: [] , guideLine: 'x'}, entities, doc, 0)).toHaveProperty('error');
    expect(respondCallToRail({ seq: 's', cards: [{ t: 'answer', text: 'hi' }] }, entities, doc, 0)).toHaveProperty('error');
  });

  it('ANSWER card maps with tightest budget and optional entity binding', () => {
    const r = ok(call([{ t: 'answer', text: 'That is the Save button.', target: 'Save button' }]));
    expect(r.rail.cards[0].entityId).toBe('word-2');
    expect(r.rail.activeIndex).toBe(0);
  });
});
```

Also create `src/rail/predicate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluatePredicate } from './predicate';
import { initialMockDoc, applyAction } from '../scenarios';

describe('evaluatePredicate', () => {
  it('resolves top-level and dotted paths', () => {
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'saved', equals: false })).toBe(true);
    const saved = applyAction(initialMockDoc('word'), 'save_file', {});
    expect(evaluatePredicate(saved, { path: 'saved', equals: true })).toBe(true);
    expect(evaluatePredicate(initialMockDoc('excel'), { path: 'cells.A1', equals: '10' })).toBe(true);
  });
  it('returns null for unknown paths (never throws)', () => {
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'cells.A1', equals: '10' })).toBeNull();
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'a.b.c.d', equals: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/rail` — FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/rail/types.ts` — exactly the Interfaces block above.

`src/rail/predicate.ts`:

```ts
import type { MockDoc } from '../scenarios';

/** Dot-path predicate against the reducer state. Returns null when the path is absent
 *  on this doc kind (mapper: whole-call error; store: treated as fail). Never throws. */
export function evaluatePredicate(doc: MockDoc, expect: { path: string; equals: unknown }): boolean | null {
  let cur: unknown = doc;
  for (const seg of expect.path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(seg in (cur as Record<string, unknown>))) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === expect.equals;
}
```

`src/rail/respondCallToRail.ts`:

```ts
import type { SceneEntity } from '../entities/registry';
import { resolveEchoedTarget } from '../entities/registry';
import type { MockDoc } from '../scenarios';
import { BUDGETS, DO_VERBS, type Rail, type RailCard, type CardType } from './types';
import { evaluatePredicate } from './predicate';

// The honest mapper (teachCallToEvent's sibling). Structural violations fail the WHOLE
// call as data; over-budget prose DEMOTES to the WHY slot (the paragraph tax); an
// unresolvable target is NOT an error — it renders hollow (deliberate divergence from
// teaching, where the agent must never teach AT a guessed element).

const CARD_TYPES: CardType[] = ['do', 'answer', 'orient', 'check', 'caution', 'concept', 'try', 'recap'];
const err = (m: string) => ({ error: m });

/** Trim `text` to `max`, pushing the overflow (whole-word) into the card's why slot. */
function budget(text: string, max: number, card: RailCard): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  const head = text.slice(0, cut > 0 ? cut : max).trimEnd();
  const tail = text.slice(head.length).trim();
  card.why = card.why ? `${tail} — ${card.why}` : tail;
  return head;
}

export function respondCallToRail(
  args: unknown, entities: SceneEntity[], doc: MockDoc, now: number,
): { rail: Rail; guideLine?: string } | { error: string } {
  const a = args as { seq?: unknown; cards?: unknown; guideLine?: unknown };
  if (!a || typeof a.seq !== 'string' || !a.seq) return err('respond requires a string "seq".');
  if (typeof a.guideLine !== 'string' || !a.guideLine.trim()) return err('respond requires exactly one guideLine sentence.');
  if (!Array.isArray(a.cards) || a.cards.length === 0) return err('respond requires a non-empty "cards" array.');

  const cards: RailCard[] = [];
  for (const [i, raw] of (a.cards as Record<string, unknown>[]).entries()) {
    const t = raw?.t as CardType;
    if (!CARD_TYPES.includes(t)) return err(`Card ${i}: unknown card type "${String(raw?.t)}".`);
    const card: RailCard = { t, band: 'solid', state: 'pending', why: typeof raw.why === 'string' ? raw.why : undefined };

    const bindTarget = (): string | null | undefined => {
      if (typeof raw.target !== 'string' || !raw.target) return undefined;
      card.target = raw.target;
      const hit = resolveEchoedTarget(entities, raw.target);
      card.entityId = hit ? (hit.entity.id as string) : null;
      card.band = hit ? 'solid' : 'hollow';
      return card.entityId;
    };

    switch (t) {
      case 'do': {
        if (typeof raw.verb !== 'string' || !(DO_VERBS as readonly string[]).includes(raw.verb))
          return err(`Card ${i}: DO verb must be one of ${DO_VERBS.join('/')}.`);
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: DO requires an action "text".`);
        if (typeof raw.result !== 'string' || !raw.result) return err(`Card ${i}: DO requires a "result" line.`);
        if (typeof raw.target !== 'string' || !raw.target) return err(`Card ${i}: DO requires a "target".`);
        card.verb = raw.verb; bindTarget();
        card.text = budget(raw.text, BUDGETS.doAction, card);
        card.result = budget(raw.result, BUDGETS.doResult, card);
        break;
      }
      case 'answer': {
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: ANSWER requires "text".`);
        bindTarget();
        card.text = budget(raw.text, BUDGETS.answer, card);
        break;
      }
      case 'orient': case 'caution': {
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: ${t.toUpperCase()} requires "text".`);
        card.text = budget(raw.text, t === 'orient' ? BUDGETS.orient : BUDGETS.caution, card);
        if (t === 'orient') card.state = 'done'; // context, never a gate
        break;
      }
      case 'check': {
        if (raw.verify !== 'auto' && raw.verify !== 'user') return err(`Card ${i}: CHECK requires verify:"auto"|"user".`);
        if (typeof raw.text !== 'string' || !raw.text) return err(`Card ${i}: CHECK requires "text".`);
        card.verify = raw.verify;
        if (raw.verify === 'auto') {
          const ex = raw.expect as { path?: unknown; equals?: unknown } | undefined;
          if (!ex || typeof ex.path !== 'string') return err(`Card ${i}: auto CHECK requires expect.path.`);
          if (evaluatePredicate(doc, { path: ex.path, equals: ex.equals }) === null)
            return err(`Card ${i}: CHECK path "${ex.path}" does not exist on the current document.`);
          card.expect = { path: ex.path, equals: ex.equals };
        }
        card.text = budget(raw.text, BUDGETS.check, card);
        break;
      }
      case 'concept': {
        if (typeof raw.front !== 'string' || typeof raw.back !== 'string') return err(`Card ${i}: CONCEPT requires front and back.`);
        card.front = budget(raw.front, BUDGETS.conceptFront, card);
        card.back = budget(raw.back, BUDGETS.conceptBack, card);
        if (typeof raw.analogy === 'string') card.analogy = budget(raw.analogy, BUDGETS.conceptAnalogy, card);
        break;
      }
      case 'try': {
        if (typeof raw.prompt !== 'string' || typeof raw.notice !== 'string') return err(`Card ${i}: TRY requires prompt and notice.`);
        bindTarget();
        card.prompt = budget(raw.prompt, BUDGETS.tryPrompt, card);
        card.notice = budget(raw.notice, BUDGETS.tryNotice, card);
        break;
      }
      case 'recap': {
        if (!Array.isArray(raw.lines) || raw.lines.length === 0) return err(`Card ${i}: RECAP requires lines.`);
        if (raw.lines.length > BUDGETS.recapLines) return err(`Card ${i}: RECAP is ${BUDGETS.recapLines} lines max.`);
        card.lines = (raw.lines as string[]).map(l => budget(String(l), BUDGETS.recapLine, card));
        break;
      }
    }
    cards.push(card);
  }

  const activeIndex = cards.findIndex(c => c.state === 'pending');
  if (activeIndex >= 0) cards[activeIndex].state = 'active';
  return { rail: { seq: a.seq, cards, activeIndex: activeIndex >= 0 ? activeIndex : null, guideLine: a.guideLine, startedAt: now }, guideLine: a.guideLine };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/rail` — PASS. Then `npx tsc --noEmit && npx vitest run` — clean, 114+new green.
(Fix the third test's stray first `call` if the implementation surfaces it as invalid — the test's `r` line with `action:` is intentionally exercising an ignored extra field; keep only the `r2` assertions if it fights the schema. Adjust the TEST, not the mapper, and note it in the report.)

- [ ] **Step 5: Commit**

```bash
git add src/rail
git commit -m "feat(rail): contract core — card types, predicate, honest respond mapper (budgets demote, violations fail as data)"
```

---

### Task 2: Rail store — pure reducer + selectors (TDD)

**Files:**
- Create: `src/rail/railStore.ts`
- Test: `src/rail/railStore.test.ts`

**Interfaces:**
- Produces:

```ts
export type RailEvent =
  | { type: 'rail.set'; rail: Rail }
  | { type: 'rail.dismiss' }
  | { type: 'user.elementAction'; entityId: string }   // click on a real control
  | { type: 'user.checkConfirm' }                      // "confirm for me" tap
  | { type: 'user.whyToggle'; index: number }
  | { type: 'user.flip'; index: number }               // concept flip
  | { type: 'doc.changed'; doc: MockDoc };
export interface RailState { rail: Rail | null; openWhy: number | null; flipped: number[]; }
export function initialRailState(): RailState;
export function reduceRail(s: RailState, e: RailEvent, now: number): RailState;  // pure, never throws
export function visibleCards(s: RailState): { card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed' }[]; // 3±1 window
export function railComplete(s: RailState): boolean;
```
- Advancement rules (grammar §5 + shell §4): `user.elementAction` advances an active `do`/`try` card whose `entityId` matches (hollow cards can NOT advance by element — there is nothing bound to click; they advance via `user.checkConfirm`-style manual advance? NO — hollow do/try cards advance on the NEXT `doc.changed` that makes a following auto-CHECK pass, or stay until dismissed; keep honest: hollow cards do not auto-advance). `user.checkConfirm` advances an active user-CHECK. `doc.changed` evaluates an active auto-CHECK: pass → done + advance; fail/null → `state:'failed'` (stays active, renders ✗). Advancing activates the next `pending` card; when none remain, `activeIndex` becomes null (complete). `answer`/`caution`/`concept`/`recap` cards are non-gating: if active, any `user.elementAction` or `user.checkConfirm` advances past them (glanceable, not blocking).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { initialRailState, reduceRail, visibleCards, railComplete } from './railStore';
import { respondCallToRail } from './respondCallToRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc, applyAction } from '../scenarios';

const program = getProgram('word');
const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
const doc = initialMockDoc('word');
const rail = () => {
  const r = respondCallToRail({ seq: 'word.save', guideLine: 'Safe in one click.', cards: [
    { t: 'orient', text: 'Nothing saved yet.' },
    { t: 'do', verb: 'click', target: 'Save button', text: 'Click Save.', result: 'Title bar reads Saved.' },
    { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'Shows Saved.' },
    { t: 'recap', lines: ['Saved.'] },
  ] }, entities, doc, 0);
  if ('error' in r) throw new Error(r.error);
  return r.rail;
};

describe('railStore', () => {
  it('element action on the bound entity advances the DO card; wrong entity does not', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-3' }, 1);
    expect(s.rail!.activeIndex).toBe(1);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 2);
    expect(s.rail!.cards[1].state).toBe('done');
    expect(s.rail!.activeIndex).toBe(2);
  });

  it('auto-CHECK passes on doc.changed and completes through non-gating recap', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc: applyAction(doc, 'save_file', {}) }, 2);
    expect(s.rail!.cards[2].state).toBe('done');
    expect(railComplete(s)).toBe(true);   // recap is non-gating: completing the check completes the rail
  });

  it('auto-CHECK failure renders failed and does NOT advance', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc }, 2);   // still unsaved
    expect(s.rail!.cards[2].state).toBe('failed');
    expect(s.rail!.activeIndex).toBe(2);
  });

  it('dismiss clears; why/flip toggles are per-index; unknown events no-op (never throws)', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.whyToggle', index: 1 }, 1);
    expect(s.openWhy).toBe(1);
    s = reduceRail(s, { type: 'user.flip', index: 1 }, 2);
    expect(s.flipped).toContain(1);
    s = reduceRail(s, { type: 'rail.dismiss' }, 3);
    expect(s.rail).toBeNull();
    expect(reduceRail(s, { type: 'user.checkConfirm' }, 4)).toEqual(s);
  });

  it('visibleCards windows to 3±1 around the active card with stubs and dims', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    const v = visibleCards(s);
    expect(v.length).toBeLessThanOrEqual(4);
    expect(v.find(x => x.index === 1)!.mode).toBe('active');
    expect(v.find(x => x.index === 0)!.mode).toBe('stub');
    expect(v.find(x => x.index === 2)!.mode).toBe('dimmed');
  });
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Implement `src/rail/railStore.ts`**

```ts
import type { MockDoc } from '../scenarios';
import type { Rail, RailCard } from './types';
import { evaluatePredicate } from './predicate';

export type RailEvent =
  | { type: 'rail.set'; rail: Rail }
  | { type: 'rail.dismiss' }
  | { type: 'user.elementAction'; entityId: string }
  | { type: 'user.checkConfirm' }
  | { type: 'user.whyToggle'; index: number }
  | { type: 'user.flip'; index: number }
  | { type: 'doc.changed'; doc: MockDoc };

export interface RailState { rail: Rail | null; openWhy: number | null; flipped: number[]; }
export const initialRailState = (): RailState => ({ rail: null, openWhy: null, flipped: [] });

const GATING: RailCard['t'][] = ['do', 'try', 'check'];

function advance(rail: Rail): Rail {
  const cards = rail.cards.map((c, i) => (i === rail.activeIndex ? { ...c, state: 'done' as const } : c));
  let next = cards.findIndex(c => c.state === 'pending');
  // Non-gating cards (answer/caution/concept/recap/orient) auto-complete as they are reached.
  while (next !== -1 && !GATING.includes(cards[next].t)) {
    cards[next] = { ...cards[next], state: 'done' };
    next = cards.findIndex(c => c.state === 'pending');
  }
  if (next === -1) return { ...rail, cards, activeIndex: null };
  cards[next] = { ...cards[next], state: 'active' };
  return { ...rail, cards, activeIndex: next };
}

export function reduceRail(s: RailState, e: RailEvent, _now: number): RailState {
  switch (e.type) {
    case 'rail.set': {
      // Non-gating leading cards complete immediately (orient already done at map time).
      let rail = e.rail;
      if (rail.activeIndex !== null && !GATING.includes(rail.cards[rail.activeIndex].t))
        rail = advance({ ...rail, cards: rail.cards.map((c, i) => i === rail.activeIndex ? { ...c, state: 'active' } : c) });
      return { rail, openWhy: null, flipped: [] };
    }
    case 'rail.dismiss': return { ...s, rail: null, openWhy: null, flipped: [] };
    case 'user.whyToggle': return { ...s, openWhy: s.openWhy === e.index ? null : e.index };
    case 'user.flip': return { ...s, flipped: s.flipped.includes(e.index) ? s.flipped.filter(i => i !== e.index) : [...s.flipped, e.index] };
    case 'user.elementAction': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      if ((c.t === 'do' || c.t === 'try') && c.entityId === e.entityId) return { ...s, rail: advance(r) };
      return s;
    }
    case 'user.checkConfirm': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      if (c.t === 'check' && c.verify === 'user') return { ...s, rail: advance(r) };
      return s;
    }
    case 'doc.changed': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      if (c.t !== 'check' || c.verify !== 'auto' || !c.expect) return s;
      if (evaluatePredicate(e.doc, c.expect) === true) return { ...s, rail: advance(r) };
      const cards = r.cards.map((x, i) => (i === r.activeIndex ? { ...x, state: 'failed' as const } : x));
      return { ...s, rail: { ...r, cards } };
    }
    default: return s;
  }
}

export const railComplete = (s: RailState): boolean => !!s.rail && s.rail.activeIndex === null;

export function visibleCards(s: RailState): { card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed' }[] {
  const r = s.rail;
  if (!r) return [];
  const active = r.activeIndex ?? r.cards.length;
  const out: { card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed' }[] = [];
  for (let i = Math.max(0, active - 2); i < Math.min(r.cards.length, active + 2); i++) {
    out.push({ card: r.cards[i], index: i, mode: i < active ? 'stub' : i === active ? 'active' : 'dimmed' });
  }
  return out.slice(0, 4);
}
```

- [ ] **Step 4: Run — PASS; full suite green; tsc clean.**
(If the `rail.set` non-gating fast-forward double-advances the orient-only case, simplify per the tests — the tests are the contract.)

- [ ] **Step 5: Commit**

```bash
git add src/rail
git commit -m "feat(rail): pure rail reducer — element/check advancement, honest auto-check, 3±1 window"
```

---

### Task 3: Teaching projection + read-only seam (TDD)

**Files:**
- Create: `src/rail/projectTeaching.ts`, `src/rail/projectTeaching.test.ts`
- Modify: `src/teaching/TeachingLayer.tsx` (optional `onStateChange` prop; call after every dispatch), `src/App.tsx` (mount TeachingLayer ALWAYS — `demo={teachMode}` instead of conditional mount; add `teachingSnapshot` state fed by the seam)

**Interfaces:**
- Consumes: `TeachingState`, `TeachSequence` from `src/teaching/types.ts`; `fadeLevel` selector.
- Produces: `projectTeaching(t: TeachingState): Rail | null` — active sequence → a Rail: each `TeachStep` becomes a DO card (`text` = instruction, `why` = undefined, kicker rendered from `subgoal` — store subgoal in `target`? NO: add `subgoal?: string` to `RailCard` in types.ts) with `entityId` = step.entityId, `band:'solid'`, state mapped (`pending/active/done`; `skipped` → `done`); `seq` = sequence.taskKey; card order = step order; `activeIndex` = sequence.activeIndex; no guideLine (teaching voice stays with the scribe). Returns null when no sequence.
- App: `teachingDispatchRef` unchanged; `<TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />` mounted unconditionally.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { projectTeaching } from './projectTeaching';
import { initialTeachingState, reduce } from '../teaching/teachingStore';

const seq = { type: 'teach.sequence' as const, title: 'Save your document', taskKey: 'word.save', posture: 'guide' as const,
  steps: [
    { entityId: 'word-1' as any, subgoal: 'Find your tools', instruction: 'Click the Home ribbon.' },
    { entityId: 'word-2' as any, subgoal: 'Save your work', instruction: 'Click Save.' },
  ] };

describe('projectTeaching', () => {
  it('projects an active sequence to a rail of DO cards', () => {
    const t = reduce(initialTeachingState(), seq, 0);
    const rail = projectTeaching(t)!;
    expect(rail.seq).toBe('word.save');
    expect(rail.cards).toHaveLength(2);
    expect(rail.cards[0]).toMatchObject({ t: 'do', entityId: 'word-1', band: 'solid', state: 'active', subgoal: 'Find your tools', text: 'Click the Home ribbon.' });
    expect(rail.activeIndex).toBe(0);
  });
  it('maps done steps to done cards and returns null with no sequence', () => {
    let t = reduce(initialTeachingState(), seq, 0);
    t = reduce(t, { type: 'user.stepAction', entityId: 'word-1' as any }, 1);
    expect(projectTeaching(t)!.cards[0].state).toBe('done');
    expect(projectTeaching(initialTeachingState())).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.** Also add `subgoal?: string;` to `RailCard` in `src/rail/types.ts` first if not present.

- [ ] **Step 3: Implement**

`src/rail/projectTeaching.ts`:

```ts
import type { TeachingState } from '../teaching/types';
import type { Rail, RailCard } from './types';

/** Read-only projection: the teaching sequence IS a rail of DO cards (grammar §5).
 *  The teaching store stays untouched — one grammar, two sources, one renderer. */
export function projectTeaching(t: TeachingState): Rail | null {
  const seq = t.sequence;
  if (!seq) return null;
  const cards: RailCard[] = seq.steps.map((step, i) => ({
    t: 'do', band: 'solid', entityId: step.entityId as string,
    subgoal: step.subgoal, text: step.instruction,
    state: step.state === 'active' ? 'active' : step.state === 'pending' ? 'pending' : 'done',
  }));
  return { seq: seq.taskKey, cards, activeIndex: seq.activeIndex, startedAt: 0 };
}
```

`src/teaching/TeachingLayer.tsx`: add `onStateChange?: (s: TeachingState) => void` to Props; at the end of `dispatch` (after `setState(next)`), call `onStateChange?.(next)`; also call it once on mount with the initial state (a `useEffect(() => { onStateChange?.(stateRef.current); }, [])`).
`src/App.tsx`: replace the conditional mount `{teachMode && <TeachingLayer ... demo ...}` with an unconditional `<TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />`; add `const [teachingSnapshot, setTeachingSnapshot] = useState<TeachingState | null>(null);` (import the type).

- [ ] **Step 4: Run — PASS; full suite + tsc clean.**
- [ ] **Step 5: Commit**

```bash
git add src/rail src/teaching/TeachingLayer.tsx src/App.tsx
git commit -m "feat(rail): teaching sequences project to rail cards via a read-only seam"
```

---

### Task 4: CardView + RailPanel + App mount

**Files:**
- Create: `src/rail/CardView.tsx`, `src/rail/RailPanel.tsx`
- Modify: `src/App.tsx` (rail state + dispatch, mount, element-click + doc-change wiring)

**Interfaces:**
- Consumes: `visibleCards`, `reduceRail`, `railComplete`, `projectTeaching`, `teachingDispatchRef` (show-me), `telemetry.guidance` (Task 6 extends kinds — use only existing kinds here; card telemetry lands in Task 6).
- Produces: `RailPanel` props `{ state: RailState; teachingRail: Rail | null; onEvent: (e: RailEvent) => void; onShowMe: (entityId: string) => void }`. App exports nothing new; wiring:
  - `const [railState, setRailState] = useState<RailState>(initialRailState());`
  - `const railDispatch = (e: RailEvent) => setRailState(s => reduceRail(s, e, Date.now()));` (+ a `railDispatchRef` for use inside `handleVoiceToolCall`).
  - `handleSurfaceElementClick` additionally calls `railDispatch({ type: 'user.elementAction', entityId: entity.id })`.
  - `useEffect(() => { railDispatch({ type: 'doc.changed', doc: mockDoc }); }, [mockDoc]);`
  - Mount inside `<main>`: `<RailPanel state={railState} teachingRail={teachingSnapshot ? projectTeaching(teachingSnapshot) : null} onEvent={railDispatch} onShowMe={(id) => teachingDispatchRef.current?.({ type: 'teach.highlight', entityId: id as EntityId })} />`.

- [ ] **Step 1: CardView**

`src/rail/CardView.tsx` — one card, all types, band-aware. Complete code:

```tsx
import React from 'react';
import { Check, X as XIcon, MousePointer2 } from 'lucide-react';
import type { RailCard } from './types';

const KICKER: Record<RailCard['t'], string> = { do: 'DO', answer: 'ANSWER', orient: 'ORIENT', check: 'CHECK', caution: 'CAUTION', concept: 'CONCEPT', try: 'TRY', recap: 'RECAP' };

/** One card: kicker → action line (bold the THING) → result line → quiet why?/show-me. */
export function CardView({ card, index, mode, whyOpen, flipped, onWhy, onFlip, onShowMe, onCheckConfirm }: {
  card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed';
  whyOpen: boolean; flipped: boolean;
  onWhy: () => void; onFlip: () => void; onShowMe: () => void; onCheckConfirm: () => void;
}) {
  if (mode === 'stub') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)]">
        <Check size={10} className="text-emerald-500 shrink-0" />
        <span className="truncate">{card.text ?? card.front ?? card.lines?.[0] ?? card.prompt}</span>
      </div>
    );
  }
  const dim = mode === 'dimmed';
  const boldTarget = (text: string) =>
    card.target && text.includes(card.target)
      ? (<>{text.split(card.target)[0]}<strong>{card.target}</strong>{text.split(card.target).slice(1).join(card.target)}</>)
      : text;
  return (
    <div className={`rounded-xl border px-3 py-2 bg-[var(--card-bg)] ${dim ? 'opacity-40 border-[var(--card-border)]' : card.state === 'failed' ? 'border-red-400/60' : 'border-[var(--accent-color)]/50 shadow-sm'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{KICKER[card.t]}{card.subgoal ? ` · ${card.subgoal}` : ''}</span>
        {card.target && (
          <MousePointer2 size={11} className={card.band === 'solid' ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)] opacity-40'}
            fill={card.band === 'solid' ? 'currentColor' : 'none'} />
        )}
      </div>
      {card.t === 'concept' ? (
        <button onClick={onFlip} className="w-full text-left">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">{card.front}</p>
          {flipped && <p className="text-[12px] text-[var(--text-primary)] mt-1">{card.back}{card.analogy ? <em className="block text-[var(--text-secondary)]">{card.analogy}</em> : null}</p>}
          {!flipped && <span className="text-[10px] font-mono text-[var(--accent-color)]">flip</span>}
        </button>
      ) : card.t === 'recap' ? (
        <ul className="mt-0.5">{card.lines?.map((l, i) => <li key={i} className="text-[12px] text-[var(--text-primary)]">{l}</li>)}</ul>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-[var(--text-primary)] mt-0.5">
            {card.band === 'hollow' && card.t === 'do'
              ? <>Find <strong>{card.target}</strong> — I can’t point at it. {card.text && boldTarget(card.text)}</>
              : boldTarget(card.text ?? card.prompt ?? '')}
          </p>
          {card.result && <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-0.5">→ {card.result}</p>}
          {card.notice && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Notice: {card.notice}</p>}
          {card.t === 'check' && card.state === 'failed' && (
            <p className="text-[11px] text-red-500 mt-0.5 flex items-center gap-1"><XIcon size={11} /> not yet — {card.text}</p>
          )}
          {card.t === 'check' && card.verify === 'user' && card.state === 'active' && (
            <button onClick={onCheckConfirm} className="mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-[var(--card-border)] text-[var(--text-primary)] hover:border-[var(--accent-color)]">confirm for me ✓</button>
          )}
        </>
      )}
      {!dim && (card.why || (card.entityId && card.band === 'solid')) && (
        <div className="flex items-center gap-3 justify-end mt-1">
          {card.why && <button onClick={onWhy} className="text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)]">why?</button>}
          {card.entityId && card.band === 'solid' && <button onClick={onShowMe} className="text-[10px] font-mono text-[var(--accent-color)]">show me</button>}
        </div>
      )}
      {whyOpen && card.why && <p className="text-[11px] text-[var(--text-secondary)] mt-1 border-t border-[var(--card-border)] pt-1">{card.why}</p>}
    </div>
  );
}
```

- [ ] **Step 2: RailPanel**

`src/rail/RailPanel.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { Rail } from './types';
import { visibleCards, type RailState, type RailEvent } from './railStore';
import { CardView } from './CardView';

/** The floating response rail (shell spec §4): right side, draggable, collapsible to a
 *  pill. Renders the respond rail when present, else the projected teaching rail.
 *  One grammar, one renderer. Chrome stops pointer-down (deixis painter lives on main). */
export function RailPanel({ state, teachingRail, onEvent, onShowMe }: {
  state: RailState; teachingRail: Rail | null;
  onEvent: (e: RailEvent) => void; onShowMe: (entityId: string) => void;
}) {
  const [pos, setPos] = useState({ x: -16, y: 56 });   // offsets from top-right
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ sx: number; sy: number; start: { x: number; y: number } } | null>(null);

  const respond = state.rail;
  const projected = respond ? state : teachingRail ? { rail: teachingRail, openWhy: null, flipped: [] } : null;
  if (!projected?.rail) return null;
  const isProjection = !respond;
  const cards = visibleCards(projected);

  if (collapsed) {
    return (
      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed(false)}
        className="absolute top-14 right-4 z-30 p-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg text-[var(--accent-color)]" title="Open responses">
        <MessageSquare size={16} />
      </button>
    );
  }
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-30 w-[300px] flex flex-col gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-color)]/90 backdrop-blur shadow-xl p-2"
      style={{ right: -pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-1 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, start: pos }; }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.start.x - (e.clientX - drag.current.sx), y: drag.current.start.y + (e.clientY - drag.current.sy) }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{projected.rail.seq}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsed(true)} className="text-[10px] font-mono text-[var(--text-secondary)] px-1" title="Collapse">—</button>
          {!isProjection && <button onClick={() => onEvent({ type: 'rail.dismiss' })} className="text-[var(--text-secondary)]" title="Dismiss"><X size={12} /></button>}
        </div>
      </div>
      {cards.map(({ card, index, mode }) => (
        <CardView key={index} card={card} index={index} mode={mode}
          whyOpen={state.openWhy === index} flipped={state.flipped.includes(index)}
          onWhy={() => onEvent({ type: 'user.whyToggle', index })}
          onFlip={() => onEvent({ type: 'user.flip', index })}
          onShowMe={() => card.entityId && onShowMe(card.entityId)}
          onCheckConfirm={() => onEvent({ type: 'user.checkConfirm' })}
        />
      ))}
      {projected.rail.guideLine && (
        <p className="px-1 text-[11px] italic text-[var(--text-secondary)]">{projected.rail.guideLine}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: App wiring** (per Interfaces above — state, `railDispatch` + ref, element-click dispatch inside `handleSurfaceElementClick`, `doc.changed` effect on `mockDoc`, mount inside `<main>` after the witness stack).

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run` green. Manual: `?teach=1` → the demo sequence now ALSO renders as cards in the rail (projection), stubs compress, rings still on-element.

- [ ] **Step 5: Commit**

```bash
git add src/rail src/App.tsx
git commit -m "feat(rail): CardView + floating RailPanel — one renderer for respond rails and teaching projections"
```

---

### Task 5: The respond tool, prompt contract, ANSWER routing, telemetry (TDD on prompt)

**Files:**
- Modify: `src/App.tsx` (tool def in VOICE_TOOLS ~line 165; branch in `handleVoiceToolCall` before the explain branch ~line 949; explain branch gains ANSWER routing), `src/prompt/instructions.ts` (+ RESPONSE CONTRACT section), `src/prompt/instructions.test.ts` (+ assertions), `src/telemetry.ts` (guidance kinds)

**Interfaces:**
- Produces: `respond` VoiceTool (schema below); `handleVoiceToolCall` branch mapping via `respondCallToRail(fc.args, entitiesRef.current, mockDocRef.current, Date.now())` → error ⇒ `sendToolResponse(fc.id, fc.name, { success: false, error })`; ok ⇒ `railDispatchRef.current?.({ type: 'rail.set', rail })` + `sendToolResponse(..., { success: true, rendered: rail.cards.length })` + `telemetry.guidance('card_dealt', { taskKey: rail.seq })` per card. `telemetry.guidance` kind union gains: `'card_dealt' | 'why_opened' | 'card_flipped' | 'show_me' | 'check_auto_pass' | 'check_auto_fail' | 'check_user_confirmed' | 'rail_complete' | 'rail_abandoned'` (wire `why_opened`/`card_flipped`/`show_me` emissions in the RailPanel handlers; `check_*`/`rail_*` in `railDispatch` by diffing prev/next state — mirror TeachingLayer's dispatch-side telemetry pattern).

Tool definition (add to VOICE_TOOLS):

```ts
  {
    name: 'respond',
    description: 'Render your answer or instructions as typed cards in the response rail. THIS IS HOW YOU DELIVER ALL INSTRUCTIONAL AND INFORMATIONAL CONTENT — one respond call per user request. Card types: do (one action: verb click/press/type/drag/open + target + text + result), answer (a short answer), orient, check (verify:"auto" with expect:{path,equals} against the document, or "user"), caution, concept (front/back), try (prompt/notice), recap (≤3 lines). Keep every text within its budget; put rationale in "why". Include exactly ONE guideLine sentence — SAY the guideLine aloud; do not speak the card contents.',
    parameters: { type: 'object', properties: {
      seq: { type: 'string', description: 'Task key for this response, e.g. "word.save" or "answer".' },
      cards: { type: 'array', items: { type: 'object', properties: {
        t: { type: 'string', description: 'do|answer|orient|check|caution|concept|try|recap' },
        text: { type: 'string' }, verb: { type: 'string' }, target: { type: 'string' },
        result: { type: 'string' }, why: { type: 'string' },
        verify: { type: 'string' }, expect: { type: 'object', properties: { path: { type: 'string' }, equals: {} } },
        front: { type: 'string' }, back: { type: 'string' }, analogy: { type: 'string' },
        prompt: { type: 'string' }, notice: { type: 'string' },
        lines: { type: 'array', items: { type: 'string' } },
      }, required: ['t'] } },
      guideLine: { type: 'string', description: 'ONE warm sentence. Speak this aloud; nothing else.' },
    }, required: ['seq', 'cards', 'guideLine'] },
  },
```

Prompt section (insert into `src/prompt/instructions.ts` between the CONFIRMATION POLICY and RESPONSE STYLE blocks):

```ts
CRITICAL - RESPONSE CONTRACT (the card grammar):
- ALL instructional and informational content goes through the respond tool as typed cards — never as spoken prose. Identifications, explanations, how-to steps: cards.
- Per response: one respond call, exactly ONE guideLine sentence. SPEAK the guideLine aloud (it is your only content speech); the cards render on screen.
- DO cards: ONE action each, verb from click/press/type/drag/open, target named exactly as the on-screen element, a short result line ("→ what success looks like").
- Budgets are enforced by the renderer; overflow is demoted to the card's collapsed "why" slot. Put rationale in "why", never in the action line.
- If respond returns an error, fix the payload and call it again — the error names the violation.
- Dialogue is still voice: clarifying questions, hedges, and error reports stay spoken and short. Cards are never questions.
```

Explain → ANSWER routing (replace the explain branch body ~App.tsx:949; keep the ack):

```ts
    if (fc.name === 'explain') {
      // Low-commitment identify. The durable artifact is an ANSWER card in the rail;
      // the spoken answer remains the model's (prompt: hedges stay voice).
      const args = fc.args as any;
      const subject = typeof args.subject === 'string' ? args.subject : '';
      const hit = resolveEchoedTarget(entitiesRef.current, subject);
      const mapped = respondCallToRail({ seq: 'answer', guideLine: ' ', cards: [
        hit ? { t: 'answer', text: `That's the ${displayName(hit.entity)}.`, target: subject }
            : { t: 'answer', text: subject ? `I can't point at "${subject}" — not on this screen.` : `I'm not sure what that is.` },
      ] }, entitiesRef.current, mockDocRef.current, Date.now());
      if (!('error' in mapped)) railDispatchRef.current?.({ type: 'rail.set', rail: { ...mapped.rail, guideLine: undefined } });
      addLog('tool', `Tool Call: explain(${subject}) - verbal only, changes nothing`);
      providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
    } else if (fc.name === 'respond') {
      const mapped = respondCallToRail(fc.args, entitiesRef.current, mockDocRef.current, Date.now());
      if ('error' in mapped) {
        addLog('tool', `Tool Call: respond REJECTED — ${mapped.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else {
        railDispatchRef.current?.({ type: 'rail.set', rail: mapped.rail });
        mapped.rail.cards.forEach(() => telemetry.guidance('card_dealt', { taskKey: mapped.rail.seq }));
        addLog('tool', `Tool Call: respond(${mapped.rail.seq}) — ${mapped.rail.cards.length} cards`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, rendered: mapped.rail.cards.length });
      }
    } else if (fc.name === 'share') {
```

Prompt test additions (in the existing describe):

```ts
  it('carries the response contract', () => {
    expect(honest).toContain('RESPONSE CONTRACT');
    expect(honest).toContain('respond');
    expect(honest).toContain('guideLine');
    expect(confident).toContain('RESPONSE CONTRACT');
  });
```

- [ ] **Step 1:** Add the prompt test (RED) → add the RESPONSE CONTRACT section (GREEN).
- [ ] **Step 2:** Extend the telemetry kind union; wire `why_opened`/`card_flipped`/`show_me` in RailPanel's three handlers; in App's `railDispatch`, diff prev/next for `check_auto_pass`/`check_auto_fail`/`check_user_confirmed`/`rail_complete` (`railComplete` flip) /`rail_abandoned` (dismiss with `activeIndex !== null`).
- [ ] **Step 3:** Add the tool def + both branches; `const railDispatchRef = useRef<typeof railDispatch | null>(null); railDispatchRef.current = railDispatch;`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx vitest run` green (incl. new prompt assertions); `grep -n "respond" src/prompt/instructions.ts src/App.tsx | head`.
- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/prompt src/telemetry.ts src/rail
git commit -m "feat(rail): respond tool + strict response contract in the prompt; explain answers land as ANSWER cards"
```

---

### Task 6: Scripted rail demo (?rail=1) + final verification

**Files:**
- Create: `src/rail/demoRail.ts`, `src/rail/demoRail.test.ts`
- Modify: `src/App.tsx` (demo driver effect, mirroring the `?teach` pattern)

**Interfaces:**
- Produces: `buildRailDemo(program: Program, entities: SceneEntity[], doc: MockDoc, now: number): Rail | null` — builds a canned `respond` payload for the active program (word: orient → DO click Save → auto-CHECK saved → recap; other programs: an ANSWER card naming element 2) and runs it through `respondCallToRail` (the demo proves the REAL pipeline, not a fixture). Returns null on mapper error.
- App: `const railMode = new URLSearchParams(window.location.search).has('rail');` and a mount effect (StrictMode-safe, mirroring TeachingLayer's `scheduled`/`played` refs pattern) that dispatches `rail.set` with the demo rail 800ms after entities measure (≥4 entities).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildRailDemo } from './demoRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc, applyAction } from '../scenarios';
import { initialRailState, reduceRail, railComplete } from './railStore';

describe('rail demo', () => {
  const program = getProgram('word');
  const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
  it('drives the real mapper+store to completion via element click and doc change', () => {
    const doc = initialMockDoc('word');
    const rail = buildRailDemo(program, entities, doc, 0)!;
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc: applyAction(doc, 'save_file', {}) }, 2);
    expect(railComplete(s)).toBe(true);
  });
  it('returns a rail for every program (never null on the shipped programs)', () => {
    for (const id of ['word', 'excel', 'powerpoint', 'photo'] as const) {
      const p = getProgram(id);
      const es = buildEntities(p, {}, { items: p.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
      expect(buildRailDemo(p, es, initialMockDoc(id), 0)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Implement `src/rail/demoRail.ts`**

```ts
import type { Program } from '../scenarios';
import type { MockDoc } from '../scenarios';
import type { SceneEntity } from '../entities/registry';
import type { Rail } from './types';
import { respondCallToRail } from './respondCallToRail';

/** The no-key proof path for the rail: a canned respond payload pushed through the REAL
 *  mapper (validation, budgets, band) — if the contract breaks, the demo breaks. */
export function buildRailDemo(program: Program, entities: SceneEntity[], doc: MockDoc, now: number): Rail | null {
  const el = (n: number) => program.images.find(i => i.id === n)?.title ?? '';
  const payload = program.id === 'word'
    ? { seq: 'word.save', guideLine: 'One click and your work is safe.', cards: [
        { t: 'orient', text: 'Your report is open; nothing saved yet.' },
        { t: 'do', verb: 'click', target: el(2), text: `Click ${el(2)}.`, result: 'The title bar reads Saved.',
          why: 'Save writes the working copy; Save As forks a new file next to it.' },
        { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'The window shows Saved.' },
        { t: 'recap', lines: ['Your work is saved.', 'Save As makes a copy.'] },
      ] }
    : { seq: `${program.id}.identify`, guideLine: 'Here is what you are looking at.', cards: [
        { t: 'answer', text: `That's the ${el(2)}.`, target: el(2) },
      ] };
  const mapped = respondCallToRail(payload, entities, doc, now);
  return 'error' in mapped ? null : mapped.rail;
}
```

- [ ] **Step 3: App demo driver** — add `railMode` beside `teachMode`; effect (StrictMode-safe refs pattern copied from TeachingLayer.tsx:52-63) that, when `railMode` and `entities.length >= 4`, after 800ms dispatches `railDispatch({ type: 'rail.set', rail: buildRailDemo(program, entitiesRef.current, mockDocRef.current, Date.now())! })` (skip if null).

- [ ] **Step 4: Full verification**

Run: `npx vitest run` (all green) then `npx tsc --noEmit && npx vite build` (clean).

Manual checklist (`npm run dev`):
- [ ] `?rail=1` (word): rail floats right — ORIENT stub, active DO with solid pointer + why? + show me, dimmed CHECK; clicking the real Save button advances; the auto-CHECK flips ✓ when the doc saves; recap + guideLine visible; collapse to pill and drag both work.
- [ ] "show me" rings the Save button on-element (teach highlight).
- [ ] `?teach=1`: the teaching sequence renders as rail cards too (projection) AND keeps its on-element scaffolding; both track a window drag.
- [ ] Rail chrome never paints (pointer-down guarded).
- [ ] With a key: say "what is this?" over an element → ANSWER card lands in the rail; a how-to question → the model's respond call renders cards, guideLine is spoken, prose stays off the audio channel.

- [ ] **Step 5: Commit**

```bash
git add src/rail src/App.tsx
git commit -m "feat(rail): scripted ?rail=1 demo through the real mapper — the no-key proof path"
```

---

## Self-Review Notes (already applied)

- Grammar spec coverage: §1 three-channel split → Task 5 (prompt + tool); §2 taxonomy/budgets → Task 1; §3 anatomy (kicker/action/result/why/show-me) → Task 4; §4 band + deliberate divergence → Tasks 1/4 (and named in Global Constraints); §5 rail/unification/3±1/stubs → Tasks 2/3/4; §6 transport/enforcement → Tasks 1/5; §7 verification → Tasks 1/2; §8 telemetry (minus resurfacing, experiment-gated out) → Task 5; §9 degradation (no session → rail renders identically; zero entities → hollow) → Tasks 1/4; §10 boundaries respected (no scheduler, no shell rework). Shell §4 placement (right, draggable, pill, caption-mode-as-collapse) → Task 4.
- Fade/caption rendering for teaching projections is intentionally MINIMAL in A2 (the projection renders whatever the teaching store says; caption mode = the user collapsing the panel). Full fade-driven rail renderings belong to Teaching Plan 2, which owns posture UX — noted so a reviewer doesn't flag the gap as a miss.
- Type consistency: `RailCard.subgoal` added in Task 3 is declared in Task 1's types.ts via Task 3's step 2 instruction; `railDispatchRef` defined in Task 4, consumed in Task 5; `buildRailDemo` consumes only Task 1 exports.
- The Task 1 test file contains one deliberately awkward test (third test, extra `action` field) — its instruction says adjust the TEST if it fights the schema; that is the plan text, not an implementer improvisation.
