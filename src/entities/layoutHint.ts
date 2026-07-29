// The layout hint: the one message that tells the model where everything on the plane is.
//
// Why it is a module. Its old preamble asserted "The on-screen program elements are at these
// coordinates" and then listed elements that were NOT on screen, at [0, 0, 0, 0] — the encoding
// updateLayout uses for an unmeasurable window. Nothing in the message said what that encoding
// meant, while resolveAt.ts guards the APP against exactly it (zero-height boxes never match).
// The app protected itself and handed the model the same zeroes unguarded, in the same breath.
//
// And a closed program window and a minimized one produced an identical payload, so the model
// could not tell "gone" from "one click away in the bar". Artifacts have a second channel that
// recovers the difference ([ARTIFACTS: …] drops a closed artifact and keeps a minimized one);
// the program window has none, so the distinction is carried here or nowhere.
//
// Terse on purpose: this goes out on every layout change (drag, resize, minimize, skin switch),
// and prompt bulk has a measured cost in this project.

import { displayName, type SceneEntity } from './registry';

/**
 * Whether the ACTIVE program's window is on the plane, and if not, why.
 * Read from the desk store, which is the only thing that knows the difference:
 *   'open'      — mounted and measurable
 *   'minimized' — not on screen, still in the inventory, restorable from the bar
 *   'closed'    — no window at all; it would have to be reopened
 */
export type ProgramWindowState = 'open' | 'minimized' | 'closed';

const PROGRAM_WINDOW_LINE: Record<ProgramWindowState, string> = {
  open: '',
  minimized: 'PROGRAM WINDOW: minimized — off screen but still open; the user can restore it from the bar.\n',
  closed: 'PROGRAM WINDOW: closed — no window at all; it would have to be reopened.\n',
};

/** The [SYSTEM UPDATE] layout message. Pure — one string per (entities, window state). */
export function buildLayoutHint(entities: SceneEntity[], programWindow: ProgramWindowState): string {
  const rows = entities.map((e) => `${displayName(e)}: [${e.bbox.map(Math.round).join(', ')}]`).join('\n');
  return `[SYSTEM UPDATE: element boxes (ymin, xmin, ymax, xmax) on a 0-1000 plane. [0, 0, 0, 0] means that element is NOT on screen — NEVER resolve "this" or "here" to one, and do not act on it.\n${PROGRAM_WINDOW_LINE[programWindow]}${rows}\nUse these to identify what the user is pointing at when they say "this" or "here". DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]`;
}
