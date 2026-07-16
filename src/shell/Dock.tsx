import React from 'react';
import { FileText, Table, Presentation, Image as ImageIcon } from 'lucide-react';
import { PROGRAMS, type ProgramId } from '../scenarios';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';

const ICONS: Record<ProgramId, React.ReactNode> = {
  word: <FileText size={18} />, excel: <Table size={18} />,
  powerpoint: <Presentation size={18} />, photo: <ImageIcon size={18} />,
};

export function Dock({ active, onSelect, onReopen }: {
  active: ProgramId; onSelect: (id: ProgramId) => void; onReopen: () => void;
}) {
  return (
    <div data-shell className="absolute bottom-3 left-4 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/85 backdrop-blur shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
      {PROGRAMS.map(p => (
        <Tip key={p.id} label={p.label}>
          <Button size="icon48" aria-label={p.label}
            variant={p.id === active ? 'primary' : 'ghost'}
            className={p.id === active ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)] hover:opacity-100' : ''}
            onClick={() => (p.id === active ? onReopen() : onSelect(p.id))}>
            {ICONS[p.id]}
          </Button>
        </Tip>
      ))}
    </div>
  );
}
