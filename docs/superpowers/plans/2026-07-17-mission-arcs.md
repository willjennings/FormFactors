# Mission Arcs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phrase-script front door with four goal-driven mission arcs over the Meridian world, driven only through the C3 goal model, with deterministic step completion, per-run scaffold fade, and quiet measured completion.

**Architecture:** A pure `src/missions/` module (defs + observables + run reducer + persistence) feeds a floating MissionPicker panel; App assembles `MissionObservables` from existing state (corpus, artifacts, commit points, teaching completions) and drives a single advance effect. The agent's only channel remains `[GOAL STATE]`.

**Tech Stack:** React + TypeScript, vitest, existing goal/rail/feedback/telemetry subsystems.

## Global Constraints (spec §2/§8)

- The agent is NEVER told a mission is scripted: no `[MISSION]` hint, no mission vocabulary in any prompt/hint string. The only agent-side channel is the existing goal model.
- Step completion is deterministic observation of committed state — never model claims/transcripts.
- Steps complete IN ORDER; an early-satisfied later predicate waits.
- Completion is quiet: `emitFeedback({ outcome: 'committed', verbClass: 'create', … })` + ONE rail answer card of measured facts + goal cleared. NO confetti, no celebration chrome.
- Scaffold fade: run 0 shows the step `hint`; run ≥1 hides hints (subgoal only). Persisted in **localStorage** key `ff-mission-runs`, fail-soft parsing (mirror `src/teaching/persistence.ts`).
- The suggestion chips in the Omnibox STAY untouched. No `Say "` phrasing anywhere in mission defs (regression-tested).
- Amendment to spec §6 (discovered in planning): the audit-era task carousel was already deleted in A1 — the picker is a NEW floating panel (window family styling), not a carousel swap. Task 3 updates the spec sentence.
- Gate per task: `npx tsc --noEmit && npm test`; tasks touching TSX also `npm run build`.

---

### Task 1: `src/missions/` pure core (defs + run reducer + persistence) — TDD

**Files:**
- Create: `src/missions/types.ts`, `src/missions/defs.ts`, `src/missions/runStore.ts`, `src/missions/persistence.ts`
- Test: `src/missions/missions.test.ts`

**Interfaces:**
- Consumes: `MockDoc`, `ProgramId` from `../scenarios`; `seedCorpus` from `../artifacts/seeds` (tests only — the module itself receives seeds via observables, staying pure).
- Produces (Task 3 relies on these exact names):
  - `types.ts`: `MissionStep { key: string; subgoal: string; hint: string; doneWhen(obs: MissionObservables): boolean }` · `MissionDef { key: string; title: string; brief: string; program: ProgramId; steps: MissionStep[] }` · `MissionObservables { docs: Partial<Record<ProgramId, MockDoc>>; seed: Record<ProgramId, MockDoc>; artifacts: { kind: string; sources: string[]; fields?: { feed?: string }[] }[]; commits: { verbClass: string; program: ProgramId }[]; sharesCommitted: number; teachingCompleted: string[] }` · `MissionRun { key: string; stepIndex: number; startedAt: number; completedAt: number | null }`
  - `defs.ts`: `MISSIONS: MissionDef[]` (keys `learn-tools`, `ship-brief`, `glance-numbers`, `fix-deck`)
  - `runStore.ts`: `startMission(def: MissionDef, now: number): MissionRun` · `advanceMission(def: MissionDef, run: MissionRun, obs: MissionObservables, now: number): { run: MissionRun; stepsDone: number[]; completed: boolean }`
  - `persistence.ts`: `parseRuns(raw: string | null): Record<string, number>` · `loadRuns(): Record<string, number>` · `saveRuns(r: Record<string, number>): void`

- [ ] **Step 1: Write the failing tests**

