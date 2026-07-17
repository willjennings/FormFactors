// A scripted whiteboard illustration (no key needed) for ?whiteboard=1: three nodes wired into a
// tiny flow, a caption, then clear. Pure — timing offsets in ms.
import type { WbEvent } from './types';

export function buildWhiteboardDemo(): { at: number; event: WbEvent }[] {
  return [
    { at: 600,  event: { type: 'wb.add', spec: { kind: 'node', key: 'in', x: 250, y: 300, text: 'You point', shape: 'box' } } },
    { at: 1200, event: { type: 'wb.add', spec: { kind: 'node', key: 'model', x: 500, y: 300, text: 'Agent grounds', shape: 'box' } } },
    { at: 1800, event: { type: 'wb.add', spec: { kind: 'node', key: 'act', x: 750, y: 300, text: 'Witnessed action', shape: 'box' } } },
    { at: 2400, event: { type: 'wb.add', spec: { kind: 'connector', from: 'in', to: 'model', label: 'this' } } },
    { at: 3000, event: { type: 'wb.add', spec: { kind: 'connector', from: 'model', to: 'act', label: 'confirm' } } },
    { at: 3600, event: { type: 'wb.add', spec: { kind: 'label', x: 500, y: 500, text: 'the honest loop' } } },
    { at: 9000, event: { type: 'wb.clear' } },
  ];
}
