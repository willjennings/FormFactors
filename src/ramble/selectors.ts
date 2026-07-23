import type { Phase, SessionState, SlotFill } from './types';

export const STALL_MS = 10_000;

export function activeSlot(state: SessionState): SlotFill | null {
  return state.fills.find((f) => f.slotId === state.activeSlotId) ?? null;
}

export function recentSlots(state: SessionState, n = 2): SlotFill[] {
  return state.fills
    .filter((f) => f.slotId !== state.activeSlotId && f.status !== 'empty')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, n);
}

/** Phases where the SYSTEM/MODEL owes progress. awaitingConsent is deliberately absent:
 *  it waits on the user's Submit/Not-yet — flagging a human-wait "stalled" would be
 *  dishonest (spec 2026-07-21-ramble-phase-machine §4). */
export const STALL_PHASES: ReadonlySet<Phase> = new Set(['conversing', 'recapping']);

export function isStalled(state: SessionState, now: number): boolean {
  return STALL_PHASES.has(state.phase) && now - state.lastUpdateAt > STALL_MS;
}
