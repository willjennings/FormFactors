# Ink rendering research: perfect-freehand, rough.js, excalidraw, and the sketchy-SVG ecosystem

Companion to `2026-07-17-ink-rendering-notes-paper53.md` (FiftyThree/Paper, ink-stroke-modeler,
signature_pad). That doc covers proprietary/patent-literature ink engines; this one covers the
open-source libraries that actually ship rough-hand-drawn SVG today, read from source.

**Our constraint, restated:** `src/ink/rough.ts` generates hand-drawn SVG paths for an AI agent's
diagram marks — arrows, rings, boxes, underlines — as **static, deterministic `d` strings**. One
`mulberry32` PRNG seeded per-mark via an FNV-1a hash of the mark's id (`seedFrom`, lines 16–20),
consumed once through pure generator functions (`onePassLine`, `roughRect`, `roughEllipse`,
`roughArc`, `roughArrowhead`). No `Math.random`, no `Date.now`, no live pointer stream — there is
no pressure or velocity to read, ever. Every mark currently strokes at a **uniform width**
(`strokeWidth="0.4"` etc., set by the caller, not by the generator). **SVG `<filter>` is banned
outright** — design spec §5.2 requires the agent's own vision snapshot to match the user's
rendered screen pixel-for-pixel, and filters risk cross-renderer divergence. `passes: 2` already
exists in `InkOpts` (`withPasses` re-draws using the *same* PRNG stream, so pass two differs
deterministically) but nothing currently sets `passes: 2` — it's plumbed but unused.

Every technique below is read from actual library source (not docs summaries) and tagged with a
portability verdict against exactly this constraint set: static generation, seeded determinism, no
filters, no live input.

---

## 1. perfect-freehand (`steveruizok/perfect-freehand`)

Repo: https://github.com/steveruizok/perfect-freehand
Source read in full: `packages/perfect-freehand/src/{getStroke,getStrokePoints,getStrokeOutlinePoints,getStrokeRadius,simulatePressure,constants}.ts`

### 1.1 Pipeline

```
getStroke(points, opts) = getStrokeOutlinePoints(getStrokePoints(points, opts), opts)
```

Two stages, each doing one job:

**Stage 1 — `getStrokePoints`**: turns raw input points into a resampled, streamlined spine.
- `streamline` (default 0.5) controls an interpolation factor `t = 0.15 + (1 - streamline) * 0.85`
  (`MIN_STREAMLINE_T=0.15`, `STREAMLINE_T_RANGE=0.85`). Each new spine point is `lerp(prevPoint,
  inputPoint, t)` — i.e. it's a **one-pole IIR low-pass filter walked along the input points**, not
  a windowed average. `streamline=1` barely moves toward new input (t≈0.15/sample, heavy lag);
  `streamline=0` snaps to the raw point every time.
- Skips points closer than `runningLength < size` at the very start (denoises pen-down jitter).
- 2-point inputs get 5 interpolated points injected so tapering has something to taper across; a
  single point gets a synthetic second point 1px away so the pipeline never degenerates.
- Each spine point carries `{point, pressure, vector (unit direction from prev), distance,
  runningLength}`.

**Stage 2 — `getStrokeOutlinePoints`**: walks the spine and emits a closed polygon (left offset
points + end cap + reversed right offset points + start cap).
- **Radius per point** (`getStrokeRadius.ts`, 8 lines total):
  ```
  radius = size * easing(0.5 - thinning * (0.5 - pressure))
  ```
  Pure function of `pressure ∈ [0,1]`. `thinning=0` → constant `size/2` regardless of pressure.
  `thinning=1, pressure=1` → radius 0 (fully tapered to a point); `pressure=0` → radius = `size`.
