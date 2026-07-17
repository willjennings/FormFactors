import { describe, it, expect } from 'vitest';
import { WB_TOOLS, wbCallToEvent } from './tools';

describe('WB_TOOLS', () => {
  it('exposes the four tools', () => {
    expect(WB_TOOLS.map((t) => t.name)).toEqual(['wb_node', 'wb_connect', 'wb_label', 'wb_clear']);
  });
});

describe('wbCallToEvent', () => {
  it('maps wb_node (shape defaults box, coords coerced+clamped)', () => {
    expect(wbCallToEvent({ name: 'wb_node', args: { key: 'a', x: '300', y: 1200, text: 'Start' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'node', key: 'a', x: 300, y: 1000, text: 'Start', shape: 'box' } });
  });
  it('maps wb_connect', () => {
    expect(wbCallToEvent({ name: 'wb_connect', args: { from: 'a', to: 'b', label: 'then' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'connector', from: 'a', to: 'b', label: 'then' } });
  });
  it('maps wb_label and wb_clear', () => {
    expect(wbCallToEvent({ name: 'wb_label', args: { x: 10, y: 20, text: 'note' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'label', x: 10, y: 20, text: 'note' } });
    expect(wbCallToEvent({ name: 'wb_clear', args: {} })).toEqual({ type: 'wb.clear' });
  });
  it('errors on missing required fields', () => {
    expect(wbCallToEvent({ name: 'wb_node', args: { x: 1, y: 1, text: 't' } })).toHaveProperty('error'); // no key
    expect(wbCallToEvent({ name: 'wb_node', args: { key: 'a', x: 1, y: 1 } })).toHaveProperty('error');   // no text
    expect(wbCallToEvent({ name: 'wb_connect', args: { from: 'a' } })).toHaveProperty('error');           // no to
    expect(wbCallToEvent({ name: 'wb_label', args: { x: 1, y: 1 } })).toHaveProperty('error');            // no text
  });
});
