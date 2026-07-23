import React, { useEffect, useRef, useState } from 'react';
import { REGISTERS, resolveDials, diffDials } from '../register/registry';
import type { DialValues } from '../register/types';
import { Button } from '../ui/Button';

// The register band: backtick-summoned strip of 5 notches (4 named registers + Custom).
// A hover/focus caption underneath previews what selecting a notch would actually change —
// the honest-experiment framing (ethos + probe) plus a live diff against the CURRENT dials,
// so switching is never a surprise. Esc + outside-click close it (App also closes it via the
// backtick chord — see bandKeys.ts — this is a redundant, harmless second path).
export function RegisterBand({ current, dials, onSelect, onCustom, onClose }: {
  current: string | null;
  dials: DialValues;
  onSelect: (key: string) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const customIndex = REGISTERS.length;
  const activeIndex = current === null ? customIndex : REGISTERS.findIndex(r => r.key === current);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Skip the pill: its own click toggle owns close-on-click. If we also queued a
        // close here, React 19 batches this mousedown's setBandOpen(false) with the pill's
        // click setBandOpen(o => !o) against the same pre-click state, netting a no-op —
        // the band would never close.
        if ((e.target as HTMLElement).closest?.('[data-register-pill]')) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const caption = (() => {
    if (hover === null) return null;
    if (hover === customIndex) return <span>twiddle individual dials</span>;
    const r = REGISTERS[hover];
    const diff = diffDials(dials, resolveDials(r.key));
    const diffText = diff.map(d => `${d.dial} ${d.from}→${d.to}`).join(' · ');
    return (
      <>
        <span className="italic">{r.ethos}</span> — <span>{r.probe}</span>
        {diffText && <><br /><span className="font-mono">{diffText}</span></>}
      </>
    );
  })();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Register"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg px-3 py-2"
      data-shell
    >
      <div className="flex items-center gap-1">
        {REGISTERS.map((r, i) => (
          <Button
            key={r.key}
            variant={activeIndex === i ? 'primary' : 'ghost'}
            size="sm"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onMouseLeave={() => setHover(h => (h === i ? null : h))}
            onBlur={() => setHover(h => (h === i ? null : h))}
            onClick={() => onSelect(r.key)}
            className="hit-24 flex flex-col items-center gap-0.5 px-2.5 py-1 leading-tight"
            aria-label={`Register: ${r.label} — press ${i + 1}`}
          >
            <span className="flex items-center gap-1 text-[13px]">
              <span aria-hidden>{r.glyph}</span>{r.label}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] opacity-60">{r.era}</span>
              <kbd className="text-[9px] opacity-50">{i + 1}</kbd>
            </span>
          </Button>
        ))}
        <Button
          variant={activeIndex === customIndex ? 'primary' : 'ghost'}
          size="sm"
          onMouseEnter={() => setHover(customIndex)}
          onFocus={() => setHover(customIndex)}
          onMouseLeave={() => setHover(h => (h === customIndex ? null : h))}
          onBlur={() => setHover(h => (h === customIndex ? null : h))}
          onClick={onCustom}
          className="hit-24 flex flex-col items-center gap-0.5 px-2.5 py-1 leading-tight"
          aria-label={`Custom register — press ${customIndex + 1}`}
        >
          <span className="text-[13px]">✎ Custom</span>
          <kbd className="text-[9px] opacity-50">{customIndex + 1}</kbd>
        </Button>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] text-center max-w-[520px] min-h-[2.6em]">
        {caption}
      </p>
    </div>
  );
}
