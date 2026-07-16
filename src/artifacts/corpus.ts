// Pure swap helper: the outgoing program's doc is preserved; the incoming one is restored
// (or seeded on first visit). Kills the reset in handleProgramChange that made
// "take the report and the numbers" inexpressible (spec §3).
import type { MockDoc, ProgramId } from '../scenarios';
import { seedCorpus } from './seeds';

export function saveAndLoad(
  corpus: Partial<Record<ProgramId, MockDoc>>, outgoingId: ProgramId, outgoingDoc: MockDoc, incomingId: ProgramId,
): { corpus: Partial<Record<ProgramId, MockDoc>>; doc: MockDoc } {
  const next = { ...corpus, [outgoingId]: outgoingDoc };
  return { corpus: next, doc: next[incomingId] ?? seedCorpus()[incomingId] };
}
