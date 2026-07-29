import React, { useEffect, useRef, useState } from 'react';
import { REGISTERS, resolveDials, diffDials } from '../register/registry';
import type { DialValues } from '../register/types';
import { SHELL_SKINS, describeRung } from './skins/registry';
import type { SkinKey } from './skins/types';
import { Button } from '../ui/Button';

// The register band: backtick-summoned strip of two rows — the register row (4 named registers +
// Custom) on top, and the shell-skin row (4 named skins) beneath it. A hover/focus caption
// underneath previews what selecting a notch would actually change — the honest-experiment
// framing (ethos + probe), plus a live dial diff for registers or the assumed learning-ladder
// rung (spec §0b) for skins — so switching is never a surprise. Esc + outside-click close it (App
// also closes it via the backtick chord — see bandKeys.ts — this is a redundant, harmless second
// path).
//
// The two rows are deliberately independent axes (spec framing): register is INTERACTION STYLE,
// skin is FURNITURE. Digits 1-5 still select a register only — bandKeys.ts's notchCount is called
// with REGISTERS.length + 1 and knows nothing about the skin row. Extending digit chords to cover
// all 9 notches is a real contract change (which digit means which skin?) and is deliberately
// deferred; skin notches are reachable by click or by tabbing to them and pressing Enter/Space,
// same as any other button.
type Hover =
  | { kind: 'register'; index: number }
  | { kind: 'custom' }
  | { kind: 'skin'; index: number };

export function RegisterBand({ current, dials, onSelect, onCustom, onClose, skin, onSelectSkin }: {
  current: string | null;
  dials: DialValues;
  onSelect: (key: string) => void;
  onCustom: () => void;
  onClose: () => void;
  skin: SkinKey;
  onSelectSkin: (key: SkinKey) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const customIndex = REGISTERS.length;
  const activeIndex = current === null ? customIndex : REGISTERS.findIndex(r => r.key === current);
  const activeSkinIndex = SHELL_SKINS.findIndex(s => s.key === skin);

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
    if (hover.kind === 'custom') return <span>twiddle individual dials</span>;
    if (hover.kind === 'register') {
      const r = REGISTERS[hover.index];
      const diff = diffDials(dials, resolveDials(r.key));
      const diffText = diff.map(d => `${d.dial} ${d.from}→${d.to}`).join(' · ');
      return (
        <>
          <span className="italic">{r.ethos}</span> — <span>{r.probe}</span>
          {diffText && <><br /><span className="font-mono">{diffText}</span></>}
        </>
      );
    }
    const s = SHELL_SKINS[hover.index];
    return (
      <>
        <span className="italic">{s.ethos}</span> — <span>{s.probe}</span>
        <br /><span className="font-mono">{describeRung(s.assumesRung)}</span>
      </>
    );
  })();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Register and shell"
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
            onMouseEnter={() => setHover({ kind: 'register', index: i })}
            onFocus={() => setHover({ kind: 'register', index: i })}
            onMouseLeave={() => setHover(h => (h?.kind === 'register' && h.index === i ? null : h))}
            onBlur={() => setHover(h => (h?.kind === 'register' && h.index === i ? null : h))}
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
          onMouseEnter={() => setHover({ kind: 'custom' })}
          onFocus={() => setHover({ kind: 'custom' })}
          onMouseLeave={() => setHover(h => (h?.kind === 'custom' ? null : h))}
          onBlur={() => setHover(h => (h?.kind === 'custom' ? null : h))}
          onClick={onCustom}
          className="hit-24 flex flex-col items-center gap-0.5 px-2.5 py-1 leading-tight"
          aria-label={`Custom register — press ${customIndex + 1}`}
        >
          <span className="text-[13px]">✎ Custom</span>
          <kbd className="text-[9px] opacity-50">{customIndex + 1}</kbd>
        </Button>
      </div>
      {/* The shell row (spec §4). No `kbd` digit hints here — deliberately click/keyboard-focus
          + Enter only, see the file-top note. */}
      <div className="flex items-center gap-1 pt-1 border-t border-[var(--card-border)] w-full justify-center">
        {SHELL_SKINS.map((s, i) => (
          <Button
            key={s.key}
            variant={activeSkinIndex === i ? 'primary' : 'ghost'}
            size="sm"
            onMouseEnter={() => setHover({ kind: 'skin', index: i })}
            onFocus={() => setHover({ kind: 'skin', index: i })}
            onMouseLeave={() => setHover(h => (h?.kind === 'skin' && h.index === i ? null : h))}
            onBlur={() => setHover(h => (h?.kind === 'skin' && h.index === i ? null : h))}
            onClick={() => onSelectSkin(s.key)}
            className="hit-24 flex items-center gap-1 px-2.5 py-1 text-[13px] leading-tight"
            aria-label={`Shell: ${s.label}`}
          >
            <span aria-hidden>{s.glyph}</span>{s.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] text-center max-w-[520px] min-h-[2.6em]">
        {caption}
      </p>
    </div>
  );
}
