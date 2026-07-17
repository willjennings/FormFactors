# Ink rendering research: Paper by FiftyThree (Expressive Ink) and comparable engines

Context for this note: we render an AI agent's diagram marks as **static, deterministic SVG
paths** — generated whole from geometry plus a seeded PRNG. There is no live pointer stream,
no pressure, no velocity. Any "ink dynamics" (variable width, pooling, wobble, bowing) has to be
**simulated after the fact** from things a static path *does* have: arc-length position along the
stroke, local curvature, endpoint distance, and seeded randomness. Every technique below is
tagged with a portability verdict against that constraint.

Research date: 2026-07-16/17. Web search + fetch only, no code execution.

---

## 1. FiftyThree / Paper — what's actually documented

**Bottom line up front:** FiftyThree never published a real engineering blog post or talk that
walks through the Expressive Ink Engine's math. I could not find a "how our ink works" article on
their Medium blog (`medium.com/fiftythree-space-to-create`), no conference talk transcript with
formulas, and no public engineering postmortem — FiftyThree was acquired by WeTransfer in 2018
and Paper/Paste were later sunset, and whatever internal writeups existed were not made public
before that. **This is a genuine "couldn't find" — the concrete algorithm is not publicly
written up in prose anywhere I could locate.** The best surviving primary source is FiftyThree's
own **patent portfolio**, which does contain real algorithmic language (it has to, for patent
claims to be valid). Treat the patent text below as the most credible technical source, with
marketing copy and reviews filling in *what it looks like* but not *how it's computed*.

One LinkedIn profile snippet (Georg Petschnigg's page, surfaced via web search, not fetched
directly) lists **"Algorithms for FiftyThree's Expressive Ink Engine"** as a named body of work,
confirming a formal algorithm existed internally, but no artifact of it is public.
Source: https://www.linkedin.com/in/georgp/ (search snippet only, page not independently verified).

### 1.1 The two patents (primary source)

- **US9,529,486 B2** and its continuation **US11,200,712 B2**, "Methods and apparatus for
  providing a digital illustration system," assignee FiftyThree, Inc.
  - US9529486: https://patents.google.com/patent/US9529486
  - US11200712: https://patents.google.com/patent/US11200712

These describe the illustration/ink pipeline in a data-preparation → interpolation → illustration
module architecture and are the closest thing to ground truth for how Paper's ink actually worked.

**Technique: speed-inverse "writing" line weight → ink pooling**
- *Visual*: for the writing/fountain-pen-like tool, a stroke that decelerates or stops (e.g. at a
  corner, or at pen-up) gets **fatter**, mimicking ink pooling where the nib lingers.
- *Algorithm sketch (from claim language)*: "A weight of the lines can be changed to the inverse
  of the writing speed" — i.e. `width ∝ 1 / speed` (with presumed clamping, since speed → 0 would
  blow up). The patent explicitly ties this to "a visual effect of ink pooling in corners and
  turns (e.g., 701 and 703), giving writing a natural and expressive quality" (FIG. 7 discussion).
- *Portable to static SVG?* **Yes — this is the single most directly reusable idea.** We have no
  real velocity, but for a *generated* path we know arc-length parameterization and can treat
  low-instantaneous-turn-rate / high-curvature / vertex regions (corners, direction reversals,
  endpoints) as "the pen would have slowed down here" by construction. Concretely: bump stroke
  width as a function of `1 / max(local_speed_proxy, ε)` where `local_speed_proxy` is derived from
  the seeded control-point spacing/timing you already assign when generating the path (see §4).
  Endpoints (start/end of stroke, where a real pen decelerates to zero) are the trivial, safe case
  to pool — width ramps up over the last ~5-10% of arc length before the terminal point.

**Technique: speed-proportional width for "drawing" tool (opposite regime)**
- *Visual*: for the sketching/drawing tool, thickness scales *up* with *speed* instead — "the
  thickness of a curve can vary... by scaling a width of a curve proportionally to a speed of
  drawing" (FIGS. 5A–5C discussion). This is corroborated outside the patent: a search snippet
  attributed to coverage of FiftyThree's Pencil stylus notes "The Pen creates thicker lines the
  faster you move" for at least one tool — which is the *opposite* of realistic ink physics, and
  FiftyThree explicitly called this out as an intentional, non-physical choice for that tool.
  (Snippet only; not independently re-verified against a fetched primary source — flagging as
  lower-confidence.)
