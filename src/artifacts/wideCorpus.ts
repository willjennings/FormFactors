// Task 6 (performance-realism spec §3): a GENERATED Meridian variant that removes the small
// default corpus's ceiling effect (seedCorpus() in seeds.ts has ~4 elements and 3 numeric
// cells — success rates saturate against it and stop predicting anything). Same MockDoc schema,
// ~5x entities, deterministic from a seed so battery runs are comparable across invocations and
// across time. This module has NO knowledge of the `?corpus=wide` URL param — it is a pure
// generator; src/journal/registry.ts's isWideCorpusBoot()/bootCorpus() decide whether to seed the
// document corpus from it, and App.tsx's wide-corpus boot effect decides whether to fold its
// artifactEvents through the live artifact store (see the comment at that effect for why the
// artifacts are NOT wired through JOURNAL_REGISTRY.artifacts.initial).
import type { MockDoc, ProgramId } from '../scenarios';
import { MERIDIAN } from './seeds';
import type { ArtifactEvent } from './types';
import { validateCombineCall } from './combineTools';
import { initialArtifactState, reduce as artifactReduce } from './artifactStore';

// ---- deterministic PRNG (mulberry32) — no dependency, seeded, NEVER Date.now() ----
// Every "random" choice below (which project, which status, which numeric value) flows through
// this single generator seeded once at the top of wideCorpus(), so the same seed always
// produces byte-identical output and a different seed produces different numbers/assignments.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
const randInt = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

// Extra projects beyond the seed pair, coherent with the Meridian world: MERIDIAN's
// uniqueOutlookFact is "Harbor Bridge bid" (seeds.ts), so Harbor Bridge Crossing is that bid
// having landed — same construction-portfolio story, just wider.
const EXTRA_PROJECTS = [
  'Harbor Bridge Crossing', 'Foundry Yard Expansion', 'Turbine Hall Retrofit',
  'Marina Walk Phase 2', 'Overpass Interchange', 'Grainhouse Renovation',
] as const;
const PROJECT_POOL = [...MERIDIAN.projects, ...EXTRA_PROJECTS] as const;

const STATUS_POOL = [
  'On schedule', '1 wk behind', '2 wks behind', 'Ahead of plan', 'At risk', 'Pending permit',
] as const;

// The deixis stressor the brief asks for: plausible NEAR-COLLISION labels sharing a token
// ("Revenue" / "Revenue Q2" / "Net Revenue" / "Gross Revenue" / ...). Fixed, not PRNG-shuffled —
// the collision SET must exist at every seed; only the numbers/projects attached to each row
// vary. 34 rows + 1 header row = 35 total spreadsheet rows, comfortably over the "30+" floor.
const METRIC_LABELS = [
  'Revenue', 'Revenue Q2', 'Net Revenue', 'Gross Revenue', 'Revenue YoY', 'Recurring Revenue',
  'Costs', 'Cost of Goods', 'Operating Costs', 'Fixed Costs',
  'Margin', 'Net Margin', 'Gross Margin', 'Margin Q2',
  'Backlog', 'Backlog Q2', 'Backlog Value',
  'Headcount', 'Headcount Q2', 'Contractor Headcount',
  'Utilization', 'Crew Utilization',
  'Change Orders', 'Change Order Value',
  'Retention', 'Retention Rate',
  'Safety Incidents', 'Safety Score',
  'Permit Status', 'Permit Backlog',
  'Bid Pipeline', 'Bid Win Rate',
  'Equipment Uptime', 'Crane Utilization',
] as const;

interface WideRow { label: string; value: string; project: string; status: string; row: number }