```ts
// src/missions/missions.test.ts
import { describe, it, expect } from 'vitest';
import { MISSIONS } from './defs';
import { startMission, advanceMission } from './runStore';
import { parseRuns } from './persistence';
import { seedCorpus } from '../artifacts/seeds';
import type { MissionObservables } from './types';

const seed = seedCorpus();
const base = (): MissionObservables => ({
  docs: { ...seed }, seed, artifacts: [], commits: [], sharesCommitted: 0, teachingCompleted: [],
});
const byKey = (k: string) => MISSIONS.find((m) => m.key === k)!;

describe('mission defs (spec §4/§8)', () => {
  it('four arcs with stable keys, briefs, and ordered steps', () => {
    expect(MISSIONS.map((m) => m.key)).toEqual(['learn-tools', 'ship-brief', 'glance-numbers', 'fix-deck']);
    for (const m of MISSIONS) {
      expect(m.brief.length).toBeGreaterThan(10);
      expect(m.steps.length).toBeGreaterThanOrEqual(1);
      for (const s of m.steps) { expect(s.subgoal).toBeTruthy(); expect(s.hint).toBeTruthy(); }
    }
  });
  it('no utterance-scripting phrasing anywhere in defs (audit gap 7 must not regress)', () => {
    const all = JSON.stringify(MISSIONS);
    expect(all).not.toMatch(/Say "/);
  });
});

describe('runStore — in-order deterministic advance (spec §3/§8)', () => {
  it('learn-tools: teach completion then a file commit, strictly in order', () => {
    const def = byKey('learn-tools');
    let run = startMission(def, 1000);
    expect(run.stepIndex).toBe(0);
    // A later-step condition arriving early must NOT advance step 0:
    let r = advanceMission(def, run, { ...base(), commits: [{ verbClass: 'file', program: 'word' }] }, 1001);
    expect(r.run.stepIndex).toBe(0);
    expect(r.stepsDone).toEqual([]);
    // Teach sequence completes → step 0 done; the earlier file commit is STILL visible in obs,
    // so step 1 completes in the same advance (both conditions now hold, order preserved):
    r = advanceMission(def, r.run, { ...base(), commits: [{ verbClass: 'file', program: 'word' }], teachingCompleted: ['word.save'] }, 1002);
    expect(r.stepsDone).toEqual([0, 1]);
    expect(r.completed).toBe(true);
    expect(r.run.completedAt).toBe(1002);
  });
  it('ship-brief: sheet fixed → combine doc from word+excel → share', () => {
    const def = byKey('ship-brief');
    let run = startMission(def, 0);
    const fixedExcel = { ...seed.excel, cells: { ...(seed.excel as any).cells, B4: '22%' } } as any;
    let r = advanceMission(def, run, { ...base(), docs: { ...seed, excel: fixedExcel } }, 1);
    expect(r.run.stepIndex).toBe(1);
    r = advanceMission(def, r.run, { ...base(), docs: { ...seed, excel: fixedExcel }, artifacts: [{ kind: 'doc', sources: ['word', 'excel'] }] }, 2);
    expect(r.run.stepIndex).toBe(2);
    expect(r.completed).toBe(false);
    r = advanceMission(def, r.run, { ...base(), docs: { ...seed, excel: fixedExcel }, artifacts: [{ kind: 'doc', sources: ['word', 'excel'] }], sharesCommitted: 1 }, 3);
    expect(r.completed).toBe(true);
  });
  it('glance-numbers: widget with the SIMULATED stock plus a LIVE feed', () => {
    const def = byKey('glance-numbers');
    let run = startMission(def, 0);
    // stock alone is not enough:
    let r = advanceMission(def, run, { ...base(), artifacts: [{ kind: 'widget', sources: ['word', 'excel'], fields: [{ feed: 'stock' }] }] }, 1);
    expect(r.completed).toBe(false);
    r = advanceMission(def, r.run, { ...base(), artifacts: [{ kind: 'widget', sources: ['word', 'excel'], fields: [{ feed: 'stock' }, { feed: 'clock' }] }] }, 2);
    expect(r.completed).toBe(true);
  });
  it('fix-deck: title slide must name the lead project (seed title does not)', () => {
    const def = byKey('fix-deck');
    let run = startMission(def, 0);
    expect(advanceMission(def, run, base(), 1).completed).toBe(false);
    const retitled = { ...seed.powerpoint, slides: ['Riverside Tower — Q3 2026 board review', ...(seed.powerpoint as any).slides.slice(1)] } as any;
    const r = advanceMission(def, run, { ...base(), docs: { ...seed, powerpoint: retitled } }, 2);
    expect(r.completed).toBe(true);
  });
  it('advance after completion is a no-op', () => {
    const def = byKey('fix-deck');
    const done = { key: def.key, stepIndex: def.steps.length, startedAt: 0, completedAt: 5 };
    const r = advanceMission(def, done, base(), 9);
    expect(r).toEqual({ run: done, stepsDone: [], completed: false });
  });
});

describe('persistence — fail-soft runs record (spec §5)', () => {
  it('parses valid, rejects garbage to empty', () => {
    expect(parseRuns('{"ship-brief":2}')).toEqual({ 'ship-brief': 2 });
    expect(parseRuns('nonsense')).toEqual({});
    expect(parseRuns(null)).toEqual({});
    expect(parseRuns('{"x":"y"}')).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify RED** — `npx vitest run src/missions/missions.test.ts` → collect error (missing modules).

- [ ] **Step 3: Implement**

```ts
// src/missions/types.ts
import type { MockDoc, ProgramId } from '../scenarios';

