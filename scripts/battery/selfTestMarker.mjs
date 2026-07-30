/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// NEW-2 (settle-detector re-review, 2026-07-30): the ONE shared constant between run.mjs (which
// SENDS this text as a dedicated, out-of-band utterance and injects a synthetic reply for it — see
// `injectDrySettleReply`'s own doc) and ts-bridge.ts (which FILTERS any `turn` event carrying this
// exact `request` text OUT of grading — see `grade`'s own comment). Living in its own file, not
// duplicated as a string literal in each, is what makes it impossible for the two ends of this
// contract to drift apart: a `turn` event ts-bridge doesn't recognize as the self-test would
// silently re-enter the graded corpus (NEW-2's original defect), and a marker run.mjs changes
// without updating this file would break the filter the same way.
//
// Deliberately NOT natural language and NOT a prefix/substring any real utterance in
// `src/eval/utterances.ts` could ever plausibly produce (bracketed, all-caps-free, and stating its
// own purpose) — an exact-match filter on this string is therefore safe against ever accidentally
// excluding real corpus data.
export const DRY_SELF_TEST_REQUEST = '[[settle-detector dry self-test — not corpus data]]';
