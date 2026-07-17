import { describe, it, expect } from 'vitest';
import { SCRIPTED_DEMO } from './scriptedDemo';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { recentSlots } from './selectors';

describe('scripted demo', () => {
  it('drives the store to the expected recap state', () => {
    let st = initialSessionState(RFI_SCHEMA, '6/29/2026', 0);
    let now = 0;
    for (const ev of SCRIPTED_DEMO) { now += 100; st = reduce(st, ev, now); }

    expect(st.phase).toBe('conversing');
    const byId = (id: string) => st.fills.find(f => f.slotId === id)!;
    expect(byId('question').status).toBe('draft');
    expect(byId('location').value).toBe('C-3');
    expect(byId('drawingRef').source).toBe('inferred');      // will show a ✓? marker
    expect(byId('neededBy').status).toBe('needsInput');
    expect(byId('dateSubmitted').source).toBe('inferred');   // seeded inferred
    // recency excludes empty slots and is newest-first
    expect(recentSlots(st, 2).every(s => s.status !== 'empty')).toBe(true);
  });
});