- *Takeaway*: FiftyThree ran **two different speed→width regimes per tool**, not one universal
  ink physics model. This matters for us: "hand-drawn" isn't one curve, it's a *choice* of
  mapping depending on what the mark is supposed to feel like (deliberate pen-lift annotation vs.
  fast gestural sketch line).
- *Portable?* Yes, same mechanism as above, inverted. Also opacity: the patent notes for the
  sketching tool "opacity varies inversely — faster strokes become more transparent," i.e. a
  second channel (alpha) riding the same speed proxy, not just width. Trivial to add to an SVG
  stroke via `stroke-opacity` interpolated along the path.

**Technique: multiplicative color blending ("Mix" / self-darkening watercolor)**
- *Visual*: overlapping strokes of the same color get **darker/richer** where they cross, like
  wet watercolor or marker overlap, rather than just alpha-compositing to a flat wash.
- *Algorithm sketch*: "the illustration module blends colors using a multiplicative relationship.
  Thus, a color drawn over the same color can self darken." I.e. at any pixel covered by N
  overlapping semi-transparent strokes, compose via `result = base × stroke₁ × stroke₂ × ...`
  (component-wise multiply, like CSS `mix-blend-mode: multiply`) rather than standard
  source-over alpha blending. Different hues "mix naturally" under the same rule (this is exactly
  how subtractive pigment mixing is faked digitally — multiply blend mode approximates it much
  better than normal alpha-over for overlapping translucent color).
- *Portable?* **Yes, trivially** — SVG supports `mix-blend-mode: multiply` natively on
  overlapping path elements, no simulation needed at all. This is a rendering-mode choice, not a
  geometry problem. Directly applicable if diagram strokes ever overlap (e.g. re-traced/emphasis
  strokes, cross-hatching, highlight passes).

**Technique: multi-layered stroke (independent edge vs. fill control)**
- *Visual*: a single visible stroke is actually two coupled strokes — one controlling the ink
  *fill* (pigment/color body) and one controlling the *edge* (outline/border), enabling e.g. a
  hard black outline with a softer/lighter fill, drawn as one gesture.
- *Algorithm sketch*: "a value of the pigment of ink is controlled by one stroke and a value of
  the edge of the color is controlled by another stroke," composited with darken blend mode so
  the outline always wins over the fill color (FIG. 8 / FIG. 6 discussion).
- *Portable?* Yes conceptually — this maps directly onto a common SVG trick: render the same
  path twice, once as a wider `stroke` in a muted/base tone and once as a narrower `stroke` in a
  darker outline tone (or vice versa: fill polygon + separate outline path). Good technique for
  giving marks a two-tone "ink body + edge" look without needing a gradient.

**Technique: OpenGL-based rendering for speed ("Expressive Ink Engine built on OpenGL")**
- Multiple secondary sources (Macworld reviews, app-update coverage) mention the Expressive Ink
  Engine moved to OpenGL for real-time performance and got progressively faster across updates
  ("three times faster ink" in a later release), but **no technical detail beyond the marketing
  claim survives** — I could not find what specifically was GPU-accelerated (tessellation? blend
  passes? texture-based brush stamps?). Treat this as a dead end for algorithm content; it's a
  performance/architecture note, not something relevant to static SVG generation anyway (we don't
  have a real-time constraint).
  Source: https://www.macworld.com/article/223613/ (brush sizes / iOS 8 coverage, general
  mention only).

**Technique: watercolor "Mix" brush texture/diffusion**
- I could not find any technical description of how the watercolor *texture* (paper-grain
  diffusion, edge feathering, wet-into-wet spread) was actually rendered — patents cover the
  color-blend-mode math above but not a diffusion/texture algorithm. This is very likely the part
  that used custom brush textures/shaders and simply isn't documented publicly. **Honest gap.**
  Note: classic offline "black ink painting" diffusion-rendering academic work exists (e.g. Way &
  Shih, IEEE, *"Diffusion rendering of black ink paintings using new paper and ink models,"*
  ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S0097849300001321) as the
  general class of technique FiftyThree's watercolor brush likely descends from conceptually, but
  I found no evidence connecting it directly to FiftyThree's implementation — flagging as
  background context only, not a confirmed source.

