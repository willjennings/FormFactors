import type { MockDoc, ProgramId } from '../scenarios';

/** Read-only observation of COMMITTED state (spec §8.2: never model claims). */
export interface MissionObservables {
  docs: Partial<Record<ProgramId, MockDoc>>;
  // World snapshot taken at run start (final review I2) — predicates diff against THIS, not the
  // pristine seed or the live corpus, so a re-run (or prior free play) that already satisfies a
  // predicate does not auto-complete. `docs` mirrors the full corpus at start (incl. the live
  // active doc); `artifactIds` are the artifact ids that already existed before this run.
  baseline: { docs: Partial<Record<ProgramId, MockDoc>>; artifactIds: string[] };
  artifacts: { id: string; kind: string; sources: string[]; fields?: { feed?: string }[] }[];
  commits: { verb: string; verbClass: string; program: ProgramId }[];
  sharesCommitted: number;
  // Completed teach sequences this run, tagged with the program active when completion was
  // detected (final review I4 — taskKeys are model-authored and untrusted; program is not).
  teachingCompleted: { taskKey: string; program: ProgramId }[];
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
