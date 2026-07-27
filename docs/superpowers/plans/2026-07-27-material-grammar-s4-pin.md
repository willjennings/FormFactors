# Material Grammar Implementation Plan — Rail Card Ids, Pin, Combine Tray

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a model response durable material — rail cards get identities you can point at, pinning one mints a real artifact, and a deterministic tray picks exactly which sources combine instead of the model guessing what "this and that" meant.

**Architecture:** Pure modules first (card content → rail entities → pin builder → source resolver → tray → request builder), then the three UI seams (card stamping + carve-out, the pin control, shift-click + tray row), then a keyless browser drive. Pin is the bridge: a card is not a combine source, so shift-clicking one does nothing; pinning mints an artifact, and artifacts are sources.

**Tech Stack:** TypeScript, React 19, vitest (pure-function tests, colocated `*.test.ts`), `tsc --noEmit` as lint. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-material-grammar-s4-pin-design.md`

## Global Constraints

- **Run the FULL suite on every task** — `npx vitest run`, never a directory-scoped subset. This lesson has cost this project twice (the ramble phase machine, then S1-S3). Baseline at the start of this plan: **645 tests, 86 files, passing.**
- **`npx tsc --noEmit` clean** (this repo's lint — there is no eslint) and **`npx vite build` succeeds** before every commit.
- **This repo does not unit-test component/DOM rendering.** Component work is verified by `tsc`, `vite build`, and the browser drive in Task 10. Do not add a DOM harness or a component testing library.
- **1-based indices everywhere**, matching `Cell A1` / `Slide 2` / `para-N`.
- **Derive, never assert.** Any message or list naming valid options computes them from the same function the resolver uses.
- **Never mint material the user did not ask for.** Pin is explicit and user-only; no gesture implicitly creates an artifact.
- **Never evict.** `MAX_ARTIFACTS = 6` refuses; it does not make room.
- No new npm dependencies.
- Commit after every task with the repo's conventional-commit style.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/rail/cardContent.ts` | **Create** — `cardTitle`, `cardParagraphs`. The single definition of a card's text. | 1 |
| `src/rail/railStore.ts` | Modify — extract `projectedRailState` so the panel and the deriver agree on which rail is showing. | 2 |
| `src/rail/railEntities.ts` | **Create** — `railEntities(projected, layout)`. | 2 |
| `src/rail/CardView.tsx` | Modify — `data-entity-id` stamping (Task 3), pin control (Task 5). | 3, 5 |
| `src/rail/RailPanel.tsx` | Modify — shell carve-out + `projectedRailState` (Task 3), `onPin` prop (Task 5). | 3, 5 |
| `src/artifacts/pin.ts` | **Create** — `pinEventFor(card, seq, now)`. | 4 |
| `src/artifacts/entities.ts` | Modify — add `entityToSourceId`. | 6 |
| `src/artifacts/combineTray.ts` | **Create** — tray reducer. | 7 |
| `src/artifacts/combineRequest.ts` | **Create** — tray → user turn + fenced hint. | 8 |
| `src/shell/Omnibox.tsx` | Modify — tray row. | 9 |
| `src/telemetry.ts` | Modify — `pin` and `combineTray` events. | 5, 9 |
| `src/App.tsx` | Modify — rail layout scan + recompose (3), pin dispatch (5), shift-click + tray + fire (9). | 3, 5, 9 |
| `src/entities/registry.ts` | Modify — document the three-prefix namespace. | 2 |

---

### Task 1: Card content

The single definition of a card's text, shared by the entity deriver (aliases) and the pin builder (artifact content) so the pinned text can never disagree with what the card displayed.

**Files:**
- Create: `src/rail/cardContent.ts`
- Create: `src/rail/cardContent.test.ts`

**Interfaces:**
- Consumes: `RailCard`, `CardType` from `src/rail/types.ts`
- Produces: `cardTitle(card: RailCard): string`; `cardParagraphs(card: RailCard): string[]`

- [ ] **Step 1: Write the failing test**

Create `src/rail/cardContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cardTitle, cardParagraphs } from './cardContent';
import type { RailCard } from './types';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'active', ...over } as RailCard);

describe('cardParagraphs', () => {
  it('answer/orient/caution/check carry their text', () => {
    expect(cardParagraphs(card({ t: 'answer', text: 'The Save As button.' })))
      .toEqual(['The Save As button.']);
  });
  it('recap yields ONE PARAGRAPH PER LINE — each line stays separately pointable', () => {
    expect(cardParagraphs(card({ t: 'recap', lines: ['Opened the deck.', 'Retitled slide 1.'] })))
      .toEqual(['Opened the deck.', 'Retitled slide 1.']);
  });
  it('concept yields front, back and analogy as separate paragraphs', () => {
    expect(cardParagraphs(card({ t: 'concept', front: 'What is a cell?', back: 'One box.', analogy: 'Like a mailbox.' })))
      .toEqual(['What is a cell?', 'One box.', 'Like a mailbox.']);
  });
  it('concept omits an absent analogy rather than emitting a blank paragraph', () => {
    expect(cardParagraphs(card({ t: 'concept', front: 'Q', back: 'A' }))).toEqual(['Q', 'A']);
  });
  it('do carries its text and result', () => {
    expect(cardParagraphs(card({ t: 'do', text: 'Click Save As.', result: 'The dialog opens.' })))
      .toEqual(['Click Save As.', 'The dialog opens.']);
  });
  it('try carries its prompt and notice', () => {
    expect(cardParagraphs(card({ t: 'try', prompt: 'Now you try.', notice: 'The icon changes.' })))
      .toEqual(['Now you try.', 'The icon changes.']);
  });
  it('an empty card yields nothing — the pin builder refuses on this', () => {
    expect(cardParagraphs(card({ t: 'answer' }))).toEqual([]);
    expect(cardParagraphs(card({ t: 'recap', lines: [] }))).toEqual([]);
  });
  it('drops blank and whitespace-only entries', () => {
    expect(cardParagraphs(card({ t: 'recap', lines: ['Real line.', '   ', ''] })))
      .toEqual(['Real line.']);
  });
});

describe('cardTitle', () => {
  it('is the first paragraph when it is short', () => {
    expect(cardTitle(card({ t: 'answer', text: 'The Save As button.' }))).toBe('The Save As button.');
  });
  it('truncates at 60 chars on a word boundary with an ellipsis', () => {
    const long = 'Revenue reached twelve million dollars at an eighteen percent margin this quarter';
    const out = cardTitle(card({ t: 'answer', text: long }));
    expect(out.length).toBeLessThanOrEqual(61);        // 60 + the ellipsis character
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('Revenue reached twelve million dollars at an eighteen percent…');
    expect(long.startsWith(out.slice(0, -1))).toBe(true); // never invents words
  });
  it('falls back to the card type when the card has no text', () => {
    expect(cardTitle(card({ t: 'caution' }))).toBe('Caution card');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/rail/cardContent.test.ts`