---

## 2. Square "Smoother Signatures" — best-documented variable-width algorithm

This is *not* FiftyThree, but it's the most concretely documented "draw a natural-looking
variable-width stroke from a point sequence" algorithm on the public web, and it directly spawned
the most widely reused open-source implementation (`signature_pad`, 8k+ GitHub stars, used
everywhere). Original post: https://developer.squareup.com/blog/smoother-signatures/ (mirror:
https://medium.com/square-corner-blog/smoother-signatures-be64515adb33).

**Pipeline: raw points → cubic Bezier spline fit → velocity-derived width → manual variable-width
polygon fill (bitmap-cached).**

1. **Spline interpolation.** Raw touch points are far too sparse/jagged to draw directly (straight
   segments look faceted). Square fits a **cubic Bezier** through each window of sampled points,
   solving for control points so the curve passes through the touch coordinates (standard
   spline-through-points control-point solve, not detailed further in the post).
2. **Velocity computation with a lowpass filter.**
   ```
   velocity_raw = distance(point, prevPoint) / (point.time - prevPoint.time)
   velocity = VELOCITY_FILTER_WEIGHT * velocity_raw
            + (1 - VELOCITY_FILTER_WEIGHT) * lastVelocity
   ```
   (exponential moving average over instantaneous speed — smooths jitter from touch-sample
   noise before it hits the width mapping).
3. **Velocity → width.** "Higher velocities correspond to thinner strokes" — inverse relationship,
   same direction as FiftyThree's "writing" tool. Exact mapping function/constants aren't
   disclosed in the post (this is the recurring gap across every source in this doc — everyone
   describes the *shape* of the velocity→width relationship, nobody publishes the tuned curve).
4. **Manual variable-width fill.** Native canvas APIs (this was Android) don't support
   variable-width strokes along a Bezier, so they walk the curve parametrically (`t` from 0→1),
   computing an interpolated width at each `t` and drawing filled segments/polygons rather than a
   single stroked path.
5. **Bitmap caching.** Each completed Bezier segment is rasterized to an offscreen bitmap once and
   blitted afterward, rather than re-vectoring the whole signature every frame — a live-drawing
   performance concern, **not applicable** to a static-SVG-generation pipeline (we only render
   once).

