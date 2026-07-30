/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The scorecard's face (design spec §4b): a thin map over `ScorecardModel` (./scorecard.ts).
// Every number and every line was already computed by `scorecard()` — nothing here re-derives a
// rate, re-grades an attempt, or decides a bucket. Two exports: `Scorecard` (the full card,
// completion-of-deck / end-of-session surface) and `ScorecardMini` (DebugDrawer's compact live
// version — same model, fewer pixels, never a separate design per spec §4b's own closing line).
//
// FILE NAME: the task-8 brief names this `src/eval/Scorecard.tsx` (matching `./scorecard.ts`'s
// casing exactly, as `EvalDeck.tsx`/`deck.ts` do). macOS's case-insensitive-but-case-preserving
// filesystem makes that pair genuinely ambiguous to TypeScript's IMPORT SPECIFIER resolution (fix
// round 1, M6; fix round 2, N13, present-tense claim about a predecessor's temporary experiment
// removed): `from './Scorecard'` resolves case-insensitively to `scorecard.ts` first, and the
// compiler then reports TS2724 ("has no exported member named 'Scorecard'. Did you mean
// 'scorecard'?") plus TS1149 ("File name '.../Scorecard.ts' differs from ... 'scorecard.ts' only
// in casing") the moment any file actually imports from the differently-cased path. So this file
// is `ScorecardView.tsx` instead. Exported names are unchanged (`Scorecard`, `ScorecardMini`);
// only the file on disk is renamed.

import React from 'react';
import type { ScorecardModel } from './scorecard';

const fmtMs = (ms: number | null): string => ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;

/** A labelled bucket of plain-language lines. Renders nothing when the bucket is empty — an
 *  empty Shaky (the flattery test's own case) is a real, honest result and must not render a
 *  placeholder "nothing to show" line that looks the same as one nobody bothered to check. */
function Bucket({ label, lines }: { label: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{label}</span>
      {lines.map((l, i) => (
        <p key={i} className="text-[12px] text-[var(--text-primary)] leading-snug">{l}</p>
      ))}
    </div>
  );
}

export function Scorecard({ model }: { model: ScorecardModel }) {
  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]" role="region" aria-label="Scorecard">
      <p className="text-sm font-medium text-[var(--text-primary)]">{model.headline}</p>
      {model.abandoned && (
        // N2 (fix round 2, reviewer-ruled): the toast/rail/log already announce abandonment
        // distinctly at the moment it happens, but this panel can be read later (or reopened) —
        // spec §5.6's "abandonment is data, not absence" belongs on the persistent card too, not
        // only the transient feedback around it.
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-600 dark:text-amber-400">
          Abandoned — closed before the deck finished
        </p>
      )}

      <Bucket label="Good at" lines={model.goodAt} />
      <Bucket label="Shaky" lines={model.shaky} />

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Latency</span>
        <p className="text-[12px] text-[var(--text-primary)]">
          {/* I3 (fix round 1): a median with no n misreports itself as the same kind of number
              whether it came from 2 samples or 200 (armAggregate.ts's own doctrine, applied here
              to this module's own medians for the first time). */}
          first response median {fmtMs(model.latency.medianMs)}{model.latency.warmN > 0 && ` (n=${model.latency.warmN})`}
          {model.latency.worst && ` · slowest ${fmtMs(model.latency.worst.ms)} (${model.latency.worst.label})`}
        </p>
        {model.latency.coldStartMs !== null && (
          // Cold-start figure, reported separately — spec §1: never averaged into the line above,
          // never dropped either. Named explicitly as a MEDIAN OF SESSIONS (I3): it is not one
          // connect's time, it is the lower median across `coldStartN` sessions' own row-1.
          <p className="text-[11px] text-[var(--text-secondary)]">
            {/* N11 (fix round 2): possessive apostrophe, not a pluralised-noun apostrophe —
                "1 session's" not "1 session'". */}
            cold start (session connect): {fmtMs(model.latency.coldStartMs)}, median of {model.latency.coldStartN} session{model.latency.coldStartN === 1 ? "'s" : "s'"} first turns — excluded from the median above
          </p>
        )}
        {model.latency.sessionCount > 1 && (
          // I3: latency reads the WHOLE sitting, not "this session" — say so when it actually spans
          // more than one, rather than leaving the scope to be assumed.
          <p className="text-[11px] text-[var(--text-secondary)]">across {model.latency.sessionCount} sessions this sitting</p>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Cost</span>
        <p className="text-[12px] text-[var(--text-primary)]">
          {model.cost.frames} frames, {model.cost.hints} hints sent
          {model.cost.sessionCount > 1 && ` — across ${model.cost.sessionCount} sessions this sitting`}
        </p>
      </div>

      <Bucket label="Watch" lines={model.watch} />

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Comparison</span>
        <p className="text-[12px] text-[var(--text-primary)]">{model.comparison}</p>
      </div>

      <p className="text-[11px] font-mono text-[var(--text-secondary)]">{model.deckSummary}</p>
    </div>
  );
}

/** DebugDrawer's compact live version — the same model, three lines: headline, the top of
 *  Watch (if anything), and the comparison string. No independent computation, no separate
 *  copy — a thinner map over the identical `ScorecardModel`, per spec §4b. */
export function ScorecardMini({ model }: { model: ScorecardModel }) {
  return (
    <div className="flex flex-col gap-1" aria-label="Scorecard (live)">
      <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Scorecard</span>
      <p className="text-[11px] text-[var(--text-primary)]">{model.headline}{model.abandoned && ' (abandoned)'}</p>
      {model.watch.length > 0 && (
        // M3 (fix round 1, reviewer-ruled): Watch is the ONE bucket the spec says must never be
        // dropped — a live miniature that silently truncated rows 2..n to fit three lines would be
        // a small version of the exact rule this bucket exists to enforce. "+N more" keeps the
        // truncation (this is still a miniature), but never hides that there IS more.
        <p className="text-[11px] text-[var(--text-primary)] truncate" title={model.watch.join(' · ')}>
          watch: {model.watch[0]}{model.watch.length > 1 && ` (+${model.watch.length - 1} more)`}
        </p>
      )}
      <p className="text-[11px] text-[var(--text-secondary)]">{model.comparison}</p>
    </div>
  );
}
