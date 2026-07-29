// A ShellSkin is a named point in slot space + a prompt-adjacent ethos sentence and a
// pre-registered probe hypothesis — no new mechanism (spec §2, §0b). Single source of truth
// for the four furniture compositions the shell can render around the same window inventory.
import type { ShellSkin } from './types';

export const SHELL_SKINS: ShellSkin[] = [
  { key: 'familiar', label: 'Familiar', glyph: '⊞', assumesRung: 'none',
    ethos: 'A computer you already know — the agent is the only new thing in the room.',
    probe: 'Does a conventional desktop make the agent\'s reach legible fastest?',
    slots: { background: 'wallpaper', topBar: 'menu', bottomBar: 'taskbar', sideRail: 'icons', windowChrome: 'full', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'material', label: 'Material', glyph: '◈', assumesRung: 'R4',
    ethos: 'What you have made is the desk; programs are sources you draw from.',
    probe: 'Does foregrounding made material change what people make?',
    slots: { background: 'paper', topBar: 'desk', bottomBar: 'shelf', sideRail: 'sources', windowChrome: 'minimal', surfaces: 'material', restoreVia: 'bottomBar' } },
  { key: 'provenance', label: 'Provenance', glyph: '◷', assumesRung: 'R2',
    ethos: 'The desk is a visible record — who did what, witnessed or not.',
    probe: 'Does visible provenance change trust and correction rate?',
    slots: { background: 'dark', topBar: 'session', bottomBar: 'timeline', sideRail: 'none', windowChrome: 'provenance', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'conversation', label: 'Conversation', glyph: '◍', assumesRung: 'none',
    ethos: 'The agent holds the centre; windows orbit the talk.',
    probe: 'Does centring conversation reduce pointing?',
    slots: { background: 'flat', topBar: 'minimal', bottomBar: 'none', sideRail: 'none', windowChrome: 'minimal', surfaces: 'column', restoreVia: 'column' } },
];

export const SKIN_KEYS = SHELL_SKINS.map(s => s.key);

/** Unknown keys return null — never a silent fallback to the first skin (see getProgram in
 *  src/scenarios.ts for the anti-pattern this deliberately avoids: a typo'd id there silently
 *  redecorates the whole desktop as Word). Callers treat null as "ignore, keep current skin". */
export function resolveSkin(key: string): ShellSkin | null {
  return SHELL_SKINS.find(s => s.key === key) ?? null;
}

/** Prose for `assumesRung` (spec §0b's ladder), for the band's hover caption — never the bare
 *  token, which means nothing without having read the spec. R2/R4 name the belief the rung
 *  stands for ("it acts visibly, and I can undo" / "what it makes is material I keep"); 'none'
 *  says plainly that the skin presumes no prior learning.
 *
 *  A `switch` with a `never`-typed default, not an `if/if/else` fallback: §0b's ladder has six
 *  rungs (R0-R5) and only three are modelled here, so the day `ShellSkin['assumesRung']` widens
 *  — a fifth skin declaring `assumesRung: 'R3'`, say — an `else` branch would silently render the
 *  R4 sentence: not blank, not a crash, a confident wrong claim about what the user is assumed to
 *  already believe. On a project whose thesis is never presenting something false, that is worse
 *  than an empty caption. The `never` assignment below makes an unhandled rung a `tsc --noEmit`
 *  failure instead — one of the few real compile-time signals available here, since this repo's
 *  `tsc` does not type-check JSX props or hook values at all. */
export function describeRung(rung: ShellSkin['assumesRung']): string {
  switch (rung) {
    case 'none': return 'assumes no prior learning';
    case 'R2': return 'assumes you already believe it acts visibly, and you can undo';
    case 'R4': return 'assumes you already believe what it makes is material you keep';
    default: { const _exhaustive: never = rung; return _exhaustive; }
  }
}
