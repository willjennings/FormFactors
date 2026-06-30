import type { SessionState, SlotFill, RambleEvent } from './types';

function hasSlot(state: SessionState, slotId: string): boolean {
  return state.fills.some((f) => f.slotId === slotId);
}

function ownerOf(state: SessionState, slotId: string): SlotFill['owner'] | undefined {
  return state.fills.find((f) => f.slotId === slotId)?.owner;
}

function patchSlot(state: SessionState, slotId: string, patch: Partial<SlotFill>, now: number): SessionState {
  return {
    ...state,
    fills: state.fills.map((f) => (f.slotId === slotId ? { ...f, ...patch, updatedAt: now } : f)),
  };
}

export function reduce(state: SessionState, event: RambleEvent, now: number): SessionState {
  switch (event.type) {
    case 'slot.fillingStart': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      const s = patchSlot(state, event.slotId, { status: 'filling' }, now);
      return { ...s, activeSlotId: event.slotId, activity: 'filling', lastUpdateAt: now };
    }
    case 'slot.valueUpdate': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { value: event.partialValue }, now), lastUpdateAt: now };
    }
    case 'slot.draft': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      const s = patchSlot(state, event.slotId, { value: event.value, status: 'draft', confidence: event.confidence, source: event.source }, now);
      const activeSlotId = state.activeSlotId === event.slotId ? null : state.activeSlotId;
      return { ...s, activeSlotId, activity: 'thinking', lastUpdateAt: now };
    }
    case 'slot.needsInput': {
      if (!hasSlot(state, event.slotId)) return state;
      return { ...patchSlot(state, event.slotId, { status: 'needsInput', pendingQuestion: event.question }, now), activity: 'asking', lastUpdateAt: now };
    }
    case 'slot.confirmed': {
      if (!hasSlot(state, event.slotId)) return state;
      return { ...patchSlot(state, event.slotId, { status: 'confirmed' }, now), lastUpdateAt: now };
    }
    case 'activity.change':
      return { ...state, activity: event.activity, lastUpdateAt: now };
    case 'session.phaseChange':
      return { ...state, phase: event.phase };
    case 'heartbeat':
      return { ...state, lastUpdateAt: now };
    default:
      return state; // user.* handled in Task 3; unknown events are no-ops
  }
}