- **Simulated pressure from geometry** (`simulatePressure.ts`, when no real pressure exists —
  this is the part that matters for a static-path port):
  ```js
  sp = min(1, distance / size)       // "speed" — closer points = slower pen = fatter
  rp = min(1, 1 - sp)                // inverse
  pressure = min(1, prevPressure + (rp - prevPressure) * sp * 0.275)
  ```
  `RATE_OF_PRESSURE_CHANGE = 0.275` is a hardcoded critical-damping constant — pressure eases
  toward the target rather than snapping, so width changes smoothly along the stroke even though
  it's derived from raw inter-point distance. First 10 points get pre-averaged
  (`computeInitialPressure`) specifically to avoid "fat starts," since real pen strokes start slow.
- **Offset direction**: for a regular (non-corner) point, the offset direction is not just the
  perpendicular of the local tangent — it's the perpendicular of `lerp(nextVector, vector,
  dot(vector, nextVector))`, i.e. blended toward the *next* segment's direction weighted by how
  aligned the two segments already are. This is what keeps the outline from kinking at each input
  sample.
- **Sharp corners**: detected via `dot(vector, prevVector) < 0` (angle > 90°); at a sharp corner
  the code fans out `CORNER_CAP_SEGMENTS=13` points in a rounded arc rather than mitering, so
  corners look like a pen pivoting, not a polygon vertex.
- **Taper**: `start`/`end` each take `{cap, taper, easing}`. `taper: true` uses
  `max(size, totalLength)` as the taper distance; a numeric taper is an absolute px distance.
  Taper strength is `easing(runningLength / taperDistance)`, and the *smaller* of start/end
  taper strength multiplies the radius — default easings are `t => t*(2-t)` (ease-out, start) and
  `t => --t*t*t+1` (ease-out cubic, end), i.e. **different eases for start vs end tapers** because
  pen-down and pen-lift don't feel symmetric.
- **Caps**: dot (single point), rounded (semicircle rotation), or flat (small rectangle), chosen
  per stroke; a 1-point stroke becomes a `drawDot`.

Full defaults: `size=16, thinning=0.5, smoothing=0.5, streamline=0.5, simulatePressure=true`.

### 1.2 How tldraw uses it

Repo: `tldraw/tldraw`, file read: `packages/tldraw/src/lib/shapes/draw/getPath.ts` (167 lines,
read in full).

tldraw runs **four different named `StrokeOptions` presets** depending on input device and dash
style, all built on the same `getStroke` call — this is the clearest evidence of how much a
product actually needs to *tune* perfect-freehand per-context rather than use one global config:

```js
// mouse/touch, "draw" dash style — pressure simulated from speed
{ size: strokeWidth, thinning: 0.5,
  streamline: modulate(strokeWidth, [9,16], [0.64,0.74], true), // wider strokes stream MORE
  smoothing: 0.62, easing: EASINGS.easeOutSine, simulatePressure: true }

// real stylus, "draw" dash style — real pressure, custom pen easing
{ size: 1 + strokeWidth * 1.2, thinning: 0.62, streamline: 0.62, smoothing: 0.62,
  simulatePressure: false, easing: t => t*0.65 + sin(t*PI/2)*0.35 }   // blend of linear + easeOutSine

// "solid" dash style (constant width, either device)
{ size: strokeWidth, thinning: 0, streamline: modulate(...), smoothing: 0.62,
  simulatePressure: false, easing: EASINGS.linear }

// highlighter
{ size: 1 + strokeWidth, thinning: 0, streamline: 0.5, smoothing: 0.5,
  simulatePressure: false, easing: EASINGS.easeOutSine, last: showAsComplete }
