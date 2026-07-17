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
