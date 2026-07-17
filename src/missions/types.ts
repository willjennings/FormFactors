import type { MockDoc, ProgramId } from '../scenarios';

/** Read-only observation of COMMITTED state (spec §8.2: never model claims). */
export interface MissionObservables {
  docs: Partial<Record<ProgramId, MockDoc>>;
  seed: Record<ProgramId, MockDoc>;
  artifacts: { kind: string; sources: string[]; fields?: { feed?: string }[] }[];
  commits: { verb: string; verbClass: string; program: ProgramId }[];
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
