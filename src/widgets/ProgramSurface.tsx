import React, { forwardRef, useState } from 'react';
import { Save, SaveAll, Sigma, Divide, Table, Presentation, Plus, Copy, Image as ImageIcon, Crop as CropIcon, Maximize2 } from 'lucide-react';
import type { MockDoc, Program, ProgramImage } from '../scenarios';
import { CATEGORY_COLORS } from '../scenarios';
import { buildWordModel, buildPptModel, buildPhotoModel } from './surfaceModels';
import { Spreadsheet } from './Spreadsheet';

// Functional mini-app surfaces. Every named element in the program set renders as a real
// DOM node stamped data-element-id (the generic measurement contract) so teaching overlays
// anchor to real controls. Buttons dispatch the SAME applyAction verbs voice uses.

export type SurfaceProps = {
  program: Program;
  doc: MockDoc;
  live: boolean;
  focusTitle?: string;
  blockedElements?: number[];
  onAction: (verb: string, args: { target?: string; detail?: string }) => void;
  onElementClick: (elementId: number) => void;
};

/** Wrapper making one named element measurable + clickable. stopPropagation keeps a click
 *  on a nested element (Save inside the Ribbon) from firing the container's deixis too. */
export function SurfaceElement({ img, live, focusTitle, blocked, onElementClick, className, children }: {
  img: ProgramImage; live: boolean; focusTitle?: string; blocked?: boolean;
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
      inert={blocked || undefined}
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

const imgOf = (program: Program, id: number): ProgramImage =>
  program.images.find((i) => i.id === id) ?? program.images[0];

function WordSurface({ program, doc, live, focusTitle, blockedElements, onAction, onElementClick }: SurfaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (doc.kind !== 'word') return null;
  const m = buildWordModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(1)} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Home</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(2)} onElementClick={onElementClick}>
          <RibbonButton icon={<Save size={16} />} label="Save"
            onClick={() => onAction('save_file', { target: 'Save button' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(3)} onElementClick={onElementClick}>
          <RibbonButton icon={<SaveAll size={16} />} label="Save As"
            onClick={() => onAction('save_file', { target: 'Save As button', detail: 'Save As' })} />
        </SurfaceElement>
      </SurfaceElement>
      <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(4)} onElementClick={onElementClick}
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

function ExcelSurface({ program, doc, live, focusTitle, blockedElements, onAction, onElementClick }: SurfaceProps) {
  if (doc.kind !== 'excel') return null;
  return (
    <div className="flex flex-col h-full gap-2">
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(1)} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Formulas</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(2)} onElementClick={onElementClick}>
          <RibbonButton icon={<Sigma size={16} />} label="SUM"
            onClick={() => onAction('insert_object', { target: 'SUM function', detail: 'SUM' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(3)} onElementClick={onElementClick}>
          <RibbonButton icon={<Divide size={16} />} label="AVERAGE"
            onClick={() => onAction('insert_object', { target: 'AVERAGE function', detail: 'AVERAGE' })} />
        </SurfaceElement>
      </SurfaceElement>
      <div className="flex-1 rounded-lg border border-[var(--card-border)] overflow-hidden">
        <Spreadsheet doc={doc} elementIds={{ A1: 4 }}
          onCellClick={(ref) => { if (ref === 'A1') onElementClick(4); }} />
      </div>
    </div>
  );
}

function PptSurface({ program, doc, live, focusTitle, blockedElements, onAction, onElementClick }: SurfaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (doc.kind !== 'powerpoint') return null;
  const m = buildPptModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(1)} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Insert</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(2)} onElementClick={onElementClick}>
          <RibbonButton icon={<Plus size={16} />} label="New Slide"
            onClick={() => onAction('insert_object', { target: 'New Slide button' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(3)} onElementClick={onElementClick}>
          <RibbonButton icon={<Copy size={16} />} label="Duplicate"
            onClick={() => onAction('insert_object', { target: 'Duplicate Slide button', detail: 'duplicate' })} />
        </SurfaceElement>
      </SurfaceElement>
      <div className="flex-1 flex gap-2 min-h-0">
        {/* filmstrip (chrome, not a named element) */}
        <div className="w-20 shrink-0 flex flex-col gap-1.5 overflow-y-auto">
          {m.slides.map((s, i) => (
            <div key={i} className={`h-12 shrink-0 rounded-md border text-[8px] text-center flex items-center justify-center px-1 leading-tight bg-white dark:bg-[#0f1623] text-[var(--text-primary)] ${i === m.slides.length - 1 ? 'border-[var(--accent-color)]' : 'border-[var(--card-border)]'}`}>
              {s}
            </div>
          ))}
        </div>
        <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(4)} onElementClick={onElementClick}
          className="flex-1 rounded-lg border border-[var(--card-border)] bg-white dark:bg-[#0f1623] flex items-center justify-center">
          <input
            value={draft ?? m.currentTitle}
            onFocus={() => setDraft(m.currentTitle)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== m.currentTitle) onAction('edit_content', { target: 'Slide canvas', detail: draft });
              setDraft(null);
            }}
            className="w-3/4 bg-transparent outline-none text-center text-lg font-bold text-slate-900 dark:text-slate-100"
          />
          {m.transition && (
            <span className="absolute bottom-2 right-3 text-[9px] font-mono text-[var(--text-secondary)]">Transition: {m.transition}</span>
          )}
        </SurfaceElement>
      </div>
    </div>
  );
}

const PHOTO_CANVAS_URL = 'https://picsum.photos/seed/photo-canvas/800/600'; // the CONTENT being edited (honest: it is an image)

function PhotoSurface({ program, doc, live, focusTitle, blockedElements, onAction, onElementClick }: SurfaceProps) {
  if (doc.kind !== 'photo') return null;
  const m = buildPhotoModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(1)} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Tools</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(2)} onElementClick={onElementClick}>
          <RibbonButton icon={<CropIcon size={16} />} label="Crop"
            onClick={() => onAction('photo_edit', { target: 'Crop tool', detail: 'crop' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(3)} onElementClick={onElementClick}>
          <RibbonButton icon={<Maximize2 size={16} />} label="Resize"
            onClick={() => onAction('photo_edit', { target: 'Resize tool', detail: 'resize' })} />
        </SurfaceElement>
      </SurfaceElement>
      <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} blocked={blockedElements?.includes(4)} onElementClick={onElementClick}
        className="flex-1 rounded-lg border border-[var(--card-border)] overflow-hidden flex items-center justify-center"
      >
        <div className="w-full h-full flex items-center justify-center"
          style={{ background: m.bgRemoved ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f1f5f9 0% 50%) 50% / 16px 16px' : 'var(--bg-color)' }}>
          <img src={PHOTO_CANVAS_URL} alt="Photo being edited" referrerPolicy="no-referrer" draggable="false"
            className={`object-cover transition-all duration-300 ${m.cropped ? 'scale-[1.35]' : ''}`}
            style={{
              filter: m.filterCss,
              width: m.resized ? '70%' : '100%',
              height: m.resized ? '70%' : '100%',
              clipPath: m.bgRemoved ? 'ellipse(38% 46% at 50% 50%)' : undefined,
            }} />
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
      {props.program.id === 'excel' && <ExcelSurface {...props} />}
      {props.program.id === 'powerpoint' && <PptSurface {...props} />}
      {props.program.id === 'photo' && <PhotoSurface {...props} />}
    </div>
  );
});
ProgramSurface.displayName = 'ProgramSurface';
