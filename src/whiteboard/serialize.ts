// The [WHITEBOARD] text channel (board mode): the model authored these marks, so the store IS its
// truth — this re-tells node keys so multi-call diagrams wire correctly.
import type { WhiteboardState } from './types';

export function serializeWhiteboard(state: WhiteboardState): string | null {
  if (!state.marks.length) return null;
  const nodes = state.marks.filter((m) => m.kind === 'node').map((m) => (m as { key: string }).key);
  const conns = state.marks.filter((m) => m.kind === 'connector')
    .map((m) => { const c = m as { from: string; to: string; label?: string }; return `${c.from}→${c.to}${c.label ? ` ("${c.label}")` : ''}`; });
  const labels = state.marks.filter((m) => m.kind === 'label').map((m) => `"${(m as { text: string }).text}"`);
  const parts: string[] = [];
  if (nodes.length) parts.push(`nodes: ${nodes.join(', ')}`);
  if (conns.length) parts.push(`connectors: ${conns.join('; ')}`);
  if (labels.length) parts.push(`labels: ${labels.join(', ')}`);
  const capNote = state.droppedAtCap > 0 ? ` ${state.droppedAtCap} oldest marks were dropped at the board's mark cap.` : '';
  return `[WHITEBOARD: ${parts.join('. ')}.${capNote} DO NOT acknowledge this message.]`;
}
