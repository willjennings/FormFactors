import { describe, it, expect } from 'vitest';
import { DEFAULT_DIALS, REGISTERS, resolveDials, matchRegister, diffDials, registerSection } from './registry';
import type { ArmAggregate } from '../eval/armAggregate';
import { UNDERPOWERED_N } from '../eval/armAggregate';

/** Hand-build an `ArmAggregate` for `winsWhen` tests without routing through `deriveAttempts` +
 *  `armAggregate` — the predicates under test consume the aggregate shape directly, so fixtures
 *  are built at that level. Every rate shares `n` (the anti-flattery single-denominator rule,
 *  armAggregate.ts's own header) unless a test overrides a field's `n` directly afterward. */
function mkAgg(n: number, opts: Partial<{
  completion: number; corrected: number; wrong: number; refusal: number; ask: number;
  abandoned: number; ungradeable: number; medianTurns: number | null; medianDurationMs: number | null;
}> = {}): ArmAggregate {
  const rate = (v = 0) => ({ value: v, n, count: Math.round(v * n) });
  return {
    n,
    completion: rate(opts.completion),
    corrected: rate(opts.corrected),
    wrong: rate(opts.wrong),
    refusal: rate(opts.refusal),
    ask: rate(opts.ask),
    abandoned: rate(opts.abandoned),
    ungradeable: rate(opts.ungradeable),
    medianTurns: { value: opts.medianTurns ?? null, n },
    medianDurationMs: { value: opts.medianDurationMs ?? null, n },
  };
}

describe('registry', () => {
  it('ships exactly terminal/ambient/guided/cockpit in minimal→maximal order', () => {
    expect(REGISTERS.map(r => r.key)).toEqual(['terminal', 'ambient', 'guided', 'cockpit']);
    for (const r of REGISTERS) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.glyph.length).toBeGreaterThan(0);
      expect(r.ethos.length).toBeGreaterThan(0);
      expect(r.probe.length).toBeGreaterThan(0);
    }
  });

  it('CONTROL-ARM INVARIANT: guided === today\'s defaults verbatim (incl. honest:false)', () => {
    expect(resolveDials('guided')).toEqual(DEFAULT_DIALS);
    expect(DEFAULT_DIALS.honest).toBe(false);
    expect(DEFAULT_DIALS).toEqual({
      honest: false, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
      markings: false, chipDensity: 'full', traceView: 'ticker', teaching: 'normal', proactivity: 'on-goal',
    });
  });

  it('the three non-control registers pin honest:true and match the spec table', () => {
    expect(resolveDials('terminal')).toEqual({
      honest: true, autonomy: 'autonomous', feedback: 'silent', confirmGoals: false,
      markings: false, chipDensity: 'none', traceView: 'ticker', teaching: 'off', proactivity: 'never',
    });
    expect(resolveDials('ambient')).toEqual({
      honest: true, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
      markings: false, chipDensity: 'grounded', traceView: 'hidden', teaching: 'off', proactivity: 'never',
    });
    expect(resolveDials('cockpit')).toEqual({
      honest: true, autonomy: 'manual', feedback: 'speech', confirmGoals: true,
      markings: true, chipDensity: 'full', traceView: 'ledger', teaching: 'eager', proactivity: 'idle-offer',
    });
  });

  it('resolveDials returns a fresh copy (mutation cannot corrupt the registry)', () => {
    const a = resolveDials('guided');
    a.honest = true;
    expect(resolveDials('guided').honest).toBe(false);
  });

  it('resolveDials throws on unknown key', () => {
    expect(() => resolveDials('vim')).toThrow(/unknown register/);
  });

  it('matchRegister round-trips every register and returns null on any twiddle', () => {
    for (const r of REGISTERS) expect(matchRegister(resolveDials(r.key))).toBe(r.key);
    expect(matchRegister({ ...resolveDials('guided'), markings: true })).toBeNull();
  });

  it('diffDials lists exactly the changed dials with readable values', () => {
    const d = diffDials(resolveDials('guided'), resolveDials('terminal'));
    const byDial = Object.fromEntries(d.map(x => [x.dial, x]));
    expect(byDial.chipDensity).toEqual({ dial: 'chipDensity', from: 'full', to: 'none' });
    expect(byDial.honest).toEqual({ dial: 'honest', from: 'off', to: 'on' });
    expect(byDial.feedback).toEqual({ dial: 'feedback', from: 'earcon', to: 'silent' });
    expect(diffDials(resolveDials('guided'), resolveDials('guided'))).toEqual([]);
  });

  it('registerSection derives the paragraph from dials, not canned prose', () => {
    const t = registerSection('terminal', resolveDials('terminal'));
    expect(t).toContain('REGISTER: Terminal');
    expect(t).toMatch(/no suggestion chips/i);          // chipDensity none
    expect(t).toMatch(/confirms silently/i);            // feedback silent
    expect(t).toMatch(/never offer (a )?walkthrough/i); // teaching off
    expect(t).toMatch(/act or answer/i);
    const g = registerSection('guided', resolveDials('guided'));
    expect(g).toContain('REGISTER: Guided');
    expect(g).not.toMatch(/no suggestion chips/i);
    const c = registerSection(null, { ...resolveDials('guided'), teaching: 'eager' });
    expect(c).toContain('REGISTER: Custom');            // null key → Custom, still coherent
    expect(c).toMatch(/offer (a )?walkthrough/i);       // teaching eager
  });
});

