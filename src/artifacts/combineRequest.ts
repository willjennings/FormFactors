// Firing the tray hands off to the model (spec §5.4) — it does NOT author content. `combine`'s
// content is model-authored by design; a UI that fabricated the synthesis would be faking
// authorship. The UI's contribution is the deterministic part: exactly which sources, and what
// kind. The hint rides sendTextHint, so spec C's per-session fence makes it unforgeable —
// typed user text cannot impersonate a combine request.
//
// Precondition: the caller must gate this via canFire (two or more members required).
// `combine` itself refuses fewer than two sources, so a sub-two request is a programming error.
// This module always produces grammatical output regardless of input to avoid latent bugs.
import type { TrayMember } from './combineTray';

function joinTitles(titles: string[]): string {
  if (titles.length === 0) return 'the selected items';
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

export function buildCombineRequest(tray: TrayMember[], kind: 'doc' | 'widget'): { userText: string; hint: string } {
  const ids = tray.map((m) => m.sourceId);
  return {
    userText: `Combine ${joinTitles(tray.map((m) => m.title))} into a ${kind}.`,
    hint: `[COMBINE REQUEST: sources=[${ids.map((i) => `"${i}"`).join(',')}], kind="${kind}" — call combine with exactly these source ids; read them first with read_sources.]`,
  };
}
