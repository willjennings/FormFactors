import { describe, it, expect } from 'vitest';
import { DEFAULT_DIALS, REGISTERS, resolveDials, matchRegister, diffDials, registerSection } from './registry';

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
