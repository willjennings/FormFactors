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
