# Deep Dive: How People Learn Software & Which On-Screen Teaching Mechanisms Work

*Adversarially-verified research report grounding the design of a teaching form factor (an agent
that highlights, tags, sequences, and relates elements on screen — teaching rather than acting).
Produced by the deep-research harness: 5 search angles, 25 sources fetched, 122 claims extracted,
top 25 verified by 3-vote adversarial panels → 24 confirmed / 1 refuted → 10 merged findings.
2026-07-02.*

---

## Headline

**People learn software by actively pursuing their own tasks, not by following instructional
scripts.** The most effective interventions constrain errors, cut verbiage, and anchor guidance in
the learner's locus of attention — rather than piling on instruction. And every form of guidance
must **fade** as competence grows, or it starts to harm.

## Verified findings (all 3-0 unless noted)

1. **Training wheels — blocking beats explaining (HIGH).** Carroll & Carrithers (1984, IBM
   Displaywriter; replicated 1987): *blocking* error-prone functions (no added instruction — the
   blocked action just no-ops with a message) produced substantially faster learning and better
   comprehension post-tests. The control group spent ~25% of its time recovering from the very
   error states the training-wheels interface made unreachable.
   → *An in-UI teaching agent gains more from constraining off-path actions during a guided
   sequence than from adding explanation.*

2. **Minimalism — slash the verbiage (HIGH).** Minimalist task-centred instruction beats
   system-centred manuals, weighted mean **d = 1.12** (13 effects, n=288; Ginns et al. 2006).
   Cutting redundant text alone: **d = 0.89**. Supporting error recognition/recovery: d = 0.59
   (independently corroborated by Keith & Frese 2008 meta-analysis, d = 0.44, n=2,183).
   → *The agent's teaching voice should say less. Extraneous explanation is a measured cost.*

3. **The paradox of the active user (HIGH).** Learners don't follow scripts: they jump to real
   tasks, skip "irrelevant" material, and make error-prone inferences (Carroll; confirmed by many
   later studies; Fu & Gray 2004).
   → *A `sequence(steps)` primitive must tolerate the learner leaving the path, and anchor steps
   in the learner's real task, not a canned exercise.*

4. **Spotlight overlays: execution ≠ learning (HIGH).** Stencils (Kelleher & Pausch, CHI 2005):
   translucent overlay with holes (spotlight + interaction blocking) → tutorial completed **26%
   faster, fewer errors** — but **statistically similar learning** vs a paper tutorial. Weak
   transfer from stencil tutorials remains an open problem (Harms 2011).
   → *Highlight+block gets tasks done; retained understanding needs something more (explanation,
   retrieval, subgoals).* This is the central design tension for a teaching mode.

5. **Contextual in-place help crushes detached help (HIGH).** ToolClips (Grossman & Fitzmaurice,
   CHI 2010, n=10): contextual video on the element raised task completion **10% → 70%**; users
   *faster a week later* (306s→166s) — video did NOT harm retention, plausibly because the demo
   didn't exactly match the task (preventing superficial mimicry). Tooltips are heavily used
   (8.87/task) but for **locating**, rarely for **understanding** — two separate learnability
   problems.
   → *Teach at the point of need, on the element. A highlight answers "where," not "how."
   Slight demo/task mismatch may aid retention.*

6. **Banner blindness kills detached callouts (HIGH).** Benway & Lane: salient banners spatially
   separated from the search path found only ~58% vs ~94% for plain menu links; task-relevant
   shortcut banners gave no speed benefit and only 17/71 participants even noticed them — while
   searching for exactly what the banners contained. Not ad-avoidance: plain-text non-ad items,
   unmitigated by animation or styling.
   → *Guidance rendered as a detached panel/callout risks being functionally invisible.*

7. **Highlight WITHIN the locus of attention works (MEDIUM — preliminary).** In the same research
   line, a yellow highlight on an item *inside* the menu users were scanning did not trigger
   blindness — users preferentially chose it. Converges with Stencils (which also modifies the
   target element itself).
   → *Render `highlight(entity)` as in-context emphasis on the element, not a separate
   annotation layer beside it.*

8. **Worked examples beat discovery — for novices (HIGH).** Sweller & Cooper 1985; meta-analyses
   d=0.48–0.57. Scope limits verified: novice-specific, and productive-failure literature shows
   problem-solving-first can beat instruction-first for conceptual/transfer outcomes.
   → *Show a worked sequence first for a new task — but only early.*

