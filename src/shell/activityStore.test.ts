import { describe, it, expect } from 'vitest';
import { reduceActivity, initialActivity, visibleActivity, type ActivityEntry } from './activityStore';

const e = (over: Partial<ActivityEntry>): ActivityEntry => ({
  kind: 'call', text: 'save_file (Save button)', at: 1000, ...over,
});

describe('activityStore — the transparency trace (audit 2026-07-18 G1/G2)', () => {
  it('appends entries newest-last and caps history at 20', () => {
    let s = initialActivity();
    for (let i = 0; i < 25; i++) s = reduceActivity(s, e({ at: i, text: `t${i}` }));
    expect(s.entries).toHaveLength(20);
    expect(s.entries[19].text).toBe('t24');
    expect(s.entries[0].text).toBe('t5');
  });
  it('coalesces an outcome onto its pending call (call → done updates in place)', () => {
    let s = initialActivity();
    s = reduceActivity(s, e({ kind: 'call', callId: 'c1', text: 'save_file (Save button)', at: 1 }));
    s = reduceActivity(s, e({ kind: 'done', callId: 'c1', text: 'Saved', at: 2 }));
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].kind).toBe('done');
    expect(s.entries[0].text).toBe('Saved');
  });
  it('a rejection coalesces the same way and reads as a rejection', () => {
    let s = initialActivity();
    s = reduceActivity(s, e({ kind: 'call', callId: 'c2', text: 'annotate_arrow (…)', at: 1 }));
    s = reduceActivity(s, e({ kind: 'error', callId: 'c2', text: 'unknown target "Sve" — model informed', at: 2 }));
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].kind).toBe('error');
  });
  it('outcomes without a matching pending call append (direct commits, feedback events)', () => {
    let s = initialActivity();
    s = reduceActivity(s, e({ kind: 'done', callId: 'nope', text: 'Saved', at: 2 }));
    expect(s.entries).toHaveLength(1);
  });
  it('visibleActivity shows at most 4, newest last, none older than the fade window', () => {
    let s = initialActivity();
    for (let i = 0; i < 6; i++) s = reduceActivity(s, e({ at: i * 1000, text: `t${i}`, kind: 'ask' }));
    const vis = visibleActivity(s, 5000 + 7000); // now = last entry + fade window exactly
    expect(vis.length).toBeLessThanOrEqual(4);
    expect(vis[vis.length - 1].text).toBe('t5');
    expect(visibleActivity(s, 5000 + 7001)).toHaveLength(0); // everything faded
  });
});
