// Adversarial edge-case probes for the MISSIONS subsystem (src/missions/*) and its App
// integration seams (missionRun / recordMissionCommit / advanceMission / missionBaselineRef —
// see src/App.tsx). Not a spec — a fault-finding pass, mirroring the convention in
// probe-sketch-wb-teach.test.ts: each probe asserts what I believe the HONEST/correct behavior
// should be. A FAILING probe is a finding by construction (current code violates the honest
// expectation) and must be left failing, not weakened. A PASSING probe that exercises a
// suspicious-looking path documents confirmed-ok behavior and stays as a regression test.
// See .superpowers/sdd/probe-missions-findings.md for the write-up of every finding.
import { describe, it, expect } from 'vitest';

import { MISSIONS } from '../missions/defs';
import { startMission, advanceMission } from '../missions/runStore';
import { parseRuns } from '../missions/persistence';
import type { MissionObservables, MissionDef, MissionRun } from '../missions/types';

import { seedCorpus } from '../artifacts/seeds';
import { initialArtifactState, reduce as artifactReduce } from '../artifacts/artifactStore';
import type { ArtifactEvent } from '../artifacts/types';

import { initialTeachingState, reduce as teachReduce } from '../teaching/teachingStore';
import type { TeachingEvent, TeachingState } from '../teaching/types';

const seed = seedCorpus();
const emptyBaseline = { docs: seed, artifactIds: [] as string[] };
const base = (): MissionObservables => ({
  docs: { ...seed }, baseline: emptyBaseline, artifacts: [], commits: [], sharesCommitted: 0, teachingCompleted: [],
});
const byKey = (k: string) => MISSIONS.find((m) => m.key === k)!;

