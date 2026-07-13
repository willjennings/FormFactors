// Model-facing whiteboard tools + a pure mapper. Fail-soft on bad coords; missing required fields
// fail the call. Connectors are NOT key-checked here (unresolved keys render nothing — the model
// learns live node keys from the [WHITEBOARD] hint).
import type { VoiceTool } from '../voice/types';
import type { WbEvent, WbShape } from './types';

export const WB_TOOLS: VoiceTool[] = [
  { name: 'wb_node',
    description: 'Draw a labeled diagram node (box or ellipse) on the whiteboard at (x,y) in 0-1000 space. key = a short id you reuse to connect it. Compose diagrams by placing nodes then connecting them.',
    parameters: { type: 'object', properties: {
      key: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      text: { type: 'string' }, shape: { type: 'string', enum: ['box', 'ellipse'] } }, required: ['key', 'x', 'y', 'text'] } },
  { name: 'wb_connect',
    description: 'Draw an arrow between two whiteboard nodes by their keys, with an optional short label.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'wb_label',
    description: 'Place free caption text on the whiteboard at (x,y) in 0-1000 space.',
    parameters: { type: 'object', properties: {
      x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' } }, required: ['x', 'y', 'text'] } },
  { name: 'wb_clear',
    description: 'Clear the whiteboard.',
    parameters: { type: 'object', properties: {}, required: [] } },
];

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : NaN; };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function wbCallToEvent(call: { name: string; args: any }): WbEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'wb_node': {
      const key = str(a.key).trim(); const text = str(a.text).trim();
      const x = num(a.x), y = num(a.y);
      if (!key) return { error: 'wb_node needs a key.' };
      if (!text) return { error: 'wb_node needs text.' };
      if (Number.isNaN(x) || Number.isNaN(y)) return { error: 'wb_node needs numeric x,y.' };
      const shape: WbShape = a.shape === 'ellipse' ? 'ellipse' : 'box';
      return { type: 'wb.add', spec: { kind: 'node', key, x, y, text, shape } };
    }
    case 'wb_connect': {
      const from = str(a.from).trim(), to = str(a.to).trim();
      if (!from || !to) return { error: 'wb_connect needs from and to node keys.' };
      return { type: 'wb.add', spec: { kind: 'connector', from, to, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'wb_label': {
      const text = str(a.text).trim(); const x = num(a.x), y = num(a.y);
      if (!text) return { error: 'wb_label needs text.' };
      if (Number.isNaN(x) || Number.isNaN(y)) return { error: 'wb_label needs numeric x,y.' };
      return { type: 'wb.add', spec: { kind: 'label', x, y, text } };
    }
    case 'wb_clear': return { type: 'wb.clear' };
    default: return { error: `Unknown whiteboard tool "${call.name}".` };
  }
}
