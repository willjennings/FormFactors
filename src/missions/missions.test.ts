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
    let r = advanceMission(def, run, { ...base(), commits: [{ verb: 'save_file', verbClass: 'mutate', program: 'word' }] }, 1001);
    expect(r.run.stepIndex).toBe(0);
    expect(r.stepsDone).toEqual([]);
    // Teach sequence completes → step 0 done; the earlier file commit is STILL visible in obs,
    // so step 1 completes in the same advance (both conditions now hold, order preserved):
    r = advanceMission(def, r.run, { ...base(), commits: [{ verb: 'save_file', verbClass: 'mutate', program: 'word' }], teachingCompleted: ['word.save'] }, 1002);
    expect(r.stepsDone).toEqual([0, 1]);
    expect(r.completed).toBe(true);
    expect(r.run.completedAt).toBe(1002);
  });
  it('learn-tools: teach completion alone lands on step 1, not completed', () => {
    const def = byKey('learn-tools');
    const run = startMission(def, 0);
    const r = advanceMission(def, run, { ...base(), teachingCompleted: ['word.save'] }, 1);
    expect(r.run.stepIndex).toBe(1);
    expect(r.stepsDone).toEqual([0]);
    expect(r.completed).toBe(false);
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
  it('ship-brief: unmodified seed docs do not advance step 0', () => {
    const def = byKey('ship-brief');
    const run = startMission(def, 0);
    const r = advanceMission(def, run, base(), 1);
    expect(r.run.stepIndex).toBe(0);
    expect(r.stepsDone).toEqual([]);
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
  it('glance-numbers: right feeds but wrong sources does NOT complete (spec §4.3: built FROM word+excel)', () => {
    const def = byKey('glance-numbers');
    const run = startMission(def, 0);
    const r = advanceMission(def, run, { ...base(), artifacts: [{ kind: 'widget', sources: ['powerpoint', 'photo'], fields: [{ feed: 'stock' }, { feed: 'clock' }] }] }, 1);
    expect(r.completed).toBe(false);
    expect(r.run.stepIndex).toBe(0);
  });
  it('fix-deck: CURRENT (last) slide must name the lead project (seed last slide does not)', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    // Seed deck's last slide is 'Outlook: Harbor Bridge…' — must NOT complete
    // (even though seed slide 2 already contains 'Riverside Tower'; the check is last-slide only):
    expect(advanceMission(def, run, base(), 1).completed).toBe(false);
    const seedSlides = (seed.powerpoint as any).slides as string[];
    const retitled = { ...seed.powerpoint, slides: [...seedSlides.slice(0, -1), 'Riverside Tower — closing summary'] } as any;
    const r = advanceMission(def, run, { ...base(), docs: { ...seed, powerpoint: retitled } }, 2);
    expect(r.completed).toBe(true);
  });
  it('fix-deck: first slide naming Riverside Tower with last slide unchanged does NOT complete', () => {
    const def = byKey('fix-deck');
    const run = startMission(def, 0);
    const seedSlides = (seed.powerpoint as any).slides as string[];
    const firstRetitled = { ...seed.powerpoint, slides: ['Riverside Tower — Q3 2026 board review', ...seedSlides.slice(1)] } as any;
    const r = advanceMission(def, run, { ...base(), docs: { ...seed, powerpoint: firstRetitled } }, 1);
    expect(r.completed).toBe(false);
    expect(r.run.stepIndex).toBe(0);
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