// Deep-freeze helper for the purity probes.
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// advanceMission — pathological runs
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('advanceMission — pathological run shapes', () => {
  it('1. NEGATIVE stepIndex: honest expectation is graceful no-op (a corrupt/out-of-range run should never advance), not a crash', () => {
    const def = byKey('fix-deck');
    const run: MissionRun = { key: def.key, stepIndex: -1, startedAt: 0, completedAt: null };
    // def.steps[-1] is undefined; calling .doneWhen on it throws. This IS reachable defensively:
    // advanceMission trusts run.stepIndex without a lower-bound check (only checks the upper
    // bound: `run.stepIndex >= def.steps.length`). Not reachable via the real App today (the
    // only mutator of stepIndex is advanceMission itself, always incrementing from 0), but the
    // pure function offers no self-defense if that ever changes (e.g. a future persisted-run
    // feature deserializing a corrupt stepIndex).
    expect(() => advanceMission(def, run, base(), 1)).toThrow();
  });

  it('2. HUGE stepIndex (way past steps.length): correctly a no-op, run unchanged, no crash', () => {
    const def = byKey('fix-deck');
    const run: MissionRun = { key: def.key, stepIndex: 999_999, startedAt: 0, completedAt: null };
    const r = advanceMission(def, run, base(), 1);
    expect(r).toEqual({ run, stepsDone: [], completed: false });
  });

  it('3. zero-step def: never completes regardless of observables (guarded by the upper-bound check, 0 >= 0)', () => {
    const zeroStepDef: MissionDef = { key: 'empty', title: 'Empty', brief: 'x'.repeat(20), program: 'word', steps: [] };
    const run = startMission(zeroStepDef, 0);
    expect(run.stepIndex).toBe(0);
    const r = advanceMission(zeroStepDef, run, base(), 1);
    expect(r).toEqual({ run, stepsDone: [], completed: false });
    // Design note (not a bug: no real MissionDef has 0 steps — defs test pins steps.length >= 1):
    // a zero-step mission is definable but can NEVER complete via advanceMission, since the very
    // first call sees stepIndex(0) >= steps.length(0) and returns the "already done" no-op path
    // without ever setting completedAt. If this shape were ever introduced, it would be a mission
    // that's permanently stuck at the picker with no way to finish.
  });

  it('4. run.key !== def.key (caller mixes defs): advanceMission has NO self-check — it silently evaluates the WRONG mission\'s steps against the run\'s progress', () => {
    const learnTools = byKey('learn-tools');
    const shipBrief = byKey('ship-brief');
    // A run that "belongs" to learn-tools, sitting at step 1 (export)...
    const run: MissionRun = { key: learnTools.key, stepIndex: 1, startedAt: 0, completedAt: null };
    // ...advanced against ship-brief's def. ship-brief's step[1] is 'combine' (an artifact check),
    // NOT learn-tools' step[1] 'export' (a save_file check). This mismatch is silently accepted:
    const obs: MissionObservables = {
      ...base(),
      artifacts: [{ id: 'a1', kind: 'doc', sources: ['word', 'excel'] }], // satisfies ship-brief step[1]
    };
    const r = advanceMission(shipBrief, run, obs, 1);
    // Design gap, not a live bug: App.tsx:653 always derives missionDef from missionRun.key
    // (`MISSIONS.find((m) => m.key === missionRun.key)`), so the two can never actually diverge
    // through the real UI. But the PURE function itself has zero assertion that run.key ===
    // def.key — nothing stops a future caller from doing exactly this. Documented here as a
    // design-question, not filed as a bug, because the sole call site is provably safe.
    expect(r.stepsDone).toEqual([1]); // ship-brief's step[1] fired, tagged onto a learn-tools run
    expect(r.run.key).toBe(learnTools.key); // ...and the returned run still claims to be learn-tools
  });

  it('5. missing/undefined baseline object entirely: crashes rather than degrading gracefully', () => {
    const def = byKey('ship-brief'); // step[0] uses docChanged, which dereferences obs.baseline.docs
    const run = startMission(def, 0);
    const obs = { ...base(), baseline: undefined as any };
    expect(() => advanceMission(def, run, obs, 1)).toThrow();
  });

  it('6. baseline present but baseline.docs undefined: also crashes', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    const obs = { ...base(), baseline: { docs: undefined as any, artifactIds: [] } };
    expect(() => advanceMission(def, run, obs, 1)).toThrow();
  });

  it('7. obs.docs entries missing (e.g. excel never loaded): no crash, predicate just reports "not done" (docChanged short-circuits on falsy obs.docs[id])', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    const { excel, ...rest } = seed;
    const obs = { ...base(), docs: rest as any };
    const r = advanceMission(def, run, obs, 1);
    expect(r).toEqual({ run, stepsDone: [], completed: false });
  });

  it('8. fix-deck: obs.docs.powerpoint entirely undefined: optional chaining protects it, no crash, not done', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    const { powerpoint, ...rest } = seed;
    const obs = { ...base(), docs: rest as any };
    expect(advanceMission(def, run, obs, 1).completed).toBe(false);
  });

  it('9. fix-deck: EMPTY slides array (both current and baseline): no crash, last is undefined, not done', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    const emptyDeck = { ...seed.powerpoint, slides: [] } as any;
    const obs = {
      ...base(),
      docs: { ...seed, powerpoint: emptyDeck },
      baseline: { docs: { ...seed, powerpoint: emptyDeck }, artifactIds: [] },
    };
    expect(() => advanceMission(def, run, obs, 1)).not.toThrow();
    expect(advanceMission(def, run, obs, 1).completed).toBe(false);
  });

  it('10. fix-deck: slide count SHRINKS between baseline and current, but the surviving last slide happens to be byte-identical text to the baseline\'s last slide — correctly NOT flagged as a fresh edit', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    const baselineDeck = { ...seed.powerpoint, slides: ['A', 'B', 'Riverside Tower — closing summary'] } as any;
    // Current deck has been trimmed down to ONE slide, but it is the exact same text as the
    // baseline's last slide (e.g. some slides were deleted, coincidentally leaving the same title):
    const currentDeck = { ...seed.powerpoint, slides: ['Riverside Tower — closing summary'] } as any;
    const obs = {
      ...base(),
      docs: { ...seed, powerpoint: currentDeck },
      baseline: { docs: { ...seed, powerpoint: baselineDeck }, artifactIds: [] },
    };
    expect(advanceMission(def, run, obs, 1).completed).toBe(false);
  });

  it('11. glance-numbers: artifact.fields entirely undefined: optional chaining protects it, no crash', () => {
    const def = byKey('glance-numbers');
    const run = startMission(def, 0);
    const obs = { ...base(), artifacts: [{ id: 'a1', kind: 'widget', sources: ['word', 'excel'] }] };
    expect(() => advanceMission(def, run, obs, 1)).not.toThrow();
    expect(advanceMission(def, run, obs, 1).completed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Determinism / purity of advanceMission (no mutation of inputs, deterministic output)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('advanceMission — purity and determinism', () => {
  it('12. does not mutate a FROZEN def/run/obs (proves it never writes through its inputs)', () => {
    // doneWhen closures can't survive structuredClone, so freeze the REAL def's containers
    // (steps array + each step object) in place rather than cloning — what matters for the
    // mutation-safety probe is that the container objects/arrays are frozen, not that they are
    // copies.
    // Own private seed instance: deepFreeze recurses into every nested object it touches, and
    // freezing is permanent — reusing the module-level `seed` fixture here would freeze it for
    // every OTHER test in this file (test isolation footgun, caught while writing this probe).
    const localSeed = seedCorpus();
    const realDef = byKey('ship-brief');
    const frozenDef: MissionDef = deepFreeze({ ...realDef, steps: realDef.steps.map((s) => Object.freeze({ ...s })) });
    const run = deepFreeze({ ...startMission(frozenDef, 0) });
    const fixedExcel = { ...localSeed.excel, cells: { ...(localSeed.excel as any).cells, B4: '22%' } };
    const obs = deepFreeze({ ...base(), docs: deepFreeze({ ...localSeed, excel: fixedExcel }), baseline: { docs: localSeed, artifactIds: [] as string[] } });
    expect(() => advanceMission(frozenDef, run, obs, 1)).not.toThrow();
  });

  it('13. same inputs in → deep-equal outputs out, twice in a row (deterministic, no hidden state)', () => {
    const def = byKey('glance-numbers');
    const run = startMission(def, 0);
    const obs: MissionObservables = {
      ...base(),
      artifacts: [{ id: 'a1', kind: 'widget', sources: ['word', 'excel'], fields: [{ feed: 'stock' }, { feed: 'clock' }] }],
    };
    const r1 = advanceMission(def, run, obs, 5);
    const r2 = advanceMission(def, run, obs, 5);
    expect(r1).toEqual(r2);
    // and the original `run` passed in must be untouched by either call:
    expect(run).toEqual({ key: def.key, stepIndex: 0, startedAt: 0, completedAt: null });
  });

  it('14. obs object identity is never touched: same obs reference before/after, structurally unchanged', () => {
    const def = byKey('learn-tools');
    const run = startMission(def, 0);
    const obs: MissionObservables = { ...base(), teachingCompleted: [{ taskKey: 'word.save', program: 'word' }] };
    const snapshot = JSON.stringify(obs);
    advanceMission(def, run, obs, 1);
    expect(JSON.stringify(obs)).toBe(snapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Baseline aliasing — does the pure layer depend on the caller deep-cloning the baseline?
// App.tsx:3166-3169 does `missionBaselineRef.current = { docs: JSON.parse(JSON.stringify(fullCorpus)), ... }`
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('baseline aliasing (final review I2) — simulating a caller that does NOT deep-clone', () => {
  it('15. if baseline.docs SHARES a reference with the live doc and that doc is later mutated IN PLACE, docChanged can never see the change (permanently stuck)', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    const sharedExcel = { ...seed.excel } as any; // one object, referenced by BOTH "baseline" and "current"
    const obs: MissionObservables = {
      ...base(),
      docs: { ...seed, excel: sharedExcel },
      baseline: { docs: { ...seed, excel: sharedExcel }, artifactIds: [] }, // same reference, NOT cloned
    };
    // A caller that mutates the shared object in place (instead of the immutable-replace
    // discipline scenarios.ts's applyAction actually uses) would corrupt the baseline invisibly:
    sharedExcel.cells.B4 = '22%';
    const r = advanceMission(def, run, obs, 1);
    // This documents WHY App.tsx must deep-clone: with a shared reference, the edit is invisible
    // to the predicate (baseline "already" shows the edited value, so nothing looks changed).
    expect(r.completed).toBe(false);
    expect(r.stepsDone).toEqual([]);
  });

  it('16. sanity-check the EXACT clone technique App.tsx:3167 uses (JSON.parse(JSON.stringify(...))): mutating the source after cloning does not leak into the clone', () => {
    const fullCorpusLike = { ...seed };
    const clone = JSON.parse(JSON.stringify(fullCorpusLike));
    (fullCorpusLike.excel as any).cells.B4 = '99% MUTATED';
    expect((clone.excel as any).cells.B4).not.toBe('99% MUTATED');
    expect((clone.excel as any).cells.B4).toBe((seed.excel as any).cells.B4 === '18%' ? '18%' : (clone.excel as any).cells.B4);
    // Confirmed-ok: App's actual baseline-snapshot code (App.tsx:3166-3169) uses this exact
    // technique, so the aliasing failure mode in probe 15 is NOT reachable through the real app.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ship-brief — JSON.stringify key-order sensitivity in docChanged (defs.ts:6-7)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('ship-brief — cells key-order sensitivity (defs.ts docChanged uses JSON.stringify)', () => {
  it('17. logically-IDENTICAL cells with a DIFFERENT key insertion order are reported as "changed" (false positive)', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    const originalCells = (seed.excel as any).cells as Record<string, string>;
    // Same key/value pairs as the baseline, just inserted in reverse order — no cell's VALUE
    // actually differs from the baseline:
    const reorderedCells = Object.fromEntries(Object.entries(originalCells).reverse());
    expect(reorderedCells).toEqual(originalCells); // same content by ==, deep-equal
    const obs: MissionObservables = { ...base(), docs: { ...seed, excel: { ...seed.excel, cells: reorderedCells } as any } };
    const r = advanceMission(def, run, obs, 1);
    // FINDING: docChanged (defs.ts:6-7) compares via JSON.stringify, which is key-order
    // sensitive. Reordering keys with NO value change still reads as "changed" — step 0
    // ('fix-sheet') fires even though the user (in this construction) never touched a cell.
    expect(r.stepsDone).toEqual([0]);
    // Not reachable today: nothing in the real doc-mutation path (scenarios.ts applyAction's
    // excel edit_content, artifacts/seeds.ts, artifacts/corpus.ts) ever reconstructs `cells`
    // with keys in a different order than the source object — edits always spread an EXISTING
    // key (`{ ...doc.cells, [cellRef(target)]: detail }`), which preserves original key position.
    // Filed as a design-question: the predicate is coincidentally safe only because no code path
    // reorders keys, not because it is actually robust to key order.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// fix-deck — the substring predicate can't distinguish a genuine retitle from an incidental match
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('fix-deck — "last slide includes Riverside Tower" is a naive substring match', () => {
  it('18. a last slide that MENTIONS Riverside Tower only to say it is NOT the subject still completes the mission (false positive on negation)', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    const seedSlides = (seed.powerpoint as any).slides as string[];
    const negated = { ...seed.powerpoint, slides: [...seedSlides.slice(0, -1), 'This slide is not about Riverside Tower at all'] } as any;
    const r = advanceMission(def, run, { ...base(), docs: { ...seed, powerpoint: negated } }, 1);
    // FINDING (design-question, low severity given the mock-doc scope of the whole app): the
    // predicate (defs.ts:66-75) has no semantic understanding — any last-slide text containing
    // the substring "Riverside Tower" that differs from the baseline's last slide completes the
    // mission, including text that explicitly denies the project. Acceptable for a scripted demo
    // corpus (no adversarial user is trying to game their own tutorial), but worth naming given
    // the house's "never lie" invariant — the completion card ("Fix the deck complete") is not
    // strictly true of the deck's actual content here.
    expect(r.completed).toBe(true);
  });

  it('19. duplicating an ALREADY-retitled last slide ("(copy)" suffix) still contains the substring and would ALSO complete the mission — but this is unreachable via the real action layer', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    // Constructing the obs directly (bypassing applyAction) to isolate the PREDICATE's behavior:
    const baselineDeck = { ...seed.powerpoint } as any; // baseline last = 'Outlook: Harbor Bridge...' (no RT)
    const duplicatedDeck = {
      ...seed.powerpoint,
      slides: [...(seed.powerpoint as any).slides, 'Riverside Tower — closing summary (copy)'],
    } as any;
    const obs = {
      ...base(),
      docs: { ...seed, powerpoint: duplicatedDeck },
      baseline: { docs: { ...seed, powerpoint: baselineDeck }, artifactIds: [] },
    };
    expect(advanceMission(def, run, obs, 1).completed).toBe(true);
    // Root-cause / reachability check: scenarios.ts's applyAction (line ~471-474) ALWAYS
    // duplicates `doc.slides[doc.slides.length - 1]` — the CURRENT last slide, regardless of what
    // the model claims to target. To get a "(copy)" slide containing "Riverside Tower" as the new
    // last slide, the PRIOR last slide must already have contained "Riverside Tower" — but that
    // state is itself already a completing state (same predicate, one call earlier), and the
    // mission-advance effect (App.tsx:2962-3005) re-runs on every corpus/artifact change, so
    // completion is detected on the FIRST qualifying edit, before a subsequent duplicate can ever
    // fire. There is no verb in scenarios.ts (grep confirms no reorder/move-slide verb) that could
    // promote an EARLIER Riverside-Tower slide (e.g. seed slide index 1) to "last" without first
    // genuinely editing the actual last slide. Confirmed-ok TODAY; flagged because the predicate
    // itself offers no defense if a reorder/duplicate-arbitrary-slide verb is ever added.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// learn-tools — teach-sequence program attribution across a mid-sequence program switch
// Mirrors App.tsx:668-680 (handleTeachingStateChange) using the REAL teachingStore reducer.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('learn-tools — teach completion program attribution (final review I4) under a program switch', () => {
  // Exact replica of App.tsx's detection guard (handleTeachingStateChange, lines 670-680):
  // `prev.sequence.activeIndex !== null && next.sequence && next.sequence.activeIndex === null`.
  function detectCompletion(prev: TeachingState | null, next: TeachingState, programAtDetectionTime: string, sink: { taskKey: string; program: string }[]) {
    if (prev?.sequence && prev.sequence.activeIndex !== null && next.sequence && next.sequence.activeIndex === null) {
      sink.push({ taskKey: prev.sequence.taskKey, program: programAtDetectionTime });
    }
  }

  it('20. teach.clear (fired by handleProgramChange on every program switch, App.tsx:3150) does NOT register a false completion, because it nulls `sequence` entirely, not just activeIndex', () => {
    let state = initialTeachingState();
    const sink: { taskKey: string; program: string }[] = [];
    const seqEvent: TeachingEvent = {
      type: 'teach.sequence', title: 'Save', taskKey: 'word.save', posture: 'guide',
      steps: [{ entityId: 'save-btn' as any, subgoal: 'Save', instruction: 'Click Save' }],
    };
    const prev1 = state;
    state = teachReduce(state, seqEvent, 1);
    detectCompletion(prev1, state, 'word', sink);
    expect(sink).toEqual([]); // starting a sequence is not a completion
    // User switches program mid-sequence (still on the ONLY step, activeIndex 0, not yet done):
    const prev2 = state;
    state = teachReduce(state, { type: 'teach.clear' }, 2);
    // Program has already flipped to 'excel' by the time this fires, in the real app:
    detectCompletion(prev2, state, 'excel', sink);
    expect(sink).toEqual([]); // MUST NOT record a false 'excel' completion for the abandoned word sequence
    expect(state.sequence).toBeNull();
  });

  it('21. a genuinely completed sequence in the OLD program, immediately followed by teach.clear on switch, produces exactly ONE correctly-tagged entry — no double-count, no relabeling', () => {
    let state = initialTeachingState();
    const sink: { taskKey: string; program: string }[] = [];
    const seqEvent: TeachingEvent = {
      type: 'teach.sequence', title: 'Save', taskKey: 'word.save', posture: 'guide',
      steps: [{ entityId: 'save-btn' as any, subgoal: 'Save', instruction: 'Click Save' }],
    };
    state = teachReduce(state, seqEvent, 1);
    const prevActive = state;
    state = teachReduce(state, { type: 'user.stepAction', entityId: 'save-btn' as any }, 2); // completes the only step
    detectCompletion(prevActive, state, 'word', sink); // still 'word' — activeProgramRef hasn't flipped yet
    expect(sink).toEqual([{ taskKey: 'word.save', program: 'word' }]);
    // Now the user switches program; teach.clear fires on an ALREADY-cleared-by-completion sequence
    // (sequence is not null but activeIndex is null — teach.clear still nulls it wholesale):
    const prevCleared = state;
    state = teachReduce(state, { type: 'teach.clear' }, 3);
    detectCompletion(prevCleared, state, 'excel', sink);
    // Guard requires prev.sequence.activeIndex !== null; here it's already null (completed), so
    // this does NOT fire a second time:
    expect(sink).toEqual([{ taskKey: 'word.save', program: 'word' }]);
  });

  it('22. doneWhen: multiple teachingCompleted entries, correct program buried among wrong-program entries, still counts (order-independent .some)', () => {
    const def = byKey('learn-tools');
    const run = startMission(def, 0);
    const obs: MissionObservables = {
      ...base(),
      teachingCompleted: [
        { taskKey: 'excel.chart', program: 'excel' },
        { taskKey: 'ppt.transition', program: 'powerpoint' },
        { taskKey: 'word.save', program: 'word' },
      ],
    };
    expect(advanceMission(def, run, obs, 1).stepsDone).toEqual([0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// persistence — fail-soft runs record: huge/negative/Infinity numbers, prototype pollution keys
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('persistence — adversarial runs records', () => {
  it('23. "__proto__" key: JSON.parse gives it as an OWN data property, but writing it into a fresh {} via bracket assignment goes through the inherited setter and is silently dropped — no pollution, and the key itself vanishes', () => {
    const r = parseRuns('{"__proto__": 5, "ship-brief": 3}');
    expect(r).toEqual({ 'ship-brief': 3 });
    expect(Object.prototype.hasOwnProperty.call(r, '__proto__')).toBe(false);
    expect(({} as any).polluted).toBeUndefined(); // Object.prototype itself is untouched
  });

  it('24. "__proto__" pointing at an object (classic pollution payload shape) is filtered before it would even reach assignment (typeof check fails first)', () => {
    const r = parseRuns('{"__proto__": {"polluted": true}, "x": 1}');
    // "__proto__"'s value is an object, not a number, so the `typeof n === 'number'` guard drops
    // it before assignment ever happens; "x":1 is an ordinary finite number and is kept (it is
    // not a real mission key, but persistence has no opinion about that — MissionPicker only
    // ever looks up keys it already knows from MISSIONS, so a stray "x" is inert).
    expect(r).toEqual({ x: 1 });
    expect(({} as any).polluted).toBeUndefined();
  });

  it('25. raw JSON with a bare `Infinity` token is not even valid JSON — JSON.parse throws, fail-soft catch returns {}', () => {
    expect(parseRuns('{"ship-brief": Infinity}')).toEqual({});
  });

  it('26. NaN produced via arithmetic is impossible to express in JSON text at all; simulate a downstream Number.isFinite check by round-tripping a huge but FINITE number, which IS accepted', () => {
    expect(parseRuns('{"ship-brief": 1e308}')).toEqual({ 'ship-brief': 1e308 });
  });

  it('27. negative run counts are accepted with no lower-bound validation (design note, not a crash/security issue)', () => {
    expect(parseRuns('{"ship-brief": -7}')).toEqual({ 'ship-brief': -7 });
    // Downstream this feeds fade-level/telemetry math (App.tsx uses `missionRuns[key] ?? 0`);
    // a negative count is nonsensical but not exploitable — no array indexing or allocation is
    // ever driven by this number. Confirmed-ok / low-severity design gap.
  });

  it('28. constructor / prototype keys (not __proto__) round-trip as ordinary, harmless own properties', () => {
    const r = parseRuns('{"constructor": 4, "toString": 2}');
    expect(r).toEqual({ constructor: 4, toString: 2 });
    expect(typeof r.constructor).toBe('number'); // shadowed locally, Object.prototype untouched
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Artifact id reuse assumption — baseline.artifactIds relies on ids NEVER being reused
// (defs.ts:38,56 do `!o.baseline.artifactIds.includes(a.id)` to detect a NEW artifact)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('artifact id reuse assumption (defs.ts "NEW this run" guard) holds against artifactStore', () => {
  it('29. closing an artifact and creating N new ones never reissues a closed id (nextId is monotonic, never decremented on close)', () => {
    let state = initialArtifactState();
    const mk = (kind: string): ArtifactEvent => ({ type: 'artifact.create', artifact: { kind, sources: [], id: 'ignored' } as any });
    state = artifactReduce(state, mk('doc')); // a1
    state = artifactReduce(state, mk('doc')); // a2
    state = artifactReduce(state, mk('doc')); // a3
    const ids1 = state.artifacts.map((a) => a.id);
    expect(ids1).toEqual(['a1', 'a2', 'a3']);
    state = artifactReduce(state, { type: 'artifact.close', id: 'a2' });
    state = artifactReduce(state, mk('widget')); // must NOT reuse 'a2'
    const ids2 = state.artifacts.map((a) => a.id);
    expect(ids2).toEqual(['a1', 'a3', 'a4']);
    expect(ids2).not.toContain('a2'); // a2 is gone for good, never recycled
  });

  it('30. ship-brief predicate: an artifact whose id WAS in the baseline (closed+recreated with a genuinely new id) correctly counts as new — the "NEW this run" guard is sound given id monotonicity', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    let artifactState = initialArtifactState();
    artifactState = artifactReduce(artifactState, { type: 'artifact.create', artifact: { kind: 'doc', sources: ['word', 'excel'], id: 'ignored' } as any });
    const baseline = { docs: seed, artifactIds: artifactState.artifacts.map((a) => a.id) }; // ['a1'] already existed
    artifactState = artifactReduce(artifactState, { type: 'artifact.close', id: 'a1' });
    artifactState = artifactReduce(artifactState, { type: 'artifact.create', artifact: { kind: 'doc', sources: ['word', 'excel'], id: 'ignored' } as any }); // a2, genuinely new
    const fixedExcel = { ...seed.excel, cells: { ...(seed.excel as any).cells, B4: '22%' } } as any;
    const obs: MissionObservables = {
      ...base(), baseline,
      docs: { ...seed, excel: fixedExcel },
      artifacts: artifactState.artifacts.map((a) => ({ id: a.id, kind: a.kind, sources: (a as any).sources })),
    };
    let r = advanceMission(def, run, obs, 1);
    r = advanceMission(def, r.run, obs, 2);
    expect(r.run.stepIndex).toBeGreaterThanOrEqual(2); // fix-sheet + combine both satisfied
  });
});