/** Read-only observation of COMMITTED state (spec §8.2: never model claims). */
export interface MissionObservables {
  docs: Partial<Record<ProgramId, MockDoc>>;
  seed: Record<ProgramId, MockDoc>;
  artifacts: { kind: string; sources: string[]; fields?: { feed?: string }[] }[];
  commits: { verbClass: string; program: ProgramId }[];
  sharesCommitted: number;
  teachingCompleted: string[]; // taskKeys of completed teach sequences
}
export interface MissionStep {
  key: string;
  subgoal: string;
  hint: string; // shown ONLY on run 0 (spec §5); never sent to the agent
  doneWhen(obs: MissionObservables): boolean;
}
export interface MissionDef {
  key: string; title: string; brief: string; program: ProgramId; steps: MissionStep[];
}
export interface MissionRun {
  key: string; stepIndex: number; startedAt: number; completedAt: number | null;
}
```

```ts
// src/missions/defs.ts
// The four arcs over the Meridian world (spec §4). Predicates observe committed state only.
import type { MissionDef } from './types';

const docChanged = (obs: { docs: any; seed: any }, id: string, field: string) =>
  !!obs.docs[id] && JSON.stringify((obs.docs[id] as any)[field]) !== JSON.stringify((obs.seed[id] as any)[field]);

