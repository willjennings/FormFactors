import { describe, it, expect } from 'vitest';
import { appendEntry, replay, compact, type JournalRegistry, type StoreSpec } from './journal';
import { JOURNAL_REGISTRY } from './registry';

// A tiny counter store — enough to prove the journal folds through reducers it does not know.
type CounterEvent = { type: 'add'; n: number } | { type: 'counter.restore'; value: number };
const counter: StoreSpec<number, CounterEvent> = {
  initial: () => 0,
  reduce: (s, e) => (e.type === 'add' ? s + e.n : e.value),
  snapshotEvent: (s) => ({ type: 'counter.restore', value: s }),
};
const registry: JournalRegistry = { counter };

describe('appendEntry', () => {
  it('appends with a monotonic 1-based seq and never mutates the input', () => {
    const a = appendEntry([], 'counter', { type: 'add', n: 1 }, 1000);
    const b = appendEntry(a, 'counter', { type: 'add', n: 2 }, 2000, 'second');
    expect(a).toHaveLength(1);
    expect(b.map((e) => e.seq)).toEqual([1, 2]);
    expect(b[1]).toEqual({ seq: 2, t: 2000, store: 'counter', event: { type: 'add', n: 2 }, label: 'second' });
  });
});

describe('replay', () => {
  it('folds each entry through its store reducer', () => {
    let j = appendEntry([], 'counter', { type: 'add', n: 2 }, 1);
    j = appendEntry(j, 'counter', { type: 'add', n: 3 }, 2);
    expect(replay(j, registry)).toEqual({ counter: 5 });
  });
  it('an empty journal yields every store initial', () => {
    expect(replay([], registry)).toEqual({ counter: 0 });
  });
  it('SKIPS unknown store keys — a newer build\'s journal must not brick this one', () => {
    let j = appendEntry([], 'counter', { type: 'add', n: 2 }, 1);
    j = appendEntry(j, 'mystery', { type: 'whatever' }, 2);
    expect(replay(j, registry)).toEqual({ counter: 2 });
  });
});

describe('compact', () => {
  // Build a real artifact history: create → revise → close → create, plus a doc edit.
  const seed = () => {
    let j: ReturnType<typeof appendEntry> = [];
    j = appendEntry(j, 'artifacts', { type: 'artifact.create', artifact: { kind: 'doc', title: 'One', sources: ['word'], content: 'alpha', createdAt: 1 } }, 1);
    j = appendEntry(j, 'artifacts', { type: 'artifact.revise', id: 'a1', baseRev: 1, patch: { op: 'replace-part', index: 1, text: 'beta' }, owner: 'agent', at: 2 }, 2);
    j = appendEntry(j, 'artifacts', { type: 'artifact.close', id: 'a1' }, 3);
    j = appendEntry(j, 'artifacts', { type: 'artifact.create', artifact: { kind: 'doc', title: 'Two', sources: ['word'], content: 'gamma', createdAt: 4 } }, 4);
    j = appendEntry(j, 'workspace', { type: 'program.set', program: 'excel' }, 5);
    return j;
  };

  it('is a no-op under the cap', () => {
    const j = seed();
    expect(compact(j, JOURNAL_REGISTRY, 100)).toBe(j);
  });

  it('post-compact replay equals pre-compact replay — the definition of correct', () => {
    const j = seed();
    const c = compact(j, JOURNAL_REGISTRY, 2);
    expect(replay(c, JOURNAL_REGISTRY)).toEqual(replay(j, JOURNAL_REGISTRY));
  });

  it('compacts to one snapshot entry per store, seq restarting, labelled', () => {
    const c = compact(seed(), JOURNAL_REGISTRY, 2);
    expect(c).toHaveLength(Object.keys(JOURNAL_REGISTRY).length);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]); // one seq per registry store (now five, Task 4)
    expect(c.every((e) => e.label?.includes('compacted'))).toBe(true);
  });

  it('t carries over from the LAST pre-compact entry — compaction invents no clock reads', () => {
    const c = compact(seed(), JOURNAL_REGISTRY, 2);
    expect(c.every((e) => e.t === 5)).toBe(true);
  });

  it('nextId survives compaction — artifact ids are NEVER reused', () => {
    const j = seed();                              // a1 created+closed, a2 live → nextId 3
    const c = compact(j, JOURNAL_REGISTRY, 2);
    const after = JOURNAL_REGISTRY.artifacts.reduce(
      (replay(c, JOURNAL_REGISTRY) as any).artifacts,
      { type: 'artifact.create', artifact: { kind: 'doc', title: 'Three', sources: ['word'], content: 'x', createdAt: 9 } },
    );
    expect(after.artifacts.map((a: any) => a.id)).toContain('a3'); // not a recycled a1
  });

  it('artifact rev history rides INSIDE the snapshot — lossless for artifacts', () => {
    const j = seed();
    const before = (replay(j, JOURNAL_REGISTRY) as any).artifacts;
    const after = (replay(compact(j, JOURNAL_REGISTRY, 2), JOURNAL_REGISTRY) as any).artifacts;
    expect(after).toEqual(before);
  });
});
