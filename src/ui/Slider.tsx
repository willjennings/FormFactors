/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import * as SL from '@radix-ui/react-slider';

export function Slider({ value, onValueChange, min, max, step, ariaLabel }: {
  value: number; onValueChange: (v: number) => void; min: number; max: number; step: number; ariaLabel: string;
}) {
  return (
    <SL.Root value={[value]} onValueChange={([v]) => onValueChange(v)} min={min} max={max} step={step}
      aria-label={ariaLabel} className="relative flex items-center w-full h-11 cursor-pointer">
      <SL.Track className="relative grow h-1 rounded-full bg-black/10 dark:bg-white/10">
        <SL.Range className="absolute h-full rounded-full bg-[var(--accent-color)]" />
      </SL.Track>
      <SL.Thumb className="block w-5 h-5 rounded-full bg-white border border-[var(--card-border)] shadow" />
    </SL.Root>
  );
}
