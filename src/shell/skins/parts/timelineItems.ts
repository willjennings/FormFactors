// The Provenance skin's four-lane timeline (spec §3 C), as a pure function over the existing
// activity trace. This is the ONE new decision Task 7 introduces, so it lives here rather than
// in JSX: this repo has no App-level test harness, so anything left in a component is verified
// only by reading.
import type { ActivityEntry } from '../../activityStore';

export type TimelineActor = 'you' | 'agent' | 'witnessed' | 'waiting';

export interface TimelineItem { actor: TimelineActor; text: string; at: number }

/** Spec §3 C's own words for the final lane — present tense, and a promise about the world
 *  rather than a claim about the past. */
export const WAITING_TEXT = 'waiting — nothing written until you answer';

// Two DIFFERENT things arrive as kind 'ask', and they point in opposite directions:
//
//   • App.tsx `processInputTranscript` traces the USER's own utterance entering the pipeline,
//     with no callId;
//   • the tool ack traces the gate's collaborative question — the agent asking the user — and
//     always carries the call's id.
//
// `callId` is therefore the discriminator, and it has to be honoured: rendering someone's own
// sentence back at them under an "agent" lane, followed by "waiting — nothing written until you
// answer", would be false on both counts.
//
// The rest is straightforward: a dispatched call, a proposal awaiting confirm and a rejection are
// all the agent acting (or failing to), while `done` is the one kind that means an act actually
// landed — the commit lane.
function actorFor(e: ActivityEntry): TimelineActor {
  switch (e.kind) {
    case 'ask': return e.callId === undefined ? 'you' : 'agent';
    case 'done': return 'witnessed';
    default: return 'agent';          // 'call' | 'witness' | 'error'
  }
}

/** The rows the timeline shows: most recent LAST, capped at `limit`, with a trailing `waiting`
 *  lane when the newest entry is an agent ask that nothing has answered yet. "Open" is read off
 *  position alone — anything traced after the question means the turn moved on — because the
 *  activity trace is the only record this function is given, and inferring more would be
 *  inventing state. The waiting lane counts against `limit`, so the caller's row budget is the
 *  real one. */
export function timelineItems(activity: ActivityEntry[], limit: number): TimelineItem[] {
  if (limit <= 0) return [];
  const rows: TimelineItem[] = activity.map((e) => ({ actor: actorFor(e), text: e.text, at: e.at }));
  const newest = activity[activity.length - 1];
  if (newest && newest.kind === 'ask' && newest.callId !== undefined) {
    rows.push({ actor: 'waiting', text: WAITING_TEXT, at: newest.at });
  }
  return rows.slice(-limit);
}