export const MISSIONS: MissionDef[] = [
  {
    key: 'learn-tools', title: 'Learn your way around', program: 'word',
    brief: 'Get comfortable in Word: have it walk you through saving, then export a copy yourself.',
    steps: [
      { key: 'walkthrough', subgoal: 'Complete a save walkthrough',
        hint: 'Try: "teach me how to save this"',
        doneWhen: (o) => o.teachingCompleted.some((k) => k.startsWith('word.')) },
      { key: 'export', subgoal: 'Export a copy',
        hint: 'Try: "export this as a PDF"',
        doneWhen: (o) => o.commits.some((c) => c.verbClass === 'file' && c.program === 'word') },
    ],
  },
  {
    key: 'ship-brief', title: 'Ship the brief', program: 'word',
    brief: 'Get the Q3 status brief out: fix the sheet, combine the report and the numbers, and send it.',
    steps: [
      { key: 'fix-sheet', subgoal: 'Fix the numbers in the sheet',
        hint: 'Point at a cell and tell it what to change',
        doneWhen: (o) => docChanged(o, 'excel', 'cells') },
      { key: 'combine', subgoal: 'Combine report + sheet into a brief',
        hint: 'Try: "combine the report and the numbers into a status brief"',
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'doc' && a.sources.includes('word') && a.sources.includes('excel')) },
      { key: 'share', subgoal: 'Send it out',
        hint: 'Try: "share the brief with my editor"',
        doneWhen: (o) => o.sharesCommitted > 0 },
    ],
  },
  {
    key: 'glance-numbers', title: 'Glanceable numbers', program: 'excel',
    brief: 'Build a live status widget from the report and the sheet — clock or weather live, MERI stock simulated.',
    steps: [
      { key: 'widget', subgoal: 'Create the status widget',
        hint: 'Try: "make a widget from the report and the sheet with the time and our stock price"',
        doneWhen: (o) => o.artifacts.some((a) => a.kind === 'widget'
          && a.fields?.some((f) => f.feed === 'stock')
          && a.fields?.some((f) => f.feed === 'clock' || f.feed === 'weather')) },
    ],
  },
  {
    key: 'fix-deck', title: 'Fix the deck', program: 'powerpoint',
    brief: 'Make the board deck lead with the lead project: the title slide should name Riverside Tower.',
    steps: [
      { key: 'retitle', subgoal: 'Title slide names Riverside Tower',
        hint: 'Point at the title slide and retitle it',
        doneWhen: (o) => {
          const ppt = o.docs.powerpoint as { slides?: string[] } | undefined;
          return !!ppt?.slides?.[0]?.includes('Riverside Tower');
        } },
    ],
  },
];
```

```ts
// src/missions/runStore.ts
// Pure run reducer (spec §3): steps complete IN ORDER — only the CURRENT step's predicate is
// consulted, so an early-satisfied later predicate waits by construction (spec §8.3).
import type { MissionDef, MissionRun, MissionObservables } from './types';

export function startMission(def: MissionDef, now: number): MissionRun {
  return { key: def.key, stepIndex: 0, startedAt: now, completedAt: null };
}

export function advanceMission(
  def: MissionDef, run: MissionRun, obs: MissionObservables, now: number,
): { run: MissionRun; stepsDone: number[]; completed: boolean } {
  if (run.completedAt !== null || run.stepIndex >= def.steps.length) {
    return { run, stepsDone: [], completed: false };
  }
  const stepsDone: number[] = [];
  let idx = run.stepIndex;
  while (idx < def.steps.length && def.steps[idx].doneWhen(obs)) {
    stepsDone.push(idx);
    idx++;
  }
  if (!stepsDone.length) return { run, stepsDone, completed: false };
  const completed = idx >= def.steps.length;
  return { run: { ...run, stepIndex: idx, completedAt: completed ? now : null }, stepsDone, completed };
}
```

```ts
// src/missions/persistence.ts
// Per-mission completed-run counts → localStorage (spec §5: fade survives sessions).
// Fail-soft parsing mirrors src/teaching/persistence.ts.
const KEY = 'ff-mission-runs';

