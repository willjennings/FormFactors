import { describe, it, expect } from 'vitest';
import { SHELL_SKINS, SKIN_KEYS, resolveSkin, describeRung } from './registry';
import type { ArmAggregate } from '../../eval/armAggregate';
import { UNDERPOWERED_N } from '../../eval/armAggregate';

/** Same fixture-building approach as register/registry.test.ts: `winsWhen` consumes an
 *  `ArmAggregate` directly, so tests build one by hand rather than routing through
 *  `deriveAttempts` + `armAggregate`. */
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

describe('skins registry', () => {
  it('ships exactly familiar/material/provenance/conversation, each with a label/glyph/ethos/probe', () => {
    expect(SHELL_SKINS.map(s => s.key)).toEqual(['familiar', 'material', 'provenance', 'conversation']);
    for (const s of SHELL_SKINS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.glyph.length).toBeGreaterThan(0);
      expect(s.ethos.length).toBeGreaterThan(0);
      expect(s.probe.length).toBeGreaterThan(0);
    }
  });

  it('all four keys are unique', () => {
    expect(new Set(SKIN_KEYS).size).toBe(SKIN_KEYS.length);
  });

  it('every skin declares an assumesRung', () => {
    for (const s of SHELL_SKINS) {
      expect(['none', 'R2', 'R4']).toContain(s.assumesRung);
    }
  });

  it('MINIMIZE-INTO-NOWHERE GUARD: any skin with bottomBar: none has restoreVia: column', () => {
    // Iterated over the registry (not asserted by index) so a fifth skin is covered
    // the moment it arrives, instead of slipping through unminimizable.
    for (const s of SHELL_SKINS) {
      if (s.slots.bottomBar === 'none') {
        expect(s.slots.restoreVia).toBe('column');
      }
    }
  });

  it('resolveSkin("familiar") returns the familiar def', () => {
    expect(resolveSkin('familiar')).toEqual(SHELL_SKINS.find(s => s.key === 'familiar'));
  });

  it('resolveSkin returns null for an unknown key — no silent fallback to the first skin', () => {
    expect(resolveSkin('windows95')).toBeNull();
  });
});

describe('describeRung', () => {
  it('never prints the bare token', () => {
    expect(describeRung('none')).not.toBe('none');
    expect(describeRung('R2')).not.toBe('R2');
    expect(describeRung('R4')).not.toBe('R4');
  });

  it('"none" reads as no prior learning presumed', () => {
    expect(describeRung('none').toLowerCase()).toContain('no prior learning');
  });

  it('R2 and R4 each name the belief the ladder rung stands for (spec §0b)', () => {
    // §0b: R2 = "It acts visibly, and I can undo"; R4 = "What it makes is material I keep".
    expect(describeRung('R2').toLowerCase()).toContain('undo');
    expect(describeRung('R4').toLowerCase()).toContain('material');
  });

  it('every registered skin\'s assumesRung renders distinct, non-empty prose — one string per ' +
     'distinct rung, not a coincidental collision between two different rungs\' sentences', () => {
    const distinctRungs = new Set(SHELL_SKINS.map(s => s.assumesRung)).size;
    const rendered = new Set(SHELL_SKINS.map(s => describeRung(s.assumesRung)));
    expect(rendered.size).toBe(distinctRungs);
    for (const text of rendered) expect(text.length).toBeGreaterThan(0);
  });
});

describe('winsWhen', () => {
  const withWinsWhen = SHELL_SKINS.filter(s => s.winsWhen);

  it('every skin declares winsWhen (all four probes have SOME machine-checkable translation)', () => {
    expect(withWinsWhen.map(s => s.key)).toEqual(['familiar', 'material', 'provenance', 'conversation']);
  });

  it('every skin with winsWhen returns underpowered — BY NAME — when either side is below ' +
     'threshold, iterated so a fifth entry is covered on arrival', () => {
    const strong = mkAgg(UNDERPOWERED_N, { medianDurationMs: 100, corrected: 0.2, completion: 0.5 });
    const weak = mkAgg(UNDERPOWERED_N - 1, { medianDurationMs: 100, corrected: 0.2, completion: 0.5 });
    for (const s of withWinsWhen) {
      const armWeak = s.winsWhen!(weak, strong);
      expect(armWeak.verdict).toBe('underpowered');
      expect(armWeak.because).toContain(`arm n=${UNDERPOWERED_N - 1}`);

      const controlWeak = s.winsWhen!(strong, weak);
      expect(controlWeak.verdict).toBe('underpowered');
      expect(controlWeak.because).toContain(`control n=${UNDERPOWERED_N - 1}`);
    }
  });

  it('no predicate throws on a zero-n aggregate, and reports it underpowered', () => {
    const zero = mkAgg(0);
    for (const s of withWinsWhen) {
      expect(() => s.winsWhen!(zero, zero)).not.toThrow();
      expect(s.winsWhen!(zero, zero).verdict).toBe('underpowered');
    }
  });

  it('familiar never returns met — "legible" is unmeasured, only "fastest" is checked', () => {
    const familiar = SHELL_SKINS.find(s => s.key === 'familiar')!;
    const control = mkAgg(20, { medianDurationMs: 1000 });
    const arm = mkAgg(20, { medianDurationMs: 100 }); // decisively faster; still not-met
    const v = familiar.winsWhen!(arm, control);
    expect(v.verdict).toBe('not-met');
    expect(v.because).toContain('100');
    expect(v.because).toContain('1000');
    expect(v.because.toLowerCase()).toContain('legible');
  });

  it('material never returns met — nothing in ArmAggregate maps to "what people make"', () => {
    const material = SHELL_SKINS.find(s => s.key === 'material')!;
    const control = mkAgg(20, { completion: 0.2 });
    const arm = mkAgg(20, { completion: 0.9 });
    const v = material.winsWhen!(arm, control);
    expect(v.verdict).toBe('not-met');
    expect(v.because).toContain('n=20');
    expect(v.because.toLowerCase()).toContain('what people make');
  });

  it('provenance never returns met — "correction rate" is checked, "trust" is named as unmeasured', () => {
    const provenance = SHELL_SKINS.find(s => s.key === 'provenance')!;
    const control = mkAgg(20, { corrected: 0.30 });
    const arm = mkAgg(20, { corrected: 0.10 });
    const v = provenance.winsWhen!(arm, control);
    expect(v.verdict).toBe('not-met');
    expect(v.because).toContain('0.10');
    expect(v.because).toContain('0.30');
    expect(v.because.toLowerCase()).toContain('trust');
  });

  it('conversation never returns met — nothing in ArmAggregate maps to "pointing"', () => {
    const conversation = SHELL_SKINS.find(s => s.key === 'conversation')!;
    const control = mkAgg(20, { completion: 0.5 });
    const arm = mkAgg(20, { completion: 0.5 });
    const v = conversation.winsWhen!(arm, control);
    expect(v.verdict).toBe('not-met');
    expect(v.because.toLowerCase()).toContain('pointing');
  });
});
