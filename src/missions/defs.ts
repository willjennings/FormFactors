// The four arcs over the Meridian world (spec §4). Predicates observe committed state only.
import type { MissionDef } from './types';

// Diffs against the RUN baseline (final review I2), not the pristine seed — a doc already
// edited before this run started (a prior run, or free play) must not auto-satisfy a step.
const docChanged = (obs: { docs: any; baseline: { docs: any } }, id: string, field: string) =>
  !!obs.docs[id] && JSON.stringify((obs.docs[id] as any)[field]) !== JSON.stringify((obs.baseline.docs[id] as any)?.[field]);

export const MISSIONS: MissionDef[] = [
  {
    key: 'learn-tools', title: 'Learn your way around', program: 'word',
    brief: 'Get comfortable in Word: have it walk you through saving, then export a copy yourself.',
    steps: [
      { key: 'walkthrough', subgoal: 'Complete a save walkthrough',
        hint: 'Try: "teach me how to save this"',
        // Keyed on PROGRAM, not taskKey (final review I4): taskKeys are model-authored free text
        // (teachTools.ts merely *suggests* a convention like "word.save"; the fallback is
        // literally 'task'), so a startsWith('word.') check goes unreachable the moment a model
        // picks its own key. `program` is recorded by App at completion-detection time from
        // activeProgramRef — not model-authored — so any completed teach sequence in Word counts.
        doneWhen: (o) => o.teachingCompleted.some((t) => t.program === 'word') },
      { key: 'export', subgoal: 'Export a copy',
        hint: 'Try: "export this as a PDF"',
        doneWhen: (o) => o.commits.some((c) => c.verb === 'save_file' && c.program === 'word') },
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
        // The qualifying artifact must be NEW this run (final review I2) — its id must not be
        // one that already existed in the baseline (a prior run's or free play's artifact).
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'doc' && a.sources.includes('word') && a.sources.includes('excel') && !o.baseline.artifactIds.includes(a.id)) },
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
        // Same NEW-this-run guard as ship-brief's combine step (final review I2) — a widget
        // left over from a prior run or free play must not auto-complete a fresh run.
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'widget'
          && a.sources.includes('word') && a.sources.includes('excel')
          && a.fields?.some((f) => f.feed === 'stock')
          && a.fields?.some((f) => f.feed === 'clock' || f.feed === 'weather')
          && !o.baseline.artifactIds.includes(a.id)) },
    ],
  },
  {
    key: 'fix-deck', title: 'Fix the deck', program: 'powerpoint',
    brief: 'Make the deck close on the lead project: the current slide should name Riverside Tower.',
    steps: [
      { key: 'retitle', subgoal: 'Current slide names Riverside Tower',
        hint: 'Point at the slide canvas and retitle it',
        // The action layer edits only the CURRENT (last) slide — scenarios.ts edit_content; a title-slide predicate would be unreachable (Task 4 browser drive, 2026-07-17).
        doneWhen: (o) => {
          const ppt = o.docs.powerpoint as { slides?: string[] } | undefined;
          const last = ppt?.slides?.[ppt.slides.length - 1];
          const baselinePpt = o.baseline.docs.powerpoint as { slides?: string[] } | undefined;
          const baselineLast = baselinePpt?.slides?.[baselinePpt.slides.length - 1];
          // Must ALSO differ from the baseline's last slide (final review I2): the last slide
          // already naming Riverside Tower at run start (a prior run, or free play) is not
          // evidence of a fresh edit THIS run — only a slide that changed since baseline counts.
          return !!last?.includes('Riverside Tower') && last !== baselineLast;
        } },
    ],
  },
];
