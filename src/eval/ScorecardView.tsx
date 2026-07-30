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
// filesystem makes that pair genuinely ambiguous to the TypeScript compiler here (TS2724/TS1149:
// a program cannot contain `scorecard.ts` and `Scorecard.tsx` at once — "differs ... only in
// casing" — even though the two extensions differ), so this file is `ScorecardView.tsx` instead.
// Exported names are unchanged (`Scorecard`, `ScorecardMini`); only the file on disk is renamed.

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

      <Bucket label="Good at" lines={model.goodAt} />
      <Bucket label="Shaky" lines={model.shaky} />

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Latency</span>
        <p className="text-[12px] text-[var(--text-primary)]">
          first response median {fmtMs(model.latency.medianMs)}
          {model.latency.worst && ` · slowest ${fmtMs(model.latency.worst.ms)} (${model.latency.worst.label})`}
        </p>
        {model.latency.coldStartMs !== null && (
          // Cold-start figure, reported separately — spec §1: never averaged into the line above,
          // never dropped either.
          <p className="text-[11px] text-[var(--text-secondary)]">cold start (session connect): {fmtMs(model.latency.coldStartMs)}, excluded from the median above</p>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Cost</span>
        <p className="text-[12px] text-[var(--text-primary)]">{model.cost.frames} frames, {model.cost.hints} hints sent</p>
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
      <p className="text-[11px] text-[var(--text-primary)]">{model.headline}</p>
      {model.watch.length > 0 && (
        <p className="text-[11px] text-[var(--text-primary)] truncate" title={model.watch[0]}>watch: {model.watch[0]}</p>
      )}
      <p className="text-[11px] text-[var(--text-secondary)]">{model.comparison}</p>
    </div>
  );
}
