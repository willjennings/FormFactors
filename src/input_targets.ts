// G8: Pointer-free input fallback for a voice point-and-speak app.
//
// This module is fully self-contained, pure, and deterministic. It exposes a
// small API for turning a list of detected interactive objects into numbered
// targets that a user can select either by voice ("number two", "the second
// one", "the last one") or by pressing a number key.
//
// No React. No imports from App.tsx. No Date.now(). No side effects.

/** Minimal shape this module needs from an interactive object. */
export interface Targetable {
  name: string;
}

/** A user-selectable target with a stable 1-based number. */
export interface NumberedTarget {
  number: number;
  name: string;
}

/** Objects with this name are never assigned a selection number. */
const EXCLUDED_NAMES: ReadonlySet<string> = new Set(["Google Maps"]);

/**
 * Assign 1-based numbers to objects in order, skipping any excluded object
 * (e.g. "Google Maps"). Numbering is contiguous over the included objects.
 */
export function assignTargetNumbers(
  objects: { name: string }[],
): NumberedTarget[] {
  const result: NumberedTarget[] = [];
  let next = 1;
  for (const obj of objects) {
    if (EXCLUDED_NAMES.has(obj.name)) {
      continue;
    }
    result.push({ number: next, name: obj.name });
    next += 1;
  }
  return result;
}

// Cardinal number words: "one".."ten" -> 1..10.
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

// Ordinal words: "first".."tenth" -> 1..10.
const ORDINAL_WORDS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

/** Normalize: lowercase, strip punctuation to spaces, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Within range [1, count]? */
function inRange(n: number, count: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= count;
}

/**
 * Parse a spoken phrase into a 1-based target number in [1, count], or null.
 *
 * Recognized forms (case-insensitive, punctuation-insensitive):
 *   - explicit selection words + value: "number 2", "number two", "select 3",
 *     "option two", "pick 1", "choose the second".
 *   - "the last one" / "last" -> count.
 *   - ordinals: "the first one", "second", "the third", "1st", "2nd", "fourth".
 *   - a bare cardinal: only when the phrase is short/selection-like
 *     (e.g. "2", "two") to avoid false positives in normal speech.
 *
 * Returns null when nothing matches or the parsed value is out of range.
 */
export function parseTargetSelection(text: string, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  const norm = normalize(text);
  if (norm.length === 0) {
    return null;
  }
  const words = norm.split(" ");

  // 1) "the last one" / "last" -> count.
  if (/\blast\b/.test(norm)) {
    return count; // count is in range by construction (count >= 1).
  }

  // 2) Numeric ordinals: "1st", "2nd", "3rd", "4th", ...
  const ordinalDigit = norm.match(/\b(\d+)(st|nd|rd|th)\b/);
  if (ordinalDigit) {
    const n = parseInt(ordinalDigit[1], 10);
    return inRange(n, count) ? n : null;
  }

  // 3) Ordinal words anywhere: "first", "the third one", "second".
  for (const w of words) {
    const ord = ORDINAL_WORDS[w];
    if (ord !== undefined) {
      return inRange(ord, count) ? ord : null;
    }
  }

  // 4) Explicit selection lead-in word followed (eventually) by a value.
  //    e.g. "number 2", "option two", "select 3", "pick the one", "choose two".
  const SELECTION_WORDS: ReadonlySet<string> = new Set([
    "number",
    "option",
    "select",
    "pick",
    "choose",
    "target",
    "item",
    "choice",
    "no",
    "num",
  ]);
  for (let i = 0; i < words.length; i++) {
    if (!SELECTION_WORDS.has(words[i])) {
      continue;
    }
    // Look at the rest of the phrase for the first cardinal value.
    for (let j = i + 1; j < words.length; j++) {
      const value = wordToNumber(words[j]);
      if (value !== null) {
        return inRange(value, count) ? value : null;
      }
    }
  }

  // 5) Bare cardinal, but only for short / selection-like phrases to avoid
  //    false positives on normal speech. Allow up to 3 tokens, all of which
  //    must be "filler" except the single number token.
  if (words.length <= 3) {
    let found: number | null = null;
    let extras = 0;
    for (const w of words) {
      const value = wordToNumber(w);
      if (value !== null) {
        if (found !== null) {
          // More than one number -> ambiguous, bail out.
          return null;
        }
        found = value;
      } else if (!FILLER_WORDS.has(w)) {
        extras += 1;
      }
    }
    // Permit at most one non-filler, non-number token (e.g. "the 2").
    if (found !== null && extras <= 1) {
      return inRange(found, count) ? found : null;
    }
  }

  return null;
}

// Tokens that may surround a bare number without disqualifying it.
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "one", // also a cardinal; handled separately by wordToNumber when standalone
  "please",
  "uh",
  "um",
  "this",
  "that",
  "go",
  "to",
]);

/** Parse a single token as a cardinal: digits or "one".."ten". */
function wordToNumber(token: string): number | null {
  if (/^\d+$/.test(token)) {
    return parseInt(token, 10);
  }
  const word = NUMBER_WORDS[token];
  return word === undefined ? null : word;
}

// ---------------------------------------------------------------------------
// Self-check (NOT executed). Expected parseTargetSelection outputs, count = 5
// unless noted:
//
//   parseTargetSelection("number 2", 5)        === 2
//   parseTargetSelection("number two", 5)      === 2
//   parseTargetSelection("select 3", 5)        === 3
//   parseTargetSelection("option two", 5)      === 2
//   parseTargetSelection("2", 5)               === 2
//   parseTargetSelection("the first one", 5)   === 1
//   parseTargetSelection("second", 5)          === 2
//   parseTargetSelection("the third", 5)       === 3
//   parseTargetSelection("1st", 5)             === 1
//   parseTargetSelection("2nd", 5)             === 2
//   parseTargetSelection("3rd", 5)             === 3
//   parseTargetSelection("fourth", 5)          === 4
//   parseTargetSelection("the last one", 5)    === 5
//   parseTargetSelection("last", 3)            === 3
//   parseTargetSelection("number 9", 5)        === null   (out of range)
//   parseTargetSelection("seventh", 5)         === null   (out of range)
//   parseTargetSelection("hello there", 5)     === null   (no match)
//   parseTargetSelection("take me to the park about 2 hours away", 5) === null
//
// assignTargetNumbers self-check:
//   assignTargetNumbers([{name:"A"},{name:"Google Maps"},{name:"B"}])
//     === [{number:1,name:"A"},{number:2,name:"B"}]
// ---------------------------------------------------------------------------
