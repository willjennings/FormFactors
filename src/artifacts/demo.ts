// ?artifacts=1 demo: a scripted combine call (word + excel → a synthesized doc artifact),
// replayed through the REAL validateCombineCall + artifactStore — no model involved (spec §9,
// mirrors sketch/demo.ts and whiteboard/demo.ts). The Meridian seed corpus is untouched; this
// demo assumes excel is present as a source alongside whatever the active program's doc is.
import { MERIDIAN, seedCorpus } from './seeds';

/** The excel doc the demo needs present as a combine source (the app seeds it into corpus). */
export const ARTIFACT_DEMO_EXCEL_SOURCE = seedCorpus().excel;

/** Tool-call args for the scripted combine — the same shape the live `combine` tool takes. */
export const ARTIFACT_DEMO_ARGS = {
  sources: ['word', 'excel'],
  kind: 'doc' as const,
  title: 'Q3 Status Brief',
  content: `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}. ${MERIDIAN.projects[0]} topped out steel in September; ${MERIDIAN.projects[1]} is running two weeks behind schedule against a $3.4M cost basis.`,
};
