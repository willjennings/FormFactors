import { describe, it, expect } from 'vitest';
import { parseCompetence, serializeCompetence } from './persistence';

describe('competence persistence', () => {
  it('round-trips a record', () => {
    expect(parseCompetence(serializeCompetence({ 'word.save': 2 }))).toEqual({ 'word.save': 2 });
  });
  it('fail-soft: null, garbage, and wrong shapes → {}', () => {
    expect(parseCompetence(null)).toEqual({});
    expect(parseCompetence('not json')).toEqual({});
    expect(parseCompetence('[1,2]')).toEqual({});
    expect(parseCompetence('{"k":"NaNish"}')).toEqual({});
  });
});
