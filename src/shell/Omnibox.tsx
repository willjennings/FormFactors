import React, { useState } from 'react';
import { Mic, MicOff, CornerDownLeft, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';
// One constant for the whole ask surface — the question line and its candidate chips are one
// thing and must not drift into two colours the way a duplicated literal eventually would.
import { ASK_CHIP_COLOR } from '../actions/askContent';

export type Suggestion = { key: string; label: string; phrase: string; color: string };
export type GroundingChip = { id: string; title: string; color: string };

export function Omnibox({ isLive, isConnecting, error, transcript, suggestions, firstRunHint, restoredDraft, modelCaption, busy = false, grounding = [], quickFireEcho = null, tray, askQuestion = null, onRemoveGrounding, onRemoveTray, onFireTray, onSubmit, onMicToggle, onChipTap, above }: {
  isLive: boolean; isConnecting: boolean; error: string | null; transcript: string | null;
  suggestions: Suggestion[]; firstRunHint: boolean;
  /** An open unspecified ask's question — rendered as its own line above the chips AND as the
   *  input's placeholder. It is a prompt, not a mode: the field stays free, so the user may
   *  answer it, ignore it and type something else, or say the answer out loud instead. */
  askQuestion?: string | null;
  restoredDraft?: { text: string; at: number } | null;
  /** The model's speech as text — the response window for muted speakers. Persists post-query. */
  modelCaption?: { text: string; final: boolean } | null;
  /** A model turn is in flight and nothing has streamed yet — show the honest thinking pulse. */
  busy?: boolean;
  /** Elements the user selected on screen — mirrored 1:1 as chips; sent with the query. */
  grounding?: GroundingChip[];
  /** Transient echo of a quick-fired chip: what was just asked, about what (chain visibility). */
  quickFireEcho?: { n: number; phrase: string; referent: string | null; at: number } | null;
  /** The combine tray (spec §5.2/5.3) — distinct from grounding: this is "make a new artifact
   *  from these", filled by shift-click, not "my next utterance is about these". */
  tray?: { sourceId: string; title: string; color: string }[];
  onRemoveGrounding?: (id: string) => void;
  onRemoveTray?: (sourceId: string) => void;
  onFireTray?: (kind: 'doc' | 'widget') => void;
  onSubmit: (text: string) => void; onMicToggle: () => void; onChipTap: (s: Suggestion) => void;
  /** Rendered at the top of the bottom-center column (witness cards) so cards and the
   *  caption/chips STACK instead of overlapping (human smoke 2026-07-16). */
  above?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  // Restore typed text that was lost when a cold-start connect failed (R1 path).
  React.useEffect(() => { if (restoredDraft) setDraft(restoredDraft.text); }, [restoredDraft?.at]);
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(640px,90vw)] flex flex-col items-stretch gap-2" data-shell onPointerDown={(e) => e.stopPropagation()}>
      {above}
      {firstRunHint && !isLive && (
        <p className="text-center text-[11px] font-mono text-[var(--text-secondary)]">Point at things and ask — or type.</p>
      )}
      {busy && modelCaption?.final !== false && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg px-3 py-2 flex items-center gap-2" aria-label="Assistant is working">
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">assistant</span>
          <span className="flex gap-1" aria-hidden>
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce [animation-delay:300ms]" />
          </span>
        </div>
      )}
      {modelCaption?.text && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg px-3 py-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">assistant</span>
          <p className="text-[12px] text-[var(--text-primary)] leading-snug">
            {modelCaption.text}
            {!modelCaption.final && <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--accent-color)] animate-pulse align-middle" />}
          </p>
        </div>
      )}
      {quickFireEcho && (
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur text-[11px] font-mono text-[var(--text-primary)] shadow-sm">
            <kbd className="px-1 rounded border border-[var(--card-border)] bg-[var(--bg-color)] text-[10px] text-[var(--text-secondary)]">{quickFireEcho.n}</kbd>
            {quickFireEcho.phrase}
            {quickFireEcho.referent && <span className="text-[var(--text-secondary)]">→ {quickFireEcho.referent}</span>}
          </span>
        </div>
      )}
      {/* The open question, kept VISIBLE while it is being answered. The placeholder below
          carries it too, but a placeholder disappears at the first keystroke — i.e. exactly
          when the user is answering — and never shows at all if a draft is already in the
          field. Not a modal: nothing is disabled, focus is not moved or trapped. */}
      {askQuestion && (
        <div className="rounded-2xl border bg-[var(--card-bg)]/90 backdrop-blur shadow-lg px-3 py-2"
          style={{ borderColor: `rgba(${ASK_CHIP_COLOR},0.45)` }} role="status">
          <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: `rgb(${ASK_CHIP_COLOR})` }}>question</span>
          <p className="text-[12px] text-[var(--text-primary)] leading-snug">{askQuestion}</p>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
          {suggestions.map((s, i) => (
            <Tip key={s.key} label={i < 9 ? `${s.label} — press ${i + 1}` : s.label}>
              <Button
                size="chip"
                variant="outline"
                onClick={() => { setDraft(s.phrase); onChipTap(s); }}
                className="shrink-0 font-mono bg-[var(--card-bg)]/85 backdrop-blur text-[var(--text-primary)] hover:border-[var(--accent-color)]"
                style={{ boxShadow: `inset 2px 0 0 rgb(${s.color})` }}
              >
                {/* Quick-fire keycap: press the digit to send this chip WITHOUT moving the
                    pointer off the referent (the click would). */}
                {i < 9 && <kbd className="mr-1.5 px-1 rounded border border-[var(--card-border)] bg-[var(--bg-color)] text-[10px] leading-4 text-[var(--text-secondary)]">{i + 1}</kbd>}
                {s.phrase}
              </Button>
            </Tip>
          ))}
        </div>
      )}
      {(error || transcript) && (
        <p className={`text-center text-[11px] font-mono ${error ? 'text-red-500' : 'text-[var(--text-secondary)] italic'}`}>
          {error ?? transcript}
        </p>
      )}
      {tray && tray.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-1 pb-1">
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">combine</span>
          {tray.map((t) => (
            <span key={t.sourceId} className="flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[11px]"
              style={{ borderColor: t.color }}>
              {t.title}
              <button aria-label={`Remove ${t.title} from the combine tray`} className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => onRemoveTray?.(t.sourceId)}>×</button>
            </span>
          ))}
          {tray.length >= 2 && (
            <>
              <button className="hit-24 rounded-full bg-[var(--accent-color)]/15 px-2 text-[11px] text-[var(--accent-color)]"
                onClick={() => onFireTray?.('doc')}>combine these → doc</button>
              <button className="hit-24 rounded-full bg-[var(--accent-color)]/15 px-2 text-[11px] text-[var(--accent-color)]"
                onClick={() => onFireTray?.('widget')}>→ widget</button>
            </>
          )}
        </div>
      )}
      <form
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSubmit(draft); setDraft(''); } }}
      >
        <Tip label={isLive ? 'End voice session' : 'Start voice session'}>
          <Button
            size="icon48"
            variant="ghost"
            onClick={onMicToggle}
            disabled={isConnecting}
            className={isLive ? 'bg-green-500/15 text-green-500 hover:bg-green-500/20' : ''}
          >
            {isLive ? <Mic size={16} /> : <MicOff size={16} />}
          </Button>
        </Tip>
        {grounding.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 max-w-[45%] overflow-hidden">
            {grounding.map(c => (
              <span key={c.id}
                className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-xs font-mono border border-[var(--card-border)] bg-[var(--bg-color)] text-[var(--text-primary)] whitespace-nowrap"
                style={{ boxShadow: `inset 2px 0 0 rgb(${c.color})` }}
                title={`Grounded on ${c.title} — sent with your query`}
              >
                {c.title}
                {/* ✕ uses hit-24 (not hit-44): chips sit in a tight row, so the standard
                    44px invisible hit area would overlap the adjacent chip. Per WCAG 2.2
                    §2.5.8 spacing exception, ≥24px hit + ≥24px gap to next target satisfies
                    the target-size requirement. gap-1.5 (6px) is the visual gap; the chip
                    pr-1 + next chip's pl-2 together give ≥24px clearance between tap targets. */}
                <Tip label="Remove">
                  <Button
                    type="button"
                    size="icon44"
                    variant="ghost"
                    onClick={() => onRemoveGrounding?.(c.id)}
                    className="w-6 h-6 hit-24 p-0 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X size={9} />
                  </Button>
                </Tip>
              </span>
            ))}
          </div>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={askQuestion ?? (grounding.length ? 'Ask about your selection…' : 'Ask or tell me anything — point while you type')}
          disabled={isConnecting}
          className="flex-1 min-h-6 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        <Tip label="Submit">
          <Button
            type="submit"
            size="icon44"
            variant="ghost"
            disabled={isConnecting || !draft.trim()}
            className="text-[var(--accent-color)] hover:bg-[var(--accent-color)]/10"
          >
            <CornerDownLeft size={15} />
          </Button>
        </Tip>
      </form>
    </div>
  );
}
