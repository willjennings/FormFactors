// refine_artifact: change an EXISTING artifact in place (spec §7). Mirrors combineTools' shape —
// pure validation, errors-as-data, every remedy DERIVED from the same functions the resolver
// uses. Flat args only: nested object-arrays were the d24abef Gemini schema hazard.
import type { VoiceTool } from '../voice/types';
import type { Artifact, ArtifactState, ArtifactEvent, ArtifactPatch } from './types';
import { artifactParts, applyPatch } from './parts';

const OPS = ['replace-part', 'add-part', 'remove-part', 'retitle'] as const;

export const REFINE_TOOL: VoiceTool = {
  name: 'refine_artifact',
  description: 'Change an EXISTING artifact in place instead of creating a new one — rewrite a paragraph or field, add one, remove one, or retitle. Read the artifact\'s current "rev N" from [ARTIFACTS] and pass it as baseRev; address parts by their 1-based index (paragraph 2 = index 2). If the call is refused as stale, re-read [ARTIFACTS] and re-issue against the current revision. Revisions are reversible and do NOT count against the artifact cap.',
  parameters: { type: 'object', properties: {
    artifactId: { type: 'string', description: 'The artifact id from [ARTIFACTS], e.g. "a1".' },
    baseRev: { type: 'number', description: 'The rev N you read from [ARTIFACTS] for this artifact.' },
    op: { type: 'string', enum: [...OPS], description: 'What to do.' },
    index: { type: 'number', description: '1-based part index. For add-part, the position the new part will occupy; omit to append.' },
    text: { type: 'string', description: 'The new paragraph text, or a widget field value.' },
    label: { type: 'string', description: 'Widget fields only: the field label.' },
    title: { type: 'string', description: 'op=retitle: the new title.' },
    note: { type: 'string', description: 'Short reason, e.g. "tightened intro" — shown in the revision history.' },
  }, required: ['artifactId', 'baseRev', 'op'] },
};

/** The part ids that would actually resolve right now. Every "valid parts" message must be
 *  derived from THIS — naming a part that would fail is a lie to the model (combine C1). */
export function validPartIds(a: Artifact): string[] {
  return artifactParts(a).map((p) => p.id);
}

function partNoun(a: Artifact): string { return a.kind === 'widget' ? 'field' : 'paragraph'; }

/** The before/after the witness card renders — pure, so the card and the tests agree. */
export function describePatch(a: Artifact, p: ArtifactPatch): { partLabel: string; before: string; after: string } {
  if (p.op === 'retitle') return { partLabel: 'title', before: a.title, after: p.title.trim() };
  const parts = artifactParts(a);
  const noun = partNoun(a);
  if (p.op === 'add-part') {
    const at = p.index ?? parts.length + 1;
    return { partLabel: `${noun} ${at}`, before: '', after: (p.text ?? '').trim() };
  }
  const current = parts[p.index - 1];
  if (p.op === 'remove-part') return { partLabel: `${noun} ${p.index}`, before: current?.text ?? '', after: '' };
  // replace-part: `text` changes the part's VALUE, `label` changes a widget field's LABEL — two
  // different fields on the artifact. Reading "after" from `text` but falling back to the OLD
  // `label` when only the label changes (the pre-fix bug, final review C1) describes a label
  // rename as if nothing but the value moved, and shows the value's OLD content as "before" a
  // label change too — both sides false. Render each field from itself.
  const hasText = p.text !== undefined;
  const hasLabel = p.label !== undefined;
  if (hasText && hasLabel) {
    // A patch touching both in one call has no single string true of only one side, so render
    // the pair that IS true of the whole patch: "label: value" on both before and after.
    const before = `${current?.label ?? ''}: ${current?.text ?? ''}`;
    const after = `${p.label}: ${p.text}`.trim();
    return { partLabel: `${noun} ${p.index}`, before, after };
  }
  if (hasLabel) return { partLabel: `${noun} ${p.index}`, before: current?.label ?? '', after: (p.label ?? '').trim() };
  return { partLabel: `${noun} ${p.index}`, before: current?.text ?? '', after: (p.text ?? '').trim() };
}