9. **Expertise reversal & fading (HIGH).** Guidance that helps novices harms as expertise grows
   (2025 meta-analysis, 60 experiments, N=5,924: low-prior-knowledge d=+0.505 with high assistance;
   high-prior-knowledge d=−0.428). Best-evidenced fading is **gradual** (Renkl: replace worked
   steps one at a time, not an abrupt switch).
   → *Track per-task competence; fade step-by-step — drop numbered markers first, then highlights,
   then prompt the learner to complete steps. Never constant guidance.*

10. **Subgoal labels turn step lists into transferable schemas (HIGH).** Margulieux et al. 2020
    (n=265, semester-long): subgoal-labeled worked examples → quiz 48% vs 41% (d=0.44), failing
    criterion 25% vs 44% (≈half), concentrated in at-risk learners.
    → *`sequence(steps)` should group numbered steps under short labels naming WHY (the subgoal),
    not just what.*

## Refuted (0-3)

- "Fifty years of research consistently shows minimally guided instruction inferior to strong
  guidance" — the universal version is contradicted by productive-failure meta-analytic evidence.
  Guidance-first is a **novice-specific** prescription, not a law.

## Evidence gaps (no claims survived verification — honest holes)

- **Learner-generated tagging/annotation vs consuming agent annotations** (the generation effect
  applied to UI learning) — directly gates whether the agent should ask the learner to mark
  elements themselves. *Unverified.*
- **Relationship visualization** (drawn links, brushing-and-linking, spreadsheet precedent
  tracing, concept maps) building correct mental models — **the `relate()` primitive currently
  rests on plausibility, not verified findings.**
- **AI-tutor hint ladders / deixis-in-tutoring** (granularity, error-timing, fading policy from
  ITS literature).
- **Commercial onboarding effectiveness** (Appcues/Pendo, product tours) — vendor metrics are
  marketing-grade and did not survive verification.

### Surfaced but unverified (extracted from sources, not put through the panel — treat as leads)
- VanLehn 2011: human tutoring is d≈0.79, not Bloom's 2-sigma — the bar an AI tutor must clear is
  lower than folklore claims.
- Strong **help avoidance**: students request a median of ZERO hints even with a hint button —
  motivating tutor-initiated guidance.
- Deictic (pointing) gestures in instructional video significantly improved retention (signaling
  principle) — the closest surfaced support for pointing-while-teaching.
- Pendo's own guide data: 2–4 step walkthroughs ≈50% completion; ≥9 steps declining.
- Game tutorials (45,000 players): helped only in the most complex game (Foldit, +29% play time);
  no effect in simple games — teach in proportion to complexity.
- Front-loaded multi-hint overlays fail: short-term memory loses them in ~20s — teach one step at
  the moment of action, not all steps upfront.

## Design implications for the FormFactors teaching form factor

1. **Positioning decision required:** highlight/sequence overlays reliably buy *execution*;
   *retained learning* needs generative acts (the learner does/recalls/labels) — the Stencils gap
   is the fork in the road.
2. `highlight(entity)` → in-context emphasis on the element (we have entity bboxes); never a
   detached callout panel.
3. `sequence(steps)` → one step at a time at the moment of action; numbered markers grouped under
   subgoal labels naming *why*; tolerate path deviation (active user); consider stencil-style
   soft-blocking of off-path elements during a sequence (strongest single finding).
4. `relate(entities)` → build it as an **experiment**, not a settled feature — the testbed
   measures whether drawn links improve relationship comprehension (the literature is silent).
5. **Voice:** minimal. Subgoal label + one short sentence; the verbiage cost is measured (d=0.89).
6. **Fading is not optional:** per-task competence tracking with gradual withdrawal (markers →
   highlights → learner-completed steps), mirroring the autonomy-dial philosophy.
7. Teaching intensity ∝ task complexity (game-tutorial evidence): don't tutorial the simple.

## Sources

Primary: Carroll & Carrithers 1984 (CACM); Ginns/Hollender/Reimann 2006 (ERIC ED491708); Kelleher
& Pausch CHI 2005 (Stencils); Grossman & Fitzmaurice CHI 2010 (ToolClips); Benway & Lane 1998
(banner blindness); Kirschner/Sweller/Clark 2006; Sweller/Ayres/Kalyuga 2011 (expertise reversal);
Tetzlaff et al. 2025 meta-analysis; Renkl et al. 2000/2003 (fading); Margulieux et al. 2020
(subgoal labels); Keith & Frese 2008. Leads (unverified): VanLehn 2011; Aleven et al. (help
avoidance); Andersen et al. 2012 (game tutorials); Pendo guide data; Ponce et al. 2022
(highlighting meta-analysis); Steinberger et al. 2011 (context-preserving visual links).
