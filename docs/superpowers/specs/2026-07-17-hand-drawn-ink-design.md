# Hand-Drawn Agent Ink — Design

**Date:** 2026-07-17
**Status:** Approved (approach A / all three surfaces / Caveat lettering / confident-marker intensity)
**Sibling of:** `2026-07-15-sketch-surface-design.md` (the user's half of "both"; this is the agent's half)

## 1. Problem

The user sketches in real hand ink (graphite polylines, SketchLayer). The agent replies in
CAD: perfect rects, straight lines, triangle `<marker>` arrowheads, monospace labels. The
mismatch undercuts the colleague-at-the-whiteboard feel the sketch surface built. The agent's
marks should read as sketched marker strokes — drawn, not plotted.

## 2. Scope

Restyle the agent's DRAWN marks on all three surfaces. **Render-only**: no geometry, tool,
store, serializer, or hint changes anywhere.

| Surface | Gets hand ink | Stays crisp chrome |
| --- | --- | --- |
| `WhiteboardMarks.tsx` (incl. beautify output) | node rects/ellipses, connector lines + arrowheads, labels | — |
| `AnnotationLayer.tsx` | arrows (curve + arrowhead), shapes (circle/box/bracket), leader lines, labels | — |
| `TeachingLayer.tsx` | relate arcs + labels, highlight rings (ad-hoc highlight + active-step ring become rough ink) | numbered step badges, step-label pill, ✓ dots, scrims, toasts, fade-2 prompt |

Out of scope: user SketchLayer (their ink is theirs, untouched), Omnibox/witness cards, any
UI chrome, the beautify PREVIEW card layout (its marks render through WhiteboardMarks and
inherit the style for free).

## 3. Approach — own deterministic rough-ink module

New pure module `src/ink/rough.ts` (~150–200 lines, zero dependencies):

- `seedFrom(id: string): number` — FNV-style string hash.
- `mulberry32(seed)` — tiny seeded PRNG. **No `Math.random`, no `Date.now()`** — the wobble
  for a given mark id + geometry is identical on every render (stable React output,
  exact-string tests, and re-renders never "shimmer").