describe('winsWhen', () => {
  const withWinsWhen = REGISTERS.filter(r => r.winsWhen);

  it('ships winsWhen on terminal/ambient/cockpit, and NOT on guided (the control arm)', () => {
    expect(withWinsWhen.map(r => r.key)).toEqual(['terminal', 'ambient', 'cockpit']);
    expect(REGISTERS.find(r => r.key === 'guided')!.winsWhen).toBeUndefined();
  });

  it('every register with winsWhen returns underpowered — BY NAME — when either side is below ' +
     'threshold, iterated so a fifth entry is covered on arrival', () => {
    const strong = mkAgg(UNDERPOWERED_N, { medianDurationMs: 100, medianTurns: 3, completion: 0.5 });
    const weak = mkAgg(UNDERPOWERED_N - 1, { medianDurationMs: 100, medianTurns: 3, completion: 0.5 });
    for (const r of withWinsWhen) {
      const armWeak = r.winsWhen!(weak, strong);
      expect(armWeak.verdict).toBe('underpowered');
      expect(armWeak.because).toContain(`arm n=${UNDERPOWERED_N - 1}`);

      const controlWeak = r.winsWhen!(strong, weak);
      expect(controlWeak.verdict).toBe('underpowered');
      expect(controlWeak.because).toContain(`control n=${UNDERPOWERED_N - 1}`);

      const bothWeak = r.winsWhen!(weak, weak);
      expect(bothWeak.verdict).toBe('underpowered');
      expect(bothWeak.because).toContain('arm n=');
      expect(bothWeak.because).toContain('control n=');
    }
  });

  it('no predicate throws on a zero-n aggregate, and reports it underpowered', () => {
    const zero = mkAgg(0);
    for (const r of withWinsWhen) {
      expect(() => r.winsWhen!(zero, zero)).not.toThrow();
      expect(r.winsWhen!(zero, zero).verdict).toBe('underpowered');
    }
  });

  describe('terminal — "lowest mission time WITHOUT correction/error spikes"', () => {
    const terminal = REGISTERS.find(r => r.key === 'terminal')!;

    it('met: faster, wrong no worse, corrections not spiking', () => {
      const control = mkAgg(20, { medianDurationMs: 1000, wrong: 0.10, corrected: 0.20 });
      const arm = mkAgg(20, { medianDurationMs: 500, wrong: 0.05, corrected: 0.20 });
      const v = terminal.winsWhen!(arm, control);
      expect(v.verdict).toBe('met');
      expect(v.because).toContain('500');
      expect(v.because).toContain('1000');
    });

    it('not-met: duration IS lower, but corrections spike past the 1.5x threshold', () => {
      const control = mkAgg(20, { medianDurationMs: 1000, wrong: 0.10, corrected: 0.10 });
      const arm = mkAgg(20, { medianDurationMs: 500, wrong: 0.05, corrected: 0.50 }); // 0.50 > 0.10*1.5
      const v = terminal.winsWhen!(arm, control);
      expect(v.verdict).toBe('not-met');
      expect(v.because).toContain('0.50');
      expect(v.because).toContain('0.15'); // control.corrected * 1.5, printed in the because
    });

    it('underpowered: reported by name, not folded into not-met', () => {
      const control = mkAgg(20, { medianDurationMs: 1000 });
      const arm = mkAgg(UNDERPOWERED_N - 1, { medianDurationMs: 500 });
      const v = terminal.winsWhen!(arm, control);
      expect(v.verdict).toBe('underpowered');
      expect(v.because).toContain(`arm n=${UNDERPOWERED_N - 1}`);
    });

    it('not-met when duration is unmeasured (null median) on either side', () => {
      const control = mkAgg(20, { medianDurationMs: null });
      const arm = mkAgg(20, { medianDurationMs: 500 });
      const v = terminal.winsWhen!(arm, control);
      expect(v.verdict).toBe('not-met');
      expect(v.because).toContain('unmeasured');
    });
  });

  describe('ambient — "Guided-equal completions with fewer interactions/stalls"', () => {
    const ambient = REGISTERS.find(r => r.key === 'ambient')!;

    it('met: completion within epsilon, fewer median turns', () => {
      const control = mkAgg(20, { completion: 0.60, medianTurns: 5 });
      const arm = mkAgg(20, { completion: 0.58, medianTurns: 3 });
      const v = ambient.winsWhen!(arm, control);
      expect(v.verdict).toBe('met');
      expect(v.because).toContain('0.58');
      expect(v.because).toContain('0.60');
      expect(v.because).toContain('5');
      expect(v.because).toContain('3');
    });

    it('not-met: completion drops too far below control', () => {
      const control = mkAgg(20, { completion: 0.60, medianTurns: 5 });
      const arm = mkAgg(20, { completion: 0.40, medianTurns: 3 });
      const v = ambient.winsWhen!(arm, control);
      expect(v.verdict).toBe('not-met');
    });
  });

  describe('cockpit — "run-0 completion + run-1 unaided beats Guided" (transfer is unmeasurable)', () => {
    const cockpit = REGISTERS.find(r => r.key === 'cockpit')!;

    it('never returns met — the transfer half cannot be checked from one ArmAggregate', () => {
      const control = mkAgg(20, { completion: 0.30 });
      const arm = mkAgg(20, { completion: 0.90 }); // even a lopsided completion win stays not-met
      const v = cockpit.winsWhen!(arm, control);
      expect(v.verdict).toBe('not-met');
      expect(v.because).toContain('0.90');
      expect(v.because).toContain('0.30');
      expect(v.because.toLowerCase()).toContain('run-1 unaided');
    });
  });
});
