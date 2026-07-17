# Shell Usability + Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the shell's interaction chrome onto vendored Radix/shadcn-style components with a hard tap-target/focus/text standard (bespoke surfaces untouched), and land the accumulated shell extras: traffic meter, idle auto-disconnect, favicon, keyboard-tight soft-block, showMarkings toggle, window-rect clamp.

**Architecture:** Vendored `src/ui/` primitives (Radix behavior + our CSS variables), a `hit-44` utility that expands hit areas without changing visuals, and per-region adoption tasks (menu bar/dock, omnibox, window chrome, drawer, witness cards, rail affordances). The checked-in tap-audit console script is the acceptance test: before/after JSON, hard bars from the spec.

**Tech Stack:** React 19, Tailwind v4, Radix primitives (`@radix-ui/react-dialog`, `-select`, `-switch`, `-slider`, `-tooltip`), `clsx` + `tailwind-merge`. **Dependency lift is scoped to exactly these packages** (spec §3).

**Spec:** `docs/superpowers/specs/2026-07-08-shell-usability-coherence-design.md`

## Global Constraints

- Branch `honest-mode`, work directly on it.
- **Standards (spec §2, binding):** ≥44×44px hit areas everywhere interactive (48px primary: mic, dock); absolute floor 24×24 (WCAG 2.2 §2.5.8) — zero exceptions; interactive labels ≥12px; visible `focus-visible` ring (accent, 2px, offset 2) on every tabbable; Radix Tooltip replaces every `title=` on icon-only controls.
- **Boundary (spec §4):** program surfaces untouched; rail CARDS keep their anatomy, rail AFFORDANCES adopt primitives; witness cards NON-modal (no focus trap — focus to Confirm, Esc cancels, desktop stays pointable).
- **Pointer conventions preserved:** every piece of chrome keeps `onPointerDown` stopPropagation; type-and-point (pointing never steals focus) must survive — no Radix component may reintroduce focus stealing.
- Vendored components live in `src/ui/`, styled ONLY with existing CSS variables (`--card-bg`, `--card-border`, `--accent-color`, `--text-primary`, `--text-secondary`, `--bg-color`, `--inner-box-bg`) — no new palette.
- Idle limit: 5 minutes (`IDLE_LIMIT_MS = 300_000`). Traffic meter counts frames + hints/texts, resets per session.
- Verify per task: `npx tsc --noEmit && npx vitest run` (baseline 142). Final: `npx vite build` + the tap-audit acceptance (Task 10).
- Commit per task with the given message.

## File Structure

```
src/ui/cn.ts                      CREATE  clsx + tailwind-merge helper
src/ui/Button.tsx                 CREATE  variants/sizes incl. icon44/icon48/chip, hit-area baked in
src/ui/Tooltip.tsx                CREATE  Radix tooltip wrapper (self-providing)
src/ui/Sheet.tsx                  CREATE  Radix dialog-based right sheet (drawer shell)
src/ui/Select.tsx                 CREATE  Radix select (trigger/content/item)
src/ui/Switch.tsx                 CREATE  Radix switch
src/ui/Slider.tsx                 CREATE  Radix slider (44px thumb hit)
scripts/tap-audit.js              CREATE  the acceptance console script
src/shell/traffic.ts(.test.ts)    CREATE  withTrafficCount provider wrapper (TDD)
src/shell/idle.ts(.test.ts)       CREATE  idleExceeded (TDD)
src/teaching/selectors.ts(.test)  MODIFY  + blockedElementNumbers (TDD)
src/index.css                     MODIFY  hit-area utilities + focus-visible baseline
index.html                        MODIFY  favicon
src/shell/{MenuBar,Dock,Omnibox,DebugDrawer,ProgramWindow,RailPanel}.tsx  MODIFY  adoption
src/rail/CardView.tsx             MODIFY  affordances → Button
src/widgets/ProgramSurface.tsx    MODIFY  SurfaceElement inert prop
src/App.tsx                       MODIFY  wiring (traffic, idle, clamp, witness semantics, blockedElements)
```

