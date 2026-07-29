import React from 'react';
import { Sun, Moon, Settings2, AudioLines, PenLine, Target } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';
import type { Traffic } from './traffic';

/** The global control cluster and the session's live indicator — the half of the top bar that is
 *  the SAME in every skin (spec §5: the register system, the drawer, the journal and the mic must
 *  not vary with the furniture). The skin-specific half arrives as `lead` from
 *  skins/parts/TopBar.tsx, which is the only caller. */
export interface MenuBarProps {
  isLive: boolean; isConnecting: boolean; isDarkMode: boolean; traffic: Traffic | null;
  registerLabel: string; registerGlyph: string;
  onToggleTheme: () => void; onToggleDrawer: () => void; onRambleMode: () => void; onSketchBoard: () => void; onMissions: () => void;
  onRegisterPill: () => void;
}

export function MenuBar({ isLive, isConnecting, isDarkMode, traffic, registerLabel, registerGlyph, onToggleTheme, onToggleDrawer, onRambleMode, onSketchBoard, onMissions, onRegisterPill, lead, trail, frameClass, skinKey, skinLabel, skinGlyph }: MenuBarProps & {
  /** Skin-specific left-hand content (menu brand, desk summary, session counts, …). */
  lead?: React.ReactNode;
  /** Skin-specific content immediately before the control cluster (the Familiar clock). */
  trail?: React.ReactNode;
  /** The bar's own surface styling, chosen by the skin. */
  frameClass?: string;
  /** Rendered as `data-shell-skin` so a DOM probe can tell which skin is mounted. */
  skinKey?: string;
  /** The current shell's label/glyph (spec §4: "the pill in the top bar shows the current shell
   *  beside the register"). TopBar passes these through from the skin it was handed; both are
   *  optional so callers with no skin concept (there are none left, but nothing requires it)
   *  still get a register-only pill. */
  skinLabel?: string;
  skinGlyph?: string;
}) {
  return (
    <div className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-3 px-4 h-12 ${frameClass ?? 'border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur'}`} data-shell data-shell-skin={skinKey} onPointerDown={(e) => e.stopPropagation()}>
      {/* Lead and pill are ONE left-hand group rather than two `justify-between` children. As
          three children the pill floated with the lead's width, and the skins whose lead is a
          summary line ("SESSION 2 pieces · 1 source · 1 step recorded") pushed it under the
          feedforward "Pointing at…" pill, which is `absolute top-3 left-1/2` at z-50 — dead centre
          of this bar's own band and not something the bar can move. Anchoring the pill to the
          left keeps it reachable whatever the skin writes beside it. */}
      <div className="flex items-center gap-3 min-w-0">
        {lead ?? <span className="text-[12px] font-semibold text-[var(--text-primary)]">FormFactors</span>}
        <button data-register-pill onClick={onRegisterPill} className="hit-24 shrink-0 flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-color)]" aria-label={`Register: ${registerLabel}${skinLabel ? `, shell: ${skinLabel}` : ''} — open register band`}>
          <span aria-hidden>{registerGlyph}</span>{registerLabel}
          {skinLabel && <><span aria-hidden className="opacity-50">·</span><span aria-hidden>{skinGlyph}</span>{skinLabel}</>}
          <kbd className="text-[9px] opacity-50">`</kbd>
        </button>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {trail}
        <span className="flex items-center gap-1.5 text-xs font-mono text-[var(--text-secondary)] mr-2" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-amber-500 animate-pulse' : 'bg-slate-400 opacity-40'}`} />
          {isLive ? `live · ${traffic?.frames ?? 0}f · ${traffic?.hints ?? 0}h` : isConnecting ? 'connecting' : 'off — nothing sent'}
        </span>
        <Tip label="Ramble mode (scribe)"><Button size="icon44" aria-label="Ramble mode" onClick={onRambleMode}><AudioLines size={16} /></Button></Tip>
        <Tip label="Sketch board"><Button size="icon44" aria-label="Sketch board" onClick={onSketchBoard}><PenLine size={16} /></Button></Tip>
        <Tip label="Missions"><Button size="icon44" aria-label="Missions" onClick={onMissions}><Target size={16} /></Button></Tip>
        <Tip label="Toggle theme"><Button size="icon44" aria-label="Toggle theme" onClick={onToggleTheme}>{isDarkMode ? <Sun size={16} /> : <Moon size={16} />}</Button></Tip>
        <Tip label="Debug drawer"><Button size="icon44" aria-label="Debug drawer" onClick={onToggleDrawer}><Settings2 size={16} /></Button></Tip>
      </div>
    </div>
  );
}
