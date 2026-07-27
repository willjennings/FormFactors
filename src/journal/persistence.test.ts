import { describe, it, expect } from 'vitest';
import { loadJournal, saveJournal, clearJournal, JOURNAL_KEY, QUARANTINE_KEY } from './persistence';
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
  it('a wrong version is a failed load (v1 has no migrations)', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 99, entries: [] }));
    const r = loadJournal(s);
    expect('failed' in r && r.failed).toMatch(/version/i);
  });
  it('a shape violation is a failed load, not a crash', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 1, entries: [{ nope: true }] }));
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
});
