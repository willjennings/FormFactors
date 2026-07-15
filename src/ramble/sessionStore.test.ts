import { describe, it, expect } from 'vitest';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

const start = () => initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);
const slot = (st: any, id: string) => st.fills.find((f: any) => f.slotId === id);

describe('reduce — agent→UI transitions', () => {
  it('fillingStart sets the single active anchor', () => {
    const st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    expect(st.activeSlotId).toBe('question');
    expect(slot(st, 'question').status).toBe('filling');
    expect(st.activity).toBe('filling');
    expect(st.lastUpdateAt).toBe(2000);
  });

  it('valueUpdate streams text into the slot', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    st = reduce(st, { type: 'slot.valueUpdate', slotId: 'question', partialValue: 'S-301 beam' }, 2100);
    expect(slot(st, 'question').value).toBe('S-301 beam');
    expect(st.lastUpdateAt).toBe(2100);
  });

  it('draft releases the anchor and records confidence + source', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2200);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: 'draft', confidence: 0.9, source: 'heard' });
    expect(st.activeSlotId).toBeNull();
  });

  it('needsInput stashes the question and sets asking', () => {
    const st = reduce(start(), { type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' }, 3000);
    expect(slot(st, 'neededBy')).toMatchObject({ status: 'needsInput', pendingQuestion: 'by when?' });
    expect(st.activity).toBe('asking');
  });

  it('confirmed settles a slot', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2200);
    st = reduce(st, { type: 'slot.confirmed', slotId: 'location' }, 2300);
    expect(slot(st, 'location').status).toBe('confirmed');
  });

  it('phaseChange and heartbeat behave', () => {
    let st = reduce(start(), { type: 'session.phaseChange', phase: 'recapping' }, 4000);
    expect(st.phase).toBe('recapping');
    st = reduce(st, { type: 'heartbeat' }, 4500);
    expect(st.lastUpdateAt).toBe(4500);
  });

  it('ignores events for an unknown slot (no throw)', () => {
    const before = start();
    const after = reduce(before, { type: 'slot.draft', slotId: 'nope', value: 'x', confidence: 1, source: 'heard' }, 2000);
    expect(after.fills).toEqual(before.fills);
  });
});

describe('reduce — yield + edits', () => {
  it('editStart takes ownership and clears the anchor if it was filling', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'question' }, 2100);
    expect(slot(st, 'question').owner).toBe('user');
    expect(st.activeSlotId).toBeNull();
  });

  it('agent CANNOT overwrite a user-owned slot (yield)', () => {
    let st = reduce(start(), { type: 'user.editStart', slotId: 'location' }, 2000);
    const before = slot(st, 'location');
    st = reduce(st, { type: 'slot.draft', slotId: 'location', value: 'WRONG', confidence: 1, source: 'heard' }, 2100);
    st = reduce(st, { type: 'slot.fillingStart', slotId: 'location' }, 2150);
    st = reduce(st, { type: 'slot.valueUpdate', slotId: 'location', partialValue: 'WRONG2' }, 2200);
    expect(slot(st, 'location')).toEqual(before); // unchanged
  });

  it('editCommit sets userEdited + confirmed + user-owned', () => {
    let st = reduce(start(), { type: 'user.editStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'user.editCommit', slotId: 'location', value: 'C-3' }, 2100);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: 'confirmed', source: 'userEdited', owner: 'user' });
  });

  it('editCancel reverts to the pre-edit snapshot and returns ownership to the agent', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 1500);
    const draft = slot(st, 'location');
    st = reduce(st, { type: 'user.editStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'user.editCancel', slotId: 'location' }, 2100);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: draft.status, source: 'heard', owner: 'agent' });
  });
});

describe('yield guards — agent events cannot touch a user-owned slot (Plan 2)', () => {
  const userOwned = () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'location' }, 2100);
    return reduce(st, { type: 'user.editCommit', slotId: 'location', value: 'C-9' }, 2200);
  };
  it('drops slot.needsInput on a user-owned slot (no status flip, no asking activity)', () => {
    const after = reduce(userOwned(), { type: 'slot.needsInput', slotId: 'location', question: 'where exactly?' }, 2300);
    expect(slot(after, 'location')).toMatchObject({ value: 'C-9', status: 'confirmed', owner: 'user' });
    expect(after.activity).not.toBe('asking');
  });
  it('drops slot.confirmed on a user-owned slot mid-edit (status stays the pre-edit snapshot)', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 0.4, source: 'heard' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'drawingRef' }, 2100); // owner=user, still 'draft'
    const after = reduce(st, { type: 'slot.confirmed', slotId: 'drawingRef' }, 2200);
    expect(slot(after, 'drawingRef')).toMatchObject({ status: 'draft', owner: 'user' });
  });
});
