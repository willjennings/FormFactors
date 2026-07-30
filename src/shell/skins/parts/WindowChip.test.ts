/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WindowChip, type ShellBarItem } from './WindowChip';
import { DeskIcons } from './DeskIcons';

// Q1 (task-9 review, Minor): `scripts/battery/run.mjs`'s `readActiveProgram` (its own docblock,
// `PUT_AWAY` const) reads a MINIMIZED program chip's `aria-label` and excludes any chip whose label
// contains the literal substring `'put away'` — that string is the ENTIRE signal the harness uses
// to tell a minimized (put-away) program window from the one actually in front. Nothing in the type
// system connects that hardcoded harness string to this component's label text, so a copy-edit here
// ("stowed", "hidden", "minimised") would fail the harness OPEN: `readActiveProgram` would silently
// keep matching the wrong chip (or none) with no test anywhere failing to say so. This test is that
// missing connection — it pins the literal substring both label sources actually render.
//
// The two sources have ALREADY drifted from each other in punctuation (WindowChip: em dash before
// "put away"; DeskIcons: semicolon) — a real, harmless divergence spec-wise, since the harness only
// ever checks for the shared substring, not the surrounding punctuation. This test asserts exactly
// that shared substring, on both sources, rather than the two full strings matching each other.
describe('Q1 — minimized-window labels carry the substring scripts/battery/run.mjs depends on', () => {
  const minimizedItem: ShellBarItem = {
    id: 'program:word', title: 'Word', kind: 'program', minimized: true, focused: false,
  };

  it("WindowChip's minimized aria-label contains 'put away'", () => {
    const html = renderToStaticMarkup(
      React.createElement(WindowChip, { item: minimizedItem, onOpen: () => {} }),
    );
    expect(html).toContain('put away');
  });

  it("DeskIcons's minimized aria-label contains 'put away'", () => {
    const html = renderToStaticMarkup(
      React.createElement(DeskIcons, {
        items: [{ id: 'artifact:a1', title: 'Report', kind: 'artifact', minimized: true, focused: false }],
        onOpen: () => {},
      }),
    );
    expect(html).toContain('put away');
  });
});
