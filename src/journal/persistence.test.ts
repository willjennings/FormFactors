import { describe, it, expect } from 'vitest';
import { loadJournal, saveJournal, clearJournal, JOURNAL_KEY, QUARANTINE_KEY, JOURNAL_VERSION } from './persistence';
import { appendEntry } from './journal';

const fake = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    _m: m,
  };
};

const stubStorageWith = (payload: unknown) => {
  const s = fake();
  s.setItem(JOURNAL_KEY, JSON.stringify(payload));
  return s;
};

const fakeWithOps = () => {
  const m = new Map<string, string>();
  const ops: Array<{ op: 'setItem' | 'removeItem'; key: string }> = [];
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      ops.push({ op: 'setItem', key: k });
      m.set(k, v);
    },
    removeItem: (k: string) => {
      ops.push({ op: 'removeItem', key: k });
      m.delete(k);
    },
    _m: m,
    _ops: ops,
  };
};

describe('journal persistence', () => {
  const entries = appendEntry([], 'dials', { type: 'dials.set', dials: {}, registerKey: null }, 1000);

  it('round-trips', () => {
    const s = fake();
    expect(saveJournal(entries, s)).toBe(true);
    expect(loadJournal(s)).toEqual({ ok: entries });
  });
  it('first run is EMPTY, not failed — silence is correct only when there was nothing', () => {
    expect(loadJournal(fake())).toEqual({ empty: true });
  });
  it('corrupt JSON fails VISIBLY and quarantines the payload', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, '{not json');
    const r = loadJournal(s);
    expect('failed' in r && r.failed.length > 0).toBe(true);
    expect(s.getItem(QUARANTINE_KEY)).toBe('{not json');
    expect(s.getItem(JOURNAL_KEY)).toBeNull(); // cleared so the next boot is a clean first run
  });
  it('a wrong version is a failed load (no migrations)', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 99, entries: [] }));
    const r = loadJournal(s);
    expect('failed' in r && r.failed).toMatch(/version/i);
  });
  it('a v1 payload is REJECTED, not half-restored — v2 added the desk store (Task 4)', () => {
    // The version gate must discriminate on the actual number, not just "is it wrong": a v1
    // payload was once valid, and a bug that only checked truthiness of `parsed.v` would let it
    // through and leave the desk at initial() while everything else restored.
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 1, entries: [] }));
    const r = loadJournal(s);
    expect('failed' in r && r.failed).toBe('unsupported version 1');
    expect(JOURNAL_VERSION).toBe(3);
  });

  it('JOURNAL_VERSION is 3 — placed changed a persisted shape', () => {
    expect(JOURNAL_VERSION).toBe(3);
  });

  it('a v2 payload is REJECTED, not half-restored', () => {
    const r = loadJournal(stubStorageWith({ v: 2, entries: [] }));
    expect('failed' in r && r.failed).toBe('unsupported version 2');
  });
  it('a shape violation is a failed load, not a crash', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, entries: [{ nope: true }] }));
    expect('failed' in loadJournal(s)).toBe(true);
  });
  it('a throwing storage fails soft on save', () => {
    const s = { ...fake(), setItem: () => { throw new Error('quota'); } };
    expect(saveJournal(entries, s as any)).toBe(false);
  });
  it('clearJournal removes journal AND quarantine', () => {
    const s = fake();
    saveJournal(entries, s);
    s.setItem(QUARANTINE_KEY, 'old');
    clearJournal(s);
    expect(s.getItem(JOURNAL_KEY)).toBeNull();
    expect(s.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('a throwing getItem is NOT silent — returns failed, not empty', () => {
    const s = { ...fake(), getItem: () => { throw new Error('access denied'); } };
    const r = loadJournal(s as any);
    expect('failed' in r && r.failed).toMatch(/inaccessible/i);
  });

  it('quarantine PRECEDES journal removal (order matters for evidence survival)', () => {
    const s = fakeWithOps();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, entries: [{ nope: true }] }));
    loadJournal(s);
    // Find the indices of quarantine setItem and journal removeItem
    const quarantineSetIdx = s._ops.findIndex(op => op.op === 'setItem' && op.key === QUARANTINE_KEY);
    const journalRemoveIdx = s._ops.findIndex(op => op.op === 'removeItem' && op.key === JOURNAL_KEY);
    expect(quarantineSetIdx >= 0).toBe(true); // quarantine setItem happened
    expect(journalRemoveIdx >= 0).toBe(true); // journal removeItem happened
    expect(quarantineSetIdx < journalRemoveIdx).toBe(true); // setItem before removeItem
  });

  it('if quarantine setItem throws, journal removeItem still runs', () => {
    const base = fakeWithOps();
    const s = {
      ...base,
      setItem: (k: string, v: string) => {
        if (k === QUARANTINE_KEY) throw new Error('quota');
        base.setItem(k, v);
      },
    };
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, entries: [{ nope: true }] }));
    const r = loadJournal(s as any);
    expect('failed' in r).toBe(true); // load fails as expected
    expect(s.getItem(JOURNAL_KEY)).toBeNull(); // journal is removed despite quarantine throw
  });

  it('no-args loadJournal (default storage) returns {empty: true} when storage unavailable', () => {
    const r = loadJournal();
    expect(r).toEqual({ empty: true });
  });

  it('no-args saveJournal (default storage) returns false when storage unavailable', () => {
    const r = saveJournal(entries);
    expect(r).toBe(false);
  });

  it('no-args clearJournal (default storage) does not throw', () => {
    expect(() => clearJournal()).not.toThrow();
  });

  it('clearJournal with throwing first removeItem still removes quarantine', () => {
    const base = fakeWithOps();
    const s = {
      ...base,
      removeItem: (k: string) => {
        if (k === JOURNAL_KEY) throw new Error('locked');
        base.removeItem(k);
      },
    };
    s.setItem(JOURNAL_KEY, 'data');
    s.setItem(QUARANTINE_KEY, 'old');
    clearJournal(s as any);
    // Despite the throw on JOURNAL_KEY removal, QUARANTINE_KEY should be removed
    expect(s.getItem(QUARANTINE_KEY)).toBeNull();
  });
});
