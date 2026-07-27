// Synthesized artifacts: what the agent makes from N sources. Artifacts are MATERIAL — they
// carry a revision number and an append-only history, and both the agent (via refine_artifact,
// dial-gated) and the user (directly) can change them. `artifact.close` and `artifact.revertTo`
// stay USER-ONLY: no tool maps to either. The agent can only propose forward.
export type FeedId = 'clock' | 'weather' | 'stock';

export interface WidgetField { label: string; value?: string; feed?: FeedId }

/** Who made a revision and why. `at` arrives on the event — reducers never read the clock,
 *  because the session journal (S5) replays them and a clock read breaks determinism. */
export interface RevisionMeta { rev: number; at: number; owner: 'agent' | 'user'; note?: string }

/** A snapshot of one PRIOR version, with the meta of the revision that produced it. */
export interface ArtifactVersion {
  rev: number; title: string; content?: string; fields?: WidgetField[]; meta: RevisionMeta;
}

export interface Artifact {
  id: string;                       // 'a1', 'a2', … deterministic
  kind: 'doc' | 'widget';
  title: string;
  sources: string[];                // program ids and/or artifact ids — the provenance line
  content?: string;                 // kind 'doc'
  fields?: WidgetField[];           // kind 'widget'
  createdAt: number;
  rev: number;                      // creation = 1
  meta: RevisionMeta;               // how THIS revision came to be
  history: ArtifactVersion[];       // prior versions only, append-only, oldest first
}

/** The one patch vocabulary, shared by the reducer, the tool validator, and the witness card.
 *  Indices are 1-BASED. For `add-part`, `index` is the position the new part will OCCUPY
 *  (later parts shift down); omitting it appends. `label` is widget-fields-only. */
export type ArtifactPatch =
  | { op: 'replace-part'; index: number; text?: string; label?: string }
  | { op: 'add-part'; index?: number; text: string; label?: string }
  | { op: 'remove-part'; index: number }
  | { op: 'retitle'; title: string };

export type ArtifactEvent =
  | { type: 'artifact.create'; artifact: Omit<Artifact, 'id' | 'rev' | 'meta' | 'history'> }
  | { type: 'artifact.close'; id: string }                                        // user-only
  | { type: 'artifact.revise'; id: string; baseRev: number; patch: ArtifactPatch;
      owner: 'agent' | 'user'; at: number; note?: string }
  | { type: 'artifact.revertTo'; id: string; toRev: number; at: number }          // user-only
  // JOURNAL-ONLY (spec §7): emitted solely by journal compaction to reconstruct state in one
  // step. No tool maps to it and no UI dispatches it — same discipline as artifact.close.
  | { type: 'artifact.restore'; state: ArtifactState }

export interface ArtifactState {
  artifacts: Artifact[];
  nextId: number;
  rejectedAtCap: number;
  rejectedStale: number;
}
