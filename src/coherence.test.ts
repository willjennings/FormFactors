import { describe, it, expect } from 'vitest';
import { CallDeduper, argsKey, dedupeKeyFor } from './coherence';

// G9 ruling (2026-07-15): teach_step_done is zero-arg, so a constant key made the
// deduper swallow LEGITIMATE consecutive advances (catch-up bursts) and ack them
// success:true — a belief/screen divergence. The key now carries the active step:
// distinct steps never collide; a true replay of the SAME step still dedupes.
describe('dedupeKeyFor', () => {
  it('keys teach_step_done on the active step index so consecutive advances do not collide', () => {
    const k0 = dedupeKeyFor('teach_step_done', {}, 0);
    const k1 = dedupeKeyFor('teach_step_done', {}, 1);
    expect(k0).not.toBe(k1);
  });

  it('a replay of the SAME step advance still collides (G9 protection kept)', () => {
    expect(dedupeKeyFor('teach_step_done', {}, 2)).toBe(dedupeKeyFor('teach_step_done', {}, 2));
    const d = new CallDeduper();
    expect(d.seen('teach_step_done', dedupeKeyFor('teach_step_done', {}, 0), 1000)).toBe(false);
    expect(d.seen('teach_step_done', dedupeKeyFor('teach_step_done', {}, 0), 1400)).toBe(true);  // replay: suppressed
    expect(d.seen('teach_step_done', dedupeKeyFor('teach_step_done', {}, 1), 1800)).toBe(false); // next step: passes
  });

  it('no active sequence (null index) keys consistently — no-op repeats still dedupe', () => {
    expect(dedupeKeyFor('teach_step_done', {}, null)).toBe(dedupeKeyFor('teach_step_done', {}, null));
    expect(dedupeKeyFor('teach_step_done', {}, null)).not.toBe(dedupeKeyFor('teach_step_done', {}, 0));
  });

  it('every other tool keeps its plain argsKey regardless of teaching state', () => {
    const args = { target: 'Save button' };
    expect(dedupeKeyFor('teach_highlight', args, 3)).toBe(argsKey(args));
    expect(dedupeKeyFor('tap', args, null)).toBe(argsKey(args));
  });
});

// A REJECTED call was never executed — deduping its retry as {success:true} is a lie
// (watched live: teach_sequence and wb_beautify retry loops after honest errors).
describe('CallDeduper.forget', () => {
  it('a forgotten call is not a duplicate — the retry gets re-processed (and re-errored honestly)', () => {
    const d = new CallDeduper();
    const key = argsKey({ target: '' });
    expect(d.seen('teach_sequence', key, 1000)).toBe(false);
    d.forget('teach_sequence', key);                       // the call was rejected
    expect(d.seen('teach_sequence', key, 1200)).toBe(false); // retry within the window: NOT deduped
    expect(d.seen('teach_sequence', key, 1400)).toBe(true);  // an actual replay of the retry still dedupes
  });
  it('forget is scoped to one (name, argsKey) — other entries keep their protection', () => {
    const d = new CallDeduper();
    d.seen('tap', argsKey({ id: 'a' }), 1000);
    d.seen('tap', argsKey({ id: 'b' }), 1000);
    d.forget('tap', argsKey({ id: 'a' }));
    expect(d.seen('tap', argsKey({ id: 'a' }), 1200)).toBe(false);
    expect(d.seen('tap', argsKey({ id: 'b' }), 1200)).toBe(true);
  });
});
