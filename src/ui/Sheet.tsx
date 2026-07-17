/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import * as D from '@radix-ui/react-dialog';

export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <D.Content
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed right-0 top-12 bottom-0 z-40 w-[360px] overflow-y-auto custom-scrollbar border-l border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-xl focus:outline-none">
          <D.Title className="text-xs font-mono uppercase tracking-widest text-[var(--text-secondary)] mb-3">{title}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
