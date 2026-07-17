// The four arcs over the Meridian world (spec §4). Predicates observe committed state only.
import type { MissionDef } from './types';

const docChanged = (obs: { docs: any; seed: any }, id: string, field: string) =>
  !!obs.docs[id] && JSON.stringify((obs.docs[id] as any)[field]) !== JSON.stringify((obs.seed[id] as any)[field]);

export const MISSIONS: MissionDef[] = [
  {
    key: 'learn-tools', title: 'Learn your way around', program: 'word',
    brief: 'Get comfortable in Word: have it walk you through saving, then export a copy yourself.',
    steps: [
      { key: 'walkthrough', subgoal: 'Complete a save walkthrough',
        hint: 'Try: "teach me how to save this"',
        doneWhen: (o) => o.teachingCompleted.some((k) => k.startsWith('word.')) },
      { key: 'export', subgoal: 'Export a copy',
        hint: 'Try: "export this as a PDF"',
        doneWhen: (o) => o.commits.some((c) => c.verbClass === 'file' && c.program === 'word') },
    ],
  },
  {
    key: 'ship-brief', title: 'Ship the brief', program: 'word',
    brief: 'Get the Q3 status brief out: fix the sheet, combine the report and the numbers, and send it.',
    steps: [
      { key: 'fix-sheet', subgoal: 'Fix the numbers in the sheet',
        hint: 'Point at a cell and tell it what to change',
        doneWhen: (o) => docChanged(o, 'excel', 'cells') },
      { key: 'combine', subgoal: 'Combine report + sheet into a brief',
        hint: 'Try: "combine the report and the numbers into a status brief"',
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'doc' && a.sources.includes('word') && a.sources.includes('excel')) },
      { key: 'share', subgoal: 'Send it out',
        hint: 'Try: "share the brief with my editor"',
        doneWhen: (o) => o.sharesCommitted > 0 },
    ],
  },
  {
    key: 'glance-numbers', title: 'Glanceable numbers', program: 'excel',
    brief: 'Build a live status widget from the report and the sheet — clock or weather live, MERI stock simulated.',
    steps: [
      { key: 'widget', subgoal: 'Create the status widget',
        hint: 'Try: "make a widget from the report and the sheet with the time and our stock price"',
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'widget'
          && a.fields?.some((f) => f.feed === 'stock')
          && a.fields?.some((f) => f.feed === 'clock' || f.feed === 'weather')) },
    ],
  },
  {
    key: 'fix-deck', title: 'Fix the deck', program: 'powerpoint',
    brief: 'Make the board deck lead with the lead project: the title slide should name Riverside Tower.',
    steps: [
      { key: 'retitle', subgoal: 'Title slide names Riverside Tower',
        hint: 'Point at the title slide and retitle it',
        doneWhen: (o) => {
          const ppt = o.docs.powerpoint as { slides?: string[] } | undefined;
          return !!ppt?.slides?.[0]?.includes('Riverside Tower');
        } },
    ],
  },
];
