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
