import { describe, it, expect } from 'vitest';
import { buildInstructions } from './instructions';
import { getProgram, buildActionTools, initialMockDoc } from '../scenarios';
import { buildEntities } from '../entities/registry';

const program = getProgram('word');
const entities = buildEntities(program, initialMockDoc('word'), {}, { items: program.images.map((img, i) => ({ id: `word-${img.id}`, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });

describe('buildInstructions — honest desktop assistant', () => {
  const honest = buildInstructions(true, program, entities);
  const confident = buildInstructions(false, program, entities);

  it('never speaks tourism', () => {
    for (const s of [honest, confident]) {
      expect(s).not.toMatch(/london|landmark|itinerary|tour.?guide|google map|map view|gallery of|screenshots/i);
    }
  });

  it('describes the real world: the program window and its elements', () => {
    expect(honest).toContain(program.label);
    for (const img of program.images) expect(honest).toContain(img.title);
    expect(honest).toMatch(/window/i);
  });

  it('carries the program action verbs and the kept tools', () => {
    for (const t of buildActionTools(program.id)) expect(honest).toContain(t.name);
    expect(honest).toContain('explain');
    expect(honest).toContain('share');
  });

  it('keeps the grounding grammar: confidence, witness, silence-on-success', () => {
    expect(honest).toMatch(/confidence/i);
    expect(honest).toMatch(/WITNESS-RENDER/);
    expect(honest).toMatch(/grounding_mismatch/);
    expect(honest).toMatch(/STAY SILENT/);
    expect(confident).not.toMatch(/confidence: low/i);
  });

  it('carries the response contract', () => {
    expect(honest).toContain('RESPONSE CONTRACT');
    expect(honest).toContain('respond');
    expect(honest).toContain('guideLine');
    expect(confident).toContain('RESPONSE CONTRACT');
  });
});