---

### Task 1: Foundation — deps, `src/ui/`, hit-area CSS, audit script, BEFORE record

**Files:**
- Create: `src/ui/cn.ts`, `src/ui/Button.tsx`, `src/ui/Tooltip.tsx`, `scripts/tap-audit.js`
- Modify: `src/index.css`, `package.json` (via npm install)

**Interfaces:**
- Produces: `cn(...classes)`; `<Button variant="primary|ghost|outline" size="sm|icon44|icon48|chip">` (all sizes carry ≥44px hit areas; `icon48` = 48×48 visual); `<Tip label="..."><Button .../></Tip>` tooltip wrapper. CSS utilities `.hit-44` / `.hit-24` (::after hit-area expansion) and a global `:focus-visible` ring.

- [ ] **Step 1: Install the scoped dependencies**

```bash
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-slider @radix-ui/react-tooltip clsx tailwind-merge
```

- [ ] **Step 2: CSS utilities** — append to `src/index.css`:

```css
/* Tap-target + focus standard (usability spec §2) */
@layer utilities {
  .hit-44 { position: relative; }
  .hit-44::after { content: ""; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: max(100%, 44px); height: max(100%, 44px); }
  .hit-24 { position: relative; }
  .hit-24::after { content: ""; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: max(100%, 24px); height: max(100%, 24px); }
}
:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; border-radius: 4px; }
```

- [ ] **Step 3: `src/ui/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
```

- [ ] **Step 4: `src/ui/Button.tsx`**

```tsx
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
```

- [ ] **Step 5: `src/ui/Tooltip.tsx`**

```tsx
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
```

- [ ] **Step 6: `scripts/tap-audit.js`** — the acceptance script (paste into DevTools console on any app state):

```js
// Tap-target acceptance audit (usability spec §5). Paste into the DevTools console.
// Bars: 0 targets <24px; ≤4 named <44px exceptions; 0 interactive labels <12px.
(() => {
  const sel = 'button, input, textarea, select, a[href], [role="button"], [data-element-id]';
  const hit = (e) => { // include ::after hit-area expansion in the measured target
    const r = e.getBoundingClientRect();
    const a = getComputedStyle(e, '::after');
    if (a.content !== 'none' && a.position === 'absolute') {
      const w = parseFloat(a.width) || 0, h = parseFloat(a.height) || 0;
      return { w: Math.max(r.width, w), h: Math.max(r.height, h) };
    }
    return { w: r.width, h: r.height };
  };
  const rows = [...document.querySelectorAll(sel)]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => { const { w, h } = hit(e); return {
      label: (e.getAttribute('aria-label') || e.title || e.placeholder || e.textContent || e.tagName).trim().slice(0, 28),
      w: Math.round(w), h: Math.round(h),
      font: parseFloat(getComputedStyle(e).fontSize) || null,
      interactive: ['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(e.tagName) || e.getAttribute('role') === 'button',
    }; });
  const under24 = rows.filter(x => x.w < 24 || x.h < 24);
  const under44 = rows.filter(x => x.w < 44 || x.h < 44);
  const tinyText = rows.filter(x => x.interactive && x.font && x.font < 12);
  return JSON.stringify({ total: rows.length, under24, under44Count: under44.length, under44: under44.slice(0, 12), tinyTextCount: tinyText.length, tinyText: tinyText.slice(0, 8) }, null, 1);
})();
```

- [ ] **Step 7: Record the BEFORE state** — the 2026-07-08 audit results are the baseline; copy the spec §1 table into `.superpowers/sdd/task-1-report.md` as the "before" record (default view: 32/42 under 44, 3 under 24; drawer slider 323×4; rail Dismiss 12×12; 19 tiny labels; window ✕ 21×21, resize 16×16).

- [ ] **Step 8: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/142 green (new files compile; nothing consumes them yet).

```bash
git add src/ui src/index.css scripts/tap-audit.js package.json package-lock.json
git commit -m "feat(ui): vendored Radix foundation — Button/Tooltip/cn, hit-area + focus utilities, tap-audit script"
```

