/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FileText, Table, Presentation, Image as ImageIcon, Check } from 'lucide-react';
import type { MockDoc } from '../scenarios';

// A small mock document that the action verbs visibly mutate. Each `kind` has its own
// renderer; the doc state comes from scenarios.ts `applyAction` (a pure reducer), so this
// component stays presentational.

const SavedBadge = ({ saved }: { saved: boolean }) =>
  saved ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-green-500">
      <Check size={11} /> Saved
    </span>
  ) : (
    <span className="text-[10px] font-mono text-[var(--text-secondary)] opacity-60">Unsaved</span>
  );

const HeaderRow = ({ icon, title, saved }: { icon: React.ReactNode; title: string; saved: boolean }) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2 text-[var(--text-primary)]">
      {icon}
      <span className="text-xs font-semibold">{title}</span>
    </div>
    <SavedBadge saved={saved} />
  </div>
);

const WordPreview = ({ doc }: { doc: Extract<MockDoc, { kind: 'word' }> }) => (
  <div>
    <HeaderRow icon={<FileText size={15} />} title="Document" saved={doc.saved} />
    <div className="rounded-lg bg-white dark:bg-[#0f1623] border border-[var(--card-border)] p-4 min-h-[96px]">
      {doc.heading && <h5 className="text-sm font-bold text-[var(--text-primary)] mb-1.5">{doc.heading}</h5>}
      <p className={`text-[13px] leading-snug text-[var(--text-primary)] ${doc.bold ? 'font-bold' : 'font-normal'}`}>
        {doc.text}
      </p>
    </div>
  </div>
);

const ExcelPreview = ({ doc }: { doc: Extract<MockDoc, { kind: 'excel' }> }) => {
  const rows = ['A1', 'A2', 'A3'];
  const fmt = (ref: string) => {
    const v = doc.cells[ref] ?? '';
    return doc.currency.includes(ref) && v ? `$${v}` : v;
  };
  return (
    <div>
      <HeaderRow icon={<Table size={15} />} title="Spreadsheet" saved={doc.saved} />
      <div className="flex items-start gap-3">
        <table className="text-[12px] font-mono border-collapse">
          <tbody>
            {rows.map(ref => (
              <tr key={ref}>
                <td className="px-2 py-1 text-[10px] text-[var(--text-secondary)] border border-[var(--card-border)]">{ref}</td>
                <td className="px-3 py-1 min-w-[56px] text-[var(--text-primary)] border border-[var(--card-border)] text-right">{fmt(ref)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {doc.chart && (
          <div className="flex items-end gap-1 h-[72px] px-2 py-1 rounded-md bg-[var(--inner-box-bg)]">
            {[16, 30, 24, 44].map((h, i) => (
              <div key={i} className="w-2.5 rounded-sm bg-teal-500/80" style={{ height: h }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PowerPointPreview = ({ doc }: { doc: Extract<MockDoc, { kind: 'powerpoint' }> }) => (
  <div>
    <HeaderRow icon={<Presentation size={15} />} title="Deck" saved={doc.saved} />
    <div className="flex items-center gap-2 flex-wrap">
      {doc.slides.map((s, i) => (
        <div
          key={i}
          className="w-[84px] h-[52px] rounded-md bg-white dark:bg-[#0f1623] border border-[var(--card-border)] flex items-center justify-center text-[9px] text-center text-[var(--text-primary)] px-1 leading-tight shadow-sm"
        >
          {s}
        </div>
      ))}
    </div>
    {doc.transition && (
      <p className="mt-2 text-[10px] font-mono text-[var(--text-secondary)]">Transition: <span className="text-[var(--text-primary)] font-bold">{doc.transition}</span></p>
    )}
  </div>
);

const PhotoPreview = ({ doc }: { doc: Extract<MockDoc, { kind: 'photo' }> }) => {
  const brightnessPct = 100 + doc.brightness * 18;
  return (
    <div>
      <HeaderRow icon={<ImageIcon size={15} />} title="Image" saved={doc.saved} />
      <div className="flex items-center gap-3">
        <div
          className={`${doc.cropped ? 'w-[72px]' : 'w-[120px]'} h-[72px] rounded-lg overflow-hidden border border-[var(--card-border)] transition-all duration-300`}
          style={{
            filter: `brightness(${brightnessPct}%)`,
            background: doc.bgRemoved
              ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f1f5f9 0% 50%) 50% / 16px 16px'
              : 'linear-gradient(135deg, #f97316, #fb7185, #8b5cf6)',
          }}
        />
        <div className="flex flex-col gap-1 text-[10px] font-mono">
          {doc.cropped && <span className="text-orange-500 font-bold">Cropped</span>}
          {doc.brightness > 0 && <span className="text-[var(--text-secondary)]">Brightness +{doc.brightness}</span>}
          {doc.bgRemoved && <span className="text-[var(--text-secondary)]">Background removed</span>}
          {!doc.cropped && doc.brightness === 0 && !doc.bgRemoved && (
            <span className="text-[var(--text-secondary)] opacity-60">Original</span>
          )}
        </div>
      </div>
    </div>
  );
};

export const MockPreview = ({ doc }: { doc: MockDoc }) => {
  switch (doc.kind) {
    case 'word': return <WordPreview doc={doc} />;
    case 'excel': return <ExcelPreview doc={doc} />;
    case 'powerpoint': return <PowerPointPreview doc={doc} />;
    case 'photo': return <PhotoPreview doc={doc} />;
  }
};