// Explicit per-label kind (not a substring heuristic — a first draft used
// `.includes('backlog value')` and missed plain 'Backlog'/'Backlog Q2', which then drew a
// STATUS_POOL string into a dollar-shaped sentence ("carries the largest backlog at 1 wk
// behind"); an exact map can't silently miss a label the way a substring check can). Every
// METRIC_LABELS entry must have exactly one kind here.
type ValueKind = 'currency' | 'percent' | 'count' | 'smallCount' | 'status';
const LABEL_KIND: Record<(typeof METRIC_LABELS)[number], ValueKind> = {
  'Revenue': 'currency', 'Revenue Q2': 'currency', 'Net Revenue': 'currency',
  'Gross Revenue': 'currency', 'Revenue YoY': 'percent', 'Recurring Revenue': 'currency',
  'Costs': 'currency', 'Cost of Goods': 'currency', 'Operating Costs': 'currency', 'Fixed Costs': 'currency',
  'Margin': 'percent', 'Net Margin': 'percent', 'Gross Margin': 'percent', 'Margin Q2': 'percent',
  'Backlog': 'currency', 'Backlog Q2': 'currency', 'Backlog Value': 'currency',
  'Headcount': 'count', 'Headcount Q2': 'count', 'Contractor Headcount': 'count',
  'Utilization': 'percent', 'Crew Utilization': 'percent',
  'Change Orders': 'smallCount', 'Change Order Value': 'currency',
  'Retention': 'percent', 'Retention Rate': 'percent',
  'Safety Incidents': 'smallCount', 'Safety Score': 'percent',
  'Permit Status': 'status', 'Permit Backlog': 'smallCount',
  'Bid Pipeline': 'currency', 'Bid Win Rate': 'percent',
  'Equipment Uptime': 'percent', 'Crane Utilization': 'percent',
};

/** One value per label, formatted by its LABEL_KIND — currency, percent, a headcount-scale
 *  count, a small count (incidents/orders/backlog-of-permits — a second draft caught these
 *  sharing 'count' with Headcount and printing "98 safety incidents this quarter"), or (only
 *  'Permit Status') a status pick. Never returns an empty string or undefined, so no generated
 *  cell can stringify as "undefined". */
function formatValue(rng: () => number, label: string): string {
  switch (LABEL_KIND[label as (typeof METRIC_LABELS)[number]]) {
    case 'currency': return `$${(randInt(rng, 8, 96) / 10).toFixed(1)}M`;
    case 'percent': return `${randInt(rng, 8, 34)}%`;
    case 'count': return String(randInt(rng, 4, 220));
    case 'smallCount': return String(randInt(rng, 0, 12));
    case 'status': default: return pick(rng, STATUS_POOL);
  }
}

function buildRows(rng: () => number): WideRow[] {
  return METRIC_LABELS.map((label, i) => ({
    label,
    value: formatValue(rng, label),
    project: pick(rng, PROJECT_POOL),
    status: pick(rng, STATUS_POOL),
    row: i + 2, // row 1 is the header
  }));
}

const valueOf = (rows: WideRow[], label: string): string => rows.find((r) => r.label === label)?.value ?? '';
const projectOf = (rows: WideRow[], label: string): string =>
  rows.find((r) => r.label === label)?.project ?? PROJECT_POOL[0];
const statusOf = (rows: WideRow[], label: string): string => rows.find((r) => r.label === label)?.status ?? '';

function buildExcel(rows: WideRow[]): Extract<MockDoc, { kind: 'excel' }> {
  const cells: Record<string, string> = { A1: 'Metric', B1: 'Q3', C1: 'Project', D1: 'Status' };
  for (const r of rows) {
    cells[`A${r.row}`] = r.label;
    cells[`B${r.row}`] = r.value;
    cells[`C${r.row}`] = r.project;
    cells[`D${r.row}`] = r.status;
  }
  return { kind: 'excel', cells, currency: [], chart: false, saved: false };
}

