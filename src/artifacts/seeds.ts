// The Meridian Structural Q3 2026 seed corpus (spec §3.1): one coherent story with
// cross-referenced facts so synthesis liberties are detectable against ground truth.
// initialMockDoc (scenarios.ts) is deliberately untouched — tests depend on its strings;
// the App boots its corpus from HERE.
import type { MockDoc, ProgramId } from '../scenarios';

export const MERIDIAN = {
  revenue: '$4.2M',
  margin: '18%',
  projects: ['Riverside Tower', 'Dockside Depot'] as const,
  uniqueOutlookFact: 'Harbor Bridge bid',
};

export function seedCorpus(): Record<ProgramId, MockDoc> {
  return {
    word: {
      kind: 'word', bold: false, saved: false,
      text: [
        'Meridian Structural — Q3 2026 report.',
        `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}.`,
        `${MERIDIAN.projects[0]} topped out steel in September; ${MERIDIAN.projects[1]} remains two weeks behind schedule.`,
        'Risk note: crane availability constrains Q4 pours.',
      ].join(' '),
    },
    excel: {
      kind: 'excel', currency: [], chart: false, saved: false,
      cells: {
        A1: 'Metric', B1: 'Q3', C1: 'Project', D1: 'Status',
        A2: 'Revenue', B2: '$4.2M', C2: 'Riverside Tower', D2: 'On schedule',
        A3: 'Costs', B3: '$3.4M', C3: 'Dockside Depot', D3: '2 wks behind',
        A4: 'Margin', B4: '18%',
      },
    },
    powerpoint: {
      kind: 'powerpoint', saved: false,
      slides: [
        'Meridian Structural — Q3 2026 board review',
        `Highlights: revenue ${MERIDIAN.revenue}, margin ${MERIDIAN.margin}, ${MERIDIAN.projects[0]} steel topped out`,
        `Outlook: ${MERIDIAN.uniqueOutlookFact} submitted, decision expected Q4`,
      ],
    },
    photo: {
      kind: 'photo', cropped: false, resized: false, brightness: 0, bgRemoved: false, saved: false,
      caption: `${MERIDIAN.projects[0]} — steel topping out, Sept 2026`,
    },
  };
}
