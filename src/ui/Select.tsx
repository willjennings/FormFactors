/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import * as S from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

export function Select({ value, onValueChange, options, ariaLabel }: {
  value: string; onValueChange: (v: string) => void;
  options: { value: string; label: string }[]; ariaLabel: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger aria-label={ariaLabel}
        className="min-h-11 w-full flex items-center justify-between gap-2 px-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] text-xs font-mono text-[var(--text-primary)]">
        <S.Value /><S.Icon><ChevronDown size={14} /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="z-[50000] rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl overflow-hidden">
          <S.Viewport className="p-1">
            {options.map(o => (
              <S.Item key={o.value} value={o.value}
                className="min-h-11 flex items-center gap-2 px-3 rounded-lg text-xs font-mono text-[var(--text-primary)] data-[highlighted]:bg-[var(--bg-color)] outline-none cursor-pointer">
                <S.ItemIndicator><Check size={12} /></S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
