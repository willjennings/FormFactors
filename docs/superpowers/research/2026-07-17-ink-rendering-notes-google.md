# Ink rendering research — Google's stroke work + the browser ink world

**Context / lens for every finding below:** our marks are STATIC — generated whole from
geometry plus a seeded PRNG (deterministic, reproducible), rendered as plain SVG `<path>`
elements. No live pointer, no velocity/pressure stream, no real-time frame loop. SVG
`<filter>` (feTurbulence/feDisplacementMap/etc.) is banned because it breaks vision-model
snapshot fidelity. So everything below is filtered through one question: **can this be
baked into path geometry / stroke-width tables ahead of time, from arc-length, curvature,
and noise sampled at fixed (seeded) offsets, with no filter and no live input?**

Research date: 2026-07-17.

---

## 1. Google's Ink stack (`ink-stroke-modeler`, `google/ink`)

Google has (at least) two separate-but-related repos:

- **`google/ink-stroke-modeler`** — C++ library that turns raw pointer samples into a
  smoothed, resampled position stream. This is the *input-side* physics simulation used
  by Chrome Canvas / Jamboard-era ink, and it's what feeds the newer Android Ink stack.
  Sources: [GitHub repo](https://github.com/google/ink-stroke-modeler),
  [docs site](https://google.github.io/ink-stroke-modeler/),
  [README](https://github.com/google/ink-stroke-modeler/blob/main/README.md).
- **`google/ink`** — newer, higher-level library (core of the Android Jetpack "Ink" API,
  alpha as of Oct 2024) that owns brush definition, mesh geometry, and rendering.
  Sources: [GitHub repo](https://github.com/google/ink),
  [README](https://github.com/google/ink/blob/main/README.md),
  [Android Developers Blog announcement](https://android-developers.googleblog.com/2024/10/introducing-ink-api-jetpack-library.html).

### 1a. Position modeling — mass-spring-drag on the *anchor*, not the geometry

The pen tip is modeled as a physical weight `s(t)` connected by a spring to a moving
anchor `Φ(t)` that follows the raw (resampled) input, with drag opposing velocity:

```
d²s/dt² = (Φ(t) − s(t)) / M − k_d · (ds/dt)
```

where `M` folds spring constant and mass together (`spring_mass_constant`) and `k_d` is
`drag_constant`. It's integrated with **fixed-timestep Euler**:

```
a_j = (i_j.pos − s_{j-1}) / M − k_d · v_{j-1}
v_j = v_{j-1} + Δ_j · a_j
s_j = s_{j-1} + Δ_j · v_j
```

with `s_0 = i_0.pos`, `v_0 = 0`.
Source: [ink-stroke-modeler docs site](https://google.github.io/ink-stroke-modeler/) (design doc, "Algorithm #3").

**Portability:** This is a live-input smoothing filter — it exists to hide latency and
digitizer jitter on a *streaming* input. We have no live input, so the algorithm itself
doesn't port. But the *shape* it produces is instructive: spring-lag toward a moving
anchor gives strokes a very specific "overshoot-and-settle" character at corners and stroke
ends (the pen "catches up" after a direction change). We can fake that shape statically:
when generating a corner/anchor-point polyline from an agent's diagram intent, insert a
small **rounded overshoot bump** at sharp direction changes — offset the corner outward
along the incoming tangent by a fixed fraction of local segment length, then curve back —
rather than a crisp corner. This is a geometry transform on the *fixed point list*, computed
once, no simulation needed.

### 1b. Resampling — upsample raw input to a fixed minimum rate via lerp

Given variable-rate raw input, the library guarantees a minimum output sample rate by
linearly interpolating extra points between consecutive raw samples:
`a_j = ⌈(Δt_input) / (Δt_target)⌉` interpolated points per gap.
Source: [google.github.io/ink-stroke-modeler](https://google.github.io/ink-stroke-modeler/) ("Algorithm #2").

**Portability:** Directly useful, minus the "live" part. When we synthesize a stroke from
a small number of geometric anchor points (e.g. 4-6 points defining an arrow or box edge),
resample **that fixed point list** up to a dense, evenly arc-length-spaced set (e.g. every
2-3px) *before* applying noise/wobble. Arc-length-uniform resampling is exactly what makes
per-point noise look like consistent "hand jitter" rather than clustering unevenly on long
straight runs — this is the load-bearing prerequisite for §3's noise techniques below.

### 1c. Wobble smoothing — velocity-weighted moving average

To suppress high-frequency digitizer noise without fighting real motion, the library
blends a time-windowed moving average of position with the raw position, weighted by
recent velocity: fast motion trusts raw input more, slow motion trusts the average more
(interpolation factor λ clamped between `speed_floor` and `speed_ceiling`).
Source: [google.github.io/ink-stroke-modeler](https://google.github.io/ink-stroke-modeler/) ("Algorithm #1").

**Portability:** Inverted for our case — we're *adding* wobble, not removing it, but the
same velocity-coupling idea is the key insight for §3's "speed → width/jitter" mapping:
real hand-drawn strokes get *smoother* where a hand moves fast (straight-line gestures,
e.g. long connector lines) and *wobblier* where it moves slow (careful line-work, e.g.
label underlines, small shapes). Since we have no real velocity, we can proxy "implied
speed" from local curvature/segment-length in the source geometry — long straight runs =
"fast" = less noise amplitude; tight curves/corners = "slow" = more noise amplitude. This
gives the deterministic PRNG an amplitude *envelope* rather than a flat noise magnitude.

### 1d. Prediction (StrokeEndPredictor / KalmanPredictor)

Two forward-prediction strategies exist purely to reduce perceived latency by drawing a
few frames ahead of the confirmed model state — a Kalman filter over position/velocity/
acceleration/jerk, or an "as if this were the stroke end" iterative relaxation.
Source: [ink-stroke-modeler README](https://github.com/google/ink-stroke-modeler/blob/main/README.md).

**Portability:** None — this is purely a live-latency-hiding technique with no analog in
static generation. Explicitly out of scope per the brief (skip latency plumbing).

### 1e. `google/ink` brush/geometry module — mesh silhouette from modeled path

`google/ink`'s architecture: `Rendering` + `Storage` → `Strokes` → `Brush` → `{Geometry,
Color, Types}`. Brush declares style (size, color, tool); Geometry holds point/segment/
triangle/quad primitives and a mesh type; Rendering currently targets `android.graphics.Mesh`.
The stroke pipeline: modeled centerline (from ink-stroke-modeler-style physics) → brush
tip shape swept/extruded along it → triangle mesh → shader-based brush effects on top.
Source: [google/ink README](https://github.com/google/ink/blob/main/README.md);
the README doesn't expose exact tip-extrusion math (it's Android-mesh-oriented and the
repo is alpha), so this is architecture-level, not algorithm-level.

**Portability:** The *pipeline shape* (centerline → tip geometry swept along centerline →
outline polygon) is exactly the shape of the portable algorithm we actually want — but the
concrete, documented, portable version of "sweep a tip shape along a centerline into an
outline polygon" is **`perfect-freehand`** (§3 below), which is JS/TS, has a fully
public/readable outline algorithm, and is the closer real match for "static geometry → SVG
polygon."

---

## 2. Chrome Experiments (experiments.withgoogle.com) — drawing/mark-making

Searched the Drawing collection. Notable entries and what they actually contribute
(technique, not gimmick):

- **[Land Lines](https://lines.chromeexperiments.com/)** — WebGL (Pixi.js) line-matching
  against satellite imagery. Rendering itself is plain smoothed polyline-to-WebGL; the
  interesting part (ML matching of drawn gesture to real coastlines) is not a rendering
  technique. **Not portable** — no ink-quality insight beyond standard smoothing.
  Source: [ArchDaily writeup](https://www.archdaily.com/801794/land-lines-trace-an-infinite-path-around-the-planet-using-maps).
- **[Animated Harmonograph](https://experiments.withgoogle.com/animated-harmonograph)** —
  pure Lissajous/pendulum math (sums of decaying sinusoids), not freehand ink at all — it's
  useful only as an *aesthetic reference* for "line quality" (thin, consistent-width,
  mathematically pure curves), not as a stroke-rendering technique. **Not portable** as an
  algorithm, but worth a visual glance if we ever want a "plotter" aesthetic mode distinct
  from "hand-drawn."
- **[Inkspace](https://experiments.withgoogle.com/ink-space)**, **[Just a Line](https://experiments.withgoogle.com/justaline)**,
  **Canvas Sketch**, **Creatability** — all thin wrappers over standard canvas
  `quadraticCurveTo`/WebGL line-strip smoothing (see §3); no novel rendering math exposed
  in public writeups.

**Conclusion for this section:** Chrome Experiments' drawing toys are demos of *input UX*
(gesture matching, multi-device, accessibility), not sources of novel stroke-geometry
algorithms. The real technical payload for our purposes is in §1 (Google's actual ink
libraries) and §3 (the classic/open-source canvas-ink literature). Nothing here changes
the plan; noted for completeness per the brief.

---

## 3. Classic canvas/SVG ink techniques (the load-bearing section)

### 3a. Quadratic midpoint smoothing (the universal freehand-canvas trick)

The standard trick for turning a polyline of raw points into a visually smooth curve
without any real curve-fitting: draw a `quadraticCurveTo` from the *previous midpoint* to
the *current midpoint*, using the actual point in between as the control point:

```js
const xc = (points[i].x + points[i - 1].x) / 2
const yc = (points[i].y + points[i - 1].y) / 2
ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc)
```

Source: [chenxiaoyao.cn — Bezier Curves for Smooth Freehand Drawing](https://www.chenxiaoyao.cn/blog/bazier_curves);
also standard reference: [MDN quadraticCurveTo](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/quadraticCurveTo).

**Portability: direct, high-value.** This is exactly the SVG-path equivalent of a
`Q` command chain: for any resampled point list, emit `M p0 Q p1 midpoint(p1,p2) Q p2
midpoint(p2,p3) ...`. It requires no randomness and is deterministic by construction —
it's the *base* smoothing pass to apply before any noise is layered on. Directly usable
as static SVG path data with zero runtime cost.

### 3b. `perfect-freehand` (Steve Ruiz) — the closest real match to our use case

[`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) computes a **filled
outline polygon** (not a stroked centerline) representing a variable-width hand-drawn
stroke, fully in JS, fully inspectable, used in production by tldraw/excalidraw-adjacent
tools. Pipeline (source: raw TS files fetched directly —
[`getStrokePoints.ts`](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokePoints.ts),
[`getStrokeRadius.ts`](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeRadius.ts),
[`getStrokeOutlinePoints.ts`](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeOutlinePoints.ts),
prior-art discussion: [Discussion #16](https://github.com/steveruizok/perfect-freehand/discussions/16)):

1. **Streamline smoothing** — each raw point is lerp'd toward the running spline point by
   `t = MIN_STREAMLINE_T + (1 − streamline) · STREAMLINE_T_RANGE`; higher `streamline` =
   less movement = sharper corners retained, lower = smoother/softer.
2. **Simulated pressure from spacing** — when no real pressure exists, distance between
   consecutive points stands in for pressure (points close together ⇒ "slow" ⇒ heavier
   line; far apart ⇒ "fast" ⇒ thinner line). This is the concrete, documented version of
   the "speed → width" mapping requested in the brief.
3. **Radius formula**: `radius = size * easing(0.5 - thinning * (0.5 - pressure))` —
   a single closed-form line, trivially portable.
4. **Outline construction** (`getStrokeOutlinePoints`): walk the spline points, at each
   one compute a radius (with taper easing applied near stroke start/end and a minimum-
   pressure average over the first ~10 points to avoid a "fat start"), detect sharp
   corners via dot-product-of-adjacent-vectors sign flip (draws a rounded cap fan at
   corners instead of a normal offset), otherwise compute a perpendicular offset vector
   scaled by radius to emit a left point and a right point (skipping points closer than a
   minimum distance to the previous one, which is what avoids self-intersecting "fishtail"
   artifacts on tight curves). Final polygon winds: **left side forward → end cap → right
   side backward → start cap**, i.e. exactly the shape you'd hand-write for an SVG `<path
   fill>` polygon.

**Portability: this is the single most directly reusable reference in the whole
investigation.** Every input to the algorithm (points, pressure) can be synthetic: feed it
our resampled, noise-perturbed centerline (§3a + PRNG jitter) with a **synthetic pressure
channel derived from arc-length-normalized position along the stroke plus seeded noise**
(e.g. thin at the very start/end via the taper easing, small seeded wobble in the middle)
and it emits a ready-to-fill SVG polygon path with zero runtime dependency on real input —
the whole computation is closed-form over a static point list. This is very likely worth
vendoring the outline-construction logic (not the library, which assumes a live-pressure
API) directly, since it's ~150 lines and MIT-licensed.

### 3c. Speed → width mapping, generalized

Several independent write-ups converge on the same inverse mapping: `width ∝ 1 / velocity`
(slow = thick, fast = thin), controllable by a signed "thinning" parameter (0 = no effect,
positive = faster strokes thinner, negative = faster strokes broader) — same shape as
`perfect-freehand`'s pressure model above, and also implemented in
[`atrament`](https://github.com/jakubfiala/atrament) ("adaptive stroke... simulates the
variation in ink discharge of a physical pen", default smoothing `0.85`, pressure via
low-pass filter with `pressureLow`/`pressureHigh` bounds) and in the classic
["Variable Width Stroke" codepen](https://codepen.io/osublake/pen/oLKWyd) (Bezier-path +
lerp'd width offsets).

**Portability:** direct. Since we have no real velocity, substitute **local arc-length
density of the *source* control points** (before resampling) as the "speed" proxy — an
agent's diagram geometry naturally has denser anchor points where it's being precise
(corners, small shapes) and sparser points on long straight connectors, which is a
reasonable stand-in for "the agent moved slowly/carefully" vs. "quickly."

### 3d. Stamp-based brushes vs. polygon-outline brushes

Two fundamentally different brush rendering families
([shenciao stamp-rendering tutorial](https://shenciao.github.io/brush-rendering-tutorial/Basics/Stamp/);
general survey terms from [Hertzmann, "Stroke-Based Rendering"](https://web.cs.ucdavis.edu/~ma/SIGGRAPH02/course23/notes/S02c23_3.pdf)):

- **Stamp-based:** a texture ("footprint") is repeatedly rendered at equidistant intervals
  along the path (prefix-sum of cumulative edge length determines stamp centers); look is
  rendering-independent of the underlying polyline's vertex density; supports per-stamp
  rotation/opacity/size jitter keyed off stamp index as a random seed.
- **Polygon-outline:** a single filled silhouette traced around the centerline (this is
  what `perfect-freehand`, `google/ink`'s mesh, and most vector "ink" tools do) —
  vertex-density-dependent but trivially exports as one clean SVG `<path>`.

**Portability:** Stamp-based is the technique behind textured/grainy brush looks
(charcoal, marker) and is **naturally deterministic and filter-free** — "stamps" can just
be small pre-defined SVG shapes (e.g. tiny ellipses) placed at seeded-jittered points along
the arc-length-resampled centerline, unioned or simply layered with partial opacity. This
is a legitimate alternative to the polygon-outline approach if we ever want a grainier,
less "vector-perfect" mark — but it produces *many* small path elements rather than one
clean path, which is worse for SVG output size and vision-snapshot legibility. **Recommend
polygon-outline (perfect-freehand-style) as primary, stamp-based only as a texture layer
if/when a grainier look is explicitly wanted.**

### 3e. Rough.js — deterministic, seeded, hand-drawn SVG (closest sibling project to ours)

[Rough.js](https://roughjs.com/) ([GitHub](https://github.com/rough-stuff/rough)) is the
existing, shipped, open-source library doing almost exactly what this project is doing:
deterministic hand-drawn-looking SVG shapes from geometry + a seeded PRNG (seed range
1..2³¹, "same seed ⇒ same shape" — [rough-stuff/rough wiki](https://github.com/rough-stuff/rough/wiki)).
Algorithm details, cross-checked against actual source
(`renderer.ts`, fetched directly from
[raw.githubusercontent.com/rough-stuff/rough](https://raw.githubusercontent.com/rough-stuff/rough/master/src/renderer.ts))
and the best public write-up, [shihn.ca — "How to emulate hand-drawn shapes / Algorithms
behind RoughJS"](https://shihn.ca/posts/2020/roughjs-algorithms/):

- **Bowing (the core "hand-drawn line" primitive):** a straight segment is drawn as a
  cubic Bezier where the two endpoints are jittered and two extra control points are
  placed near the 50%/75% marks, also jittered — this single move is what makes a line
  look hand-drawn instead of ruler-straight. Concrete offset formula from source:
  `offset(min, max) = roughness * roughnessGain * (random() * (max - min) + min)`, and the
  bowing displacement itself: `midDispX = bowing * maxRandomnessOffset * (y2 - y1) / 200`
  (and the Y-analog using `x2 - x1`) — i.e. **bow displacement is perpendicular to the
  segment and proportional to segment length**, which is exactly an arc-length-aware noise
  amplitude, not a flat jitter.
- **Length-based dampening:** `roughnessGain` is a step/linear function of segment length
  — full gain (`1`) under 200px, tapering linearly down to `0.4` by 500px, flat `0.4`
  beyond. This directly answers "should jitter amplitude depend on stroke length" — yes,
  and Rough.js's answer is *longer lines get proportionally less relative wobble*, which
  matches real hand-drawing (you can't keep a long line as wobbly-per-inch as a short one
  without it looking broken).
- **Double-stroke ("drawn twice"):** every line/shape edge is independently rerandomized
  and drawn a second time on top, at lower/full opacity depending on style — this is the
  single cheapest "reads as hand-drawn, not vector-perfect" trick, and it's just "run the
  seeded generator twice with two different seed offsets and render both paths."
- **Ellipses:** sample `n` points around the ellipse (n scales with size to avoid
  quadratic-look artifacts at large sizes), jitter each point by roughness, and
  deliberately don't close the loop cleanly (last point rejoins near the *second* point,
  not the first) — mimics the real overshoot/gap of a hand-drawn circle — then draw a
  second overlapping ellipse pass for extra "sketchiness."
- **Hachure/fill:** classic scanline polygon fill (Global Edge Table / Active Edge Table),
  shape rotated to the desired hachure angle, scanlines computed, then rotated back;
  cross-hatch = two hachure passes at 90°; not relevant to stroke rendering but relevant if
  we ever fill shape interiors by hand-drawn hatching instead of flat fill.
- **Seeding:** deterministic PRNG seeded once per generator instance; same seed always
  reproduces the identical shape — this is architecturally identical to what our project
  needs and is proof the approach works in production (Rough.js ships in diagramming tools
  like Excalidraw).

**Portability: the highest-value single finding in this whole doc.** Rough.js is not just
an analogous technique — it is a working, MIT-licensed, dependency-free reference
implementation of "deterministic seeded PRNG → hand-drawn SVG path geometry" with no
filters, no live input, and public source. The bowing formula and length-based dampening
step function are copy-adaptable directly (arc-length in our resampled point list stands
in for Rough.js's raw segment length). Recommend treating Rough.js's `renderer.ts` as a
primary reference implementation alongside `perfect-freehand`'s outline construction —
Rough.js gives the *wobble/bow* layer, perfect-freehand gives the *variable-width outline*
layer; the two compose (bow the centerline first, then run the outline sweep over the
bowed centerline).

### 3f. Ink darkening / "wetness" accumulation where strokes overlap

[InkField tutorial series — "Blend & Flow"](https://ileivoivm.github.io/inkField/tech/en/blend-flow.html)
documents three blend strategies for simulating ink darkening at stroke overlaps: **mix**
(linear alpha blend, mild saturation increase), **multiply** (`existing * new`, the
strongest/most "real ink" darkening — complementary colors go very dark), and **darken**
(per-channel min, preserves deepest tone). The generalization noted across sources
(Procreate/watercolor write-ups) is that digital "wet ink" look is fundamentally *repeated
multiply-blended passes*, not a special ink shader.

**Portability, with an explicit caveat:** `mix-blend-mode: multiply` / `darken` are CSS
*compositing* properties, not SVG `<filter>` primitives, so they are not covered by the
project's filter ban on paper — but flag this as **needs a vision-snapshot compatibility
check**, since headless/rasterizing snapshot pipelines (e.g. resvg, some browser screenshot
paths) have historically had inconsistent `mix-blend-mode` support outside a live
Chromium-based renderer, which could silently break "vision fidelity" the same way a
filter would. If double-stroke passes (Rough.js-style, §3e) are layered with plain
`opacity` (not `mix-blend-mode`), you get a *weaker* but filter-safe and universally
supported approximation of the same darkening-at-overlap effect — recommend defaulting to
plain overlapping-opacity rather than `mix-blend-mode` unless the snapshot pipeline is
verified to rasterize blend modes correctly.

---

## 4. W3C / browser pointer & "delayed ink" APIs — rendering insight only

[Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) (W3C Recommendation, 2026)
adds `getCoalescedEvents()` (recover high-frequency samples the browser batched into one
dispatched `pointermove`) and `getPredictedEvents()` (forward-predicted points for
speculative low-latency drawing). The [WICG `ink-enhancement`](https://github.com/WICG/ink-enhancement/blob/main/README.md)
proposal (delegated-ink-trail presentation) carries one piece of rendering insight worth
keeping even though it's fundamentally latency plumbing: **when an OS/browser renders the
"last few pixels" of a live stroke on your behalf, it deliberately restricts itself to a
minimal style contract — color, diameter, opacity only** — explicitly to avoid a visible
seam ("fork") between two different rendering styles meeting at a boundary.

**Portability:** Confirms a general principle rather than supplying an algorithm: **when
two rendering passes/techniques meet along the same stroke (e.g. a bowed/wobbled section
transitioning into a straight section, or a taper transitioning into full width), keep the
shared style contract (color, width, opacity) continuous across the seam** — mismatched
antialiasing, mismatched noise amplitude, or a hard width discontinuity at a segment
boundary is the visual tell of "two systems stitched together" rather than one hand-drawn
line. Otherwise this section is confirmed **not** to carry portable rendering algorithms —
correctly out of scope, as anticipated in the brief.

---

## Summary table — what to actually borrow

| Technique | Source | Use in our static/SVG/seeded-PRNG pipeline |
|---|---|---|
| Arc-length-uniform resampling before adding noise | ink-stroke-modeler | Prerequisite step: resample fixed anchor points to even spacing first |
| Quadratic midpoint smoothing | classic canvas technique | Base smoothing pass, zero-cost, deterministic |
| Bowing formula (perpendicular offset ∝ segment length, dampened at length) | Rough.js `renderer.ts` | Primary "looks hand-drawn" wobble layer on the centerline |
| Double-stroke (draw twice, independent seed offsets) | Rough.js | Cheapest "not vector-perfect" trick; two seeded passes layered |
| Streamline / taper / corner-detection outline sweep | perfect-freehand | Primary variable-width polygon-fill algorithm, fed synthetic "pressure" |
| Synthetic pressure from arc-length position + seeded noise | perfect-freehand pressure model | Replaces missing live pressure/velocity signal |
| Speed→width inverse mapping, proxied by source-point density | atrament / perfect-freehand / codepen | Local anchor-point density in agent's geometry ≈ "how carefully drawn" |
| Stamp-based texture brushes | shenciao tutorial | Optional secondary texture layer, not primary stroke method |
| Multiply/darken overlap darkening | InkField tutorial | Use plain layered opacity, not `mix-blend-mode`, until snapshot pipeline verified |
| Style-contract continuity across seams | WICG ink-enhancement | Design principle, not algorithm: keep width/opacity/noise-amplitude continuous across any pass boundary |
