/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EntityId } from './entities/registry';

// --- Referent registry: cross-turn anaphora for the point-and-speak app ---
//
// The app resolves a user's deictic ("this/here") to an element NAME (a string
// such as "Save button", "Document body", "Cell A1", "Slide canvas"). This
// module remembers the recently-referenced names so later turns can resolve
// back-references like:
//
//   "make THAT bold"            -> most recent pointed referent
//   "send the chart I just MADE" -> a recently CREATED referent whose noun matches
//   "put IT back"               -> most recent pointed referent
//
// It is pure and deterministic except for timestamps. IMPORTANT: no Date.now()
// is called at module load time — only inside methods, at runtime.

export type ReferentKind = 'pointed' | 'created';

export type Referent = {
  /** The display name, e.g. "Save button" or a perceived label. */
  name: string;
  /** Stable entity id when the referent IS a scene entity (quoted OCR words and created doc-objects have none). */
  id?: EntityId | null;
  /** How this referent entered the conversation. */
  kind: ReferentKind;
  /** Timestamp (ms) the referent was last noted. */
  t: number;
};

// Normalize for token matching: collapse to lowercase alphanumerics + spaces.
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tokenize = (s: string): string[] => {
  const n = normalize(s);
  return n ? n.split(' ') : [];
};

// Default window for "recent" (ms).
const DEFAULT_WINDOW_MS = 60_000;
// Re-noting the same name within this window just refreshes the timestamp.
const DEDUPE_WINDOW_MS = 60_000;

// Pronouns / phrases that bare-refer to the most recent pointed referent.
const BARE_PRONOUNS = new Set([
  'that',
  'it',
  'this',
  'this one',
  'that one',
  'the same',
  'same',
  'the same one',
]);

// Leading determiners/quantifiers to strip when looking for "the X" patterns.
const LEADING_DETERMINERS = new Set(['the', 'that', 'this', 'a', 'an', 'my']);

// Interrogatives/auxiliaries that mark a question — "it"/"that" there isn't anaphoric
// ("what time is it", "is that all"), so we don't resolve a referent from them.
const INTERROGATIVES = new Set([
  'what', 'when', 'where', 'why', 'who', 'whom', 'whose', 'which', 'how',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should',
]);

// Trailing "...I just made/created/added" style suffixes we tolerate.
const CREATION_VERBS = new Set(['made', 'created', 'added', 'inserted']);

export class ReferentRegistry {
  private items: Referent[] = [];

  /** Runtime clock. Isolated so logic stays testable; never called at load time. */
  private now(): number {
    return Date.now();
  }

  /**
   * Record a referent with the current timestamp. If the same name was noted
   * within DEDUPE_WINDOW_MS, refresh its timestamp/kind instead of appending.
   */
  note(name: string, kind: ReferentKind, id: EntityId | null = null): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    if (!key) return;

