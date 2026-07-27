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

/** Advance past the current active card.
 *  Non-gating cards (answer/caution/concept/recap/orient) fast-forward ONLY if a gating card
 *  follows later; otherwise they become ACTIVE so the user can glance then dismiss.
 *  If `doc` is provided (doc.changed path), a newly-activated auto-CHECK is re-evaluated
 *  immediately and chained until a check fails or a non-check gate activates. */
function advance(rail: Rail, doc?: MockDoc): Rail {
  const cards = rail.cards.map((c, i) => (i === rail.activeIndex ? { ...c, state: 'done' as const } : c));
  let next = cards.findIndex(c => c.state === 'pending');
  // Fast-forward non-gating cards only when a gating card still follows.
  while (next !== -1 && !GATING.includes(cards[next].t)) {
    const hasGatingAfter = cards.slice(next + 1).some(c => GATING.includes(c.t) && c.state === 'pending');
    if (!hasGatingAfter) break; // no gating card follows — make this card active instead
    cards[next] = { ...cards[next], state: 'done' };
    next = cards.findIndex(c => c.state === 'pending');
  }
  if (next === -1) return { ...rail, cards, activeIndex: null };
  cards[next] = { ...cards[next], state: 'active' };
  let result: Rail = { ...rail, cards, activeIndex: next };
  // Re-evaluate auto-CHECK on the newly-activated card when a doc context is available.
  if (doc) {
    while (result.activeIndex !== null) {
      const ac = result.cards[result.activeIndex];
      if (ac.t !== 'check' || ac.verify !== 'auto' || !ac.expect) break;
      if (evaluatePredicate(doc, ac.expect) === true) {
        result = advance(result, doc); // chain: check passed → try to advance further
      } else {
        const newCards = result.cards.map((x, i) =>
          i === result.activeIndex ? { ...x, state: 'failed' as const } : x
        );
        result = { ...result, cards: newCards };
        break;
      }
    }
  }
  return result;
}

export function reduceRail(s: RailState, e: RailEvent, _now: number): RailState {
  switch (e.type) {
    case 'rail.set': {
      // Non-gating leading cards fast-forward only when a gating card follows; otherwise leave
      // the first card ACTIVE so the user can glance and dismiss (rail.set never auto-completes).
      let rail = e.rail;
      if (rail.activeIndex !== null && !GATING.includes(rail.cards[rail.activeIndex].t)) {
        const hasGatingAfter = rail.cards.slice(rail.activeIndex + 1).some(
          c => GATING.includes(c.t) && c.state === 'pending'
        );
        if (hasGatingAfter)
          rail = advance({ ...rail, cards: rail.cards.map((c, i) => i === rail.activeIndex ? { ...c, state: 'active' } : c) });
        // else: the non-gating card stays active — rail.set alone never flips railComplete
      }
      return { rail, openWhy: null, flipped: [] };
    }
    case 'rail.dismiss': return { ...s, rail: null, openWhy: null, flipped: [] };
    case 'user.whyToggle': return { ...s, openWhy: s.openWhy === e.index ? null : e.index };
    case 'user.flip': return { ...s, flipped: s.flipped.includes(e.index) ? s.flipped.filter(i => i !== e.index) : [...s.flipped, e.index] };
    case 'user.elementAction': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      // Any user action advances past a glanceable (non-gating) active card.
      if (!GATING.includes(c.t)) return { ...s, rail: advance(r) };
      if ((c.t === 'do' || c.t === 'try') && c.entityId === e.entityId) return { ...s, rail: advance(r) };
      return s;
    }
    case 'user.checkConfirm': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      // Any user action advances past a glanceable (non-gating) active card.
      if (!GATING.includes(c.t)) return { ...s, rail: advance(r) };
      if (c.t === 'check' && c.verify === 'user') return { ...s, rail: advance(r) };
      return s;
    }
    case 'doc.changed': {
      const r = s.rail;
      if (!r || r.activeIndex === null) return s;
      const c = r.cards[r.activeIndex];
      if (c.t !== 'check' || c.verify !== 'auto' || !c.expect) return s;
      if (evaluatePredicate(e.doc, c.expect) === true) return { ...s, rail: advance(r, e.doc) };
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

/** Which rail is actually on screen: the respond rail wins, else the projected teaching rail.
 *  Extracted so RailPanel and railEntities cannot disagree about what is being rendered —
 *  an entity for a card the panel is not showing would be a lie about the screen. */
export function projectedRailState(state: RailState, teachingRail: Rail | null): RailState | null {
  if (state.rail) return state;
  if (teachingRail) return { rail: teachingRail, openWhy: null, flipped: [] };
  return null;
}
