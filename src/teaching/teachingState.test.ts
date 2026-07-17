import { describe, it, expect } from 'vitest';
import { serializeTeachingState, makeChangeGate } from './teachingState';
import { initialTeachingState } from './teachingStore';
import type { TeachingState, TeachStep } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});

// word-2 is the active target; the other two are what soft-block scrims.
const entities: SceneEntity[] = [
  ent('word-1', 'Title text'),
  ent('word-2', 'Bold button'),
  ent('word-3', 'Save button'),
];

const step = (entityId: string, subgoal: string, instruction: string, state: TeachStep['state']): TeachStep =>
  ({ entityId: entityId as EntityId, subgoal, instruction, state });

const seqState = (over: Partial<NonNullable<TeachingState['sequence']>> = {}): TeachingState => ({
  ...initialTeachingState(),
  sequence: {
    title: 'Make the title bold',
    taskKey: 'bold-title',
    posture: 'guide',
    steps: [
      step('word-1', 'Select the title', 'Drag over the title text.', 'done'),
      step('word-2', 'Click Bold', 'Click Bold to embolden it.', 'active'),
      step('word-3', 'Save', 'Save the document.', 'pending'),
    ],
    activeIndex: 1,
    softBlock: true,
    paused: false,
    blockedAttempts: 0,
    ...over,
  },
});

describe('serializeTeachingState', () => {
  it('returns null when no sequence is active', () => {
    expect(serializeTeachingState(initialTeachingState(), entities)).toBeNull();
  });

  it('returns null when the sequence has no active step', () => {
    expect(serializeTeachingState(seqState({ activeIndex: null }), entities)).toBeNull();
  });

  it('serializes posture, progress, active step, completed, blocked, fade, paused', () => {
    const s = serializeTeachingState(seqState(), entities)!;
    expect(s).toContain('Guiding "Make the title bold"');
    expect(s).toContain('step 2 of 3');
    expect(s).toContain('Click Bold');
    expect(s).toContain('Click Bold to embolden it.');
    expect(s).toContain('target: Bold button');
    expect(s).toContain('Completed: Title text');
    expect(s).toContain('Blocked (soft): Title text, Save button');
    expect(s).toContain('Fade level: 0');
    expect(s).toContain('Paused: no');
    expect(s.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });

  it('uses "Teaching" for the teach posture', () => {
    expect(serializeTeachingState(seqState({ posture: 'teach' }), entities)).toContain('Teaching "Make the title bold"');
  });

  it('reports paused and empties the blocked set when paused', () => {
    const s = serializeTeachingState(seqState({ paused: true }), entities)!;
    expect(s).toContain('Paused: yes');
    expect(s).toContain('Blocked (soft): none');
  });

  it('falls back to the raw id (never blank) when an entity is missing, without throwing', () => {
    const s = serializeTeachingState(seqState(), [])!;
    expect(s).toContain('target: word-2');
    expect(s).not.toContain('target: )'); // guards against a blank name before the closing paren
  });
});

describe('makeChangeGate', () => {
  it('sends once per change, resets on null, never sends null', () => {
    const gate = makeChangeGate();
    expect(gate('A')).toBe(true);   // first non-null → send
    expect(gate('A')).toBe(false);  // unchanged → skip
    expect(gate('B')).toBe(true);   // changed → send
    expect(gate(null)).toBe(false); // null → never sent, resets
    expect(gate('B')).toBe(true);   // re-sends after reset
  });
});