---

### Task 2: Traffic meter (TDD) + menu bar/dock adoption + favicon

**Files:**
- Create: `src/shell/traffic.ts`, `src/shell/traffic.test.ts`
- Modify: `src/shell/MenuBar.tsx`, `src/shell/Dock.tsx`, `src/App.tsx` (provider assignment ~line 1601, MenuBar mount ~2410), `index.html`

**Interfaces:**
- Produces: `type Traffic = { frames: number; hints: number }`; `withTrafficCount(p: VoiceProvider, onChange: (t: Traffic) => void): VoiceProvider`. `MenuBar` props gain `traffic: Traffic | null` (null = never connected this session). `Dock` icons become `Button size="icon48"` with `Tip`; MenuBar buttons `icon44` with `Tip`.

- [ ] **Step 1: Failing test** — `src/shell/traffic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withTrafficCount } from './traffic';
import type { VoiceProvider } from '../voice/types';

const fake = (log: string[]): VoiceProvider => ({
  connect: async () => {}, close: () => {},
  sendTextHint: () => log.push('hint'), sendUserText: () => log.push('text'),
  sendVideoFrame: () => log.push('frame'), sendToolResponse: () => log.push('tool'),
});

describe('withTrafficCount', () => {
  it('counts frames and hints/texts, forwards every call, leaves tool responses uncounted', () => {
    const log: string[] = [];
    let latest = { frames: 0, hints: 0 };
    const p = withTrafficCount(fake(log), t => { latest = t; });
    p.sendVideoFrame('f'); p.sendVideoFrame('f'); p.sendTextHint('h'); p.sendUserText('u'); p.sendToolResponse('1', 'n', {});
    expect(latest).toEqual({ frames: 2, hints: 2 });
    expect(log).toEqual(['frame', 'frame', 'hint', 'text', 'tool']);
  });
});
```

Run: `npx vitest run src/shell/traffic.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `src/shell/traffic.ts`**

```ts
import type { VoiceProvider } from '../voice/types';

export type Traffic = { frames: number; hints: number };

/** Glanceable burn meter: counts what actually leaves the browser. Wraps the provider at
 *  the single assignment point so every send site is covered without touching call sites. */
export function withTrafficCount(p: VoiceProvider, onChange: (t: Traffic) => void): VoiceProvider {
  const t: Traffic = { frames: 0, hints: 0 };
  return {
    ...p,
    sendVideoFrame: (f) => { t.frames++; onChange({ ...t }); p.sendVideoFrame(f); },
    sendTextHint: (x) => { t.hints++; onChange({ ...t }); p.sendTextHint(x); },
    sendUserText: (x) => { t.hints++; onChange({ ...t }); p.sendUserText(x); },
  };
}
```

Run the test — PASS.

- [ ] **Step 3: App wiring** — in `src/App.tsx`:
  - State near other UI state: `const [traffic, setTraffic] = useState<Traffic | null>(null);` (import from './shell/traffic').
  - At the provider assignment (~1601), wrap the whole ternary: `providerRef.current = withTrafficCount(<existing ternary expression>, setTraffic);` and reset the meter right before connecting: `setTraffic({ frames: 0, hints: 0 });`
  - MenuBar mount gains `traffic={traffic}`.

- [ ] **Step 4: MenuBar + Dock adoption** — rewrite the two components using Task 1 primitives, preserving their pointer guards:

`src/shell/MenuBar.tsx`:

```tsx
import React from 'react';
import { Sun, Moon, Settings2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';
import type { Traffic } from './traffic';

export function MenuBar({ isLive, isConnecting, isDarkMode, traffic, onToggleTheme, onToggleDrawer }: {
  isLive: boolean; isConnecting: boolean; isDarkMode: boolean; traffic: Traffic | null;
  onToggleTheme: () => void; onToggleDrawer: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-12 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      <span className="text-[12px] font-semibold text-[var(--text-primary)]">FormFactors</span>
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1.5 text-xs font-mono text-[var(--text-secondary)] mr-2" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-amber-500 animate-pulse' : 'bg-slate-400 opacity-40'}`} />
          {isLive ? `live · ${traffic?.frames ?? 0}f · ${traffic?.hints ?? 0}h` : isConnecting ? 'connecting' : 'off — nothing sent'}
        </span>
        <Tip label="Toggle theme"><Button size="icon44" aria-label="Toggle theme" onClick={onToggleTheme}>{isDarkMode ? <Sun size={16} /> : <Moon size={16} />}</Button></Tip>
        <Tip label="Debug drawer"><Button size="icon44" aria-label="Debug drawer" onClick={onToggleDrawer}><Settings2 size={16} /></Button></Tip>
      </div>
    </div>
  );
}
```

(The bar grows h-9 → h-12 to hold 44px buttons; check nothing overlaps — the window default y=48 still clears it.)

`src/shell/Dock.tsx` — same shape as today but each icon becomes:

```tsx
        <Tip key={p.id} label={p.label}>
          <Button size="icon48" aria-label={p.label}
            variant={p.id === active ? 'primary' : 'ghost'}
            className={p.id === active ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)] hover:opacity-100' : ''}
            onClick={() => (p.id === active ? onReopen() : onSelect(p.id))}>
            {ICONS[p.id]}
          </Button>
        </Tip>
