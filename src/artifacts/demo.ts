// ?artifacts=1 demo: two scripted combine calls (word + excel → a synthesized doc artifact,
// then that doc + excel → a widget artifact with live/simulated feeds), replayed through
// the REAL validateCombineCall + artifactStore — no model involved (spec §9, mirrors
// sketch/demo.ts and whiteboard/demo.ts). The corpus boots with the full Meridian seed set
// (spec §3.1), so the demo needs no hand-injected sources — it runs against exactly the
// corpus a real first turn would see.
import { MERIDIAN } from './seeds';

/** Tool-call args for the scripted combine — the same shape the live `combine` tool takes. */
export const ARTIFACT_DEMO_ARGS = {
  sources: ['word', 'excel'],
  kind: 'doc' as const,
  title: 'Q3 Status Brief',
  content: `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}. ${MERIDIAN.projects[0]} topped out steel in September; ${MERIDIAN.projects[1]} is running two weeks behind schedule against a $3.4M cost basis.`,
};

/**
 * The M2 widget demo (spec §8/§10): combines the doc artifact from ARTIFACT_DEMO_ARGS (id 'a1'
 * — closure under composition, spec §5) with excel (present in the boot seed corpus)
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

/**
 * The scripted refine (spec §13): rewrites paragraph 1 of the doc artifact created by
 * ARTIFACT_DEMO_ARGS, replayed through the REAL validateRefineCall + reducer. This is what
 * makes the whole revise loop drivable with no API key — rev chip, history, and revert all
 * become reachable offline.
 */
export const ARTIFACT_DEMO_REFINE_ARGS = {
  artifactId: 'a1',
  baseRev: 1,
  op: 'replace-part' as const,
  index: 1,
  text: `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin — ahead of plan, led by ${MERIDIAN.projects[0]}.`,
  note: 'tightened the opening',
};
