// ?artifacts=1 demo: two scripted combine calls (word + excel → a synthesized doc artifact,
// then that doc + powerpoint → a widget artifact with live/simulated feeds), replayed through
// the REAL validateCombineCall + artifactStore — no model involved (spec §9, mirrors
// sketch/demo.ts and whiteboard/demo.ts). The Meridian seed corpus is untouched; this demo
// assumes excel is present as a source alongside whatever the active program's doc is.
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

/**
 * The M2 widget demo (spec §8/§10): combines the doc artifact from ARTIFACT_DEMO_ARGS (id 'a1'
 * — closure under composition, spec §5) with excel (already seeded into corpus for the doc demo)
 * into a status-board widget. clock and stock are always driveable offline/in CI; weather is
 * included to show LIVE provenance but the demo's success never depends on its fetch succeeding
 * — a failed weather feed renders "feed unavailable" and nothing else about the demo breaks
 * (spec §9).
 */
export const ARTIFACT_DEMO_WIDGET_ARGS = {
  sources: ['a1', 'excel'],
  kind: 'widget' as const,
  title: 'Status Board',
  fields: [
    { label: 'Lead project', value: MERIDIAN.projects[0] },
    { label: 'Local time', feed: 'clock' as const },
    { label: 'MERI', feed: 'stock' as const },
    { label: 'Weather', feed: 'weather' as const },
  ],
};
