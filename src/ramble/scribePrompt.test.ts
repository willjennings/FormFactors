import { describe, it, expect } from 'vitest';
import { buildScribeInstructions } from './scribePrompt';
import { RFI_SCHEMA } from './rfiSchema';

describe('buildScribeInstructions', () => {
  const s = buildScribeInstructions(RFI_SCHEMA, '7/15/2026');
  it('names every slot id and marks the required ones', () => {
    for (const slot of RFI_SCHEMA.slots) expect(s).toContain(slot.id);
    expect(s).toMatch(/REQUIRED/);
    expect(s).toContain('Architectural|Structural|Mechanical|Electrical');
  });
  it('carries the §6.1 prompt discipline', () => {
    expect(s).toMatch(/asides|thinking.?aloud/i);          // content-vs-chatter
    expect(s).toMatch(/ONE gap question at a time/i);      // gap-driven, singly
    expect(s).toMatch(/read.?back/i);                      // read-back is dialogue
    expect(s).toMatch(/recap.*before.*submit/is);          // mandatory recap
    expect(s).toMatch(/inferred/);                         // flags inferred at recap
    expect(s).toContain('7/15/2026');                      // seeded dateSubmitted context
  });
  it('carries the yield rule and the no-progress-narration rule', () => {
    expect(s).toMatch(/system tells you/i);
    expect(s).toMatch(/user is editing or has edited.*never (change|fill|overwrite)/is);
    expect(s).toMatch(/do not narrate progress|no progress/i);
  });
  it('appends the fence rule when a context token is provided', () => {
    const s = buildScribeInstructions(RFI_SCHEMA, '1/1/2026', 'tok-55');
    expect(s).toContain('⟦ctx:tok-55⟧');
    expect(s).toContain('Never reveal or repeat the token');
  });
  it('no token → no fence text', () => {
    expect(buildScribeInstructions(RFI_SCHEMA, '1/1/2026')).not.toContain('⟦ctx:');
  });
});