Expected: FAIL — `Failed to resolve import "./cardContent"`.

- [ ] **Step 3: Write the implementation**

Create `src/rail/cardContent.ts`:

```ts
// The SINGLE definition of a card's text. The entity deriver builds aliases from it and the pin
// builder turns it into artifact content — if either reimplemented the extraction, a pinned
// artifact could disagree with the card the user was looking at when they pinned it.
import type { RailCard } from './types';

const TITLE_MAX = 60;

function clean(parts: (string | undefined)[]): string[] {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean);
}

export function cardParagraphs(card: RailCard): string[] {
  switch (card.t) {
    case 'recap':
      // One paragraph per line: preserves the structure the model authored, keeps each line
      // separately pointable and refinable, and gives the deferred annotation phase line-level
      // parts to anchor marks to.
      return clean(card.lines ?? []);
    case 'concept':
      return clean([card.front, card.back, card.analogy]);
    case 'do':
      return clean([card.text, card.result]);
    case 'try':
      return clean([card.prompt, card.notice]);
    default:
      return clean([card.text]);
  }
}

/** First paragraph, truncated on a word boundary. Never invents words that were not there. */
export function cardTitle(card: RailCard): string {
  const first = cardParagraphs(card)[0];
  if (!first) return `${card.t.charAt(0).toUpperCase()}${card.t.slice(1)} card`;
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/rail/cardContent.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **656 tests**.

- [ ] **Step 6: Commit**

```bash
git add src/rail/cardContent.ts src/rail/cardContent.test.ts
git commit -m "feat(rail): cardContent — the single definition of a card's text"
```

---

### Task 2: Rail card entities

**Files:**
- Modify: `src/rail/railStore.ts` (add `projectedRailState`)
- Create: `src/rail/railEntities.ts`
- Create: `src/rail/railEntities.test.ts`
- Modify: `src/entities/registry.ts` (namespace comment)

**Interfaces:**
- Consumes: `cardTitle`, `cardParagraphs` (Task 1); `visibleCards`, `RailState` from `railStore`; `asId`, `normText`, `SceneEntity` from `src/entities/registry.ts`
- Produces:
  - `projectedRailState(state: RailState, teachingRail: Rail | null): RailState | null`
  - `railEntities(projected: RailState | null, layout: Record<string, [number, number, number, number]>): SceneEntity[]`

- [ ] **Step 1: Write the failing test**

Create `src/rail/railEntities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { railEntities } from './railEntities';
import { projectedRailState } from './railStore';
import type { Rail, RailCard } from './types';
import type { RailState } from './railStore';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'pending', ...over } as RailCard);

const rail = (cards: RailCard[]): Rail =>
  ({ seq: 'Explain Save', cards, activeIndex: 0, startedAt: 1 });

const st = (r: Rail): RailState => ({ rail: r, openWhy: null, flipped: [] });

describe('railEntities', () => {
  it('mints one 1-based, sub:true entity per visible card', () => {
    const es = railEntities(st(rail([
      card({ text: 'The Save As button opens a dialog.' }),
      card({ t: 'caution', text: 'This overwrites the original file.' }),
    ])), {});
    expect(es.map((e) => e.id)).toEqual(['rail-explain-save-c1', 'rail-explain-save-c2']);
    expect(es.every((e) => e.sub === true)).toBe(true);
  });

  it('numbers by index in rail.cards, NOT by position in the visible window', () => {
    // visibleCards shows a sliding window around the active card. With 6 cards and the 5th
    // active, the window starts partway in — the ids must still name the real card numbers,
    // or "card 5" would mean a different card each time one completes.
    const cards = Array.from({ length: 6 }, (_, i) => card({ text: `Line ${i + 1}` }));
    const r: Rail = { seq: 'Long', cards, activeIndex: 4, startedAt: 1 };
    const ids = railEntities(st(r), {}).map((e) => e.id);
    expect(ids).toContain('rail-long-c5');
    expect(ids).not.toContain('rail-long-c1');   // scrolled out of the window
  });

  it('aliases a card by number, ordinal and kicker', () => {
    const e = railEntities(st(rail([
      card({ text: 'first' }),
      card({ t: 'caution', text: 'This overwrites the original file.' }),
    ])), {})[1];
    expect(e.aliases).toContain('card 2');
    expect(e.aliases).toContain('second card');
    expect(e.aliases).toContain('the caution card');
  });

  it('aliases by first words so "the part about overwriting" resolves', () => {
    const e = railEntities(st(rail([card({ text: 'This overwrites the original file.' })])), {})[0];
    expect(e.aliases.some((a) => a.includes('overwrites'))).toBe(true);
  });

  it('drops a one-word first-words alias — the exact-match branch would ground it falsely', () => {
    // registry.ts's MIN_OVERLAP_TOKENS floor guards only the bare-overlap fallback; an exact
    // match scores 1000 regardless. Same guard as artifact paragraphs.
    const e = railEntities(st(rail([card({ text: 'Saved' })])), {})[0];
    expect(e.aliases).not.toContain('saved');
    expect(e.aliases).toContain('card 1');
  });

  it('degrades to a zero bbox when a card was not measured', () => {
    expect(railEntities(st(rail([card({ text: 'unmeasured' })])), {})[0].bbox).toEqual([0, 0, 0, 0]);
  });

  it('reads a measured bbox by the card entity id', () => {
    const es = railEntities(st(rail([card({ text: 'measured' })])), { 'rail-explain-save-c1': [1, 2, 3, 4] });
    expect(es[0].bbox).toEqual([1, 2, 3, 4]);
  });

  it('is empty when no rail is showing', () => {
    expect(railEntities(null, {})).toEqual([]);
  });
});

