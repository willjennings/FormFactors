// A ShellSkin is a named point in slot space + a prompt-adjacent ethos sentence and a
// pre-registered probe hypothesis — no new mechanism (spec §2, §0b). Single source of truth
// for the four furniture compositions the shell can render around the same window inventory.
import type { ShellSkin } from './types';
import type { ArmAggregate } from '../../eval/armAggregate';
import { UNDERPOWERED_N } from '../../eval/armAggregate';
import type { ProbeVerdict } from '../../eval/types';

// Same shape and same reasoning as register/registry.ts's `underpoweredVerdict` (Task 5, spec
// §4) — duplicated rather than imported cross-registry, since the two registries are
// deliberately independent (`skins/` keeps its one-way import discipline: this file imports
// FROM `../../eval/`, never from `../../register/`, so the two `winsWhen` sets can't couple).
function underpoweredVerdict(a: ArmAggregate, control: ArmAggregate): ProbeVerdict | null {
  if (a.n >= UNDERPOWERED_N && control.n >= UNDERPOWERED_N) return null;
  const parts: string[] = [];
  if (a.n < UNDERPOWERED_N) parts.push(`arm n=${a.n} < ${UNDERPOWERED_N}`);
  if (control.n < UNDERPOWERED_N) parts.push(`control n=${control.n} < ${UNDERPOWERED_N}`);
  return { verdict: 'underpowered', because: parts.join('; ') };
}

export const SHELL_SKINS: ShellSkin[] = [
  { key: 'familiar', label: 'Familiar', glyph: '⊞', assumesRung: 'none',
    ethos: 'A computer you already know — the agent is the only new thing in the room.',
    probe: 'Does a conventional desktop make the agent\'s reach legible fastest?',
    // "fastest" -> measurable (`medianDurationMs`). "legible" -> NOT measurable — `ArmAggregate`
    // has no comprehension/legibility signal at all, so this predicate can never honestly return
    // 'met': half the conjunction is permanently unchecked with today's instrumentation. Reports
    // the duration comparison for transparency and names the unmeasured half explicitly.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      const aDur = a.medianDurationMs.value;
      const cDur = control.medianDurationMs.value;
      const durationNote = aDur === null || cDur === null
        ? `duration unmeasured (medianDurationMs.n=${a.medianDurationMs.n} vs ${control.medianDurationMs.n})`
        : `medianDurationMs ${aDur} vs control ${cDur} (faster=${aDur < cDur})`;
      return {
        verdict: 'not-met',
        because: `${durationNote} (n=${a.n} vs ${control.n}) is the only measurable half of this probe; "legible" has no corresponding ArmAggregate field, so it is unmeasured and 'met' is never claimed`,
      };
    },
    slots: { background: 'wallpaper', topBar: 'menu', bottomBar: 'taskbar', sideRail: 'icons', windowChrome: 'full', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'material', label: 'Material', glyph: '◈', assumesRung: 'R4',
    ethos: 'What you have made is the desk; programs are sources you draw from.',
    probe: 'Does foregrounding made material change what people make?',
    // "What people make" is artifact CONTENT — `ArmAggregate` carries only attempt outcomes/
    // rates/durations, no signal about what was produced. Nothing here maps to the probe's claim
    // even partially (unlike Familiar/Provenance, which each keep one measurable half). Only `n`
    // is genuinely comparable; reported for transparency, not as evidence for the claim itself.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      return {
        verdict: 'not-met',
        because: `n=${a.n} vs control n=${control.n} is all that is comparable here; ArmAggregate has no field for "what people make" (artifact content), so this probe is entirely unmeasured with current instrumentation and 'met' is never claimed`,
      };
    },
    slots: { background: 'paper', topBar: 'desk', bottomBar: 'shelf', sideRail: 'sources', windowChrome: 'minimal', surfaces: 'material', restoreVia: 'bottomBar' } },
  { key: 'provenance', label: 'Provenance', glyph: '◷', assumesRung: 'R2',
    ethos: 'The desk is a visible record — who did what, witnessed or not.',
    probe: 'Does visible provenance change trust and correction rate?',
    // "correction rate" -> measurable (`corrected`). "trust" -> NOT measurable — no trust signal
    // exists in `ArmAggregate` or anywhere upstream of it. Same reasoning as Familiar: reports
    // the measurable half, names the unmeasured half, never claims 'met'.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      const changed = a.corrected.value !== control.corrected.value;
      return {
        verdict: 'not-met',
        because: `corrected ${a.corrected.value.toFixed(2)} vs control ${control.corrected.value.toFixed(2)} (n=${a.n} vs ${control.n}, changed=${changed}) is the only measurable half of this probe; "trust" has no corresponding ArmAggregate field, so it is unmeasured and 'met' is never claimed`,
      };
    },
    slots: { background: 'dark', topBar: 'session', bottomBar: 'timeline', sideRail: 'none', windowChrome: 'provenance', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'conversation', label: 'Conversation', glyph: '◍', assumesRung: 'none',
    ethos: 'The agent holds the centre; windows orbit the talk.',
    probe: 'Does centring conversation reduce pointing?',
    // "Pointing" (direct-manipulation/targeting behaviour) has no corresponding ArmAggregate
    // field — same shape as Material: nothing here maps to the probe's claim even partially.
    // Only `n` is genuinely comparable; reported for transparency, not as evidence.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      return {
        verdict: 'not-met',
        because: `n=${a.n} vs control n=${control.n} is all that is comparable here; ArmAggregate has no field for "pointing", so this probe is entirely unmeasured with current instrumentation and 'met' is never claimed`,
      };
    },
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