```

(keep the root div + its stopPropagation; delete the old `title=` attributes.)

- [ ] **Step 5: Favicon** — in `index.html` `<head>`, add:

```html
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='5' width='26' height='20' rx='3' fill='%231A73E8'/%3E%3Crect x='6' y='8' width='14' height='10' rx='1.5' fill='white'/%3E%3Ccircle cx='24' cy='21' r='2' fill='white'/%3E%3C/svg%3E" />
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/143 green. Manual: dock icons 48px with tooltips; meter reads "off — nothing sent"; no favicon 404 in console.

```bash
git add src/shell/traffic.ts src/shell/traffic.test.ts src/shell/MenuBar.tsx src/shell/Dock.tsx src/App.tsx index.html
git commit -m "feat(shell): traffic meter in the menu bar; dock/menubar adopt 44-48px buttons + tooltips; favicon"
```

---

### Task 3: Omnibox adoption

**Files:**
- Modify: `src/shell/Omnibox.tsx`

**Interfaces:** consumes `Button`/`Tip`. Props unchanged. Rules: mic → `icon44` (48 visual via className `w-12 h-12` is NOT needed — mic is primary: use `icon48`); submit → `icon44`; suggestion chips → `Button size="chip"` (hit-44 baked in); grounding chips keep 28px visuals but the chip gets `hit-44` and its ✕ becomes a `Button size="icon44"`-hit mini button (`className="w-6 h-6 hit-24 p-0"` with `hit-24` minimum + spacing — chips sit in a row: use the WCAG spacing rule, ✕ hit ≥24px and ≥24px from the next target); all chip/label text ≥12px (`text-xs` replaces `text-[10px]`/`text-[11px]` on interactive elements); first-run hint and transcript lines may stay 11px (non-interactive).

- [ ] **Step 1: Apply** — rewrite Omnibox's buttons/chips with the primitives (keep the root stopPropagation, the form semantics, draft/restoredDraft logic, caption window, and ALL existing props/behavior identical). Mic keeps its live/off styling via className overrides on the Button.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/green. Manual: chips prefill; ✕ removes; Enter submits while pointing (type-and-point regression).

```bash
git add src/shell/Omnibox.tsx
git commit -m "feat(shell): omnibox adopts the primitives — 44px mic/submit, compliant chips and labels"
```

---

### Task 4: Window chrome + loaded-rect clamp

**Files:**
- Modify: `src/shell/ProgramWindow.tsx`, `src/App.tsx` (windowRect load effect ~529 + the per-program load effect)

