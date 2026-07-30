// The window inventory (spec §1). The store OWNS geometry/order/visibility and NEVER content:
// a window carries refId, titles resolve at selector time from the owning store, so a retitled
// artifact can never keep a stale window label.
import type { WindowRect } from '../windowState';
import type { SkinKey } from '../skins/types';

export type WindowKind = 'program' | 'artifact';
export type WindowOrigin = 'you' | 'agent';

export interface DeskWindow {
  id: string;            // programWindowId(...) | artifactWindowId(...)
  kind: WindowKind;
  refId: string;
  rect: WindowRect;
  z: number;
  minimized: boolean;
  origin: WindowOrigin;  // stamped at open, never changes (skin C's title tag)
  openedAt: number;      // stable bar-order key — never rewritten, even by reopen
  placed: boolean;       // the desk positioned it (false), or you did (true) — sticky once true,
                          // so a skin's projection can never re-walk a window the user dragged
}

export interface DeskState {
  windows: DeskWindow[];
  focusedId: string | null;
  nextZ: number;
  skin: SkinKey;
}

export type DeskEvent =
  | { type: 'window.open'; id: string; kind: WindowKind; refId: string; rect: WindowRect; origin: WindowOrigin; at: number }
  | { type: 'window.close'; id: string }
  | { type: 'window.focus'; id: string }
  | { type: 'window.minimize'; id: string }
  | { type: 'window.move'; id: string; rect: WindowRect; byUser?: boolean }
  | { type: 'desk.skin'; skin: SkinKey }
  | { type: 'desk.restore'; state: DeskState };
