import React from 'react';
import * as T from '@radix-ui/react-tooltip';

/** Icon-only controls wrap in <Tip label> — replaces title= (invisible on touch). */
export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={250}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6}
            className="z-[50000] px-2 py-1 rounded-md text-xs bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-primary)] shadow-md">
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
