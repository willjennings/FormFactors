// combine + read_sources: the combinatory grammar (spec §4-§5). Create-only; validation is
// all-or-error; capacity checks by SIMULATION through the real reducer (spec §7).
import type { VoiceTool } from '../voice/types';
import type { MockDoc, ProgramId } from '../scenarios';
import { serializeMockDoc } from '../scenarios';
import type { Artifact, ArtifactState, ArtifactEvent, FeedId, WidgetField } from './types';
import { reduce as artifactReduce, MAX_ARTIFACTS } from './artifactStore';
import { FEEDS } from './feeds';

export const COMBINE_TOOL: VoiceTool = {
  name: 'combine',
  description: 'Create a NEW artifact by combining two or more sources (program docs by id: word/excel/powerpoint/photo, or artifact ids from [ARTIFACTS]). You author the synthesized content — read the sources first with read_sources. The new artifact appears as a window showing its provenance.',
  parameters: { type: 'object', properties: {
    sources: { type: 'array', items: { type: 'string' }, description: 'Two or more source ids.' },
    kind: { type: 'string', enum: ['doc', 'widget'] },
    title: { type: 'string', description: 'Short title for the new artifact.' },
    content: { type: 'string', description: 'kind=doc: your synthesized text.' },
    fields: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string' }, value: { type: 'string' },
      feed: { type: 'string', enum: ['clock', 'weather', 'stock'] } }, required: ['label'] },
      description: 'kind=widget: labeled fields; bind live data with feed.' },
  }, required: ['sources', 'kind', 'title'] },
};

export const READ_SOURCES_TOOL: VoiceTool = {
  name: 'read_sources',
  description: 'Request the FULL content of named sources before combining — the standing [CORPUS] hint carries only gists. Responds via a [CORPUS DETAIL] update.',
  parameters: { type: 'object', properties: {
    sources: { type: 'array', items: { type: 'string' } } }, required: ['sources'] },
};

const PROGRAM_IDS: ProgramId[] = ['word', 'excel', 'powerpoint', 'photo'];

export function resolveSources(
  sources: string[], corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState,
): string[] | { error: string } {
  const validPrograms = PROGRAM_IDS.filter((p) => corpus[p]);
  const validArtifacts = artifacts.artifacts.map((a) => a.id);
  const valid = new Set<string>([...validPrograms, ...validArtifacts]);
  const unknown = sources.filter((s) => !valid.has(s));
  if (unknown.length) {
    return { error: `Unknown source(s): ${unknown.join(', ')}. Valid sources: ${[...valid].join(', ')}.` };
  }
  return sources;
}

export function sourceDetail(
  id: string, corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState,
): string | null {
  const art = artifacts.artifacts.find((a) => a.id === id);
  if (art) return `${art.id} "${art.title}" (${art.kind}, from: ${art.sources.join(' + ')}): ${art.content ?? art.fields?.map((f) => `${f.label}: ${f.value ?? f.feed}`).join('; ') ?? ''}`;
  const doc = corpus[id as ProgramId];
  if (!doc) return null;
  return `${id}: ${serializeMockDoc(doc)}`; // photo → its caption line, never pixels
}

export function validateCombineCall(
  args: any, corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState, now: number,
): { event: ArtifactEvent; provenance: string } | { error: string } {
  const sources: string[] = Array.isArray(args?.sources) ? [...new Set<string>(args.sources.map(String))] : [];
  if (sources.length < 2) return { error: 'combine needs at least 2 sources — for a single target use the ordinary editing/creation verbs instead.' };
  const resolved = resolveSources(sources, corpus, artifacts);
  if ('error' in (resolved as any)) return resolved as { error: string };
  const kind = args?.kind === 'widget' ? 'widget' : 'doc';
  const title = String(args?.title ?? '').trim();
  if (!title) return { error: 'combine needs a non-empty title.' };

  let artifact: Omit<Artifact, 'id'>;
  if (kind === 'widget') {
    const fields = validateWidgetFields(args?.fields);
    if ('error' in fields) return fields;
    artifact = { kind, title, sources, fields: fields.fields, createdAt: now };
  } else {
    const content = String(args?.content ?? '').trim();
    if (!content) return { error: 'combine kind "doc" needs non-empty content — author the synthesis yourself from what read_sources returned.' };
    artifact = { kind, title, sources, content, createdAt: now };
  }

  const event: ArtifactEvent = { type: 'artifact.create', artifact };
  // Capacity by SIMULATION through the real reducer (spec §7).
  const simulated = artifactReduce(artifacts, event);
  if (simulated.rejectedAtCap > artifacts.rejectedAtCap) {
    return { error: `The desk already holds ${MAX_ARTIFACTS} artifacts — ask the user to close one first. Nothing may be evicted without their say.` };
  }
  return { event, provenance: `from: ${sources.join(' + ')}` };
}

// Widget field validation (spec §8): ≥1 field, non-empty labels, every bound `feed` id must be
// in the fixed registry (an unknown id fails naming the valid ones — spec §9).
function validateWidgetFields(raw: unknown): { fields: WidgetField[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'combine kind "widget" needs at least one field.' };
  }
  const fields: WidgetField[] = [];
  for (const entry of raw) {
    const label = String((entry as { label?: unknown })?.label ?? '').trim();
    if (!label) return { error: 'combine kind "widget" fields need a non-empty label.' };
    const rawFeed = (entry as { feed?: unknown })?.feed;
    if (rawFeed !== undefined && rawFeed !== null && rawFeed !== '') {
      const feedId = String(rawFeed);
      if (!(feedId in FEEDS)) {
        return { error: `Unknown feed "${feedId}". Valid feeds: ${Object.keys(FEEDS).join(', ')}.` };
      }
      fields.push({ label, feed: feedId as FeedId });
      continue;
    }
    const value = String((entry as { value?: unknown })?.value ?? '').trim();
    if (!value) return { error: `combine kind "widget" field "${label}" needs a value or a feed.` };
    fields.push({ label, value });
  }
  return { fields };
}
