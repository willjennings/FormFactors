import React from 'react';
import { Sun, Moon, Settings2 } from 'lucide-react';

export function MenuBar({ isLive, isConnecting, isDarkMode, onToggleTheme, onToggleDrawer }: {
  isLive: boolean; isConnecting: boolean; isDarkMode: boolean;
  onToggleTheme: () => void; onToggleDrawer: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-9 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      <span className="text-[12px] font-semibold text-[var(--text-primary)]">FormFactors</span>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-secondary)]">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-amber-500 animate-pulse' : 'bg-slate-400 opacity-40'}`} />
          {isLive ? 'live' : isConnecting ? 'connecting' : 'off'}
        </span>
        <button onClick={onToggleTheme} title="Toggle theme" className="p-1.5 rounded hover:bg-[var(--bg-color)] text-[var(--text-primary)]">
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button onClick={onToggleDrawer} title="Debug drawer" className="p-1.5 rounded hover:bg-[var(--bg-color)] text-[var(--text-primary)]">
          <Settings2 size={14} />
        </button>
      </div>
    </div>
  );
}