// Deliberately does NOT plant MERIDIAN.uniqueOutlookFact here — seeds.ts's own narrative device
// (the one fact only the outlook slide carries) is preserved: it stays powerpoint-only below.
function buildWord(rows: WideRow[]): Extract<MockDoc, { kind: 'word' }> {
  const leadBacklogProject = projectOf(rows, 'Backlog');
  const utilizationProject = projectOf(rows, 'Crew Utilization');
  const text = [
    'Meridian Structural — Q3 2026 wide-portfolio report.',
    `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}.`,
    `Across the wider portfolio, gross revenue came to ${valueOf(rows, 'Gross Revenue')} against net revenue of ${valueOf(rows, 'Net Revenue')} after ${valueOf(rows, 'Change Order Value')} in change orders — recurring revenue is ${valueOf(rows, 'Recurring Revenue')}.`,
    `${leadBacklogProject} carries the largest backlog at ${valueOf(rows, 'Backlog')}, versus ${valueOf(rows, 'Backlog Q2')} at the Q2 mark (status: ${statusOf(rows, 'Backlog')}).`,
    `Headcount stands at ${valueOf(rows, 'Headcount')} against ${valueOf(rows, 'Headcount Q2')} in Q2, with ${valueOf(rows, 'Contractor Headcount')} contractors on site.`,
    `${utilizationProject} is the schedule watch item this quarter; crew utilization is running at ${valueOf(rows, 'Crew Utilization')} against overall utilization of ${valueOf(rows, 'Utilization')}.`,
    `Bid pipeline stands at ${valueOf(rows, 'Bid Pipeline')} with a win rate of ${valueOf(rows, 'Bid Win Rate')}.`,
    'Risk note: crane availability and permit backlog remain the two watch items into Q4.',
  ].join(' ');
  return { kind: 'word', text, bold: false, saved: false };
}

function buildPowerpoint(rows: WideRow[]): Extract<MockDoc, { kind: 'powerpoint' }> {
  const slides = [
    'Meridian Structural — Q3 2026 board review (wide portfolio)',
    `Highlights: revenue ${MERIDIAN.revenue}, margin ${MERIDIAN.margin}, ${MERIDIAN.projects[0]} steel topped out`,
    `Portfolio revenue ${valueOf(rows, 'Revenue')} vs net revenue ${valueOf(rows, 'Net Revenue')} after ${valueOf(rows, 'Change Order Value')} in change orders`,
    `Backlog ${valueOf(rows, 'Backlog')}, up from ${valueOf(rows, 'Backlog Q2')} in Q2`,
    `Headcount ${valueOf(rows, 'Headcount')} (${valueOf(rows, 'Contractor Headcount')} contractors), utilization ${valueOf(rows, 'Utilization')}`,
    `Safety: ${valueOf(rows, 'Safety Incidents')} incidents this quarter, safety score ${valueOf(rows, 'Safety Score')}`,
    `Bid pipeline ${valueOf(rows, 'Bid Pipeline')}, win rate ${valueOf(rows, 'Bid Win Rate')}`,
    `Outlook: ${MERIDIAN.uniqueOutlookFact} submitted, decision expected Q4`,
  ];
  return { kind: 'powerpoint', slides, saved: false };
}

function buildPhoto(rows: WideRow[]): Extract<MockDoc, { kind: 'photo' }> {
  const project = projectOf(rows, 'Revenue');
  return {
    kind: 'photo', cropped: false, resized: false, brightness: 0, bgRemoved: false, saved: false,
    caption: `${project} — steel topping out, Sept 2026`,
  };
}

// Fixed epoch (never Date.now()): each artifact.create's createdAt is this instant plus a fixed
// per-index offset, so ordering, `meta.at`, and any test asserting on these timestamps are
// stable across every run and every machine.
const ARTIFACT_EPOCH = 1_700_000_000_000;

/**
 * 6 pre-seeded artifacts via REAL artifact.create events, validated + folded through the REAL
 * validateCombineCall + artifactReduce (combineTools.ts / artifactStore.ts) — mirroring how
 * ?artifacts=1's demo seeds artifacts (src/artifacts/demo.ts) and never hand-constructing an
 * Artifact/ArtifactState. Each combine's sources resolve against either a corpus program doc or
 * a PRIOR artifact in this same list (closure under composition), exactly as the live `combine`
 * tool would see it.
 *
 * DISCREPANCY (flagged per the task brief, not silently resolved): the performance-realism spec
 * §3 asks for "8-10 artifacts pre-seeded". MAX_ARTIFACTS (artifactStore.ts) is 6, and the
 * artifact.create reducer case REJECTS (never evicts) once the desk holds 6 — a deliberate
 * product invariant ("reject, never evict", spec §7), not a bug. Seeding 8-10 args here would
 * mean the last 2-4 silently fail validation/reduction (return `{error}` / increment
 * `rejectedAtCap`), which would violate this file's own contract ("no cap rejection"). So this
 * seeds exactly 6 — the cap — and the 8-10 vs 6 conflict is reported rather than raising
 * MAX_ARTIFACTS, which is a product decision for a human, not this generator.
 */
