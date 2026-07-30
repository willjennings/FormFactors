// Pure swap helper: the outgoing program's doc is preserved; the incoming one is restored
// (or seeded on first visit). Kills the reset in handleProgramChange that made
// "take the report and the numbers" inexpressible (spec §3).
import type { MockDoc, ProgramId } from '../scenarios';
import { seedCorpus } from './seeds';

/**
 * `fallbackCorpus` (fix round 1, I2) defaults to the plain Meridian seed so every existing
 * caller/test is unaffected, but a `?corpus=wide` session's App.tsx passes `bootCorpus()`
 * explicitly — so a never-visited program falls back to the SAME corpus the session actually
 * booted on, not silently to the small default. Deliberately a PARAMETER, not an import of
 * journal/registry's bootCorpus() here: that would invert this module's established one-way
 * layering (artifacts/ never depends on journal/) for a decision only the caller (which already
 * imports both) needs to make.
 */
export function saveAndLoad(
  corpus: Partial<Record<ProgramId, MockDoc>>, outgoingId: ProgramId, outgoingDoc: MockDoc, incomingId: ProgramId,
  fallbackCorpus: Record<ProgramId, MockDoc> = seedCorpus(),
): { corpus: Partial<Record<ProgramId, MockDoc>>; doc: MockDoc } {
  const next = { ...corpus, [outgoingId]: outgoingDoc };
  return { corpus: next, doc: next[incomingId] ?? fallbackCorpus[incomingId] };
}
