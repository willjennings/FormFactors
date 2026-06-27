/**
 * coherence.ts
 *
 * Self-contained, pure TypeScript helpers for a voice point-and-speak app:
 *   - G9: tool-call idempotency / dedup (CallDeduper, argsKey)
 *   - G7: temporal coherence (isStale)
 *   - G9: repair grammar (parseRepair)
 *
 * No React, no external imports. Everything is pure and deterministic; the
 * caller supplies `now` rather than this module reading the clock.
 */

// ---------------------------------------------------------------------------
// 1. IDEMPOTENCY / DEDUP (G9)
// ---------------------------------------------------------------------------

/**
 * Produce a stable string key from a tool-call args object.
 *
 * Keys are sorted so that `{a:1,b:2}` and `{b:2,a:1}` collapse to the same
 * key. Tolerant of `undefined` / `null` (both yield the empty-args key).
 */
export function argsKey(args: Record<string, unknown> | undefined | null): string {
  if (args == null) return '{}';
  const keys = Object.keys(args).sort();
  // Build a deterministic JSON-ish representation with sorted keys at the top
  // level. Values are JSON-serialized; nested objects are sorted recursively
  // via a stable replacer so ordering does not affect the key.
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(args[k])}`);
  return `{${parts.join(',')}}`;
}

/** Recursively stringify a value with object keys sorted. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

const DEFAULT_DEDUP_WINDOW_MS = 1500;

/**
 * Guards against the model re-emitting the same tool call in a short window.
 *
 * Usage: call `seen(name, argsKey(args), now)` before dispatching a tool call.
 * If it returns `true`, the call is a duplicate within the window and the
 * caller should SKIP it. Otherwise the call is recorded and `false` returned.
 */
export class CallDeduper {
  private readonly entries = new Map<string, number>();

  /**
   * @returns true if (name+argsKey) was already seen within `windowMs` -> skip.
   *          false otherwise (and the call is recorded as just-seen).
   */
  seen(name: string, argsKey: string, now: number, windowMs: number = DEFAULT_DEDUP_WINDOW_MS): boolean {
    this.prune(now, windowMs);
    const key = `${name}${argsKey}`;
    const last = this.entries.get(key);
    if (last !== undefined && now - last < windowMs) {
      // Duplicate within window. Refresh the timestamp so a steady stream of
      // repeats keeps being suppressed rather than slipping through.
      this.entries.set(key, now);
      return true;
    }
    this.entries.set(key, now);
    return false;
  }

  /** Drop the internal record of all prior calls. */
  reset(): void {
    this.entries.clear();
  }

  /** Remove entries older than the window to keep the map small. */
  private prune(now: number, windowMs: number): void {
    for (const [key, ts] of this.entries) {
      if (now - ts >= windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. TEMPORAL COHERENCE (G7)
// ---------------------------------------------------------------------------

/**
 * Returns true if a referent resolved at `resolvedVersion` is stale relative to
 * `currentVersion` (i.e. the layout changed since the referent was resolved, so
 * the action may no longer point at what the user meant).
 *
 * If `resolvedVersion` is undefined, the referent has no version to compare and
 * is treated as NOT stale.
 */
export function isStale(resolvedVersion: number | undefined, currentVersion: number): boolean {
  return resolvedVersion !== undefined && resolvedVersion < currentVersion;
}

// ---------------------------------------------------------------------------
// 3. REPAIR GRAMMAR (G9)
// ---------------------------------------------------------------------------

export type Repair = 'other' | 'undo' | 'cancel' | null;

/**
 * Normalize a transcript for matching: lowercase, strip punctuation to spaces,
 * collapse whitespace, trim. Surrounded by single spaces so word-boundary
 * checks via substring (` word `) are reliable.
 */
function normalize(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${cleaned} `;
}

/** True if `phrase` (a normalized, space-delimited token sequence) appears. */
function has(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase} `);
}

/**
 * Detect a conversational repair phrase in a transcript.
 *
 * Priority: 'cancel' (most decisive) > 'undo' > 'other'. Matching is
 * whole-word and normalized, so e.g. "can" does not trigger 'cancel'.
 */
export function parseRepair(text: string): Repair {
  if (!text) return null;
  const n = normalize(text);

  // cancel
  if (
    has(n, 'cancel') ||
    has(n, 'never mind') ||
    has(n, 'nevermind') ||
    has(n, 'forget it') ||
    has(n, 'stop')
  ) {
    return 'cancel';
  }

  // undo
  if (
    has(n, 'undo') ||
    has(n, 'take it back') ||
    has(n, 'revert that') ||
    has(n, 'revert')
  ) {
    return 'undo';
  }

  // other / wrong referent
  if (
    has(n, 'the other one') ||
    has(n, 'other one') ||
    has(n, 'not that one') ||
    has(n, 'not that') ||
    has(n, 'i meant the other') ||
    has(n, 'meant the other') ||
    has(n, 'wrong one')
  ) {
    return 'other';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Self-check (commented out — do NOT execute). Expected outputs:
// ---------------------------------------------------------------------------
//
// parseRepair('No, the other one')      -> 'other'
// parseRepair('not that one')           -> 'other'
// parseRepair('I meant the other')      -> 'other'
// parseRepair('wrong one')              -> 'other'
// parseRepair('undo that')              -> 'undo'
// parseRepair('take it back')           -> 'undo'
// parseRepair('revert that')            -> 'undo'
// parseRepair('cancel')                 -> 'cancel'
// parseRepair('never mind')             -> 'cancel'
// parseRepair('forget it')              -> 'cancel'
// parseRepair('stop')                   -> 'cancel'
// parseRepair('can you tap the button') -> null   (no false 'cancel' on "can")
// parseRepair('tap the blue button')   -> null
//
// isStale(undefined, 5) -> false
// isStale(5, 5)         -> false
// isStale(4, 5)         -> true
// isStale(6, 5)         -> false
//
// const d = new CallDeduper();
// d.seen('tap', argsKey({ id: 'a' }), 1000) -> false  (first time)
// d.seen('tap', argsKey({ id: 'a' }), 1500) -> true   (dup within 1500ms)
// d.seen('tap', argsKey({ id: 'a' }), 3000) -> false  (window elapsed)
// d.seen('tap', argsKey({ id: 'b' }), 3000) -> false  (different args)
// argsKey({ b: 2, a: 1 }) === argsKey({ a: 1, b: 2 }) -> true
// argsKey(undefined) -> '{}'
