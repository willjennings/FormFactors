# Ink rendering research — synthesis (Ink v2)

**Date:** 2026-07-17. Companion notes (full sources per claim):
`2026-07-17-ink-rendering-notes-paper53.md` · `…-freehand.md` · `…-google.md`

Three independent research passes (Paper by FiftyThree / perfect-freehand+Excalidraw+rough.js
internals / Google ink + Chrome experiments) converge on the same ranking for what makes marks
read as INK rather than wobbled vectors.

## The gap in Ink v1

v1 (src/ink/rough.ts) wobbles a **uniform-width stroked path**: bow + jitter + overshoot.
That earns "hand-ruled," not "hand-inked." Every serious ink renderer studied — Paper 53
(patents US9529486/US11200712), perfect-freehand, Google's ink library — models the stroke as
a **variable-width region**, not a line: width responds to (real or simulated) speed, tapers
at entry, pools at stops. Uniform width is the single biggest tell.

## Adopted for v2 (ranked by payoff/effort, all deterministic + filter-free)

1. **Variable-width outline polygon** (perfect-freehand's pipeline, statically simulated):
   centerline → arc-length resample → width profile `w(t)` → offset both normals → filled
   polygon path. Radius formula (perfect-freehand, MIT):
   `radius = size * ease(0.5 - thinning * (0.5 - pressure))`. With no live input, pressure is
   SIMULATED: taper-in at stroke start, ~flat body with seeded ±10% drift, slight POOL at the
   terminal end (Paper 53: width ∝ 1/speed — pens stop at ends and corners). 3-tap smoothing
   kernel `0.25/0.5/0.25` on widths (Microsoft) prevents popping.
2. **Phase-coherent wobble** (matplotlib's Sketch): displace resampled points along the
   normal by `sin(phase)·amp` where phase advances with a seeded per-step multiplier —
   smoother, less "buzzy" than v1's independent per-point jitter.
3. **Length-scaled roughness ramp** (rough.js `_line`): wobble at full amplitude on short
   segments, dampened on long ones (full <20 viewBox units, taper to 0.4× by 50) — long
   connectors stop looking nervous.
4. **Double-pass** stays available via `passes: 2` (rough.js `_doubleLine`), now cheap
   because the second pass is a second outline polygon at reduced opacity.
5. **Anisotropy compensation** (our own requirement, not in any library): the mark layers
   render in a 0..100 viewBox stretched non-uniformly (`preserveAspectRatio="none"`), which
   would make a polygon's width direction-dependent (the RoughRing lesson). v2 offsets
   normals in *aspect-corrected* space: `opts.aspect = (containerW/containerH)` scales the
   x-component of every normal offset so on-screen stroke width is uniform in all directions.

## Rejected, with reasons

- **`mix-blend-mode: multiply` ink darkening** (Paper 53's "Mix"): blend-mode support in the
  html-to-image vision-snapshot rasterizer is unverified — same fidelity risk class as
  filters. Layered opacity gives 80% of the effect; revisit only with a proven snapshot test.
- **SVG turbulence/displacement filters**: banned (spec §5.2), stays banned.
- **ink-stroke-modeler's spring-mass modeling + prediction, WICG delayed-ink**: latency
  machinery for live input; nothing to render statically.
- **Hachure fills** (rough.js): no filled-region marks exist yet; YAGNI until one does.

## Consequences for the module

`src/ink/rough.ts` gains `inkStroke(points, seed, opts)` (centerline → filled polygon `d`)
plus a `resample`/`widthProfile` internals; the existing generators become centerline
producers whose output feeds `inkStroke`. Layers switch `stroke=…` paths to `fill=…` polygon
paths (vectorEffect no longer applies — width lives in the geometry, which is exactly why
aspect compensation is required). The v1 uniform-stroke generators remain exported: labels'
leader lines and the dashed relate arcs keep uniform stroke (a dashed variable-width polygon
is not a thing), so both renderers coexist.
