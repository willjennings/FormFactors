/** Token guard: a live session streams vision frames + hints continuously; an abandoned one
 *  burns silently. 5 idle minutes (no pointer, typing, or speech) ends the session. */
export const IDLE_LIMIT_MS = 300_000;
export const idleExceeded = (now: number, lastActivity: number, limit: number = IDLE_LIMIT_MS): boolean =>
  now - lastActivity > limit;