**Interfaces:** ✕ → `<Tip label="Close window"><Button size="icon44" aria-label="Close window" onClick={onClose}><X size={14} /></Button></Tip>` (title bar height grows to fit — min-h 44px). Resize handle: visual glyph stays small but the handle div becomes `w-6 h-6` with `hit-24` → 24×24 minimum hit (corner placement caps expansion; 24 is the floor, name it as one of the ≤4 sub-44 exceptions). Title bar (drag surface) is already ≥24px tall — keep. Clamp: the per-program rect load effect wraps in `clampWindow(...)`:

```ts
  useEffect(() => {
    const plane = { width: mainContainerRef.current?.clientWidth ?? 1200, height: mainContainerRef.current?.clientHeight ?? 800 };
    setWindowRect(clampWindow(loadWindowRect(activeProgram) ?? defaultWindowRect(), plane));
    setWindowOpen(true);
  }, [activeProgram]);
```

(and the initial `useState` initializer likewise clamps against `{ width: window.innerWidth, height: window.innerHeight }`).

- [ ] **Step 1: Apply the three changes** (✕ button, resize hit area, clamp).
- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/green (windowState tests unaffected). Manual: ✕ has a 44px hit + tooltip; resize still works; a saved rect from a huge window loads on-screen.

```bash
git add src/shell/ProgramWindow.tsx src/App.tsx
git commit -m "feat(shell): window chrome adopts primitives — 44px close, 24px resize hit, viewport-clamped rect load"
```

---

### Task 5: Drawer → Sheet with Radix controls + showMarkings toggle

**Files:**
- Create: `src/ui/Sheet.tsx`, `src/ui/Select.tsx`, `src/ui/Switch.tsx`, `src/ui/Slider.tsx`
- Modify: `src/shell/DebugDrawer.tsx`, `src/App.tsx` (drawer props gain `showMarkings`/`onShowMarkings`)

**Interfaces:**
- `Sheet`: `{ open, onOpenChange, children }` — Radix Dialog (modal) rendering a right-side panel (`fixed right-0 top-12 bottom-0 w-[360px]`), overlay click + Esc close, focus trapped (spec §2).
- `Select`: `{ value, onValueChange, options: { value: string; label: string }[], label?: string }` — 44px trigger.
- `Switch`: `{ checked, onCheckedChange, label }` — 44px row hit.
- `Slider`: `{ value, onValueChange, min, max, step, label }` — full-width 44px-tall interactive band, 20px visual thumb.

- [ ] **Step 1: Vendor the four components**

`src/ui/Sheet.tsx`:

```tsx
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
```

`src/ui/Select.tsx`:

```tsx
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
```

`src/ui/Switch.tsx`:

```tsx
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
```

`src/ui/Slider.tsx`:

```tsx
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
```

- [ ] **Step 2: Rebuild DebugDrawer on the primitives** — same content order as today, each hand-rolled control swapped: honest-mode → `Switch`; backend/autonomy/feedback → `Select` (options from the existing constants: backends `[{value:'gemini',label:'Gemini'},{value:'azure',label:'RTV2 (Azure Realtime)'}]`, `AUTONOMY_OPTIONS`, `FEEDBACK_OPTIONS` mapped to `{value,label}`); refresh-rate → `Slider` (min 300, max 2000, step 100); earcon/audit/export/End/Reset buttons → `Button size="sm"`; the drawer shell → `Sheet` (App: `<Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title="Control Center">` — delete the hand-rolled slide-over/backdrop). **Add the missing spec §7 dial:** `<Switch label="Debug markings" hint="highlight rings + legend" checked={showMarkings} onCheckedChange={onShowMarkings} />`; App passes `showMarkings={showMarkings} onShowMarkings={setShowMarkings}` (state + setter already exist at App.tsx:347).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/green. Manual: drawer opens from ⚙, traps focus, Esc closes; every dial works; markings toggle lights the legend; slider drags with a fat hit area.

