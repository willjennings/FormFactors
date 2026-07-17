import type { SessionState, SlotFill } from './types';

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

export function isStalled(state: SessionState, now: number): boolean {
  return state.phase === 'conversing' && now - state.lastUpdateAt > STALL_MS;
}
