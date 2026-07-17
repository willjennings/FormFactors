import type { EntityId } from '../entities/registry';

export type TeachPosture = 'guide' | 'teach';
export type FadeLevel = 0 | 1 | 2;
export type StepState = 'pending' | 'active' | 'done' | 'skipped';

export interface TeachStep {
  entityId: EntityId;
  subgoal: string;
  instruction: string;
  state: StepState;
}

export interface TeachSequence {
  title: string;
  taskKey: string;
  posture: TeachPosture;
  steps: TeachStep[];
  activeIndex: number | null;
  softBlock: boolean;
  paused: boolean;
  blockedAttempts: number;
  lastBlocked?: { entityId: EntityId; at: number };
}

export interface TeachHighlight { entityId: EntityId; note?: string; at: number }
export interface TeachRelation { from: EntityId; to: EntityId; label: string }

export interface TeachingState {
  posture: TeachPosture;
  sequence: TeachSequence | null;
  highlights: TeachHighlight[];
  relations: TeachRelation[];
  competence: Record<string, number>;
  revealRequested: boolean;
}

export type TeachingEvent =
  | { type: 'teach.highlight'; entityId: EntityId; note?: string }
  | { type: 'teach.sequence'; title: string; taskKey: string; posture: TeachPosture;
      steps: { entityId: EntityId; subgoal: string; instruction: string }[] }
  | { type: 'teach.stepAdvance' }
  | { type: 'teach.relate'; relations: TeachRelation[] }
  | { type: 'teach.clear' }
  | { type: 'user.stepAction'; entityId: EntityId }
  | { type: 'user.reveal' }
  | { type: 'user.pause' } | { type: 'user.resume' } | { type: 'user.dismiss' };