```bash
git add src/ui src/shell/DebugDrawer.tsx src/App.tsx
git commit -m "feat(shell): drawer becomes a Radix Sheet — Select/Switch/Slider dials, showMarkings toggle restored"
```

---

### Task 6: Witness cards — non-modal dialog semantics + Buttons

**Files:**
- Modify: `src/App.tsx` (witness stack ~search `bottom-24`; confirm/cancel buttons; an Esc+autofocus effect)

**Interfaces:** No Radix needed (the non-modal, desktop-stays-pointable requirement is simpler by hand): Confirm/Cancel become `Button variant="primary" size="sm"` / `Button variant="outline" size="sm"` (44px hits). Add one effect implementing the spec semantics:

```ts
  // Witness semantics (spec §2): focus moves to Confirm on open; Esc cancels. Non-modal —
  // no trap, the desktop stays pointable while confirming.
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if ((pendingAction && !pendingAction.confirmed) || (shareRequest && !shareRequest.confirmed)) {
      confirmBtnRef.current?.focus();
    }
  }, [pendingAction, shareRequest]);
```

and in the keyboard handler (before the editable-target bail is fine — Esc in a field should still cancel? NO: keep it after the editable bail; Esc while typing dismisses per platform norms — put it BEFORE the bail, Esc is safe):

```ts
      if (e.key === 'Escape') {
        if (pendingActionRef.current && !pendingActionRef.current.confirmed) { cancelPendingAction(); return; }
        if (shareRequestRef.current && !shareRequestRef.current.confirmed) { cancelShare(); return; }
      }
```

(add `pendingActionRef`/`shareRequestRef` mirrors if not present — check; otherwise include `pendingAction`/`shareRequest` in the effect deps.) `ref={confirmBtnRef}` goes on whichever Confirm renders (pendingAction card's Confirm; share's Confirm gets focus only when it's the sole card — give share's Confirm the ref when `!pendingAction`).

- [ ] **Step 1: Apply** (Buttons + focus effect + Esc branch + refs).
- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/green. Manual: witnessed action → focus lands on Confirm (Enter commits), Esc cancels, pointing still works while the card is up, voice "yes" still works.

```bash
git add src/App.tsx
git commit -m "feat(shell): witness cards — focus-to-Confirm, Esc-cancels, 44px buttons, still non-modal"
```

---

### Task 7: Rail affordances adopt the primitives

**Files:**
- Modify: `src/rail/RailPanel.tsx`, `src/rail/CardView.tsx`

**Interfaces:** cards keep their anatomy (spec §4); ONLY affordances change:
- RailPanel header: collapse → `Button size="icon44" className="w-8 h-8 hit-44"` (visual 32, hit 44) with `Tip "Collapse"`; dismiss ✕ likewise; the drag header row becomes `min-h-8` (≥24px) with a `GripHorizontal` glyph (lucide) at left; collapsed pill → `Button size="icon48"`.
- CardView: `why?` / `show me` / `confirm for me ✓` / `flip` become `Button variant="ghost" size="chip"` (12px text, 44px hits); the concept flip stays a full-card button (already large).
- Telemetry wiring unchanged (the handlers pass through).

- [ ] **Step 1: Apply.**
- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — clean/green (rail tests untouched — reducer unchanged). Manual (`?rail=1`): drag by the grip header; collapse/dismiss/why/show-me all comfortably tappable.

```bash
git add src/rail
git commit -m "feat(rail): affordances adopt shared primitives — compliant hits, grip header; card anatomy untouched"
```

---

### Task 8: Soft-block keyboard closure — `inert` on blocked elements (TDD)

**Files:**
- Modify: `src/teaching/selectors.ts`, `src/teaching/selectors.test.ts`, `src/widgets/ProgramSurface.tsx` (SurfaceElement + SurfaceProps), `src/App.tsx`

**Interfaces:**
- Produces: `blockedElementNumbers(state: TeachingState, entities: SceneEntity[]): number[]` — the scrimmed leaf elements' numeric image ids (empty when no active fade-0 sequence). `SurfaceProps` gains `blockedElements?: number[]`; `SurfaceElement` sets `inert` when its `img.id` is blocked (closes the Tab+Enter bypass — inert removes the subtree from focus AND click).

