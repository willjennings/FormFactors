// The one bridge across the ownership boundary (spec §7): the model proposes, the app
// validates (errors-as-data, nothing partial), the USER confirms on a witness card.
import type { VoiceTool } from '../voice/types';
import type { WbEvent, WhiteboardState } from '../whiteboard/types';
import { wbCallToEvent } from '../whiteboard/tools';
import { reduce as wbReduce, MAX_MARKS } from '../whiteboard/store';
import type { SketchState } from './types';

export const BEAUTIFY_TOOL: VoiceTool = {
  name: 'wb_beautify',
  description: 'Offer to replace some of the USER\'s sketched strokes (ids from [SKETCH]) with your structured whiteboard marks. The user sees a confirmation card first — nothing is replaced without their yes.',
  parameters: {
    type: 'object',
    properties: {
      strokeIds: { type: 'array', items: { type: 'string' }, description: 'The stroke ids to replace, from [SKETCH].' },
      marks: { type: 'array', items: { type: 'object', properties: {
        kind: { type: 'string', enum: ['node', 'connector', 'label'] },
        key: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
        text: { type: 'string' }, shape: { type: 'string', enum: ['box', 'ellipse'] },
        from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' },
      }, required: ['kind'] }, description: 'The structured marks to draw instead.' },
    },
    required: ['strokeIds', 'marks'],
  },
};

const KIND_TO_TOOL: Record<string, string> = { node: 'wb_node', connector: 'wb_connect', label: 'wb_label' };

export function validateBeautifyCall(
  args: any, sketch: SketchState, whiteboard: WhiteboardState,
): { removeIds: string[]; events: WbEvent[]; summary: string } | { error: string } {
  // Duplicate ids/keys must not inflate the confirmation's numbers (probe 2026-07-16):
  // the card's counts describe what will ACTUALLY happen, or the witness gate is theater.
  const strokeIds: string[] = Array.isArray(args?.strokeIds) ? [...new Set<string>(args.strokeIds.map(String))] : [];
  const marks: any[] = Array.isArray(args?.marks) ? args.marks : [];
  if (!strokeIds.length || !marks.length) return { error: 'wb_beautify needs both strokeIds (from [SKETCH]) and marks.' };
  const live = new Set(sketch.strokes.map((s) => s.id));
  const stale = strokeIds.filter((id) => !live.has(id));
  if (stale.length) {
    return { error: `Unknown stroke id(s): ${stale.join(', ')}. Live stroke ids: ${sketch.strokes.map((s) => s.id).join(', ') || 'none'}.` };
  }
  const events: WbEvent[] = [];
  for (const m of marks) {
    const tool = KIND_TO_TOOL[m?.kind];
    if (!tool) return { error: `Unknown mark kind "${m?.kind}" — use node, connector, or label.` };
    const mapped = wbCallToEvent({ name: tool, args: m });
    if ('error' in mapped) return { error: mapped.error };
    events.push(mapped);
  }
  // Capacity check by SIMULATION through the real reducer (probe 2026-07-16: a valid proposal
  // could push the board past MAX_MARKS and silently evict pre-existing marks the user never
  // confirmed losing — a witnessed swap must never change more than the card names).
  const simulated = events.reduce((st, ev) => wbReduce(st, ev), whiteboard);
  const evicted = simulated.droppedAtCap - whiteboard.droppedAtCap;
  if (evicted > 0) {
    return { error: `The proposal exceeds the board's ${MAX_MARKS}-mark capacity — applying it would evict ${evicted} existing mark${evicted > 1 ? 's' : ''} the user has not agreed to lose. Propose fewer marks or ask the user to clear the board first.` };
  }
  // Counts from the simulation delta, so replace-by-key duplicates aren't double-counted.
  const counts: Record<string, number> = {};
  for (const m of simulated.marks.slice(whiteboard.marks.length)) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  const replacedInPlace = whiteboard.marks.filter((m, i) => simulated.marks[i] !== m && simulated.marks[i]?.kind === 'node').length;
  if (replacedInPlace > 0) counts['node'] = (counts['node'] ?? 0) + replacedInPlace;
  const what = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' + ') || 'nothing new';
  return { removeIds: strokeIds, events, summary: `Replace ${strokeIds.length} stroke${strokeIds.length > 1 ? 's' : ''} with ${what}?` };
}
