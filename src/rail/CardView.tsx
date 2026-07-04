import React from 'react';
import { Check, X as XIcon, MousePointer2 } from 'lucide-react';
import type { RailCard } from './types';

const KICKER: Record<RailCard['t'], string> = { do: 'DO', answer: 'ANSWER', orient: 'ORIENT', check: 'CHECK', caution: 'CAUTION', concept: 'CONCEPT', try: 'TRY', recap: 'RECAP' };

/** One card: kicker → action line (bold the THING) → result line → quiet why?/show-me. */
export function CardView({ card, index, mode, whyOpen, flipped, onWhy, onFlip, onShowMe, onCheckConfirm }: {
  card: RailCard; index: number; mode: 'stub' | 'active' | 'dimmed';
  whyOpen: boolean; flipped: boolean;
  onWhy: () => void; onFlip: () => void; onShowMe: () => void; onCheckConfirm: () => void;
}) {
  if (mode === 'stub') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)]">
        <Check size={10} className="text-emerald-500 shrink-0" />
        <span className="truncate">{card.text ?? card.front ?? card.lines?.[0] ?? card.prompt}</span>
      </div>
    );
  }
  const dim = mode === 'dimmed';
  const boldTarget = (text: string) =>
    card.target && text.includes(card.target)
      ? (<>{text.split(card.target)[0]}<strong>{card.target}</strong>{text.split(card.target).slice(1).join(card.target)}</>)
      : text;
  return (
    <div className={`rounded-xl border px-3 py-2 bg-[var(--card-bg)] ${dim ? 'opacity-40 border-[var(--card-border)]' : card.state === 'failed' ? 'border-red-400/60' : 'border-[var(--accent-color)]/50 shadow-sm'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{KICKER[card.t]}{card.subgoal ? ` · ${card.subgoal}` : ''}</span>
        {card.target && (
          <MousePointer2 size={11} className={card.band === 'solid' ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)] opacity-40'}
            fill={card.band === 'solid' ? 'currentColor' : 'none'} />
        )}
      </div>
      {card.t === 'concept' ? (
        <button onClick={onFlip} className="w-full text-left">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">{card.front}</p>
          {flipped && <p className="text-[12px] text-[var(--text-primary)] mt-1">{card.back}{card.analogy ? <em className="block text-[var(--text-secondary)]">{card.analogy}</em> : null}</p>}
          {!flipped && <span className="text-[10px] font-mono text-[var(--accent-color)]">flip</span>}
        </button>
      ) : card.t === 'recap' ? (
        <ul className="mt-0.5">{card.lines?.map((l, i) => <li key={i} className="text-[12px] text-[var(--text-primary)]">{l}</li>)}</ul>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-[var(--text-primary)] mt-0.5">
            {card.band === 'hollow' && card.t === 'do'
              ? <>Find <strong>{card.target}</strong> — I can't point at it. {card.text && boldTarget(card.text)}</>
              : boldTarget(card.text ?? card.prompt ?? '')}
          </p>
          {card.result && <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-0.5">→ {card.result}</p>}
          {card.notice && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Notice: {card.notice}</p>}
          {card.t === 'check' && card.state === 'failed' && (
            <p className="text-[11px] text-red-500 mt-0.5 flex items-center gap-1"><XIcon size={11} /> not yet — {card.text}</p>
          )}
          {card.t === 'check' && card.verify === 'user' && card.state === 'active' && (
            <button onClick={onCheckConfirm} className="mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-[var(--card-border)] text-[var(--text-primary)] hover:border-[var(--accent-color)]">confirm for me ✓</button>
          )}
        </>
      )}
      {!dim && (card.why || (card.entityId && card.band === 'solid')) && (
        <div className="flex items-center gap-3 justify-end mt-1">
          {card.why && <button onClick={onWhy} className="text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)]">why?</button>}
          {card.entityId && card.band === 'solid' && <button onClick={onShowMe} className="text-[10px] font-mono text-[var(--accent-color)]">show me</button>}
        </div>
      )}
      {whyOpen && card.why && <p className="text-[11px] text-[var(--text-secondary)] mt-1 border-t border-[var(--card-border)] pt-1">{card.why}</p>}
    </div>
  );
}