export function parseRuns(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch { return {}; }
}
export function loadRuns(): Record<string, number> {
  try { return parseRuns(localStorage.getItem(KEY)); } catch { return {}; }
}
export function saveRuns(r: Record<string, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* fail-soft */ }
}
```

- [ ] **Step 4: GREEN** — `npx vitest run src/missions/missions.test.ts` all pass; then `npx tsc --noEmit && npm test`.
  (If the `learn-tools` in-order test fails because both steps complete at once when conditions coexist: that is the DESIGNED behavior — the while-loop advances through consecutively-satisfied steps in order. The test asserts exactly that.)

- [ ] **Step 5: Commit**

```bash
git add src/missions/
git commit -m "feat(missions): pure core — four Meridian arcs, in-order run reducer, fail-soft runs persistence"
```

---

### Task 2: Mission telemetry events

**Files:**
- Modify: `src/telemetry.ts` (TelemetryEvent union ~line 35-46; methods ~line 85-108)
- Test: `src/telemetry.test.ts` (append)

**Interfaces:**
- Produces: `telemetry.missionStart(key: string, run: number)` · `telemetry.missionStepDone(key: string, stepKey: string)` · `telemetry.missionComplete(key: string, run: number, durationMs: number, steps: number)` · `telemetry.missionAbandoned(key: string, stepIndex: number)`.

- [ ] **Step 1: Failing test** (append to `src/telemetry.test.ts`; follow its existing construction pattern for the Telemetry instance — read the top of the file first):

```ts
describe('mission telemetry (spec §7)', () => {
  it('records the four mission events with their payloads', () => {
    telemetry.start({ backend: 'gemini', autonomy: 'auto', feedback: 'earcon', program: 'word', honest: true, device: 'desktop' } as any);
    telemetry.missionStart('ship-brief', 0);
    telemetry.missionStepDone('ship-brief', 'fix-sheet');
    telemetry.missionComplete('ship-brief', 0, 102000, 3);
    telemetry.missionAbandoned('fix-deck', 0);
    const types = (telemetry as any).events.map((e: any) => e.type);
    expect(types).toContain('mission_start');
    expect(types).toContain('mission_step_done');
    expect(types).toContain('mission_complete');
    expect(types).toContain('mission_abandoned');
  });
});
```

(Adapt the instance/access idiom to the file's existing style — if `events` is private and the file's other tests use `export()`/`metrics()` instead, assert through that established accessor. Do not add a test-only accessor to production code.)

- [ ] **Step 2: RED**, then implement — union members:

```ts
  | { t: number; type: 'mission_start'; key: string; run: number }
  | { t: number; type: 'mission_step_done'; key: string; stepKey: string }
  | { t: number; type: 'mission_complete'; key: string; run: number; durationMs: number; steps: number }
  | { t: number; type: 'mission_abandoned'; key: string; stepIndex: number }
```

and methods beside the existing ones (same `this.push({...})` idiom):

```ts
  missionStart(key: string, run: number) { this.push({ type: 'mission_start', key, run }); }
  missionStepDone(key: string, stepKey: string) { this.push({ type: 'mission_step_done', key, stepKey }); }
  missionComplete(key: string, run: number, durationMs: number, steps: number) { this.push({ type: 'mission_complete', key, run, durationMs, steps }); }
  missionAbandoned(key: string, stepIndex: number) { this.push({ type: 'mission_abandoned', key, stepIndex }); }
```

- [ ] **Step 3: GREEN + gate**, **Step 4: Commit** `feat(missions): telemetry events (start/step/complete/abandoned)`.

---

### Task 3: MissionPicker panel + App wiring

**Files:**
- Create: `src/missions/MissionPicker.tsx`
- Modify: `src/shell/MenuBar.tsx` (add a Target-icon toggle beside the PenLine one, ~line 19-20)
- Modify: `src/App.tsx` (state + observables + advance effect + start/abandon/complete handlers + render)
- Modify: `docs/superpowers/specs/2026-07-17-mission-arcs-design.md` §6 first sentence (see Global Constraints amendment)

**Interfaces:**
- Consumes (Tasks 1-2 exact names): `MISSIONS`, `startMission`, `advanceMission`, `loadRuns`, `saveRuns`, `MissionRun`, `MissionObservables`; the four telemetry methods.
- Existing seams (verified): `goalDispatch({ type: 'goal.set', objective, steps: [{ label }] })` — ids are assigned `String(nextId++)` in order, so `goalState.steps[i].id` addresses step i · `goalDispatch({ type: 'goal.stepDone', id })` · `goalDispatch({ type: 'goal.clear' })` · `railDispatchRef.current({ type: 'rail.set', rail })` with `Rail { seq, cards, activeIndex, startedAt }` and answer card `{ t: 'answer', text, band: 'solid', state: 'done' }` · `emitFeedback({ outcome: 'committed', verbClass: 'create', label })` · `fullCorpus` memo · `artifactState` · `seedCorpus()` · telemetry commit sites at App.tsx:1338 (tool commits — gate on the same condition that logs `'commit'`), :1558 and :1585 (direct commits) · share commit at :1257 · teaching completion detectable in the existing TeachingLayer `onStateChange` handler in App (prior sequence `activeIndex !== null` → next `activeIndex === null` with same sequence → completed taskKey; App keeps the prior snapshot in a ref).

- [ ] **Step 1: MissionPicker component**

```tsx
// src/missions/MissionPicker.tsx
import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { MissionDef, MissionRun } from './types';