```

Notable: `thinning: 0` is tldraw's way of getting a **uniform-width outline polygon** out of
perfect-freehand — i.e. even their "solid" style still routes through the full offset-outline
machinery (for the rounded caps and streamline smoothing) rather than a plain stroked path. Also
notable: their custom pen easing `t*0.65 + sin(t*PI/2)*0.35` is a deliberate blend, not a canned
easing — worth stealing as a literal constant if we ever add taper.

tldraw's **other** sketchy technique — the "cloud" geo-shape wobble
(`packages/tldraw/src/lib/shapes/geo/getGeoShapePath.ts`, `getCloudPath`, read in full) — is
**not** perfect-freehand at all. It's a from-scratch technique directly relevant to us:
- an `rng(seed)` deterministic generator (string seed → PRNG, same shape as our `seedFrom` +
  `mulberry32`) drives per-shape jitter;
- bump points are placed evenly around the shape's perimeter, then only the points near the
  *first and last* bump (`Math.floor(numBumps/2)` from each end) get wiggled, "so that the bumps
  'pop' in at the bottom-right and the top-left looks relatively stable" — an explicit, deliberate
  asymmetry to avoid a shape looking uniformly noisy;
- three points (two wiggled bump endpoints + one geometrically-derived arc point) get fit to a
  circle via `centerOfCircleFromThreePoints`, and the path is built from `circularArcTo` calls —
  i.e. **seeded jitter on control points, then exact circle-fit through them**, not raw noise on
  the final path.

### 1.3 Portability verdict

The **radius/pressure formulas are trivially portable as-is** — `getStrokeRadius` is 3 lines and
takes an arbitrary `pressure ∈ [0,1]`; nothing about it requires live input. `simulatePressure`'s
distance-based heuristic is *already* arc-length-shaped (it consumes `distance` between
consecutive spine points, which for a static path is just consecutive vertex spacing — replace
"distance between live samples" with "distance between our resampled path vertices" and it works
unmodified). This is the natural way to get **real variable-width strokes** out of our currently
uniform-width paths: resample a mark's path at fixed arc-length steps, feed the (fake, geometric)
"distance" sequence through `simulatePressure` to get a pressure curve, run it through
`getStrokeRadius`, then build left/right offset points and emit a **filled polygon** instead of a
stroked `Q` path. This is the single highest-payoff, highest-effort item in this whole survey —
effort is in the offset-outline geometry (proper miter/corner handling), not the pressure math,
which is already free.

The **corner-fan / sharp-corner handling** and **taper easing curves** are also directly portable
— pure functions of accumulated arc length and a dot product, no live state.

tldraw's cloud-shape technique (seed jitter on sparse control points + exact geometric fit,
deliberately asymmetric wiggle placement) is a good **complementary pattern for our
`roughEllipse`**: instead of jittering all 12 sample points independently (current behavior), only
jitter a subset and let curve interpolation carry the rest — cheaper and can look more organic
than uniform per-point noise.

---

## 2. Excalidraw

Repo: https://github.com/excalidraw/excalidraw
Source read: `packages/element/src/shape.ts` (1288 lines — full options/generation logic read),
`packages/element/src/renderElement.ts` (freedraw render path).

### 2.1 rough.js tuning — `generateRoughOptions` (shape.ts:194–259)

This is the part of Excalidraw most relevant to us: it's a thin, deliberately-tuned wrapper
around rough.js's raw options, and every override has a one-line rationale in the source:

```js
options = {
  seed: element.seed,
  disableMultiStroke: element.strokeStyle !== "solid",   // dashed/dotted double-stroke overlaps ugly
  strokeWidth: element.strokeStyle !== "solid" ? strokeWidth + 0.5 : strokeWidth,
  fillWeight: strokeWidth / 2,      // explicit, because rough.js derives this FROM strokeWidth
  hachureGap: strokeWidth * 4,      // if unset — and we just changed strokeWidth above
  roughness: adjustRoughness(element),
  preserveVertices: continuousPath || element.roughness < ROUGHNESS.cartoonist,
}
```

`adjustRoughness` (shape.ts:171–192) is the standout technique — **roughness scaled down for
small shapes** so tiny elements don't turn into an illegible scribble:

```js
function adjustRoughness(element) {
  const maxSize = Math.max(element.width, element.height);
  const minSize = Math.min(element.width, element.height);
  if ((minSize >= 20 && maxSize >= 50) ||                       // big enough, leave alone
      (minSize >= 15 && element.roundness && canChangeRoundness(element.type)) ||
      (isLinearElement(element) && maxSize >= 50)) {
    return element.roughness;
  }
  return Math.min(element.roughness / (maxSize < 10 ? 3 : 2), 2.5);  // small: divide by 2 or 3
}
```
This shipped as "adaptive roughness" (PR #6698) and drew pushback in
https://github.com/excalidraw/excalidraw/issues/7239 for making things look *less* hand-drawn —
the team's own users felt the dampening went too far on mid-size shapes. The lesson isn't "don't
dampen," it's **the dampening threshold and divisor are exactly the kind of thing that needs
visual tuning against your own shape sizes, not a value to copy verbatim.**

### 2.2 Freedraw — perfect-freehand with named, empirically-tuned constants (shape.ts:958–1252)

Excalidraw's own comment on these constants (shape.ts:1176–1180) is worth quoting verbatim
because it's exactly our situation: *"These factors are not derived analytically — they were
tuned empirically by visually comparing rendered strokes until they matched the desired feel.
Treat them as magic numbers backed by visual verification."*

```js
VARIABLE_WIDTH_FREEDRAW = { SIZE_FACTOR: 4.25, THINNING: 0.6, SMOOTHING: 0.5 }
CONSTANT_WIDTH_FREEDRAW = { SIZE_FACTOR: 1.4 }

