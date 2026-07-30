/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { EVAL_DECK, currentCard, isDeckComplete, deckTally, type DeckState, type ObservedGrade } from './deck';

/** The eval deck's face (design spec §4b). The whole evaluation protocol is visible from here:
 *  one card, what to try, and where you are in the twelve. It is also the outside participant's
 *  script — they read it off the screen, which is what makes a 45-minute sitting produce structured
 *  data with no moderation.
 *
 *  Panel shape is MissionPicker's, deliberately: same window family, same `data-shell` contract
 *  (App's pointer handlers skip touch-deixis and paint over `[data-shell]` surfaces that carry no
 *  `[data-entity-id]`, so tapping "It worked" must not register a false deixis point — a card that
 *  graded itself from the participant's own button press would be worthless). No `onPointerDown`
 *  stopPropagation: that broke the custom cursor over other shell surfaces (see the
 *  handlePointerMove carve-out comments in App.tsx); `data-shell` alone is what the handlers key off.
 *
 *  Deck state arrives as a prop and lives in App as SESSION-SCOPED React state — deliberately not
 *  journaled (see deck.ts's reducer header: JOURNAL_VERSION stays at 2). */
export function EvalDeck({ open, state, recording, unrecorded, onStart, onSelfGrade, onSkip, onAdvance, onClose }: {
  open: boolean;
  state: DeckState;
  /** Is the recorder actually recording? Found by driving (2026-07-30): `telemetry.push` is a no-op
   *  until a session has started, so a deck run begun before connecting grades nothing and writes no
   *  `eval_card` events — the deck's React state and the export then disagree, silently. The deck is
   *  an instrument; using it with the instrument off has to be VISIBLE, not discovered later in a
   *  short export. App passes `telemetry.eventCount() > 0`, which is exactly "a session_start has
   *  been recorded", not a proxy for it. */
  recording: boolean;
  /** How many results were recorded while the recorder was NOT recording — trials that exist in deck
   *  state and in no export (fix round 1, I7). Normally 0, because `Start the deck` is disabled until
   *  `recording`; it is reported rather than assumed-zero so a gap can never be silent. */
  unrecorded: number;
  onStart: () => void;
  onSelfGrade: (grade: ObservedGrade) => void;
  onSkip: () => void;
  onAdvance: () => void;
  onClose: () => void;
}) {
  // Focus the panel when it opens so a keyboard user lands inside the dialog; Esc closes. Same
  // pattern as MissionPicker — and the reason every control below is a real <button>.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
  if (!open) return null;

  const card = currentCard(state);
  const result = card ? state.results.find((r) => r.cardId === card.id) : undefined;
  const tally = deckTally(state);
  const total = EVAL_DECK.length;

  return (
    <div ref={panelRef} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
         className="absolute top-10 right-[21.5rem] z-40 w-80 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg p-3 pointer-events-auto outline-none"
         role="dialog" aria-label="Eval deck" data-shell>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Eval deck</span>
        <button aria-label="Close eval deck" onClick={onClose} className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={12} /></button>
      </div>

      {!recording && (
        <p role="status" className="text-[11px] text-[var(--text-primary)] mb-2 rounded-lg border border-[var(--card-border)] px-2 py-1.5">
          Nothing is being recorded yet — start the session first (the mic, or just type something).
          Cards can’t watch what isn’t recorded.
        </p>
      )}

      {state.startedAt === null && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--text-primary)]">
            {total} cards, one thing to try each. Follow them in order — the deck watches what actually
            happens and records it.
          </p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            When it can’t tell, it asks you. Skipping a card is fine: a skip is recorded, not ignored.
          </p>
          {/* I7: the deck cannot start until the recorder is recording. A run begun offline grades
              nothing (every predicate reads an empty stream) and writes no `eval_card` events, so the
              panel would claim results that no export contains. Disabled, with the reason above. */}
          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={onStart} disabled={!recording}
                    title={recording ? undefined : 'Start the session first'}>Start the deck</Button>
          </div>
        </div>
      )}

      {state.startedAt !== null && card && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">
              Card {state.index + 1} of {total}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-full border border-[var(--card-border)] text-[var(--text-primary)]">
              {card.dimension}
            </span>
          </div>
          <p className="text-sm text-[var(--text-primary)]">{card.instruction}</p>

          {result ? (
            <>
              {/* The verdict names HOW it was graded — the participant can see the difference between
                  "the app saw this" and "you told us", because the scorecard will not merge them. */}
              <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                recorded: {result.grade}
                {result.grade === 'skipped' ? '' : result.graded === 'observed' ? ' · observed' : ' · your call'}
              </p>
              <div className="flex justify-end">
                <Button size="sm" variant="primary" onClick={onAdvance}>
                  {state.index + 1 >= total ? 'Finish' : 'Next card'}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* No result yet IS "observe returned null": the observe loop records the instant a
                  predicate resolves, so an ungraded card on screen is by definition one the
                  instruments cannot (yet) settle. That is the only condition under which a
                  self-grade is offered — and only for cards whose gesture the app does not record
                  unconditionally (see EvalCard.selfGradable). */}
              {card.selfGradable ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--text-secondary)]">Did it work?</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => onSelfGrade('done')}>It worked</Button>
                    <Button size="sm" variant="outline" onClick={() => onSelfGrade('failed')}>It didn’t</Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--text-secondary)]">
                  This one records itself — do it and the deck will notice.
                </p>
              )}
              <div className="flex justify-end"><Button size="sm" onClick={onSkip}>Skip this card</Button></div>
            </>
          )}
        </div>
      )}

      {isDeckComplete(state) && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--text-primary)]">Deck complete.</p>
          {/* Counts only — never a rate. Every number here is its own n (eval spec §5), and the
              observed/your-call split is reported rather than summed. */}
          <p className="text-[11px] font-mono text-[var(--text-secondary)]">
            {tally.total} of {total} recorded · {tally.done} worked · {tally.failed} didn’t · {tally.skipped} skipped
          </p>
          <p className="text-[11px] font-mono text-[var(--text-secondary)]">
            {tally.observed} observed · {tally.self} your call
          </p>
          {unrecorded > 0 && (
            <p className="text-[11px] text-[var(--text-primary)]">
              {unrecorded} of these {unrecorded === 1 ? 'is' : 'are'} in this panel only — the recorder
              was off when {unrecorded === 1 ? 'it' : 'they'} happened, so the export does not have
              {unrecorded === 1 ? ' it' : ' them'}.
            </p>
          )}
          <div className="flex justify-end"><Button size="sm" variant="primary" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </div>
  );
}