**Portable to static SVG?** The velocity→width *shape* (EMA-smoothed speed, inverse mapping,
clamped to a min/max width) is directly reusable as a **simulated** speed proxy: for a
procedurally generated stroke, define speed as inversely proportional to the density of control
points you chose to place per unit arc length (denser points = "the simulated pen slowed down
here" = wider), or more simply, drive it from a seeded low-frequency noise function evaluated
along arc-length so the "velocity" itself looks organic rather than constant. The manual
parametric-width-fill approach (step 4) is *exactly* what's needed for SVG too, since plain
`stroke-width` on a `<path>` is constant — variable width in SVG requires either (a) building an
explicit filled outline polygon (two offset curves, near/far side, joined — see §3, this is what
`perfect-freehand` automates), or (b) chaining many short fixed-width segments each with their own
`stroke-width`, which is Square's own workaround.

**Reference implementation to actually read code from, not just prose:**
`szimek/signature_pad` — https://github.com/szimek/signature_pad — TypeScript, MIT-licensed,
implements exactly this pipeline (Catmull-Rom-esque interpolation + Square's EMA velocity + a
variable-width Bezier renderer) and is small enough to read end-to-end in an afternoon if a
concrete reference implementation is wanted beyond this doc's prose descriptions. I did not fetch
its full source in this pass (time-boxed), but flag it as the single best "read the code" next
step if implementing custom width logic rather than using `perfect-freehand`.

---

## 3. `perfect-freehand` (Steve Ruiz / tldraw) — most directly portable technique

https://github.com/steveruizok/perfect-freehand — MIT, actively maintained, used in production by
tldraw, Excalidraw, Canva, draw.io. **This is the strongest candidate for direct reuse or
close reimplementation**, because it already solves the exact problem we have: turn a plain
`[x, y]` (or `[x, y, pressure]`) point array into a filled SVG polygon that *looks* like a
pressure-sensitive ink stroke — including a mode that **fabricates pressure from geometry alone**
when no real pressure data exists, which is precisely our situation.

**Pipeline: raw points → streamlined "stroke points" (with derived/simulated pressure) → per-point
radius → offset-outline polygon (two sides + caps) → single closed SVG path.**

1. **`getStrokePoints`** — converts raw input into enriched points:
   - *Streamline (smoothing) via linear interpolation toward each new point*:
     `t = MIN_STREAMLINE_T + (1 - streamline) * STREAMLINE_T_RANGE`, then
     `point = lerp(prevSmoothedPoint, rawPoint, t)`. Low `streamline` (~0) barely smooths; high
     `streamline` (~1) heavily damps noise — this is literally an EMA on position, same family as
     Square's EMA on velocity.
   - Tracks **running arc-length** (`runningLength += dist(point, prev.point)`) and a per-point
     **direction vector**, both of which are exactly the "arc-length + local direction" primitives
     our static-path generator already has for free (we generated the curve, we know its
     parameterization).
   - A minimum-length guard skips points until `runningLength >= size`, avoiding a fat starting
     blob from finger/pen-down noise — not relevant to us (no noisy input) but the *pattern* of
     "don't trust the first few samples" maps to "add deliberate falloff at true path start."
   - Real pressure, if present, is taken directly (`pts[i][2]`), else defaults to 0.5.
2. **`getStrokeRadius(size, thinning, pressure, easing)`** — the actual width formula, and it's
   fully disclosed (unlike Square's):
   ```
   radius = size * easing(0.5 - thinning * (0.5 - pressure))
   ```
   With `pressure = 0.5` (default/neutral), this reduces to `radius = size * easing(0.5)` i.e. no
   thinning effect. `pressure → 1` (heavy) pushes the inner term toward `0.5 + 0.5*thinning`,
   *increasing* radius; `pressure → 0` (light) decreases it. `thinning` is a signed knob: negative
   `thinning` inverts the relationship (stroke gets thinner *with* pressure instead of thicker) —
   directly matches the FiftyThree "two regimes per tool" finding in §1, as a single tunable
   parameter rather than two hardcoded behaviors.
3. **Pressure simulation from geometry (`simulatePressure: true`)** — this is the load-bearing
   feature for us. When no real pressure exists, the library derives a synthetic pressure value
   from the *distance between consecutive input points* (a velocity proxy: closer points along a
   fixed-timestep-ish input ⇒ slower ⇒ implied higher "pressure"/width, same inverse-speed logic
   as FiftyThree/Square) combined with an easing curve. Exact interpolation formula wasn't fully
   surfaced by the fetch (README describes behavior, not every line of the simulation math), but
   the *mechanism* — treat inter-point spacing as a stand-in for speed, feed it through
   `getStrokeRadius`'s pressure slot — is exactly the technique to replicate for a purely
   geometric (no real timing) generator: substitute **local curvature and/or point density**
   for "distance between points" as our speed proxy, since our paths are built from geometry, not
   timed sampling.
4. **`getStrokeOutlinePoints`** — builds the actual polygon:
   - Perpendicular offset vector at each point: `offset = perpendicular(direction) * radius`;
     left side = `point - offset`, right side = `point + offset`.
   - Filters near-duplicate points (`dist² > minDistance`) to keep the polygon clean.
   - **Sharp-corner handling**: when the direction changes sign sharply (`prevDpr < 0`), it
     inserts a small rounded fan of points rotating around the corner (`rotAround(..., FIXED_PI *
     t)` for `t` in [0,1]) instead of leaving a self-intersecting notch — this is the concrete
     answer to "how do you keep a variable-width offset-outline from folding on itself at
     corners," a real problem any offset-outline approach hits.
   - **Caps**: rounded (rotate a fan of points around the endpoint), flat (four points at ±0.5×
     and ±0.51× the perpendicular), or a single dot for zero-length strokes — plus **taper**,
     which shrinks the radius toward 0 over a configurable distance/point-count at either end
     (`start.taper` / `end.taper`, optionally `true` = whole stroke length), giving the classic
     "pen lifting off the page" thin-to-thick or thick-to-thin ramp.
   - Final polygon: `leftPoints.concat(endCap, rightPoints.reverse(), startCap)` — one closed
     path, correct winding, fillable directly as a single SVG `<path d="...Z">`.

**Portability verdict: highest of everything surveyed.** Every input this algorithm wants
(sequential points, optional pressure, distance between points as a speed proxy) is either
directly available or trivially derivable from a static, seeded, procedurally generated path.
Recommended approach: **don't reinvent this** — either vendor/port the actual algorithm (it's
small, dependency-free, pure math, ports cleanly to any language) or reimplement the same three
functions (`getStrokePoints` → `getStrokeRadius` → `getStrokeOutlinePoints`) driving pressure from
our own geometric proxy (curvature + a seeded low-frequency noise channel instead of real
distance/time) rather than real input distance. The taper/cap/corner-fan logic in particular is
worth copying near-verbatim since it's solving a pure-geometry problem (self-intersection
avoidance at corners) that has nothing to do with live input at all.

