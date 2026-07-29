import { describe, it, expect } from 'vitest';
import { SHELL_SKINS, SKIN_KEYS, resolveSkin } from './registry';

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
