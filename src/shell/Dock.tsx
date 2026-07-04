import React from 'react';
import { FileText, Table, Presentation, Image as ImageIcon } from 'lucide-react';
import { PROGRAMS, type ProgramId } from '../scenarios';

const ICONS: Record<ProgramId, React.ReactNode> = {
  word: <FileText size={18} />, excel: <Table size={18} />,
  powerpoint: <Presentation size={18} />, photo: <ImageIcon size={18} />,
};

export function Dock({ active, onSelect, onReopen }: {
  active: ProgramId; onSelect: (id: ProgramId) => void; onReopen: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-4 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/85 backdrop-blur shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
      {PROGRAMS.map(p => (
        <button
          key={p.id}
          onClick={() => (p.id === active ? onReopen() : onSelect(p.id))}
          title={p.label}
          className={`p-2 rounded-xl transition-all active:scale-90 ${p.id === active
            ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-color)] hover:text-[var(--text-primary)]'}`}
        >
          {ICONS[p.id]}
        </button>
      ))}
    </div>
  );
}