    const t = this.now();
    const existing = this.items.find(
      (r) => normalize(r.name) === key && t - r.t <= DEDUPE_WINDOW_MS,
    );
    if (existing) {
      existing.t = t;
      existing.kind = kind;
      existing.name = trimmed;
      existing.id = id ?? existing.id;
      return;
    }
    this.items.push({ name: trimmed, id, kind, t });
  }

  /**
   * Referents noted within `windowMs` (default 60s), newest first, deduped by
   * normalized name (keeping the newest occurrence).
   */
  recent(windowMs: number = DEFAULT_WINDOW_MS): Referent[] {
    const cutoff = this.now() - windowMs;
    const seen = new Set<string>();
    const out: Referent[] = [];
    // Iterate newest-first so the first occurrence per name is the newest.
    const sorted = [...this.items].filter((r) => r.t >= cutoff).sort((a, b) => b.t - a.t);
    for (const r of sorted) {
      const key = normalize(r.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  /**
   * Resolve a spoken phrase to a recent referent NAME, or null.
   *
   *  - Bare pronouns ("that", "it", "this one", "the same") resolve to the most
   *    recent POINTED referent (falling back to the most recent of any kind).
   *  - "the X I just made/created" or "the X" resolve to a recent CREATED
   *    referent whose name contains the noun X.
   */
  resolveAnaphora(phrase: string): string | null {
    const norm = normalize(phrase);
    if (!norm) return null;
    const recent = this.recent();
    if (recent.length === 0) return null;

    // 1) Bare pronoun / "the same" -> most recent pointed (then most recent any).
    if (BARE_PRONOUNS.has(norm)) {
      const pointed = recent.find((r) => r.kind === 'pointed');
      return (pointed ?? recent[0]).name;
    }

    // 2) Extract a candidate noun phrase from patterns like
    //    "the X", "the X I just made", "send the X i created".
    const noun = this.extractNoun(tokenize(norm));
    if (noun.length > 0) {
      const created = this.matchByTokens(
        recent.filter((r) => r.kind === 'created'),
        noun,
      );
      if (created) return created.name;

      // Fall back to any recent referent whose name matches the noun tokens.
      const any = this.matchByTokens(recent, noun);
      if (any) return any.name;
    }

    // 3) Phrase may simply CONTAIN a bare pronoun (e.g. "put it back",
    //    "make that bold"). Look for a standalone pronoun token — but NOT in a
    //    question ("what time is it", "is it on"), where "it" isn't anaphoric.
    const toks = tokenize(norm);
    const isQuestion = INTERROGATIVES.has(toks[0]) || /\?\s*$/.test(phrase);
    if (!isQuestion && toks.some((tok) => tok === 'it' || tok === 'that' || tok === 'this')) {
      const pointed = recent.find((r) => r.kind === 'pointed');
      return (pointed ?? recent[0]).name;
    }

    return null;
  }

  /** Compact one-line context string for the model, or '' if nothing recent. */
  promptContext(): string {
    const recent = this.recent();
    if (recent.length === 0) return '';
    const now = this.now();
    const parts = recent.map((r) => {
      const ago = Math.max(0, Math.round((now - r.t) / 1000));
      return `${r.name} (${r.kind} ${ago}s ago)`;
    });
    return `Recently referenced: ${parts.join(', ')}.`;
  }

  /** Reset the registry (session end / program switch / reset). */
  clear(): void {
    this.items = [];
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Pull the noun tokens out of a normalized phrase. Strips a leading verb +
   * determiner ("send the X", "the X") and any trailing "i just made" clause.
   */
  private extractNoun(tokens: string[]): string[] {
    let toks = [...tokens];

    // Drop a trailing creation clause: "... i just made", "... that i created".
    const justIdx = toks.indexOf('just');
    const iIdx = toks.indexOf('i');
    const cutAt = [justIdx, iIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (cutAt !== undefined && cutAt >= 0) {
      toks = toks.slice(0, cutAt);
    }
    // Also drop any standalone trailing creation verb.
    while (toks.length && CREATION_VERBS.has(toks[toks.length - 1])) {
      toks = toks.slice(0, -1);
    }

    // Find the last leading determiner and take what's after it as the noun.
    let lastDet = -1;
    for (let i = 0; i < toks.length; i++) {
      if (LEADING_DETERMINERS.has(toks[i])) lastDet = i;
    }
    if (lastDet >= 0) {
      return toks.slice(lastDet + 1);
    }
    // No determiner: treat the whole (already trimmed) phrase as the noun.
    return toks;
  }

  /**
   * Find the referent whose normalized name shares the most noun tokens with
   * `noun`. Requires at least one overlapping token. Ties break to the newest
   * (callers pass an already newest-first list).
   */
  private matchByTokens(candidates: Referent[], noun: string[]): Referent | null {
    if (noun.length === 0) return null;
    const wanted = new Set(noun);
    let best: Referent | null = null;
    let bestScore = 0;
    for (const r of candidates) {
      const nameToks = tokenize(r.name);
      let score = 0;
      for (const tok of nameToks) {
        if (wanted.has(tok)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return bestScore > 0 ? best : null;
  }
}

/** Singleton registry shared across the app. */
export const referents = new ReferentRegistry();

// ── tiny self-check (do NOT execute) ──────────────────────────────────────────
//
// referents.note('Save button', 'pointed');   // t = now
// referents.note('Chart', 'created');          // t = now (most recent)
//
// referents.resolveAnaphora('make that bold');          // -> 'Save button'
// referents.resolveAnaphora('put it back');             // -> 'Save button'
// referents.resolveAnaphora('the same one');            // -> 'Save button'
// referents.resolveAnaphora('send the chart I just made'); // -> 'Chart'
// referents.resolveAnaphora('the chart');               // -> 'Chart'
// referents.resolveAnaphora('open the spreadsheet');    // -> null (no match)
//
// referents.promptContext();
//   // -> 'Recently referenced: Chart (created 0s ago), Save button (pointed 0s ago).'