/** Floating mission panel (window family styling — see WhiteboardPanel). Picker when idle;
 *  slim strip while a run is active. Hints show ONLY on run 0 (spec §5 fade). */
export function MissionPicker({ missions, runs, active, activeDef, open, onStart, onAbandon, onClose }: {
  missions: MissionDef[];
  runs: Record<string, number>;          // completed-run counts (fade source)
  active: MissionRun | null;
  activeDef: MissionDef | null;
  open: boolean;
  onStart: (key: string) => void;
  onAbandon: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  if (active && activeDef) {
    const step = activeDef.steps[active.stepIndex];
    const fade = (runs[activeDef.key] ?? 0) > 0;
    return (
      <div className="absolute top-10 right-4 z-40 w-72 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg px-4 py-3 pointer-events-auto" role="status" aria-label="Active mission">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{activeDef.title}</span>
          <button aria-label="Abandon mission" onClick={onAbandon} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={12} /></button>
        </div>
        {step && (
          <>
            <p className="text-sm text-[var(--text-primary)] mt-1">{step.subgoal}</p>
            {!fade && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{step.hint}</p>}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="absolute top-10 right-4 z-40 w-80 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg p-3 pointer-events-auto" role="dialog" aria-label="Missions">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Missions</span>
        <button aria-label="Close missions" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={12} /></button>
      </div>
      <div className="flex flex-col gap-2">
        {missions.map((m) => (
          <div key={m.key} className="rounded-lg border border-[var(--card-border)] px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">{m.title}</span>
              {(runs[m.key] ?? 0) > 0 && <span className="text-[10px] font-mono text-[var(--text-secondary)]">×{runs[m.key]}</span>}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{m.brief}</p>
            <div className="flex justify-end mt-1.5">
              <Button size="sm" onClick={() => onStart(m.key)}>{(runs[m.key] ?? 0) > 0 ? 'Run again' : 'Start'}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: MenuBar toggle** — in `src/shell/MenuBar.tsx`, import `Target` from lucide-react, add a prop `onMissions: () => void`, and a button beside the PenLine one:

```tsx
<Tip label="Missions"><Button size="icon44" aria-label="Missions" onClick={onMissions}><Target size={16} /></Button></Tip>
```

- [ ] **Step 3: App wiring** (all in `src/App.tsx`; keep each block beside the subsystem it touches):

State + observables plumbing:

```tsx
// --- Missions (spec 2026-07-17-mission-arcs): user-side scaffolding ONLY — the agent sees
// nothing but the goal model. Observables are COMMITTED state (never model claims).
const [missionOpen, setMissionOpen] = useState(false);
const [missionRuns, setMissionRuns] = useState<Record<string, number>>(() => loadRuns());
const [missionRun, setMissionRun] = useState<MissionRun | null>(null);
const missionDef = missionRun ? MISSIONS.find((m) => m.key === missionRun.key) ?? null : null;
const missionCommitsRef = useRef<{ verbClass: string; program: ProgramId }[]>([]);
const missionSharesRef = useRef(0);
const missionTeachDoneRef = useRef<string[]>([]);
const [missionTick, setMissionTick] = useState(0);
const recordMissionCommit = (verbClass: string) => {
  missionCommitsRef.current = [...missionCommitsRef.current, { verbClass, program: activeProgramRef.current }];
  setMissionTick((n) => n + 1);
};
```

(If `activeProgramRef` does not already exist, add `const activeProgramRef = useRef(activeProgram);` + sync effect beside the other refs.)

Hook the observation points:
1. At App.tsx:1338 (`telemetry.action(fc.name, verbClass, effectiveDecision, …)`): immediately after, `if (effectiveDecision === 'commit') recordMissionCommit(verbClass);`
2. At :1558 and :1585 (direct commits): after each `telemetry.action(...)`, `recordMissionCommit(classOf(verb))` / `recordMissionCommit(classOf(p.verb))`.
3. At the share commit (:1257, the `outcome: 'committed', verbClass: 'share'` branch): `missionSharesRef.current += 1; setMissionTick((n) => n + 1);`
4. Teaching completions: in the existing TeachingLayer `onStateChange` handler App passes, detect completion (keep the previous snapshot in a ref; when `prev?.sequence && prev.sequence.activeIndex !== null && next.sequence && next.sequence.activeIndex === null`, push `prev.sequence.taskKey` into `missionTeachDoneRef.current` and `setMissionTick((n) => n + 1)`).

The advance effect (single subscription point):

```tsx
useEffect(() => {
  if (!missionRun || !missionDef || missionRun.completedAt !== null) return;
  const obs: MissionObservables = {
    docs: fullCorpus, seed: seedCorpus(),
    artifacts: artifactState.artifacts,
    commits: missionCommitsRef.current,
    sharesCommitted: missionSharesRef.current,
    teachingCompleted: missionTeachDoneRef.current,
  };
  const { run, stepsDone, completed } = advanceMission(missionDef, missionRun, obs, Date.now());
  if (!stepsDone.length) return;
  for (const i of stepsDone) {
    telemetry.missionStepDone(missionDef.key, missionDef.steps[i].key);
    const gs = goalStateRef.current.steps[i];
    if (gs && !gs.done) goalDispatch({ type: 'goal.stepDone', id: gs.id });
  }
  setMissionRun(run);
  if (completed) {
    const runN = missionRuns[missionDef.key] ?? 0;
    const durationMs = Date.now() - run.startedAt;
    telemetry.missionComplete(missionDef.key, runN, durationMs, missionDef.steps.length);
    const next = { ...missionRuns, [missionDef.key]: runN + 1 };
    setMissionRuns(next); saveRuns(next);
    emitFeedback({ outcome: 'committed', verbClass: 'create', label: `${missionDef.title} — complete` });
    const mm = Math.floor(durationMs / 60000), ss = Math.floor((durationMs % 60000) / 1000);
    railDispatchRef.current?.({ type: 'rail.set', rail: {
      seq: `mission-${missionDef.key}-${run.startedAt}`,
      cards: [{ t: 'answer', text: `${missionDef.title} complete — ${missionDef.steps.length} step${missionDef.steps.length === 1 ? '' : 's'}, ${mm}:${String(ss).padStart(2, '0')}`, band: 'solid', state: 'done' }],
      activeIndex: null, startedAt: Date.now(),
    } });
    goalDispatch({ type: 'goal.clear' });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [missionTick, fullCorpus, artifactState, missionRun, missionDef]);
```

(If `goalStateRef` does not exist, add it beside goalState like the other snapshot refs. If completion facts like a corrections count are not cheaply available, the card carries steps + duration only — do NOT invent numbers; spec §8.4.)

Start / abandon handlers + render:

```tsx
const startMissionRun = (key: string) => {
  const def = MISSIONS.find((m) => m.key === key)!;
  if (missionRun && missionRun.completedAt === null) {
    telemetry.missionAbandoned(missionRun.key, missionRun.stepIndex);
  }
  missionCommitsRef.current = []; missionSharesRef.current = 0; missionTeachDoneRef.current = [];
  if (activeProgram !== def.program) handleProgramChange(def.program);
  goalDispatch({ type: 'goal.set', objective: def.brief, steps: def.steps.map((s) => ({ label: s.subgoal })) });
  telemetry.missionStart(key, missionRuns[key] ?? 0);
  setMissionRun(startMission(def, Date.now()));
};
const abandonMission = () => {
  if (missionRun && missionRun.completedAt === null) {
    telemetry.missionAbandoned(missionRun.key, missionRun.stepIndex);
    goalDispatch({ type: 'goal.clear' });
  }
  setMissionRun(null);
};
```

Render `<MissionPicker missions={MISSIONS} runs={missionRuns} active={missionRun} activeDef={missionDef} open={missionOpen} onStart={startMissionRun} onAbandon={abandonMission} onClose={() => setMissionOpen(false)} />` inside the main plane (beside the goal chip block), and pass `onMissions={() => setMissionOpen((v) => !v)}` to MenuBar. Also: when the user clears the goal chip (`goal.clear` from the chip's × at the goal-chip render site), an active mission is abandoned — route the chip's onClick through `abandonMission()` when `missionRun` is active.

- [ ] **Step 4: Spec truth edit** — in `docs/superpowers/specs/2026-07-17-mission-arcs-design.md` §6, replace "the task-carousel surface swaps content — mission cards" with "a floating Missions panel (MenuBar Target toggle; the audit-era carousel was already deleted in A1) lists mission cards".

- [ ] **Step 5: Gate** — `npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/missions/ src/shell/MenuBar.tsx src/App.tsx docs/superpowers/specs/2026-07-17-mission-arcs-design.md
git commit -m "feat(missions): picker panel + App wiring — goal-model-only channel, deterministic advance, quiet completion"
```

---

### Task 4: Verification drives (no code)

- [ ] **Step 1: Full gate** — `npx tsc --noEmit && npm test && npm run build`.
- [ ] **Step 2: No-key browser drive** (`npx vite --port 3001 --strictPort`; port 3000 is another project):
  - Open the Missions panel via the MenuBar Target button; all four cards show briefs, no `Say "` phrasing anywhere.
  - Start **fix-deck**: program switches to PowerPoint, goal chip shows the objective + 0/1, panel strip shows the subgoal + hint. Retitle the title slide by direct manipulation to include "Riverside Tower" → step completes, goal chip clears, create earcon card "Fix the deck — complete" appears as a rail answer card. `ff-mission-runs` in localStorage now has `fix-deck: 1`.
  - Start fix-deck AGAIN: the panel strip now shows the subgoal WITHOUT the hint (fade), and the picker showed "Run again ×1".
  - Start **ship-brief** then abandon via the strip's × → goal clears, telemetry shows `mission_abandoned` (Export session JSON from the drawer to check).
- [ ] **Step 3: Report** — screenshots + findings; live **ship-brief** by voice stays on the owed human-smoke list (spec §9).

---

## Self-review notes

- **Spec coverage:** §2 agent-blindness → no new hints anywhere (Task 3 wiring only touches goal model); §3 model/reducer → Task 1; §4 arcs → Task 1 defs (predicates match the Meridian seeds verified in-repo); §5 fade → persistence (Task 1) + picker fade (Task 3); §6 surfaces → Task 3 (+ spec amendment for the deleted carousel); §7 telemetry → Task 2 + Task 3 call sites; §8 invariants → Global Constraints + in-order reducer test; §9 testing → Tasks 1/4 (+ owed live smoke); §10 out of scope respected.
- **Type consistency:** `MissionObservables`/`MissionRun`/`advanceMission` signatures identical across Tasks 1 and 3; telemetry method names identical across Tasks 2 and 3.
- **Known judgment areas (not hidden):** Task 3's goal-chip-clear → abandon routing depends on the chip's current onClick shape; the implementer adapts mechanically. Telemetry test idiom must follow the existing file's access pattern. `learn-tools` step 2 counts any word file-class commit (export/save both qualify) — deliberate looseness, the arc's teaching step is the measured one.
