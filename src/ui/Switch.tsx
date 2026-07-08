/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import * as SW from '@radix-ui/react-switch';

export function Switch({ checked, onCheckedChange, label, hint }: {
  checked: boolean; onCheckedChange: (c: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label className="min-h-11 w-full flex items-center justify-between gap-3 px-1 cursor-pointer">
      <span className="flex flex-col">
        <span className="text-xs font-bold text-[var(--text-primary)]">{label}</span>
        {hint && <span className="text-[10px] font-mono text-[var(--text-secondary)]">{hint}</span>}
      </span>
      <SW.Root checked={checked} onCheckedChange={onCheckedChange}
        className="w-11 h-6 rounded-full bg-slate-300 dark:bg-slate-600 data-[state=checked]:bg-green-500 relative shrink-0">
        <SW.Thumb className="block w-5 h-5 rounded-full bg-white shadow translate-x-0.5 data-[state=checked]:translate-x-5 transition-transform" />
      </SW.Root>
    </label>
  );
}