Secondary write-ups on the same library, for triangulating the above (not independently deep-read
in this pass): https://ulfschneider.io/2023-05-14-perfect-freehand/ and
https://www.bram.us/2021/09/16/perfect-freehand/.

---

## 4. RoughJS — the "seeded randomness on static geometry" half of the problem

https://github.com/rough-stuff/rough — directly relevant because, unlike everything above, RoughJS
starts from the assumption we share: **a fully-known, static shape** (not a live pointer stream),
and its whole job is making that static shape look hand-drawn via seeded perturbation. Best
technical write-up found: https://shihn.ca/posts/2020/roughjs-algorithms/ (independent analysis
of the library's algorithms, not official docs — read this over the official docs if going
deeper, it has more actual mechanism).

**Technique: line "bowing"**
- *Visual*: straight lines are never perfectly straight — they bow slightly, like a hand-drawn
  ruler line.
- *Algorithm sketch*: randomize the two true endpoints slightly (by an amount scaled to
  `roughness`), then pick two more random points at roughly the 50% and 75% marks along the line
  (also offset by an amount that's "a function of the line's length and the randomness value," with
  a length-based dampening/step-function so very long lines don't bow absurdly), then fit a curve
  through all four points. Exact formula/constants weren't recoverable from the fetched summary
  (the source blog references them but the fetch tool's summarization didn't preserve the literal
  numbers) — **if exact constants matter, read `rough/src/geometry.ts` / `line.ts` in the actual
  repo directly** rather than relying on this note.
- *Portable?* **Directly and trivially portable — this is the paradigm to imitate**, since it
  already assumes static known geometry plus a seed. Applies to any straight segment in a diagram
  mark (box edges, connector lines, arrow shafts): don't draw a literal `M x1,y1 L x2,y2`; draw a
  cubic/quadratic through 4 seeded-jittered points along that line instead.

**Technique: double-stroke "sketchy" effect**
- *Visual*: shapes look hand-inked partly because the pen retraced the same line twice, slightly
  offset, the way a person re-inks a sketch line.
- *Algorithm*: literally just render the same (independently re-jittered) path twice with the same
  seed-derived-but-distinct perturbation. No deeper math than that.
- *Portable?* Trivial and cheap. Directly applicable — draw every mark stroke as two overlapping
  passes with independent-but-correlated seeded jitter, optionally at slightly different opacity
  (echoes FiftyThree's multiply-blend self-darkening from §1 as a side effect, for free, if using
  `mix-blend-mode: multiply` on the two passes).

**Technique: closed-shape (ellipse/polygon) construction from perturbed sample points**
- *Algorithm*: sample N points around the ideal shape, jitter each by `roughness`, fit a curve
  through them, and deliberately **don't close the loop cleanly** — join the second-to-last point
  back to the second/third point rather than literally closing start→end, so the "pen" appears to
  overshoot/undershoot on closing a loop the way a human does. Optionally draw the whole shape a
  second time (a second independent perturbation) for extra sketchiness, same idea as the
  double-stroke line technique.
- *Portable?* Yes, same paradigm as bowing — fully static-geometry-compatible, seed-driven,
  no timing data needed anywhere.

**Technique: hachure/fill via scanline**
- Detailed scanline-fill pseudocode exists in the source blog post for generating the sketchy
  parallel-line fill pattern inside closed shapes (edge table, scanline stepping, gap/angle
  params). Not read in full depth here since it's a fill-pattern concern rather than a
  stroke-rendering concern, but flagged as directly relevant if diagram marks ever need a
  hand-hatched fill rather than a flat fill. Read the source post directly for the pseudocode:
  https://shihn.ca/posts/2020/roughjs-algorithms/.

---

## 5. Microsoft Windows Ink — smoothing formulas that ARE fully disclosed

Two Microsoft sources, both unusually concrete for once:

**5a. Project Austin ink smoothing (cardinal splines)** —
https://devblogs.microsoft.com/cppblog/project-austin-part-3-of-6-ink-smoothing/

- *Algorithm*: real-time smoothing over a sliding window of 4 raw input points
  `(P0, P1, P2, P3)`, generating the curve segment between the *middle* two points (`P1`→`P2`) via
  a cardinal spline (Catmull-Rom family) with tension parameter `L ≈ 0.5`:
  ```
  smoothed(t) = (2t³ − 3t² + 1)·P1 + (−2t³ + 3t²)·P2
              + (t³ − 2t² + t)·L·(P2 − P0)
              + (t³ − t²)·L·(P3 − P1)
  ```
  applied identically to x and y. Endpoints (fewer than 4 points available) are handled by
  "faking up" extra points so the same math always applies.
- *Portable?* This is a **generic curve-through-points formula**, not an ink-specific dynamic — 
  it's directly usable as the base centerline-smoothing step for any point-sequence-to-curve
  conversion in a static generator (e.g., smoothing a jittered/noisy control-point sequence before
  offsetting it into a variable-width outline). Not novel (standard Catmull-Rom) but the tension
  constant and windowing approach are concretely specified, which most sources in this doc are
  not.

**5b. `google/ink-stroke-modeler`** — https://github.com/google/ink-stroke-modeler — not
Microsoft, but adjacent and far better documented than most: a **mass-spring-damper physical
model** for smoothing live stylus input:
```
d²s/dt² = (k_s / m_pen)(Φ(t) − s(t)) − k_d(ds/dt)
```
(`s` = modeled pen position, `Φ` = raw input position acting as a moving anchor). Also documents a
separate wobble-smoothing moving-average pass, resampling to a minimum output rate, and two
predictors (spring-mass extrapolation and dual Kalman filters). **Not portable to us as-is** —
this whole model exists to solve *real-time prediction/latency-hiding* for live input, which is a
non-problem for offline-generated static paths — but the underlying spring-damper relaxation is a
reasonable *aesthetic* device if you want a mark's path to look like it "settled" into position
(e.g., simulate the model once, offline, over your seeded control points, purely for the wiggle
character it produces, and bake the result into the static path). Flagging as a stretch/optional
technique, not core.

**5c. Older Microsoft patent, US20050162413A1**, "Rendering ink strokes of variable width and
angle" (Dresevic & Kallay, Microsoft, filed 2001, now abandoned) —
https://patents.google.com/patent/US20050162413A1

- *Algorithm*: represents each sampled pen position as a "pen tip instance" (a positioned,
  sized, rotated shape — circle/rectangle/oval), then generates a **connecting quadrangle**
  between each consecutive pair of instances (tangent-line construction for same-size circles;
  corner-correspondence + union for differing sizes/rotations/polygons) to bridge them into a
  continuous filled region. Also gives a fully disclosed **width-smoothing formula**:
  ```
  smoothed_width[i] = A1·width[i-1] + A2·width[i] + A3·width[i+1]     (e.g. A1=0.25, A2=0.5, A3=0.25)
  ```
  and a least-squares curve-fit generalization for smoothing position/width/rotation jointly
  against a parametric (Bezier) fit:
  `minimize Σ { a·(C_i − P_i)² + b·[W(C_i) − W(P_i)]² + c·[R(C_i) − R(P_i)]² }`.
- *Portable?* The **3-tap width-smoothing kernel is directly and trivially portable** — cheapest
  possible way to avoid width jitter/popping between adjacent sampled widths along a static path,
  no dependencies. The pen-tip-instance + connecting-quadrangle geometry is a legitimate
  alternative to perfect-freehand's offset-outline approach for variable width+angle (nib-shape)
  rendering, but is considerably more implementation work for marginal benefit if we don't need
  rotating nib angle (calligraphy-style) — flag as available but lower priority than
  perfect-freehand's approach unless we specifically want angled/calligraphic marks.

---

## 6. Honest gaps — what I could not find

- No public FiftyThree engineering blog post, talk transcript, or slide deck with the actual
  ink-engine math (only patent claim language survives publicly).
- No disclosed exact velocity→width mapping function/constants from *either* FiftyThree or Square
  — both describe the relationship qualitatively ("faster = thinner," "inverse of speed") but
  neither publishes the curve/clamping values. If exact tunable constants are needed, they'd have
  to come from reading `signature_pad`'s or `perfect-freehand`'s actual source, not from prose
  writeups (this doc time-boxed before doing that deep a source read — flagged in §2 and §3 as the
  concrete next step).
- No technical description found anywhere of FiftyThree's watercolor/"Mix" *texture* diffusion
  (paper-grain feathering, wet-edge spread) — only the color-blend-mode math survived in the
  patents. This is likely proprietary shader/texture work that was never documented publicly.
- Could not verify the "Pen creates thicker lines the faster you move" claim against a primary
  FiftyThree source — it surfaced only as a secondary-source search snippet, flagged accordingly
  in §1.
- No RoughJS bowing-offset exact formula/constants recovered (only the qualitative mechanism) —
  the shihn.ca post apparently has more detail than the fetch summarization preserved; read
  `rough/src/geometry.ts` directly if exact constants are needed.

---

## Sources index

- FiftyThree patent (parent): https://patents.google.com/patent/US9529486
- FiftyThree patent (continuation): https://patents.google.com/patent/US11200712
- Square, "Smoother Signatures": https://developer.squareup.com/blog/smoother-signatures/ (mirror: https://medium.com/square-corner-blog/smoother-signatures-be64515adb33)
- `szimek/signature_pad`: https://github.com/szimek/signature_pad
- `steveruizok/perfect-freehand`: https://github.com/steveruizok/perfect-freehand
  - `getStrokePoints.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokePoints.ts
  - `getStrokeRadius.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeRadius.ts
  - `getStrokeOutlinePoints.ts`: https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeOutlinePoints.ts
  - Secondary write-ups: https://ulfschneider.io/2023-05-14-perfect-freehand/ , https://www.bram.us/2021/09/16/perfect-freehand/
- `rough-stuff/rough`: https://github.com/rough-stuff/rough ; algorithm analysis: https://shihn.ca/posts/2020/roughjs-algorithms/
- Microsoft, "Project Austin Part 3 of 6: Ink Smoothing": https://devblogs.microsoft.com/cppblog/project-austin-part-3-of-6-ink-smoothing/
- `google/ink-stroke-modeler`: https://github.com/google/ink-stroke-modeler
- Microsoft patent US20050162413A1 (Dresevic & Kallay): https://patents.google.com/patent/US20050162413A1
- Microsoft Learn, "Digital Ink - Ink Interaction in Windows 10": https://learn.microsoft.com/en-us/archive/msdn-magazine/2015/windows-10-special-issue/digital-ink-ink-interaction-in-windows-10
- Macworld, iOS 8 brush sizes coverage: https://www.macworld.com/article/223613/
- iMore, Paper faster-ink update coverage: https://www.imore.com/paper-fiftythree-update-faster-ink-edge-edge-drawing-more
- (Background, unconfirmed link to FiftyThree) Way & Shih, "Diffusion rendering of black ink paintings using new paper and ink models": https://www.sciencedirect.com/science/article/abs/pii/S0097849300001321