- [ ] **Step 1: Failing test** — append to `src/teaching/selectors.test.ts`:

```ts
import { blockedElementNumbers } from './selectors';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';
// inside the describe (fixtures for a soft-blocked sequence already exist in this file — reuse
// the store setup pattern):
  it('blockedElementNumbers: scrimmed leaves as numeric ids; program chrome and the target excluded', () => {
    const program = getProgram('word');
    const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i, xmin: 0, ymax: i + 1, xmax: 1 } })) });
    let st = reduce(initialTeachingState(), { type: 'teach.sequence', title: 't', taskKey: 'k', posture: 'guide',
      steps: [{ entityId: 'word-2' as any, subgoal: 's', instruction: 'i' }] }, 0);
    expect(blockedElementNumbers(st, entities).sort()).toEqual([3, 4]); // ui leaf 3 + content 4; chrome 1 excluded; target 2 excluded
    expect(blockedElementNumbers(initialTeachingState(), entities)).toEqual([]);
  });
```

Run: FAIL (not exported).

- [ ] **Step 2: Implement** in `src/teaching/selectors.ts`:

```ts
import type { SceneEntity } from '../entities/registry';

/** The scrimmed leaf elements as numeric image ids — lets surfaces set `inert` so keyboard
 *  (Tab+Enter) cannot bypass the pointer-only scrim. Chrome ('program') is never blocked. */
export function blockedElementNumbers(state: TeachingState, entities: SceneEntity[]): number[] {
  const leafIds = entities.filter(e => e.category !== 'program').map(e => e.id);
  return blockedEntityIds(state, leafIds)
    .map(id => Number(String(id).split('-').pop()))
    .filter(n => Number.isFinite(n));
}
```

- [ ] **Step 3: Wire** — `SurfaceProps` gains `blockedElements?: number[]`; `SurfaceElement` gains prop `blocked?: boolean` rendered as `inert={blocked || undefined}` on its wrapper div (React 19 supports the `inert` boolean prop); each surface passes `blocked={blockedElements?.includes(img.id)}` where it renders SurfaceElements. App:

```ts
  const blockedElements = useMemo(
    () => (teachingSnapshot ? blockedElementNumbers(teachingSnapshot, entities) : []),
    [teachingSnapshot, entities]);
```
passed to `<ProgramSurface ... blockedElements={blockedElements} />`.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run src/teaching` then full suite + tsc — green/clean. Manual (`?teach=1`): during step ① , Tab reaches neither Save As nor the body; clicking scrimmed tiles still toasts.

```bash
git add src/teaching src/widgets/ProgramSurface.tsx src/App.tsx
git commit -m "fix(teaching): soft-block closes the keyboard — blocked leaves render inert"
```

---

### Task 9: Idle auto-disconnect (TDD)

**Files:**
- Create: `src/shell/idle.ts`, `src/shell/idle.test.ts`
- Modify: `src/App.tsx` (activity tracking + watchdog effect)

**Interfaces:**
- Produces: `IDLE_LIMIT_MS = 300_000`; `idleExceeded(now: number, lastActivity: number, limit?: number): boolean`.
- App: `lastActivityRef` updated by (a) `handlePointerDown`, (b) omnibox `onSubmit`, (c) `onInputTranscript`; a 30s interval while `isLive` closes the provider and surfaces the reason at the omnibox.

- [ ] **Step 1: Failing test** — `src/shell/idle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { idleExceeded, IDLE_LIMIT_MS } from './idle';

