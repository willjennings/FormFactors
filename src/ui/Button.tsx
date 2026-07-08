import React from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'ghost' | 'outline';
type Size = 'sm' | 'icon44' | 'icon48' | 'chip';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--accent-color)] text-white hover:opacity-90',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--bg-color)] hover:text-[var(--text-primary)]',
  outline: 'border border-[var(--card-border)] text-[var(--text-primary)] hover:border-[var(--accent-color)]',
};
const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-full hit-44',
  icon44: 'w-11 h-11 rounded-xl flex items-center justify-center',
  icon48: 'w-12 h-12 rounded-xl flex items-center justify-center',
  chip: 'px-2.5 py-1 text-xs font-mono rounded-full hit-44',
};

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ variant = 'ghost', size = 'sm', className, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type}
      className={cn('transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none', VARIANT[variant], SIZE[size], className)}
      {...props} />
  ),
);
Button.displayName = 'Button';