function buildArtifactEvents(corpus: Record<ProgramId, MockDoc>, rows: WideRow[]): ArtifactEvent[] {
  const argsList: Array<Record<string, unknown>> = [
    {
      sources: ['word', 'excel'], kind: 'doc', title: 'Q3 Wide Brief',
      content: `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}. Portfolio-wide gross revenue came to ${valueOf(rows, 'Gross Revenue')}.`,
    },
    {
      sources: ['excel', 'powerpoint'], kind: 'doc', title: 'Backlog & Bid Summary',
      content: `Backlog stands at ${valueOf(rows, 'Backlog')} against ${valueOf(rows, 'Backlog Q2')} in Q2. Bid pipeline is ${valueOf(rows, 'Bid Pipeline')} at a ${valueOf(rows, 'Bid Win Rate')} win rate.`,
    },
    {
      sources: ['word', 'photo'], kind: 'doc', title: 'Field Report',
      content: `${projectOf(rows, 'Revenue')} topped out steel in September. Crew utilization is running at ${valueOf(rows, 'Crew Utilization')} with ${valueOf(rows, 'Safety Incidents')} safety incidents this quarter.`,
    },
    {
      sources: ['a1', 'excel'], kind: 'widget', title: 'Status Board',
      fields: [
        { label: 'Lead project', value: projectOf(rows, 'Revenue') },
        { label: 'Backlog', value: valueOf(rows, 'Backlog') },
        { label: 'Headcount', value: valueOf(rows, 'Headcount') },
      ],
    },
    {
      sources: ['a2', 'a3'], kind: 'doc', title: 'Combined Program Digest',
      content: `Combining the backlog/bid summary with the field report: ${projectOf(rows, 'Backlog')} carries the backlog while ${projectOf(rows, 'Revenue')} leads on schedule performance.`,
    },
    {
      sources: ['a4', 'powerpoint'], kind: 'widget', title: 'Program Status Board',
      fields: [
        { label: 'Bid win rate', value: valueOf(rows, 'Bid Win Rate') },
        { label: 'Safety score', value: valueOf(rows, 'Safety Score') },
      ],
    },
  ];

  let arts = initialArtifactState();
  const events: ArtifactEvent[] = [];
  argsList.forEach((args, i) => {
    const now = ARTIFACT_EPOCH + i * 1000;
    const result = validateCombineCall(args, corpus, arts, now);
    if ('error' in result) {
      // A generator producing an invalid seed is a bug in this file, not a runtime condition to
      // degrade gracefully from — fail loudly so it's caught by wideCorpus.test.ts, never by a
      // live boot silently seeding fewer artifacts than the contract promises.
      throw new Error(`wideCorpus: seed artifact ${i} ("${String(args.title)}") failed validation: ${result.error}`);
    }
    events.push(result.event);
    arts = artifactReduce(arts, result.event);
  });
  return events;
}

/** The wide corpus (Task 6, spec §3): same MockDoc schema as seedCorpus(), ~5x the entities,
 *  deterministic from `seed`. Returns both the program corpus and the artifact.create events a
 *  boot path can fold through the real artifactReduce to pre-seed the desk (see
 *  src/journal/registry.ts's bootCorpus()/bootArtifactState()). */
export function wideCorpus(seed = 42): { corpus: Record<ProgramId, MockDoc>; artifactEvents: ArtifactEvent[] } {
  const rng = mulberry32(seed);
  const rows = buildRows(rng);
  const corpus: Record<ProgramId, MockDoc> = {
    word: buildWord(rows),
    excel: buildExcel(rows),
    powerpoint: buildPowerpoint(rows),
    photo: buildPhoto(rows),
  };
  const artifactEvents = buildArtifactEvents(corpus, rows);
  return { corpus, artifactEvents };
}