describe('projectedRailState', () => {
  const respond = rail([card({ text: 'from the model' })]);
  const teaching = rail([card({ text: 'from a sequence' })]);

  it('prefers the respond rail', () => {
    expect(projectedRailState(st(respond), teaching)?.rail?.cards[0].text).toBe('from the model');
  });
  it('falls back to the teaching rail with no why/flip state', () => {
    const p = projectedRailState({ rail: null, openWhy: 3, flipped: [1] }, teaching);
    expect(p?.rail?.cards[0].text).toBe('from a sequence');
    expect(p?.openWhy).toBeNull();
    expect(p?.flipped).toEqual([]);
  });
  it('is null when neither is present', () => {
    expect(projectedRailState({ rail: null, openWhy: null, flipped: [] }, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/rail/railEntities.test.ts`
Expected: FAIL — `Failed to resolve import "./railEntities"`.

- [ ] **Step 3: Extract the projection into railStore**

Append to `src/rail/railStore.ts`:

```ts
/** Which rail is actually on screen: the respond rail wins, else the projected teaching rail.
 *  Extracted so RailPanel and railEntities cannot disagree about what is being rendered —
 *  an entity for a card the panel is not showing would be a lie about the screen. */
export function projectedRailState(state: RailState, teachingRail: Rail | null): RailState | null {
  if (state.rail) return state;
  if (teachingRail) return { rail: teachingRail, openWhy: null, flipped: [] };
  return null;
}
```

`Rail` is already imported at the top of the file (`import type { Rail, RailCard } from './types';`).

- [ ] **Step 4: Write the deriver**

Create `src/rail/railEntities.ts`:

```ts
// Rail cards as pointable entities (spec §3). A card's OWN identity — distinct from
// `card.entityId`, which is what the card POINTS AT. Conflating them is the obvious future bug.
//
// Ids are honest only relative to the current rail: cards are replaced wholesale on `rail.set`.
// No handshake is needed because no tool writes through a card id — but the caller MUST
// recompose entities on every rail change, or the registry keeps describing cards that are gone.
import { asId, normText, type SceneEntity } from '../entities/registry';
import { visibleCards, type RailState } from './railStore';
import { cardParagraphs } from './cardContent';
import type { RailCard } from './types';

type Layout = Record<string, [number, number, number, number]>;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

const KICKER: Record<RailCard['t'], string> = {
  do: 'do', answer: 'answer', orient: 'orient', check: 'check',
  caution: 'caution', concept: 'concept', try: 'try', recap: 'recap',
};

/** Slug for the rail id segment: `Explain Save` → `explain-save`. */
export function railSlug(seq: string): string {
  return normText(seq).replace(/ /g, '-') || 'rail';
}

/** First few words, for "the part about overwriting". Returns null below two tokens: a
 *  one-word alias would hit resolveEchoedTarget's exact-match branch (score 1000) regardless
 *  of the MIN_OVERLAP_TOKENS floor, which guards only the bare-overlap fallback. */
function firstWords(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 5);
  return words.length < 2 ? null : words.join(' ');
}

export function railEntities(projected: RailState | null, layout: Layout): SceneEntity[] {
  if (!projected?.rail) return [];
  const slug = railSlug(projected.rail.seq);
  return visibleCards(projected).map(({ card, index }): SceneEntity => {
    // `index` is the position in rail.cards, NOT in the visible window — visibleCards slides
    // as the rail advances, so numbering by window position would renumber every card each
    // time one completed.
    const n = index + 1;
    const id = `rail-${slug}-c${n}`;
    const fw = firstWords(cardParagraphs(card)[0] ?? '');
    const aliases = Array.from(new Set([
      normText(`card ${n}`),
      ...(ORDINALS[n] ? [normText(`${ORDINALS[n]} card`)] : []),
      normText(`the ${KICKER[card.t]} card`),
      ...(fw ? [normText(fw)] : []),
    ].filter(Boolean)));
    return {
      id: asId(id),
      title: `Card ${n} — ${KICKER[card.t].toUpperCase()}`,
      url: '',
      category: 'content',
      aliases,
      bbox: layout[id] ?? [0, 0, 0, 0],
      sub: true,
    };
  });
}
```

- [ ] **Step 5: Document the namespace**

In `src/entities/registry.ts`, directly above `export function buildEntities`, add:

```ts
// ENTITY ID NAMESPACE — three prefixes, one flat scene:
//   `<programId>-…`  program controls and their sub-entities (buildEntities, below)
//   `artifact-…`     artifact windows and their paragraphs/fields (artifacts/entities.ts)
//   `rail-…`         response-rail cards (rail/railEntities.ts)
// Anything added here must not collide with those; resolveEchoedTarget searches the whole set.
```

- [ ] **Step 6: Run the tests, then the full gates**

Run: `npx vitest run src/rail/railEntities.test.ts`
Expected: PASS (10 tests).

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **666 tests**.

- [ ] **Step 7: Commit**

```bash
git add src/rail/railEntities.ts src/rail/railEntities.test.ts src/rail/railStore.ts src/entities/registry.ts
git commit -m "feat(rail): cards are pointable entities; projectedRailState shared with the panel"
```

---

### Task 3: Stamp cards in the DOM and wire the recompose

Without this, Task 2 mints entities that can be named but never pointed at.

**Files:**
- Modify: `src/rail/CardView.tsx` (accept and stamp an `entityDomId`)
- Modify: `src/rail/RailPanel.tsx` (use `projectedRailState`, mark chrome `data-shell`, pass the id)
- Modify: `src/App.tsx` (layout scan, compose, recompose deps)

**Interfaces:**
- Consumes: `railEntities`, `railSlug`, `projectedRailState` (Task 2)
- Produces: rail card DOM nodes carrying `data-entity-id="rail-<slug>-cN"`, measured into `railLayoutRef` and composed into the scene

- [ ] **Step 1: Stamp the card**

In `src/rail/CardView.tsx`, add `entityDomId` to the props and put it on the ROOT element of all three modes (`stub`, `dimmed`, and the full card). Change the signature:

```tsx
export function CardView({ card, index, mode, entityDomId, whyOpen, flipped, onWhy, onFlip, onShowMe, onCheckConfirm }: {
  card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed'; entityDomId: string;
  whyOpen: boolean; flipped: boolean;
  onWhy: () => void; onFlip: () => void; onShowMe: () => void; onCheckConfirm: () => void;
}) {
```

then add `data-entity-id={entityDomId}` to each of the three returned root `<div>`s — the stub row, the dimmed card, and the full card. All three are on screen, so all three are pointable.

- [ ] **Step 2: Carve the panel out of the shell**

In `src/rail/RailPanel.tsx`:

1. Replace the inline projection with the shared helper. Add `projectedRailState` to the existing `railStore` import and replace the `const projected: RailState | null = …` block with:

```tsx
  const projected = projectedRailState(state, teachingRail);
```

(`const respond = state.rail;` and `const isProjection = !respond;` stay as they are.)

2. Mark the panel's CHROME as shell so pointing skips it, while leaving card content pointable. On the root `<div>` add `data-shell`, and change its `onPointerDown` so it only swallows the event for chrome:

```tsx
      onPointerDown={(e) => {
        // Card CONTENT must reach <main>'s hit-test so a card can be pointed at and
        // shift-clicked; the panel's own chrome (drag bar, buttons) must not. Same carve-out
        // ArtifactWindow uses: shell stops pointing UNLESS the target is inside a data-entity-id.
        if (!(e.target as HTMLElement)?.closest?.('[data-entity-id]')) e.stopPropagation();
      }}
      data-shell
```

3. Pass the id down, computing it from the same slug the deriver uses:

```tsx
      {cards.map(({ card, index, mode }) => (
        <CardView key={index} card={card} index={index} mode={mode}
          entityDomId={`rail-${railSlug(projected.rail!.seq)}-c${index + 1}`}
```

Add the import: `import { railSlug } from './railEntities';`

- [ ] **Step 3: Measure and compose in App**

In `src/App.tsx`:

1. Beside `artifactLayoutRef` (~line 628) add:

```tsx
  // Measured bboxes of mounted rail cards, keyed by `rail-<slug>-cN` — same contract as
  // artifactLayoutRef, filled by updateLayout below.
  const railLayoutRef = useRef<Record<string, [number, number, number, number]>>({});
```

2. In `updateLayout`, immediately after the artifact-window scan that fills `artifactLayoutRef`, add the rail scan:

```tsx
    const railEls = Array.from(main.querySelectorAll<HTMLElement>('[data-entity-id^="rail-"]'));
    const railLayout: Record<string, [number, number, number, number]> = {};
    for (const el of railEls) {
      const b = el.getBoundingClientRect();
      railLayout[el.dataset.entityId!] = [
        ((b.top - mainRect.top) / mainRect.height) * 1000,
        ((b.left - mainRect.left) / mainRect.width) * 1000,
        ((b.bottom - mainRect.top) / mainRect.height) * 1000,
        ((b.right - mainRect.left) / mainRect.width) * 1000,
      ];
    }
    railLayoutRef.current = railLayout;
```

Use whatever local variable the existing artifact scan uses for the container rect — read the surrounding lines and match it exactly rather than assuming the name `mainRect`.

3. In `composeEntities` (~line 632), append the rail entities:

```tsx
    [...built, ...artifactEntities(artifactStateRef.current, artifactLayoutRef.current),
     ...railEntities(projectedRailState(railStateRef.current, teachingRailRef.current), railLayoutRef.current)];
```

If `railStateRef` / `teachingRailRef` do not exist, add refs mirroring `artifactStateRef` and keep them synced in an effect the same way — `composeEntities` runs outside React render and must not read state directly.

4. **Recompose on every rail change.** Extend the effect that currently re-runs `updateLayout` on artifact revisions so it also fires on rail changes:

```tsx
  // Rail cards are entities, so the scene must be re-measured whenever the rail changes —
  // otherwise the registry keeps describing cards that `rail.set` has already replaced. Same
  // failure the artifact revise core shipped and had to fix: state moved, scene never did.
  const railSignature = `${railState.rail?.seq ?? ''}:${railState.rail?.cards.length ?? 0}:${railState.rail?.activeIndex ?? -1}`;
```

and add `railSignature` to that effect's dependency array. A **string** signature is required, not the state object: `updateLayout` calls `setEntities`, so a fresh-identity dependency would re-render forever.

Add the imports: `import { railEntities } from './rail/railEntities';` and add `projectedRailState` to the existing `railStore` import.

- [ ] **Step 4: Verify no re-measure loop**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: PASS, **666 tests** (no new tests — component wiring).

Then start the app (`npx vite --port 3001`), open `http://localhost:3001/?rail=1`, and confirm in the console that the page settles rather than looping:

```js
let n = 0; const o = new MutationObserver(() => n++); o.observe(document.body, {subtree:true, childList:true, attributes:true});
setTimeout(() => { console.log('mutations in 3s:', n); o.disconnect(); }, 3000);
```

Expected: a small number that stops growing. A number in the thousands means the recompose is retriggering itself — fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/rail/CardView.tsx src/rail/RailPanel.tsx src/App.tsx
git commit -m "feat(rail): stamp card entities, carve the panel out of the shell, recompose on rail change"
```

---

### Task 4: The pin builder

**Files:**
- Create: `src/artifacts/pin.ts`
- Create: `src/artifacts/pin.test.ts`

**Interfaces:**
- Consumes: `cardTitle`, `cardParagraphs` (Task 1); `ArtifactEvent` from `src/artifacts/types.ts`
- Produces: `pinEventFor(card: RailCard, seq: string, now: number): { event: ArtifactEvent } | { error: string }`

- [ ] **Step 1: Write the failing test**

Create `src/artifacts/pin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pinEventFor } from './pin';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';
import type { RailCard } from '../rail/types';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'active', ...over } as RailCard);

describe('pinEventFor', () => {
  it('builds a doc artifact from the card, with card provenance', () => {
    const v = pinEventFor(card({ text: 'The Save As button opens a dialog.' }), 'Explain Save', 5000);
    expect(v).toEqual({ event: { type: 'artifact.create', artifact: {
      kind: 'doc',
      title: 'The Save As button opens a dialog.',
      sources: ['ANSWER card (Explain Save)'],
      content: 'The Save As button opens a dialog.',
      createdAt: 5000,
    } } });
  });

  it('is ALWAYS a doc, even for a widget-ish card', () => {
    const v = pinEventFor(card({ t: 'recap', lines: ['a', 'b'] }), 'Seq', 1) as { event: any };
    expect(v.event.artifact.kind).toBe('doc');
  });

  it('a recap becomes one paragraph per line', () => {
    const v = pinEventFor(card({ t: 'recap', lines: ['Opened the deck.', 'Retitled slide 1.'] }), 'Seq', 1) as { event: any };
    expect(v.event.artifact.content).toBe('Opened the deck.\n\nRetitled slide 1.');
  });

  it('refuses an empty card instead of minting a blank artifact', () => {
    expect(pinEventFor(card({ t: 'answer' }), 'Seq', 1)).toEqual({
      error: 'That card has no text to pin.',
    });
  });

  it('the event it produces is accepted by the REAL reducer', () => {
    const v = pinEventFor(card({ text: 'Pin me.' }), 'Seq', 1) as { event: any };
    const st = reduce(initialArtifactState(), v.event);
    expect(st.artifacts).toHaveLength(1);
    expect(st.artifacts[0].id).toBe('a1');
    expect(st.artifacts[0].rev).toBe(1);
  });

  it('at the cap the REAL reducer refuses it — pin never evicts', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) {
      const v = pinEventFor(card({ text: `Card ${i}` }), 'Seq', 1) as { event: any };
      st = reduce(st, v.event);
    }
    const v = pinEventFor(card({ text: 'One too many' }), 'Seq', 1) as { event: any };
    const after = reduce(st, v.event);
    expect(after.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(after.artifacts.map((a) => a.title)).not.toContain('One too many');
    expect(after.rejectedAtCap).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/artifacts/pin.test.ts`
Expected: FAIL — `Failed to resolve import "./pin"`.

- [ ] **Step 3: Write the implementation**

Create `src/artifacts/pin.ts`:

```ts
// Pin: a response becomes durable material (spec §4). USER-ONLY, like artifact.close and
// artifact.revertTo — no agent tool maps to this. The user decides what is worth keeping.
//
// Always a doc: a card is prose, and doc is the prose artifact kind. Widgets stay
// agent-authored through `combine`, where the model chooses the feed bindings.
import type { ArtifactEvent } from './types';
import type { RailCard } from '../rail/types';
import { cardTitle, cardParagraphs } from '../rail/cardContent';

const KICKER: Record<RailCard['t'], string> = {
  do: 'DO', answer: 'ANSWER', orient: 'ORIENT', check: 'CHECK',
  caution: 'CAUTION', concept: 'CONCEPT', try: 'TRY', recap: 'RECAP',
};

export function pinEventFor(card: RailCard, seq: string, now: number): { event: ArtifactEvent } | { error: string } {
  const paragraphs = cardParagraphs(card);
  if (!paragraphs.length) return { error: 'That card has no text to pin.' };
  return {
    event: {
      type: 'artifact.create',
      artifact: {
        kind: 'doc',
        title: cardTitle(card),
        // A provenance RECORD, not a live reference: deliberately not a valid combine source-id.
        // A model that tries read_sources on it gets the existing honest rejection naming the
        // ids that would work. (There is no turnId in this codebase — that arrives with the
        // journal in S5-S6. Citing one here would invent a value that does not exist.)
        sources: [`${KICKER[card.t]} card (${seq})`],
        content: paragraphs.join('\n\n'),
        createdAt: now,
      },
    },
  };
}
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run src/artifacts/pin.test.ts`
Expected: PASS (6 tests).

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **672 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/pin.ts src/artifacts/pin.test.ts
git commit -m "feat(artifacts): pinEventFor — a card becomes a doc artifact, refused at the cap"
```

---

### Task 5: The pin control

**Files:**
- Modify: `src/telemetry.ts` (add the `pin` event)
- Modify: `src/rail/CardView.tsx` (the button)
- Modify: `src/rail/RailPanel.tsx` (thread `onPin`)
- Modify: `src/App.tsx` (dispatch, at-cap refusal, telemetry)

**Interfaces:**
- Consumes: `pinEventFor` (Task 4)
- Produces: `RailPanel` prop `onPin: (index: number) => void`; `telemetry.pin(cardType, artifactId, error?)`

- [ ] **Step 1: Add the telemetry event**

In `src/telemetry.ts`, add to the `TelemetryEvent` union:

```ts
  | { type: 'pin'; cardType: string; artifactId?: string; error?: string }
```

and the method, beside `registerSwitch`:

```ts
  pin(cardType: string, artifactId?: string, error?: string) { this.push({ type: 'pin', cardType, artifactId, error }); }
```

- [ ] **Step 2: Add the button**

In `src/rail/CardView.tsx`, add `onPin: () => void` to the props type, and render the control in the full-card affordance row. Replace the affordance-row condition and body with:

```tsx
      {/* Pin is ALWAYS shown — it is durable-material, not scaffolding, so no register gate
          applies and it does not depend on the card carrying a why or an entity. */}
      <div className="flex items-center gap-3 justify-end mt-1">
        {card.why && <Button variant="ghost" size="chip" onClick={onWhy}>why?</Button>}
        {card.entityId && card.band === 'solid' && <Button variant="ghost" size="chip" onClick={onShowMe} className="text-[var(--accent-color)]">show me</Button>}
        <button aria-label="Pin this card as an artifact" title="Pin as an artifact"
          className="hit-24 text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--accent-color)]"
          onClick={onPin}>pin</button>
      </div>
```

(The previous `{(card.why || (card.entityId && card.band === 'solid')) && ( … )}` wrapper goes away — the row now always renders because pin always renders.)

- [ ] **Step 3: Thread it through the panel**

In `src/rail/RailPanel.tsx`, add `onPin: (index: number) => void` to the props type and pass `onPin={() => onPin(index)}` in the `CardView` call.

- [ ] **Step 4: Wire it in App**

At the `<RailPanel` mount site in `src/App.tsx`, add:

```tsx
            onPin={(index) => {
              const projected = projectedRailState(railState, teachingRail);
              const card = projected?.rail?.cards[index];
              if (!card) return;
              const v = pinEventFor(card, projected!.rail!.seq, Date.now());
              if ('error' in v) {
                addLog('info', `Pin refused — ${v.error}`);
                emitFeedback({ outcome: 'error', label: v.error });
                telemetry.pin(card.t, undefined, v.error);
                return;
              }
              // SIMULATE through the real reducer first: at the cap the store refuses, and a
              // refusal the user cannot see reads as a broken button. Reject-never-evict means
              // the honest outcome is a visible "close one first", not silence.
              const next = artifactReduce(artifactStateRef.current, v.event);
              if (next.rejectedAtCap > artifactStateRef.current.rejectedAtCap) {
                artifactDispatch(v.event);            // still dispatch: the counter must be real
                artifactStateRef.current = next;
                addLog('info', `Pin refused — the desk already holds ${MAX_ARTIFACTS} artifacts.`);
                emitFeedback({ outcome: 'error', label: `Can't pin — close an artifact first (${MAX_ARTIFACTS} open)` });
                telemetry.pin(card.t, undefined, 'at-cap');
                return;
              }
              artifactDispatch(v.event);
              artifactStateRef.current = next;
              const created = next.artifacts[next.artifacts.length - 1];
              addLog('info', `Pinned ${created.id} — "${created.title}"`);
              emitFeedback({ outcome: 'committed', verbClass: 'create', label: `Pinned: ${created.title}` });
              telemetry.pin(card.t, created.id);
            }}
```

Add the imports: `import { pinEventFor } from './artifacts/pin';` and add `MAX_ARTIFACTS` to the existing `artifactStore` import if it is not already there.

- [ ] **Step 5: Run the gates**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS, **672 tests** (no new tests — component wiring).

- [ ] **Step 6: Commit**

```bash
git add src/telemetry.ts src/rail/CardView.tsx src/rail/RailPanel.tsx src/App.tsx
git commit -m "feat(rail): pin a card into an artifact — user-only, refused honestly at the cap"
```

---

### Task 6: The combinability resolver

**Files:**
- Modify: `src/artifacts/entities.ts` (add `entityToSourceId`)
- Modify: `src/artifacts/entities.test.ts`

**Interfaces:**
- Consumes: `SceneEntity` from `src/entities/registry.ts`
- Produces: `entityToSourceId(entity: SceneEntity): string | null`

- [ ] **Step 1: Write the failing test**

Append to `src/artifacts/entities.test.ts`:

```ts
import { entityToSourceId } from './entities';
import { asId, type SceneEntity } from '../entities/registry';

const ent = (id: string, sub = false): SceneEntity =>
  ({ id: asId(id), title: 't', url: '', category: 'content', aliases: [], bbox: [0, 0, 0, 0], sub });

describe('entityToSourceId', () => {
  it('maps a whole artifact to its source id', () => {
    expect(entityToSourceId(ent('artifact-a1'))).toBe('a1');
  });
  it('maps any program element to that program — the document is the combinable unit', () => {
    expect(entityToSourceId(ent('word-3'))).toBe('word');
    expect(entityToSourceId(ent('excel-cell-A3', true))).toBe('excel');
    expect(entityToSourceId(ent('powerpoint-slide-2', true))).toBe('powerpoint');
    expect(entityToSourceId(ent('photo-1'))).toBe('photo');
  });
  it('an artifact PART is not a source — the artifact is', () => {
    expect(entityToSourceId(ent('artifact-a1-para-2', true))).toBeNull();
    expect(entityToSourceId(ent('artifact-a2-field-1', true))).toBeNull();
  });
  it('a rail card is not a source — pin it first', () => {
    expect(entityToSourceId(ent('rail-explain-save-c1', true))).toBeNull();
  });
  it('an unknown prefix is not a source', () => {
    expect(entityToSourceId(ent('mystery-1'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/artifacts/entities.test.ts`
Expected: FAIL — `entityToSourceId is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/artifacts/entities.ts`:

```ts
// The SINGLE answer to "can this be combined?" (spec §5.1). Every combinability decision and
// every message naming valid sources derives from this — never a hardcoded list.
//
// There is no program-WINDOW entity in this codebase (buildEntities mints one entity per
// control plus sub-entities), so any element of the mounted program stands for its document:
// the combinable unit is the doc, and shift-clicking the Save button means "this Word doc".
const PROGRAM_IDS = ['word', 'excel', 'powerpoint', 'photo'];

export function entityToSourceId(entity: { id: string; sub?: boolean }): string | null {
  const id = String(entity.id);
  // Artifact PARTS (paragraphs, fields) are not sources; the artifact is. `artifact-a1` has
  // exactly two segments, `artifact-a1-para-2` has more.
  if (id.startsWith('artifact-')) {
    const rest = id.slice('artifact-'.length);
    return rest.includes('-') ? null : rest;
  }
  const program = PROGRAM_IDS.find((p) => id.startsWith(`${p}-`));
  return program ?? null;   // rail cards and anything else: not a source
}
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run src/artifacts/entities.test.ts`
Expected: PASS.

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **677 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/entities.ts src/artifacts/entities.test.ts
git commit -m "feat(artifacts): entityToSourceId — the single combinability resolver"
```

---

### Task 7: The tray

**Files:**
- Create: `src/artifacts/combineTray.ts`
- Create: `src/artifacts/combineTray.test.ts`

**Interfaces:**
- Consumes: `MAX_ARTIFACTS` from `src/artifacts/artifactStore.ts`
- Produces: `TrayMember`, `CombineTray`, `toggleTray`, `removeTray`, `clearTray`, `canFire`

- [ ] **Step 1: Write the failing test**

Create `src/artifacts/combineTray.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toggleTray, removeTray, clearTray, canFire, type TrayMember } from './combineTray';
import { MAX_ARTIFACTS } from './artifactStore';

const m = (sourceId: string): TrayMember =>
  ({ entityId: `artifact-${sourceId}`, sourceId, title: sourceId.toUpperCase(), color: '#000' });

describe('combineTray', () => {
  it('adds a member that is absent', () => {
    expect(toggleTray([], m('a1')).map((x) => x.sourceId)).toEqual(['a1']);
  });
  it('removes a member that is present — toggle', () => {
    expect(toggleTray([m('a1')], m('a1'))).toEqual([]);
  });
  it('preserves selection order', () => {
    const t = toggleTray(toggleTray(toggleTray([], m('word')), m('a1')), m('excel'));
    expect(t.map((x) => x.sourceId)).toEqual(['word', 'a1', 'excel']);
  });
  it('dedupes by sourceId, not by entityId', () => {
    // Two different program elements resolve to the SAME source — the doc must appear once.
    const fromButton: TrayMember = { entityId: 'word-3', sourceId: 'word', title: 'Word', color: '#000' };
    const fromCell: TrayMember = { entityId: 'word-5', sourceId: 'word', title: 'Word', color: '#000' };
    expect(toggleTray([fromButton], fromCell)).toEqual([]);   // same source → toggles it off
  });
  it('caps at MAX_ARTIFACTS', () => {
    let t: TrayMember[] = [];
    for (let i = 0; i < MAX_ARTIFACTS + 2; i++) t = toggleTray(t, m(`a${i}`));
    expect(t).toHaveLength(MAX_ARTIFACTS);
  });
  it('removeTray drops exactly one by sourceId; unknown is a no-op', () => {
    const t = [m('a1'), m('a2')];
    expect(removeTray(t, 'a1').map((x) => x.sourceId)).toEqual(['a2']);
    expect(removeTray(t, 'zzz')).toEqual(t);
  });
  it('clearTray empties it', () => {
    expect(clearTray()).toEqual([]);
  });
  it('needs two to fire — combine rejects fewer', () => {
    expect(canFire([])).toBe(false);
    expect(canFire([m('a1')])).toBe(false);
    expect(canFire([m('a1'), m('word')])).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/artifacts/combineTray.test.ts`
Expected: FAIL — `Failed to resolve import "./combineTray"`.

- [ ] **Step 3: Write the implementation**

Create `src/artifacts/combineTray.ts`:

```ts
// The combine tray (spec §5.2): an ordered, deduped selection buffer.
//
// Semantically distinct from the grounding buffer: grounding means "my next utterance is about
// these"; the tray means "make a new artifact from these". Deduped by sourceId rather than
// entityId because two different program elements resolve to the same document.
import { MAX_ARTIFACTS } from './artifactStore';

export interface TrayMember { entityId: string; sourceId: string; title: string; color: string }
export type CombineTray = TrayMember[];

export function toggleTray(tray: CombineTray, member: TrayMember): CombineTray {
  if (tray.some((x) => x.sourceId === member.sourceId)) return removeTray(tray, member.sourceId);
  if (tray.length >= MAX_ARTIFACTS) return tray;
  return [...tray, member];
}

export function removeTray(tray: CombineTray, sourceId: string): CombineTray {
  return tray.filter((x) => x.sourceId !== sourceId);
}

export function clearTray(): CombineTray {
  return [];
}

/** `combine` itself refuses fewer than two sources — the fire affordance must not offer it. */
export function canFire(tray: CombineTray): boolean {
  return tray.length >= 2;
}
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run src/artifacts/combineTray.test.ts`
Expected: PASS (8 tests).

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **685 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/combineTray.ts src/artifacts/combineTray.test.ts
git commit -m "feat(artifacts): combineTray — ordered, deduped by source, two to fire"
```

---

### Task 8: The combine request builder

**Files:**
- Create: `src/artifacts/combineRequest.ts`
- Create: `src/artifacts/combineRequest.test.ts`

**Interfaces:**
- Consumes: `TrayMember` (Task 7)
- Produces: `buildCombineRequest(tray: TrayMember[], kind: 'doc' | 'widget'): { userText: string; hint: string }`

- [ ] **Step 1: Write the failing test**

Create `src/artifacts/combineRequest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCombineRequest } from './combineRequest';
import type { TrayMember } from './combineTray';

const m = (sourceId: string, title: string): TrayMember =>
  ({ entityId: `e-${sourceId}`, sourceId, title, color: '#000' });

describe('buildCombineRequest', () => {
  const tray = [m('word', 'Quarterly report'), m('excel', 'Q3 numbers')];

  it('names the exact source ids and kind in the hint', () => {
    const { hint } = buildCombineRequest(tray, 'doc');
    expect(hint).toContain('sources=["word","excel"]');
    expect(hint).toContain('kind="doc"');
  });

  it('the hint tells the model to read before authoring', () => {
    expect(buildCombineRequest(tray, 'doc').hint.toLowerCase()).toContain('read');
  });

  it('the user turn reads naturally from the titles, not the ids', () => {
    const { userText } = buildCombineRequest(tray, 'doc');
    expect(userText).toBe('Combine Quarterly report and Q3 numbers into a doc.');
    expect(userText).not.toContain('word');
  });

  it('three or more members read with commas and a final and', () => {
    const { userText } = buildCombineRequest([...tray, m('a1', 'Trip brief')], 'widget');
    expect(userText).toBe('Combine Quarterly report, Q3 numbers and Trip brief into a widget.');
  });

  it('preserves tray order in both the hint and the sentence', () => {
    const { hint, userText } = buildCombineRequest([m('a1', 'B'), m('word', 'A')], 'doc');
    expect(hint).toContain('sources=["a1","word"]');
    expect(userText).toBe('Combine B and A into a doc.');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/artifacts/combineRequest.test.ts`
Expected: FAIL — `Failed to resolve import "./combineRequest"`.

- [ ] **Step 3: Write the implementation**

Create `src/artifacts/combineRequest.ts`:

```ts
// Firing the tray hands off to the model (spec §5.4) — it does NOT author content. `combine`'s
// content is model-authored by design; a UI that fabricated the synthesis would be faking
// authorship. The UI's contribution is the deterministic part: exactly which sources, and what
// kind. The hint rides sendTextHint, so spec C's per-session fence makes it unforgeable —
// typed user text cannot impersonate a combine request.
import type { TrayMember } from './combineTray';

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? '';
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

export function buildCombineRequest(tray: TrayMember[], kind: 'doc' | 'widget'): { userText: string; hint: string } {
  const ids = tray.map((m) => m.sourceId);
  return {
    userText: `Combine ${joinTitles(tray.map((m) => m.title))} into a ${kind}.`,
    hint: `[COMBINE REQUEST: sources=[${ids.map((i) => `"${i}"`).join(',')}], kind="${kind}" — call combine with exactly these source ids; read them first with read_sources.]`,
  };
}
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run src/artifacts/combineRequest.test.ts`
Expected: PASS (5 tests).

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **690 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/combineRequest.ts src/artifacts/combineRequest.test.ts
git commit -m "feat(artifacts): buildCombineRequest — fenced handoff naming the exact ids"
```

---

### Task 9: Shift-click, the tray row, and firing

**Files:**
- Modify: `src/telemetry.ts` (the `combineTray` event)
- Modify: `src/shell/Omnibox.tsx` (the tray row)
- Modify: `src/App.tsx` (shift branch, tray state, fire)

**Interfaces:**
- Consumes: `entityToSourceId` (6), `toggleTray`/`removeTray`/`clearTray`/`canFire`/`TrayMember` (7), `buildCombineRequest` (8)
- Produces: a live tray; `telemetry.combineTray(count, kind, ok)`

- [ ] **Step 1: Add the telemetry event**

In `src/telemetry.ts`, add to the union:

```ts
  | { type: 'combine_tray'; count: number; kind: string; ok: boolean }
```

and the method:

```ts
  combineTray(count: number, kind: string, ok: boolean) { this.push({ type: 'combine_tray', count, kind, ok }); }
```

- [ ] **Step 2: Add the tray row to the omnibox**

In `src/shell/Omnibox.tsx`, add to the props type:

```tsx
  tray?: { sourceId: string; title: string; color: string }[];
  onRemoveTray?: (sourceId: string) => void;
  onFireTray?: (kind: 'doc' | 'widget') => void;
```

and render it directly ABOVE the existing grounding-chip block, so the two rows read as distinct:

```tsx
        {tray && tray.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap px-1 pb-1">
            <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">combine</span>
            {tray.map((t) => (
              <span key={t.sourceId} className="flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[11px]"
                style={{ borderColor: t.color }}>
                {t.title}
                <button aria-label={`Remove ${t.title} from the combine tray`} className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  onClick={() => onRemoveTray?.(t.sourceId)}>×</button>
              </span>
            ))}
            {tray.length >= 2 && (
              <>
                <button className="hit-24 rounded-full bg-[var(--accent-color)]/15 px-2 text-[11px] text-[var(--accent-color)]"
                  onClick={() => onFireTray?.('doc')}>combine these → doc</button>
                <button className="hit-24 rounded-full bg-[var(--accent-color)]/15 px-2 text-[11px] text-[var(--accent-color)]"
                  onClick={() => onFireTray?.('widget')}>→ widget</button>
              </>
            )}
          </div>
        )}
```

- [ ] **Step 3: Add tray state and the shift-click branch in App**

In `src/App.tsx`, beside the `grounding` state (~line 500):

```tsx
  // The combine tray (spec §5.2) — distinct from grounding: grounding is "my next utterance is
  // about these", the tray is "make a new artifact from these". Cleared on program swap.
  const [tray, setTray] = useState<TrayMember[]>([]);
  useEffect(() => { setTray(clearTray()); }, [activeProgram]);
```

In `handlePointerDown`, immediately after the `found` entity is resolved from the bbox hit-test and BEFORE the touch-deixis registration, add:

```tsx
      // SHIFT-CLICK = tray toggle (spec §5.3). This is the right seam, not
      // handleSurfaceElementClick: that one takes a bare elementId with no event, and artifact
      // windows never route through it. Only consumes the click when the entity actually
      // resolves to a source — everything else falls through to normal pointing.
      if (e.shiftKey && found) {
        const sourceId = entityToSourceId(found);
        if (sourceId) {
          setTray((t) => toggleTray(t, { entityId: String(found.id), sourceId,
            title: displayName(found), color: CATEGORY_COLORS[found.category] }));
          return;
        }
      }
```

- [ ] **Step 4: Wire the omnibox props**

At the `<Omnibox` mount site, beside the existing `onRemoveGrounding`:

```tsx
            tray={tray.map((t) => ({ sourceId: t.sourceId, title: t.title, color: t.color }))}
            onRemoveTray={(sourceId) => setTray((t) => removeTray(t, sourceId))}
            onFireTray={(kind) => {
              if (!canFire(tray)) return;
              const { userText, hint } = buildCombineRequest(tray, kind);
              // The fenced hint carries the exact ids; the user turn carries the intent. Firing
              // does NOT author content — the model reads the named sources and writes the
              // synthesis itself, so authorship stays honest.
              providerRef.current?.sendTextHint(hint);
              providerRef.current?.sendUserText(userText);
              addLog('event', `Combine tray fired — ${tray.map((t) => t.sourceId).join(' + ')} → ${kind}`);
              telemetry.combineTray(tray.length, kind, true);
              setTray(clearTray());
            }}
```

Add the imports:

```tsx
import { entityToSourceId } from './artifacts/entities';
import { toggleTray, removeTray, clearTray, canFire, type TrayMember } from './artifacts/combineTray';
import { buildCombineRequest } from './artifacts/combineRequest';
```

`CATEGORY_COLORS` and `displayName` are already in scope (the grounding path uses both).

- [ ] **Step 5: Run the gates**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS, **690 tests** (no new tests — component wiring).

- [ ] **Step 6: Commit**

```bash
git add src/telemetry.ts src/shell/Omnibox.tsx src/App.tsx
git commit -m "feat(artifacts): shift-click fills the combine tray; firing hands off fenced ids"
```

---

### Task 10: Browser drive

This is the first time any of this runs. A checklist item you cannot observe is a FAILED item, not a passed one.

**Files:**
- Modify: whatever the drive proves is broken.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Start the app**

```bash
npx vite --port 3001
```

Port 3000 belongs to a different project on this machine and the repo's own `server.ts` hardcodes it, so use vite directly on 3001. No API key is needed: `?rail=1` replays a scripted rail and `?artifacts=1` a scripted combine, both through the real reducers.

The first CDP-driven click after page load reliably misses in this repo's harness — the app is fine. Prefer JS-driven interaction (`element.click()`, dispatched events) and screenshots for observation.

- [ ] **Step 2: Drive the rail half at `http://localhost:3001/?rail=1`**

Record what you actually see for each:

| # | Check |
|---|---|
| R1 | Cards render; each card root carries `data-entity-id="rail-<slug>-cN"` (inspect the DOM) |
| R2 | Hovering a card shows it as the pointing target in the status line — the panel's chrome does NOT |
| R3 | Dragging the panel by its grip still works (the carve-out did not break chrome) |
| R4 | `document.querySelectorAll('[data-entity-id^="rail-"]').length` is non-zero and matches the visible card count |
| R5 | The mutation-count probe from Task 3 still settles (no re-measure loop) |

- [ ] **Step 3: Drive pin**

| # | Check |
|---|---|
| P1 | A `pin` control is on every full card, and is at least 24×24 (`getBoundingClientRect`) |
| P2 | Clicking it opens an artifact window whose provenance line reads `from: ANSWER card (<seq>)` |
| P3 | A recap card pins as one paragraph per line — inspect the window and count `<p>` elements |
| P4 | The pinned artifact's paragraphs are themselves pointable (`[data-entity-id^="artifact-"]` includes `-para-`) |
| P5 | Pin six artifacts, then pin a seventh: an honest "close an artifact first" message appears and nothing is evicted |

- [ ] **Step 4: Drive the tray at `http://localhost:3001/?artifacts=1`**

| # | Check |
|---|---|
| T1 | Shift-clicking an artifact window's content adds a chip to the `combine` row |
| T2 | Shift-clicking it again removes it (toggle) |
| T3 | Shift-clicking a program control adds the program once; shift-clicking a different control of the SAME program toggles it off rather than adding a duplicate |
| T4 | Shift-clicking a rail card adds nothing — it is not a source until pinned |
| T5 | With two members the `combine these → doc` chip appears; with fewer it does not |
| T6 | A normal (non-shift) click still points and grounds as before |
| T7 | Firing logs the exact source ids in the op-stream drawer and clears the tray |

- [ ] **Step 5: Fix anything that failed**

Record both the failure and the fix in the report. Re-run `npx vitest run && npx tsc --noEmit && npx vite build` after any change.

- [ ] **Step 6: Add the owed live-smoke rows**

Append to `docs/superpowers/smokes/2026-07-24-human-smoke-sitting.md`, in the same table format its other sections use (`| # | Test | Verifies | Result |`, `pending` in Result), under a new heading for this phase:

- M1 — Fire the tray with two sources → the model calls `combine` with exactly those ids, not re-guessed ones
- M2 — Point at "the caution card" by voice → grounds to the right card
- M3 — Pin a card, then refine the resulting artifact by voice → the full loop: ask → answer → pin → refine
- M4 — Pin at the 6-artifact cap during a live session → honest refusal, nothing evicted
- M5 — Shift-click a rail card → nothing enters the tray, and the model is not told anything happened

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(artifacts): browser drive for the material grammar + owed live-smoke rows"
```

---

## Self-Review

**Spec coverage:** §2 architecture → the File Structure table · §3 rail card ids (including the index-not-window-position rule and the recompose requirement) → Tasks 2, 3 · §4 pin (doc-only, recap-per-line, provenance, user-only, at-cap refusal, always-visible `hit-24`) → Tasks 1, 4, 5 · §5.1 `entityToSourceId` → Task 6 · §5.2 tray → Task 7 · §5.3 interaction and both spec-A corrections → Tasks 3 (carve-out) and 9 (`handlePointerDown` seam) · §5.4 fenced handoff → Tasks 8, 9 · §6 honesty rules → enforced across 4, 5, 6, 9 · §7 telemetry → Tasks 5, 9 · §8 testing → every task plus Task 10 · §9 risks → each mitigation lands in the task that creates the risk.

**Deviation from the spec, noted:** §5.1 says "the program window → the active program's id", but this codebase has **no program-window entity** — `buildEntities` mints one entity per control plus sub-entities. Task 6 therefore maps *any* element of a program to that program's source id, on the reasoning that the combinable unit is the document and any part of its surface stands for it. Recorded here rather than silently reinterpreted.

**Type consistency:** `cardTitle`/`cardParagraphs` (Task 1) are consumed under those names in Tasks 2 and 4. `projectedRailState` (Task 2) is used in Tasks 3 and 5. `railSlug` (Task 2) is used by Task 3's DOM stamping, so the id the panel writes and the id the deriver computes come from one function. `TrayMember`'s four fields are constructed identically in Tasks 7, 9. `entityToSourceId` takes `{ id: string; sub?: boolean }` — structurally satisfied by `SceneEntity`, so Task 9 can pass a scene entity directly.
