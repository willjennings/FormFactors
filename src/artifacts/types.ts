// Synthesized artifacts: what the agent makes from N sources. The agent's tool surface is
// CREATE-ONLY (spec §7) — artifact.close exists for the USER's × button, and no tool maps to it.
export type FeedId = 'clock' | 'weather' | 'stock';

export interface WidgetField { label: string; value?: string; feed?: FeedId }

export interface Artifact {
  id: string;                       // 'a1', 'a2', … deterministic
  kind: 'doc' | 'widget';
  title: string;
  sources: string[];                // program ids and/or artifact ids — the provenance line
  content?: string;                 // kind 'doc'
  fields?: WidgetField[];           // kind 'widget'
  createdAt: number;
}

export type ArtifactEvent =
  | { type: 'artifact.create'; artifact: Omit<Artifact, 'id'> }
  | { type: 'artifact.close'; id: string };  // user-only

export interface ArtifactState { artifacts: Artifact[]; nextId: number; rejectedAtCap: number }