export function validateRefineCall(
  args: any, state: ArtifactState, now: number,
): { event: ArtifactEvent } | { error: string } {
  const id = String(args?.artifactId ?? '');
  const a = state.artifacts.find((x) => x.id === id);
  if (!a) {
    const live = state.artifacts.map((x) => x.id);
    return { error: live.length
      ? `Unknown artifact "${id}". Live artifacts: ${live.join(', ')}.`
      : `Unknown artifact "${id}" — there are no artifacts on the desk. Use combine to create one first.` };
  }

  // Staleness layer 1 of 3 (tool time). Layer 2 is the confirm-time guard in App; layer 3 is
  // the reducer's own baseRev check, which counts what slips past both.
  const baseRev = Number(args?.baseRev);
  if (!Number.isFinite(baseRev)) {
    return { error: `refine_artifact needs baseRev — ${a.id} is at rev ${a.rev}. Read it from [ARTIFACTS] and pass it back.` };
  }
  if (baseRev !== a.rev) {
    return { error: `${a.id} is at rev ${a.rev}, you addressed rev ${baseRev} — re-read [ARTIFACTS] and re-issue against the current revision.` };
  }

  const op = String(args?.op ?? '');
  if (!(OPS as readonly string[]).includes(op)) {
    return { error: `Unknown op "${op}". Valid ops: ${OPS.join(', ')}.` };
  }

  const parts = artifactParts(a);
  const noun = partNoun(a);
  const rawIndex = args?.index;
  const hasIndex = rawIndex !== undefined && rawIndex !== null;
  const index = Number(rawIndex);

  let patch: ArtifactPatch;
  if (op === 'retitle') {
    const title = String(args?.title ?? '').trim();
    if (!title) return { error: 'refine_artifact op "retitle" needs a non-empty title.' };
    if (title === a.title) return { error: `${a.id} is already titled "${a.title}".` };
    patch = { op: 'retitle', title };
  } else if (op === 'add-part') {
    const text = String(args?.text ?? '').trim();
    if (!text) return { error: `refine_artifact op "add-part" needs text for the new ${noun}.` };
    if (hasIndex && (!Number.isInteger(index) || index < 1 || index > parts.length + 1)) {
      return { error: `index ${rawIndex} is out of range — ${a.id} has ${parts.length} ${noun}s, so add-part takes 1..${parts.length + 1} (or omit index to append).` };
    }
    if (a.kind === 'widget' && !String(args?.label ?? '').trim()) {
      return { error: 'a new widget field needs a label — an unlabeled field cannot be named or pointed at.' };
    }
    patch = { op: 'add-part', ...(hasIndex ? { index } : {}), text,
              ...(a.kind === 'widget' ? { label: String(args.label).trim() } : {}) };
  } else {
    if (!hasIndex || !Number.isInteger(index) || index < 1 || index > parts.length) {
      return { error: `index ${hasIndex ? rawIndex : '(missing)'} is not a ${noun} of ${a.id}. Valid parts: ${validPartIds(a).join(', ')}.` };
    }
    if (op === 'remove-part') {
      if (parts.length === 1) {
        return { error: `that would leave ${a.id} with no content. Refine the ${noun} instead, or ask the user to close the artifact.` };
      }
      patch = { op: 'remove-part', index };
    } else {
      const text = args?.text === undefined ? undefined : String(args.text).trim();
      const label = args?.label === undefined ? undefined : String(args.label).trim();
      if (text === undefined && label === undefined) {
        return { error: `refine_artifact op "replace-part" needs text${a.kind === 'widget' ? ' or label' : ''}.` };
      }
      if (a.kind === 'doc' && label !== undefined) {
        return { error: 'a doc has no field labels — use text to rewrite the paragraph, or op "retitle" for the artifact title.' };
      }
      // These two must be caught HERE, before applyPatch: applyPatch's own empty-after-trim
      // guards (parts.ts) return null indistinguishably from a genuine no-op, and an empty
      // string is never equal to existing non-empty content — so without this check the
      // fallback message below would lie, claiming the part "already reads" empty text.
      if (text !== undefined && !text) {
        return { error: `refine_artifact op "replace-part" needs non-empty text — to clear ${a.id} ${noun} ${index} entirely, use op "remove-part" instead.` };
      }
      if (label !== undefined && !label) {
        return { error: `refine_artifact op "replace-part" needs a non-empty label to name ${a.id} ${noun} ${index} — an empty label cannot be pointed at.` };
      }
      const field = a.kind === 'widget' ? a.fields?.[index - 1] : undefined;
      if (text !== undefined && field?.feed) {
        // The chips say LIVE/SIMULATED. Authoring that value would launder authored text as
        // fetched data — the one thing the feed provenance surface exists to prevent.
        return { error: `field ${index} "${field.label}" is bound to the ${field.feed} feed — its value is live and cannot be authored. You can rename it with label, or remove it.` };
      }
      patch = { op: 'replace-part', index, text, label };
    }
  }

  // applyPatch is the final authority AND the no-op detector: every specific rule has its own
  // message above, so a null here means "the artifact already reads exactly that".
  if (!applyPatch(a, patch)) {
    const { partLabel } = describePatch(a, patch);
    return { error: `${a.id} ${partLabel} already reads exactly that — nothing to change.` };
  }

  const note = args?.note === undefined ? undefined : String(args.note).trim() || undefined;
  return { event: { type: 'artifact.revise', id: a.id, baseRev, patch, owner: 'agent', at: now, note } };
}