getStroke(points, {
  simulatePressure: element.simulatePressure,
  size: strokeWidth * 4.25,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: element.strokeOptions?.streamline ?? DEFAULT_STROKE_STREAMLINE,
  easing: t => Math.sin((t * Math.PI) / 2),   // ease-out-sine, named explicitly in a comment
  last: true,
})
```

They also run a **second, entirely different code path** for "constant width" freedraw
(`CONSTANT_WIDTH_FREEDRAW`) using the `perfect-freehand`-adjacent `LaserPointer` class
(`@excalidraw/laser-pointer`) with `sizeMapping: details => Math.max(0.1, details.pressure)` and
pressure pinned to `1` per point — i.e. even their "uniform width" mode still goes through an
outline-polygon renderer, not a plain stroked line, presumably for the rounded-cap/streamline
behavior.

**`getSvgPathFromStroke` (shape.ts:1256–1272)** — this is the single most portable, highest-value
technique in the whole Excalidraw read, and it's short enough to quote in full:

```js
const med = (A, B) => [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];

const getSvgPathFromStroke = (points) => {
  const max = points.length - 1;
  return points.reduce((acc, point, i, arr) => {
    if (i === max) { acc.push(point, med(point, arr[0]), "L", arr[0], "Z"); }
    else           { acc.push(point, med(point, arr[i + 1])); }
    return acc;
  }, ["M", points[0], "Q"]).join(" ");
};
```

Given perfect-freehand's raw polygon-vertex output (or *any* dense point array), this builds a
smooth closed path using **quadratic Béziers through the midpoint of every consecutive point
pair** — each point becomes the control point of the *next* segment, each segment's endpoint is
the midpoint before it. This eliminates polygonal faceting from a coarse point list with zero
extra computation (no curve fitting, no matrix solve) and no new dependency. **We already do
exactly this trick** in `roughEllipse` (`rough.ts:80–89`, `Q ${pts[i]} ${mx},${my}`) — Excalidraw's
version confirms it's the right general-purpose pattern and shows it generalizing cleanly to
*any* point sequence, not just a resampled ellipse. Worth promoting out of `roughEllipse` into a
shared helper (`smoothPathThroughPoints(points, close)`) for any future multi-point mark
(freehand-style annotation squiggles, multi-segment underlines) instead of re-deriving it.

Excalidraw's freedraw background fill is also worth noting: when a freedraw stroke is a closed
loop, they Douglas-Peucker–simplify the input points (`simplify(points, 0.75)`) before feeding
them to `generator.curve(...)` for the fill pass, keeping the stroke path itself un-simplified —
i.e. **different point densities for fill vs. stroke on the same mark.**

### 2.3 Portability

Everything in §2.1–2.2 ports directly — none of it depends on live input; `adjustRoughness` is
pure geometry, the freedraw constants feed straight into perfect-freehand (already established as
portable in §1.3), and `getSvgPathFromStroke` is pure point-list-to-string. The main transferable
lesson: **decouple derived rough.js parameters (`fillWeight`, `hachureGap`) from whatever you're
also independently tuning (`strokeWidth`)** — rough.js silently derives them from `strokeWidth` if
unset, which bites you the moment you touch `strokeWidth` for an unrelated reason.

---

## 3. rough.js internals (`rough-stuff/rough`)

Repo: https://github.com/rough-stuff/rough
Source read in full: `src/renderer.ts` (533 lines — every draw primitive), `src/core.ts` (options
+ defaults), `src/fillers/{hachure-filler,zigzag-filler,scan-line-hachure}.ts`.

### 3.1 The core bowed double-line (`_line`, `renderer.ts:292–361`)

This is the actual algorithm behind rough.js's signature look, and it's more deliberate than "add
noise":

```js
function _line(x1, y1, x2, y2, o, move, overlay) {
  const length = Math.hypot(x1 - x2, y1 - y2);
  // roughnessGain: shapes get LESS wobbly, not more, as they get longer
  let roughnessGain = length < 200 ? 1
                     : length > 500 ? 0.4
                     : -0.0016668 * length + 1.233334;   // linear ramp 200→500

  let offset = o.maxRandomnessOffset || 0;                 // default 2px
  if (offset*offset*100 > length*length) offset = length/10; // clamp offset for tiny segments

  const divergePoint = 0.2 + random(o) * 0.2;   // where the bow "kinks", randomized per line
  // bow displacement, perpendicular-ish, scaled by segment length /200 and by `bowing`:
  let midDispX = o.bowing * o.maxRandomnessOffset * (y2 - y1) / 200;
  let midDispY = o.bowing * o.maxRandomnessOffset * (x1 - x2) / 200;
  midDispX = _offsetOpt(midDispX, o, roughnessGain);   // then ALSO randomized in [-x,x]*roughness
  midDispY = _offsetOpt(midDispY, o, roughnessGain);

  // single cubic bezier through two control points along the line at `divergePoint`/`2*divergePoint`,
  // each jittered independently, endpoints jittered independently too
  ops.push({ op: 'bcurveTo', data: [
    midDispX + x1 + (x2-x1)*divergePoint + randomOffset(),
    midDispY + y1 + (y2-y1)*divergePoint + randomOffset(),
    midDispX + x1 + 2*(x2-x1)*divergePoint + randomOffset(),
    midDispY + y1 + 2*(y2-y1)*divergePoint + randomOffset(),
    x2 + randomOffset(), y2 + randomOffset(),
  ]});
}
```

`_doubleLine` calls `_line` **twice** (unless `disableMultiStroke`) — once with `randomFull` jitter
(`overlay=false`) and once with `randomHalf` jitter (`overlay=true`, half-magnitude noise) — two
independent cubic curves over the same nominal segment, which is what produces the "sketched
twice, slightly off" pen-overlap look. Default `bowing=1`.

`curve()` (`renderer.ts:56–85`) does the analogous thing for multi-point curves: draws the whole
polyline once at `1 * (1 + roughness*0.2)` point-jitter magnitude, then (unless
`disableMultiStroke`) again at `1.5 * (1 + roughness*0.22)` with a **re-seeded** options clone
(`cloneOptionsAlterSeed`: `seed + 1`) — so the second pass is deterministic but decorrelated from
the first, not just a repeat.

### 3.2 Catmull-Rom → cubic Bézier fit (`_curve`, `renderer.ts:391–424`)

For >3 points, rough.js fits a **Catmull-Rom-style spline** and converts each segment to a cubic
Bézier analytically (no numeric solve):
```js
s = 1 - o.curveTightness;  // curveTightness default 0 → s=1, i.e. full Catmull-Rom pull
b1 = [pt[i][0] + (s*pt[i+1][0] - s*pt[i-1][0])/6, ...]
b2 = [pt[i+1][0] + (s*pt[i][0] - s*pt[i+2][0])/6, ...]
// bcurveTo(b1, b2, pt[i+1])
```
This is the standard closed-form Catmull-Rom-to-Bézier conversion (each control point derived
from the two neighboring spline points, divided by 6) — no fitting/optimization needed, O(n).
`curveStepCount` (default 9) controls how many synthetic points an ellipse/arc/circle gets sampled
into before being run through this same `_curve` fitter — i.e. **ellipses in rough.js are not
special-cased geometry, they're point clouds fed through the same generic curve fitter as
freehand-style multi-point paths.**

### 3.3 Fills — hachure/zigzag (only relevant if we ever fill a region)

`polygonHachureLines` (`scan-line-hachure.ts`) computes evenly-spaced parallel scan lines at
`hachureAngle` (default -41°) and `hachureGap` (default `strokeWidth*4` if unset), delegating the
actual scan-line/polygon-intersection math to a separate `hachure-fill` package. `ZigZagFiller`
reuses the same scan lines but offsets alternating line endpoints by
`±(gap/2)*cos/sin(angle)` to zigzag instead of running straight — cheap reuse of one geometry pass
for two visual styles. Each hachure line itself is drawn through `_doubleLine`, so fills get the
same double-stroke sketchiness as strokes.

`fillWeight` defaults to `-1` (meaning: derive from `strokeWidth`) — this is the value Excalidraw
explicitly overrides (§2.1) to avoid surprise coupling.

### 3.4 Portability

**Everything here is pure math over static geometry already** — rough.js has zero concept of live
input to begin with, so there's no "simulate the missing pressure" step; it's a direct source of
copy-portable formulas. Highest-value items for us specifically:

- **`roughnessGain` scaled by segment length** (full wobble under 200px, ramping down to 0.4× by
  500px) is a one-line addition to `onePassLine` and directly answers a problem `adjustRoughness`
  (§2.1) solves more heavy-handedly — long strokes staying proportionally calm is cheaper to encode
  as a per-segment length ramp than as a whole-shape bounding-box check.
- **The two-pass double-stroke with independently-reseeded second pass** (`curve()`'s
  `cloneOptionsAlterSeed`) is *already structurally present* in our `withPasses`/`passes: 2` — the
  only gap is nobody has turned it on. rough.js's exact half-magnitude-jitter-on-pass-2 pattern
  (`_doubleLine`'s `randomHalf` vs `randomFull`) is a good concrete tuning target once it is.
- **Catmull-Rom-to-Bézier** is the natural upgrade path if we ever need a *single smooth curve*
  through >2 points instead of our current per-segment independent `Q` chains (which is exactly
  what `roughRect`/`roughEllipse` currently do — 4 and 13 independent `Q` segments respectively);
  it would remove the visible per-segment "kink" at each joint for any future free-form multi-point
  mark.

---

## 4. Other notable prior art

### 4.1 matplotlib's `xkcd()` — `Sketch` class (C++, Agg backend)

Source read in full: `src/path_converters.h:1044–1165`
(https://github.com/matplotlib/matplotlib/blob/main/src/path_converters.h)

This is the most different technique from the rough.js/perfect-freehand family, and it's the
closest match to "wobble along a static path with no input points to jitter individually" — worth
studying precisely because our paths are static:

1. `conv_segmentator` first **resamples the path at a fixed maximum segment length** (arc-length
   subdivision) — you don't jitter the original sparse vertices, you jitter a dense, evenly-spaced
   resampling of the curve.
2. At each resampled vertex, displace **perpendicular to the local tangent** by
   `sin(p * p_scale) * scale`, where `scale` = wobble amplitude in px.
3. The critical trick is how `p` (the sine's phase) advances — **not** at a constant rate per
   vertex (which would just be a fixed-frequency sine wave, visibly mechanical), but by a
   **randomized step every vertex**: `p += exp(rand() * 2*log(randomness))`, i.e. each step's
   phase increment is `randomness^(2*rand()-1)` — a log-uniform random multiplier around 1. High
   `randomness` (default period `length`) → phase speed varies a lot vertex-to-vertex → the "wave"
   speeds up and slows down unpredictably along the stroke, which reads as hand-tremor rather than
   a printed sine wave.
4. Seeded and fully deterministic (`m_rand.seed(0)` in `rewind()`) — same philosophy as our
   per-mark seed, just seeded once per path draw rather than derived from an id.

### 4.2 `rough-stuff/wired-elements` and `fskpf/svg2roughjs`

- `wired-elements` (https://github.com/rough-stuff/wired-elements): Lit web components
  (`<wired-button>`, `<wired-input>`, …) that draw their chrome via rough.js on every render. No
  new algorithm — it's packaging rough.js as reusable custom elements, useful only as a reference
  for "how do you re-sketch on resize/theme-change without redrawing everything," not for the
  wobble math itself.
- `svg2roughjs` (https://github.com/fskpf/svg2roughjs): converts arbitrary existing SVG (paths,
  shapes, even embedded raster) into a rough.js-rendered version. Exposes `seed` (deterministic
  reproducibility, same idea as us), `randomize` (vary fill-weight/hachure params per element for
  visual variety), `roughConfig` (pass-through rough.js options), and a `pencilFilter` toggle for
  an *additional* graphite-texture SVG filter pass. Confirms rough.js's own seed mechanism is
  commonly treated as the reproducibility knob in this ecosystem — validates our id→seed approach
  rather than teaching anything new. The `pencilFilter` option is filter-based — same category as
  §4.3, don't use it.
- `sun0day/svg-sketchy` (https://github.com/sun0day/svg-sketchy): CLI wrapper, same rough.js
  substrate, targeted at Graphviz/Mermaid diagram output specifically — evidence this
  diagram-marks-as-sketchy-SVG use case is a recognized pattern elsewhere, not just our project's
  idiosyncrasy.

### 4.3 SVG filter wobble (`feTurbulence` + `feDisplacementMap`) — BANNED, flagged not recommended

Standard technique (e.g. https://camillovisini.com/coding/simulating-hand-drawn-motion-with-svg-filters,
MDN `feTurbulence`/`feDisplacementMap`): `feTurbulence` generates Perlin-noise texture, and
`feDisplacementMap` uses that noise as a per-pixel offset map to distort an existing path/shape,
optionally animated by keyframing `baseFrequency`. This is the cheapest possible way (near-zero
authoring code, all declarative) to get organic wobble, including *animated* wobble — but it is
**explicitly incompatible with our pipeline**: design spec §5.2 bans SVG filters specifically so
the agent's rendered-vision snapshot can't diverge from what the user's browser actually paints
(filter rendering has known cross-browser/cross-renderer inconsistencies, and headless snapshot
tools frequently don't apply filter effects identically to a live browser). Documented here only
so it isn't independently "discovered" and proposed later without the context for why it's off
the table.

---

## 5. Portability summary against `src/ink/rough.ts`

| Technique | Source | Est. effort | Payoff | Verdict |
|---|---|---|---|---|
| Turn on `passes: 2` with rough.js-style half-magnitude second pass | rough.js `_doubleLine` (§3.1) | trivial — plumbing exists | high (the signature "sketched twice" look) | do first |
| Length-scaled `roughnessGain` ramp in `onePassLine` | rough.js `_line` (§3.1) | ~3 lines | medium-high (long strokes stop over-wobbling) | cheap win |
| Promote `roughEllipse`'s midpoint-`Q` trick to a shared `smoothPathThroughPoints` helper | Excalidraw `getSvgPathFromStroke` (§2.2) | ~10 lines, refactor only | medium (reuse, future multi-point marks) | cheap win |
| Shape-size-scaled roughness dampening (bounding-box based, not just per-segment length) | Excalidraw `adjustRoughness` (§2.1) | ~15 lines | medium (small marks stop looking chaotic) — tune the divisor by eye, don't copy Excalidraw's exactly (§2.1 caveat) | worth it, needs visual tuning |
| Arc-length-resampled sine-phase wobble as an alternate/blended jitter model for long strokes | matplotlib `Sketch` (§4.1) | ~30–40 lines (needs resampling step) | medium-high (smoother, less "buzzy" wobble on long marks) | good next experiment |
| Catmull-Rom-to-Bézier multi-point curve fit | rough.js `_curve` (§3.2) | ~20 lines | medium (only matters once marks have >2-point free-form paths) | later, situational |
| Full perfect-freehand-style variable-width outline polygon | perfect-freehand (§1) | largest — new fill-polygon geometry, corner handling | highest (real taper/pressure feel) | biggest lever, biggest lift — good candidate for a dedicated follow-up spec |
| Hachure/zigzag region fills | rough.js fillers (§3.3) | small if ever needed | situational | only if/when marks need filled regions |
| `feTurbulence`/`feDisplacementMap` | (§4.3) | n/a | n/a | **banned — do not use** |

---

## Sources index

- `steveruizok/perfect-freehand`: https://github.com/steveruizok/perfect-freehand
  - `getStroke.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStroke.ts
  - `getStrokePoints.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokePoints.ts
  - `getStrokeOutlinePoints.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeOutlinePoints.ts
  - `getStrokeRadius.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeRadius.ts
  - `simulatePressure.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/simulatePressure.ts
  - `constants.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/constants.ts
- `tldraw/tldraw`:
  - draw-shape tuning: https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/shapes/draw/getPath.ts
  - cloud geo-shape seeded wiggle: https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/shapes/geo/getGeoShapePath.ts
- `excalidraw/excalidraw`:
  - rough.js options + freedraw + `getSvgPathFromStroke`: https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts
  - freedraw render path: https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/renderElement.ts
  - adaptive-roughness pushback discussion: https://github.com/excalidraw/excalidraw/issues/7239
- `rough-stuff/rough`:
  - core primitives: https://github.com/rough-stuff/rough/blob/master/src/renderer.ts
  - options/types: https://github.com/rough-stuff/rough/blob/master/src/core.ts
  - hachure/zigzag fillers: https://github.com/rough-stuff/rough/tree/master/src/fillers
  - wiki: https://github.com/rough-stuff/rough/wiki
- `matplotlib/matplotlib`, `Sketch` class: https://github.com/matplotlib/matplotlib/blob/main/src/path_converters.h
- `rough-stuff/wired-elements`: https://github.com/rough-stuff/wired-elements
- `fskpf/svg2roughjs`: https://github.com/fskpf/svg2roughjs
- `sun0day/svg-sketchy`: https://github.com/sun0day/svg-sketchy
- SVG filter wobble (flagged, not recommended): https://camillovisini.com/coding/simulating-hand-drawn-motion-with-svg-filters , MDN `feTurbulence` (https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence), MDN `feDisplacementMap` (https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)
- Our own implementation (grounding, not external): `/Users/will0/Code/FormFactors/src/ink/rough.ts`