describe('idle watchdog', () => {
  it('trips only past the limit', () => {
    expect(idleExceeded(1000 + IDLE_LIMIT_MS, 1000)).toBe(false);
    expect(idleExceeded(1001 + IDLE_LIMIT_MS, 1000)).toBe(true);
    expect(idleExceeded(5000, 1000, 3000)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/shell/idle.ts`**

```ts
/** Token guard: a live session streams vision frames + hints continuously; an abandoned one
 *  burns silently. 5 idle minutes (no pointer, typing, or speech) ends the session. */
export const IDLE_LIMIT_MS = 300_000;
export const idleExceeded = (now: number, lastActivity: number, limit: number = IDLE_LIMIT_MS): boolean =>
  now - lastActivity > limit;
```

- [ ] **Step 3: App wiring**

```ts
  const lastActivityRef = useRef(Date.now());
  // in handlePointerDown (top): lastActivityRef.current = Date.now();
  // in the omnibox onSubmit (top): lastActivityRef.current = Date.now();
  // in onInputTranscript (top): lastActivityRef.current = Date.now();
  useEffect(() => {
    if (!isLive) return;
    lastActivityRef.current = Date.now();
    const t = setInterval(() => {
      if (idleExceeded(Date.now(), lastActivityRef.current)) {
        providerRef.current?.close();
        setLastError('Session ended after 5 idle minutes (token guard) — tap the mic to reconnect.');
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [isLive]);
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run src/shell/idle.test.ts` then full suite + tsc — green/clean.

```bash
git add src/shell/idle.ts src/shell/idle.test.ts src/App.tsx
git commit -m "feat(shell): idle auto-disconnect — 5 silent minutes ends the session, reason shown at the omnibox"
```

---

### Task 10: AFTER audit + regressions + sweep

**Files:**
- Modify: `.superpowers/sdd/task-10-report.md` (audit record), stray cleanups only

- [ ] **Step 1: Full verification** — `npx vitest run` (all green), `npx tsc --noEmit`, `npx vite build` (clean; chunk warning pre-existing).
- [ ] **Step 2: AFTER audit** — dev server up; run `scripts/tap-audit.js` in the console for EACH state: default, drawer open, `?rail=1`, grounding chips present (click Save first), witness card visible (autonomy = Confirm changes → click Save). Record all five JSON outputs in the task report. **Acceptance (spec §5):** 0 under-24 anywhere; ≤4 named under-44 exceptions (expected: resize handle 24px, chip ✕ 24px+spacing, and up to two more — name them); `tinyTextCount` 0 in all states.
- [ ] **Step 3: Behavioral regressions** — type-and-point (focus omnibox, paint over an element, Enter submits); chrome clicks never paint; drawer dials each wired (flip every one, observe effect); witness voice-confirm still works alongside Esc/Enter; `?teach=1` demo advances; window drag re-measures (say "this" after a drag if a key is available, else confirm rings track).
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shell): usability pass verified — tap-audit acceptance recorded, zero sub-24px targets"
```

---

## Self-Review Notes (already applied)

- Spec coverage: §2 standards → Tasks 1 (utilities/focus ring) + 3-7 (per region) + 10 (acceptance); §3 library/deps → Task 1; §4 boundary → Tasks 3-7 honor it (surfaces only touched by Task 8's `inert`, which is behavioral not visual — spec §4 allows standards applied manually to bespoke regions, and the soft-block closure was an explicitly named extra); §5 verification → Tasks 1 (script + BEFORE) and 10 (AFTER + regressions).
- Extras mapping: traffic meter + favicon → Task 2; windowRect clamp → Task 4; showMarkings → Task 5 (setter already exists at App.tsx:347 — wiring only); inert soft-block → Task 8; idle disconnect → Task 9.
- Type consistency: `Traffic`/`withTrafficCount` (Task 2) match the MenuBar prop; `blockedElementNumbers` (Task 8) consumes existing `blockedEntityIds(state, allTileIds)`; `Sheet/Select/Switch/Slider` prop shapes defined once in Task 5 and used only there.
- Witness cards deliberately skip Radix Dialog (spec §4 non-modal + §2's no-trap amendment make the hand-rolled focus/Esc simpler and safer than fighting Radix's modal defaults); the spec's "Dialog semantics" are delivered as behavior (focus-to-Confirm, Esc-cancels), which is what §2 defines.
