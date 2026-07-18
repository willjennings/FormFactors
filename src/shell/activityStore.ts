// The transparency trace (audit 2026-07-18): a glanceable record of what the model is
// actually DOING — requests entering the pipeline, tool calls dispatching, outcomes and
// rejections landing. Fed ONLY from the real seams (dispatch, ack, feedback), never from
// model narration; a rejection renders as a rejection so retries stop looking like dead air.
// Pure: caller supplies timestamps.

export interface ActivityEntry {
  kind: 'ask' | 'call' | 'witness' | 'done' | 'error';
  text: string;
  at: number;
  /** Ties an outcome to its dispatched call so the row updates in place. */
  callId?: string;
}

export interface ActivityState { entries: ActivityEntry[] }

const CAP = 20;             // full in-memory history (the drawer's op-stream is the real log)
export const VISIBLE_MAX = 4;
export const FADE_MS = 7000;

export function initialActivity(): ActivityState {
  return { entries: [] };
}

export function reduceActivity(s: ActivityState, entry: ActivityEntry): ActivityState {
  // An outcome (done/error) for a still-pending call replaces that call's row in place —
  // the trace reads "save_file → Saved", not two rows.
  if ((entry.kind === 'done' || entry.kind === 'error') && entry.callId) {
    const i = s.entries.findIndex((x) => x.kind === 'call' && x.callId === entry.callId);
    if (i !== -1) {
      const entries = s.entries.slice();
      entries[i] = entry;
      return { entries };
    }
  }
  return { entries: [...s.entries, entry].slice(-CAP) };
}

/** The rows the ticker shows: newest-last, capped, faded out after FADE_MS. */
export function visibleActivity(s: ActivityState, now: number): ActivityEntry[] {
  return s.entries.filter((e) => now - e.at <= FADE_MS).slice(-VISIBLE_MAX);
}