- Generators, all returning SVG path `d` strings in viewBox units (0..100 space, matching the
  existing `pct` transform):
  - `roughLine(p, q, seed, opts)` — slight bow (control-point offset ⊥ to the segment) +
    endpoint overshoot.
  - `roughRect(x, y, w, h, seed, opts)` — four `roughLine` sides with corner overshoot;
    sides drawn as one path.
  - `roughEllipse(cx, cy, rx, ry, seed, opts)` — one imperfect loop: 8–12 anchor points on
    the ellipse, each jittered, joined with Catmull-Rom→bezier; start/end overlap slightly.
  - `roughArc(p, ctrl, q, seed, opts)` — jittered quadratic (for annotation arrows + relate
    arcs), preserving the existing control-point shape.
  - `roughArrowhead(tip, angle, seed, opts)` — two flick strokes (no filled triangle);
    replaces the shared `<marker>` defs (markers can't vary per instance).
- `opts` (single exported `INK_OPTS` constant — **confident marker**): `bow ≈ 0.35`,
  `jitter ≈ 0.25`, `overshoot ≈ 0.8`, `passes: 1` (viewBox units). One tunable table so a
  later "loose pencil" variant is a constant swap, not a rewrite.

Surface integration: each layer swaps its `<line>/<rect>/<ellipse>/<path>` for
`<path d={rough…(…, seedFrom(mark.id))} …>` with the same stroke color/width/vectorEffect it
uses today. Teaching highlight rings (currently CSS `ring-4` divs) gain a small SVG overlay
rendering `roughRect`/`roughEllipse` in the same accent color; the glow shadow stays on the
div. Arrowhead `<defs>` blocks are deleted from both WhiteboardMarks and AnnotationLayer.

## 4. Lettering

Add Caveat (OFL) to the existing Google Fonts `@import` in `index.css` and a
`--font-ink: "Caveat", cursive` theme var. Labels ON drawn marks (connector labels, wb
labels, annotation labels, relate labels) switch from `font-mono` to the ink font, one size
step up (2.4–2.6 → 3.2 viewBox units) for small-size legibility. All UI chrome keeps its
current fonts. The step-label pill and toasts are chrome — mono stays.

## 5. Binding invariants (honesty)

1. **Ownership legibility survives.** Agent ink remains indigo `rgb(99,102,241)` (amber for
   teach highlights), user ink remains graphite. Wobble is deterministic and consistent —
   styling reads "sketched," never "a live human hand." No color/width changes that could
   blur the two-ink distinction.
2. **Perception fidelity.** Plain SVG paths + a webfont only — NO SVG filters, NO external
   images, nothing that could make the model's vision frame diverge from the user's screen.
   The webfont label switch initially shipped on top of `snapshotNode`'s `skipFonts: true`,
   which meant every label rasterized in a fallback face in the model's frame while the
   screen showed Caveat (final review). Fonts are now embedded via a session-cached
   `getFontEmbedCSS` call (fetched once, reused across snapshot ticks). Two library quirks
   the seam works around: html-to-image's used-font scan walks only HTML elements, so a
   font used exclusively on SVG `<text>` (Caveat — every ink label) would be filtered out
   of the embed CSS; an invisible HTML primer span (`.font-ink`, App.tsx instruction-layer
   wrapper) declares the ink font to the scanner. And because the cache is shared by both
   snapshot roots (surface + instruction layer), the scan runs against `document.body` —
   the embed CSS is independent of which root ticks first and always covers the primer.
   Fail-soft fallback unchanged: if embedding fails, `skipFonts: true` — never block the
   snapshot (per §6/learnings §6). Final pixel-level frame verification (drawer/debug
   vision frame vs on-screen lettering) on a real mic/live session remains on the owed
   human-smoke list — no jsdom test can exercise the rasterization path.
3. **Coordinates stay true.** Max total displacement (bow 0.35 + jitter 0.25 + overshoot
   0.8 = 1.4) stays under 1.5 viewBox units so drawn pixels still visually match the
   coordinates declared in
   [WHITEBOARD]/[ANNOTATIONS] hints and the entity bboxes the model grounds against. The
   teaching `RoughRing` is the one exception: it generates in **pixel space** (measured
   element box, not the 0..100 viewBox) with `RING_OPTS {bow:2, jitter:1.2, overshoot:5}`,
   since ring targets declare no [WHITEBOARD]/[ANNOTATIONS] coordinates for the viewBox
   budget to protect — measured worst-case excursion ≈3.6px including stroke half-width,
   inside the old CSS `ring-4`'s 4px envelope. The three SVG mark layers (WhiteboardMarks,
   AnnotationLayer, TeachingLayer's relate arcs) remain governed by the viewBox-unit budget
   above.
4. **Render-only.** `nodeBox`, `connectorEnds`, `geometry.ts`, every store/serializer/tool,
   and every hint string are untouched. If a diff in this project touches a serializer, it
   is wrong.

## 6. Testing

- `src/ink/rough.test.ts` (TDD): determinism (same id+geometry → byte-identical `d`;
  different ids → different `d`); bounds (every emitted coordinate within input bbox ±
  overshoot+jitter budget); arrowhead flicks anchored at the tip within tolerance; ellipse
  path closes (start≈end).
- Layer render coverage: node env can't render TSX (house pattern) — `npx tsc --noEmit`,
  `npm test`, `npm run build`, then re-drive `?whiteboard=1`, `?illustrate=1`, `?teach=1`,
  and a sketch→beautify pass in the browser with screenshots.
- Perception spot-check: during the `?teach=1` drive, confirm the vision-frame snapshot
  (drawer/debug view) shows the same rough marks as the screen.

## 7. Rollout

Single plan, ordered: ink module (TDD) → WhiteboardMarks swap → AnnotationLayer swap →
TeachingLayer swap (rings + arcs) → lettering → demo drives + screenshots. Each step is
independently revertible; the ink module lands before any consumer.
