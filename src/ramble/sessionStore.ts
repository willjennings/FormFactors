import type { SessionState, SlotFill, RambleEvent, Phase } from './types';

/** Spec 2026-07-21-ramble-phase-machine: the machine's only legal edges. Self-transitions
 *  are idempotent no-ops (recap while recapping, etc.). Everything else is ignored here
 *  (defense in depth) — model-facing honesty for illegal calls lives in the HOST guard. */
const LEGAL_EDGES: ReadonlyArray<readonly [Phase, Phase]> = [
  ['conversing', 'recapping'],
  ['recapping', 'conversing'],
  ['recapping', 'awaitingConsent'],
  ['awaitingConsent', 'submitting'],
  ['awaitingConsent', 'conversing'],   // decline returns to conversing
  ['submitting', 'done'],
];

export function legalTransition(from: Phase, to: Phase): boolean {
  return from === to || LEGAL_EDGES.some(([f, t]) => f === from && t === to);
}

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
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { status: 'needsInput', pendingQuestion: event.question }, now), activity: 'asking', lastUpdateAt: now };
    }
    case 'slot.confirmed': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { status: 'confirmed' }, now), lastUpdateAt: now };
    }
    case 'activity.change':
      return { ...state, activity: event.activity, lastUpdateAt: now };
    case 'session.phaseChange':
      if (!legalTransition(state.phase, event.phase)) return state;
      return { ...state, phase: event.phase };
    case 'heartbeat':
      return { ...state, lastUpdateAt: now };
    case 'user.editStart': {
      const cur = state.fills.find((f) => f.slotId === event.slotId);
      if (!cur) return state;
      // Mid-edit re-entry must NOT overwrite the original snapshot (probe 2026-07-16:
      // double editStart then cancel restored an intermediate state, and after a commit
      // the fresh snapshot correctly carries owner='user' so cancel keeps yield sticky).
      const s = patchSlot(state, event.slotId, { owner: 'user', prior: cur.prior ?? { ...cur } }, now);
      const activeSlotId = state.activeSlotId === event.slotId ? null : state.activeSlotId;
      return { ...s, activeSlotId };
    }
    case 'user.editCommit':
      if (!hasSlot(state, event.slotId)) return state;
      return patchSlot(state, event.slotId, { value: event.value, status: 'confirmed', source: 'userEdited', owner: 'user', prior: null }, now);
    case 'user.editCancel': {
      const cur = state.fills.find((f) => f.slotId === event.slotId);
      if (!cur || !cur.prior) return state;
      const prior = cur.prior;
      // Restore the snapshot VERBATIM including its owner: if the slot was already
      // user-owned before this edit (re-editing a committed value), cancel must NOT
      // hand it back to the agent (probe 2026-07-16: hardcoded 'agent' broke yield).
      return { ...state, fills: state.fills.map((f) => (f.slotId === event.slotId ? { ...prior, prior: null } : f)) };
    }
    case 'user.openFullEditor':
      return state; // navigation handled by the app shell
    default:
      return state;
  }
}
