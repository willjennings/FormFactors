# Shell Usability + Component Coherence — Design Spec

*Adopt the most-widely-used component system for our stack (shadcn/ui on Radix primitives) for
the shell's interaction chrome, and enforce a measured tap-target/focus/text standard — while
the bespoke product surfaces stay bespoke. Grounded in a live usability audit (2026-07-08, below)
that shows every measured violation is in the chrome and zero are in the surfaces.*

Date: 2026-07-08
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record: library = **shadcn/ui (Radix primitives, components vendored in-repo)**;
boundary = **chrome adopts, surfaces stay bespoke**, with the rail-affordance + window-chrome
amendment (§4). The long-standing "no new dependencies" plan constraint is **explicitly lifted
for this project only** (Radix packages + clsx/tailwind-merge; lucide-react already present).

---

## 1. Evidence — the 2026-07-08 live audit

Measured on the running app (default view = 42 interactive targets; plus drawer, `?rail=1`,
window-chrome states):

| Region | Targets | <44px | <24px (WCAG 2.2 §2.5.8 hard fail) |
|---|---|---|---|
| Program surface (bespoke) | 7 | 0 | 0 |
| Omnibox | 12 | 12 | 1 |
| Dock | 4 | 4 (~34px) | 0 |
| Menu bar | 2 | 2 | 0 |
| Window chrome | 2 | 2 | 2 (✕ 21×21; resize 16×16) |
| Drawer | 15+ | 15 | 1 (slider hit area 323×4) |
| Rail affordances | 5 | 5 | 4 (Dismiss 12×12, Collapse 14×15, why? 24×15, drag header 15px) |

Also: 19 focusable elements with labels <12px; 38 tabbables with no visible focus indicator;
`title=` attributes standing in for tooltips (invisible on touch, delayed on mouse).

**Conclusion the design follows:** reskinning the surfaces buys nothing measurable (they already
pass every threshold — they are real program controls at real sizes); the gains live entirely in
the chrome. Estimated acquisition-speed gain on dock/omnibox/rail affordances from 34→48px
targets: 15–25% (Fitts's-law estimate, to be validated by the same audit script post-change).

## 2. The standards (binding)

- **Tap targets:** ≥44×44 CSS px hit area for every interactive control; 48px for primary
  actions (mic, dock icons). Absolute floor 24×24 (WCAG 2.2 AA §2.5.8) — no exceptions. Dense
  inline rows (grounding/suggestion chips) may render smaller *visuals* but must reach 44px
  *hit areas* via padding/`::after` expansion, or qualify under WCAG's spacing exception
  (≥24px visual + undilated spacing) — pick per case in the plan, never silently.
- **Focus:** every interactive control shows a visible `focus-visible` ring (accent color, 2px,
  offset 2). The drawer traps focus and closes on Esc (Radix Sheet). Witness cards are
  deliberately NON-modal (the desktop must stay pointable while confirming): no focus trap —
  focus moves to Confirm on open, Esc cancels, tab order stays natural.
- **Text:** ≥12px for any interactive label; micro-mono kickers (9-10px) remain legal only on
  non-interactive text.
- **Tooltips:** every icon-only control gets a Radix Tooltip (replacing `title=`).
- **Pointer conventions preserved:** all chrome keeps `onPointerDown` stopPropagation (the
  plane owns deixis painting); the type-and-point focus rule (pointing never steals focus) is
  regression-checked after adoption — Radix components must not reintroduce focus stealing.

## 3. The library and how it enters the repo

- **shadcn/ui, vendored**: components are copied into `src/ui/` (shadcn's model — source in
  repo, no component package), styled with our existing CSS variables (`--card-bg`,
  `--card-border`, `--accent-color`, `--text-*`) so light/dark theming keeps working unchanged.
- **New dependencies (the explicit lift):** the Radix primitive packages actually used
  (`@radix-ui/react-dialog`, `-select`, `-switch`, `-slider`, `-tooltip`), plus `clsx` +
  `tailwind-merge` (the `cn()` helper). Nothing else; no CSS framework changes (Tailwind v4
  stays).
- Component inventory to vendor: `Button` (sized variants: `icon-lg` 48px, `icon` 44px, `sm`
  text buttons with 44px hit area), `Tooltip`, `Sheet` (drawer), `Select`, `Switch`, `Slider`,
  `Dialog` (witness semantics), `Badge` (chips).

## 4. The boundary (what adopts, what stays)

**Adopts shadcn/Radix:**
- Debug drawer → `Sheet` (focus trap, Esc, overlay dismiss); its controls → `Select`
  (backend/autonomy/feedback), `Switch` (honest mode), `Slider` (refresh rate — 44px thumb,
  full-height hit area), `Button` (earcons, export, End/Reset).
- Witness cards → `Dialog` semantics on the existing card visuals (focus moves to Confirm,
  Esc = Cancel, voice confirm unaffected). Non-modal positioning stays (they float above the
  omnibox; the desktop stays interactive — Radix `Dialog` with `modal={false}`).
- Menu bar + dock buttons → `Button` variants (`icon-lg`), Tooltips.
- Omnibox: mic/submit → `Button` 44px; suggestion + grounding chips → `Badge`-styled buttons
  with 44px hit areas (visual height may stay 28px); chip ✕ gets a 24px+ expanded hit area.

**Stays bespoke, with standards applied manually (§2):**
- Program surfaces (already compliant — untouched except regression re-measurement).
- Rail **cards** (the grammar's anatomy is the product) — but the rail's **affordances** adopt
  the shared primitives: collapse/dismiss/why?/show me/confirm-for-me become `Button`s with
  compliant hit areas; the drag header grows to ≥24px tall with a visible grip glyph.
- Window chrome: title bar stays custom; ✕ becomes `Button icon` (44px hit area); the resize
  handle grows to a 24×24 hit area (visual corner glyph may stay small).
- Teaching overlays, omnibox layout, desktop plane: untouched.

## 5. Verification — the audit is the acceptance test

- The §1 audit script is checked in as `scripts/tap-audit.js` — a paste-into-DevTools console
  script (no new test infrastructure). Before/after JSON results are recorded in the plan's
  final task report, and the after-state must meet the acceptance bars below.
- Acceptance: **0 targets under 24px in any state** (default, drawer open, `?rail=1`, grounding
  chips present, witness card shown); **≤4 justified sub-44 exceptions**, each named in the
  audit record; 0 interactive labels <12px; focus ring visible on every tabbable.
- Existing suite stays green (139+); `npx tsc --noEmit` and `npx vite build` clean.
- Behavioral regressions explicitly re-checked: type-and-point (Enter submits while pointing),
  chrome pointer guards (no painting from chrome clicks), witness voice-confirm path, drawer
  dials each still wired to exactly one consumer.

## 6. Out of scope

Reskinning program surfaces or rail card anatomy; mobile shell; the goal model, entity
granularity, or any audit-gap work beyond what §2 pays incidentally (focus/keyboard); replacing
Tailwind; theming changes beyond consuming the existing CSS variables.
