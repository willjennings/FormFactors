import React from 'react';
import { Sun, Moon, Settings2, AudioLines, PenLine, Target } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';
import type { Traffic } from './traffic';

export function MenuBar({ isLive, isConnecting, isDarkMode, traffic, registerLabel, registerGlyph, onToggleTheme, onToggleDrawer, onRambleMode, onSketchBoard, onMissions, onRegisterPill }: {
  isLive: boolean; isConnecting: boolean; isDarkMode: boolean; traffic: Traffic | null;
  registerLabel: string; registerGlyph: string;
  onToggleTheme: () => void; onToggleDrawer: () => void; onRambleMode: () => void; onSketchBoard: () => void; onMissions: () => void;
  onRegisterPill: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-12 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur" data-shell onPointerDown={(e) => e.stopPropagation()}>
      <span className="text-[12px] font-semibold text-[var(--text-primary)]">FormFactors</span>
      <button onClick={onRegisterPill} className="hit-24 flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-color)]" aria-label={`Register: ${registerLabel} — open register band`}>
        <span aria-hidden>{registerGlyph}</span>{registerLabel}<kbd className="text-[9px] opacity-50">`</kbd>
      </button>
      <div className="flex items-center gap-1">
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
