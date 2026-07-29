import type { DeskEvent, DeskState, DeskWindow } from './types';
import type { WindowRect } from '../windowState';

export const programWindowId = (programId: string) => `program:${programId}`;
export const artifactWindowId = (artifactId: string) => `artifact:${artifactId}`;

export function initialDeskState(activeProgram: string, rect: WindowRect): DeskState {
  // Sparse start (spec §0b): first contact opens ONE window — the active program. Density is
  // earned; a returning desk restores whatever the journal says was open.
  const w: DeskWindow = {
    id: programWindowId(activeProgram), kind: 'program', refId: activeProgram,
    rect, z: 1, minimized: false, origin: 'you', openedAt: 0,
  };
  return { windows: [w], focusedId: w.id, nextZ: 2, skin: 'familiar' };
}

const fallbackFocus = (windows: DeskWindow[]): string | null => {
  const visible = windows.filter(w => !w.minimized);
  if (!visible.length) return null;
  return visible.reduce((a, b) => (b.z > a.z ? b : a)).id;
};

export function deskReduce(s: DeskState, e: DeskEvent): DeskState {
  switch (e.type) {
    case 'window.open': {
      const existing = s.windows.find(w => w.id === e.id);
      if (existing) {
        // Reopen = focus + restore. openedAt is NOT rewritten: bar order must stay stable
        // under the user's hand (research §5).
        const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: false, z: s.nextZ } : w);
        return { ...s, windows, focusedId: e.id, nextZ: s.nextZ + 1 };
      }
      const w: DeskWindow = { id: e.id, kind: e.kind, refId: e.refId, rect: e.rect, z: s.nextZ, minimized: false, origin: e.origin, openedAt: e.at };
      return { ...s, windows: [...s.windows, w], focusedId: e.id, nextZ: s.nextZ + 1 };
    }
    case 'window.close': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.filter(w => w.id !== e.id);
      return { ...s, windows, focusedId: s.focusedId === e.id ? fallbackFocus(windows) : s.focusedId };
    }
    case 'window.focus': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: false, z: s.nextZ } : w);
      return { ...s, windows, focusedId: e.id, nextZ: s.nextZ + 1 };
    }
    case 'window.minimize': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: true } : w);
      return { ...s, windows, focusedId: s.focusedId === e.id ? fallbackFocus(windows) : s.focusedId };
    }
    case 'window.move': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      return { ...s, windows: s.windows.map(w => w.id === e.id ? { ...w, rect: e.rect as WindowRect } : w) };
    }
    case 'desk.skin':
      // Skins change furniture, never geometry: windows array is passed through by IDENTITY —
      // the reducer cannot move a window the user placed (spec §1, tested).
      return { ...s, skin: e.skin };
    case 'desk.restore':
      return e.state;
    default:
      return s;
  }
}
