import React, { forwardRef, useState } from 'react';
import { Save, SaveAll, FileText } from 'lucide-react';
import type { MockDoc, Program, ProgramImage } from '../scenarios';
import { CATEGORY_COLORS } from '../scenarios';
import { buildWordModel } from './surfaceModels';

// Functional mini-app surfaces. Every named element in the program set renders as a real
// DOM node stamped data-element-id (the generic measurement contract) so teaching overlays
// anchor to real controls. Buttons dispatch the SAME applyAction verbs voice uses.

export type SurfaceProps = {
  program: Program;
  doc: MockDoc;
  live: boolean;
  focusTitle?: string;
  onAction: (verb: string, args: { target?: string; detail?: string }) => void;
  onElementClick: (elementId: number) => void;
};

/** Wrapper making one named element measurable + clickable. stopPropagation keeps a click
 *  on a nested element (Save inside the Ribbon) from firing the container's deixis too. */
export function SurfaceElement({ img, live, focusTitle, onElementClick, className, children }: {
  img: ProgramImage; live: boolean; focusTitle?: string;
  onElementClick: (id: number) => void; className?: string; children: React.ReactNode;
}) {
  const isFocus = !!focusTitle && img.title === focusTitle;
  const tone = CATEGORY_COLORS[img.category];
  return (
    <div
      data-element-id={img.id}
      onClick={(e) => { e.stopPropagation(); onElementClick(img.id); }}
      className={`relative ${className ?? ''}`}
      style={isFocus ? { boxShadow: `0 0 0 3px rgb(${tone}), 0 0 16px 2px rgba(${tone}, 0.45)` } : undefined}
    >
      {children}
      {live && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-mono font-bold flex items-center justify-center z-10">
          {img.id}
        </span>
      )}
      {isFocus && (
        <span className="absolute -top-2 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wide text-white z-10" style={{ backgroundColor: `rgb(${tone})` }}>
          Point here
        </span>
      )}
    </div>
  );
}

export function RibbonButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-md border border-transparent hover:border-[var(--card-border)] hover:bg-[var(--bg-color)] active:scale-95 transition-all text-[var(--text-primary)]"
    >
      {icon}
      <span className="text-[10px] font-mono">{label}</span>
    </button>
  );
}

export function TitleBar({ icon, filename, statusLabel }: { icon: React.ReactNode; filename: string; statusLabel: string }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2">
      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        {icon}
        <span className="text-xs font-semibold">{filename}</span>
      </div>
      <span className={`text-[10px] font-mono font-bold ${statusLabel === 'Edited' ? 'text-[var(--text-secondary)] opacity-60' : 'text-green-500'}`}>
        {statusLabel}
      </span>
    </div>
  );
}

const imgOf = (program: Program, id: number): ProgramImage =>
  program.images.find((i) => i.id === id) ?? program.images[0];

function WordSurface({ program, doc, live, focusTitle, onAction, onElementClick }: SurfaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (doc.kind !== 'word') return null;
  const m = buildWordModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <TitleBar icon={<FileText size={15} />} filename={m.filename} statusLabel={m.statusLabel} />
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Home</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Save size={16} />} label="Save"
            onClick={() => onAction('save_file', { target: 'Save button' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<SaveAll size={16} />} label="Save As"
            onClick={() => onAction('save_file', { target: 'Save As button', detail: 'Save As' })} />
        </SurfaceElement>
      </SurfaceElement>
      <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-white dark:bg-[#0f1623] overflow-hidden">
        <div className="p-4 h-full flex flex-col">
          {m.heading && <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1.5">{m.heading}</h5>}
          <textarea
            value={draft ?? m.text}
            onFocus={() => setDraft(m.text)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== m.text) onAction('edit_content', { target: 'Document body', detail: draft });
              setDraft(null);
            }}
            className={`flex-1 w-full resize-none bg-transparent outline-none text-[13px] leading-snug text-slate-900 dark:text-slate-100 ${m.bold ? 'font-bold' : 'font-normal'}`}
          />
        </div>
      </SurfaceElement>
    </div>
  );
}

/** Dispatcher: one surface per program. Tasks 5-7 fill in the remaining branches. */
export const ProgramSurface = forwardRef<HTMLDivElement, SurfaceProps>((props, ref) => {
  return (
    <div ref={ref} className="program-surface w-full h-full">
      {props.program.id === 'word' && <WordSurface {...props} />}
    </div>
  );
});
ProgramSurface.displayName = 'ProgramSurface';
