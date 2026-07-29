// A Register is a named point in dial space + a prompt paragraph + a telemetry arm —
// no new mechanism (spec §2). Single source of truth for pill, band, prompt, arm stamp.
import type { DialValues } from './types';

/** Today's app defaults — and, by the control-arm invariant, exactly Guided's dials. */
export const DEFAULT_DIALS: DialValues = {
  honest: false, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
  markings: false, chipDensity: 'full', traceView: 'ticker', teaching: 'normal', proactivity: 'on-goal',
};

export interface RegisterDef {
  key: string; label: string; glyph: string;
  era: 'old' | 'today' | 'emerging' | 'maximal';
  ethos: string;   // one sentence: what this register believes
  probe: string;   // the pre-registered hypothesis (rendered in the band — honest experiment framing)
  dials: DialValues;
}

export const REGISTERS: RegisterDef[] = [
  {
    key: 'terminal', label: 'Terminal', glyph: '▮', era: 'old',
    ethos: 'The trace is the interface — zero scaffold, the hand on the keyboard.',
    probe: 'Is zero-scaffold fastest for experts? Wins: lowest mission time WITHOUT correction/error spikes.',
    dials: { honest: true, autonomy: 'autonomous', feedback: 'silent', confirmGoals: false,
             markings: false, chipDensity: 'none', traceView: 'ticker', teaching: 'off', proactivity: 'never' },
  },
  {
    key: 'ambient', label: 'Ambient', glyph: '◌', era: 'emerging',
    ethos: 'Calm computing — the periphery informs, nothing demands.',
    probe: 'Does calm periphery cost outcomes? Wins: Guided-equal completions with fewer interactions/stalls.',
    dials: { honest: true, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
             markings: false, chipDensity: 'grounded', traceView: 'hidden', teaching: 'off', proactivity: 'never' },
  },
  {
    key: 'guided', label: 'Guided', glyph: '◆', era: 'today',
    ethos: 'Today\'s balance — chips, guidance, and witnessed actions. The control arm.',
    probe: 'The fixed control arm — every other register is measured against this.',
    dials: { ...DEFAULT_DIALS },
  },
  {
    key: 'cockpit', label: 'Cockpit', glyph: '▣', era: 'maximal',
    ethos: 'Maximal scaffold — every affordance visible, every action narrated and previewed.',
    probe: 'Does maximal scaffold help first contact + transfer? Wins: run-0 completion + run-1 unaided beats Guided.',
    dials: { honest: true, autonomy: 'manual', feedback: 'speech', confirmGoals: true,
             markings: true, chipDensity: 'full', traceView: 'ledger', teaching: 'eager', proactivity: 'idle-offer' },
  },
];

/** The number of notches `bandKeyAction` (bandKeys.ts) resolves digits against: the register row
 *  plus Custom, and NOTHING else — the register band's shell-skin row (RegisterBand.tsx, spec §4)
 *  deliberately does not receive digit chords, and that is now a permanent contract (human ruling
 *  2026-07-29, spec §4 amended to match), not a deferral. App.tsx's `bandKeyAction(...)` call
 *  imports and passes this constant rather than recomputing `REGISTERS.length + 1` inline, so a
 *  widened `REGISTERS` array — or an attempt to fold the skin row's notches in — changes this one
 *  place; bandKeys.test.ts pins its literal value so that widening shows up as an explicit test
 *  edit instead of silent drift. */
export const BAND_NOTCH_COUNT = REGISTERS.length + 1;

export function resolveDials(key: string): DialValues {
  const r = REGISTERS.find(x => x.key === key);
  if (!r) throw new Error(`unknown register: ${key}`);
  return { ...r.dials };
}

const DIAL_KEYS = Object.keys(DEFAULT_DIALS) as (keyof DialValues)[];

export function matchRegister(dials: DialValues): string | null {
  return REGISTERS.find(r => DIAL_KEYS.every(k => r.dials[k] === dials[k]))?.key ?? null;
}

const show = (v: DialValues[keyof DialValues]): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

export function diffDials(a: DialValues, b: DialValues): { dial: keyof DialValues; from: string; to: string }[] {
  return DIAL_KEYS.filter(k => a[k] !== b[k]).map(k => ({ dial: k, from: show(a[k]), to: show(b[k]) }));
}

/** The prompt paragraph — DERIVED from dials so Custom is always coherent. Tells the model
 *  what the user can and cannot see (it must know the feedback channel or it double-confirms). */
export function registerSection(key: string | null, dials: DialValues): string {
  const label = REGISTERS.find(r => r.key === key)?.label ?? 'Custom';
  const lines: string[] = [`REGISTER: ${label}.`];
  if (dials.chipDensity === 'none') lines.push('The user sees NO suggestion chips — never reference "the chips".');
  else if (dials.chipDensity === 'grounded') lines.push('Suggestion chips appear only after the user selects a target.');
  if (dials.traceView === 'hidden') lines.push('The activity ticker is hidden; witness cards are the only visual trace of your actions.');
  else if (dials.traceView === 'ledger') lines.push('The user sees a full activity ledger of every call you make — always name your targets precisely.');
  if (dials.feedback === 'silent') lines.push('The app confirms silently with a visual log line only — be maximally terse; never narrate success.');
  else if (dials.feedback === 'speech') lines.push('The app SPEAKS its confirmations — never confirm success yourself; the app already did.');
  if (dials.teaching === 'off') lines.push('Never offer a walkthrough or teach sequence — act or answer, nothing more.');
  else if (dials.teaching === 'eager') lines.push('Readily offer a walkthrough when the user seems unsure — scaffolding is welcome here.');
  if (dials.proactivity === 'never') lines.push('Never make unprompted suggestions — speak only when spoken to.');
  else if (dials.proactivity === 'idle-offer') lines.push('If the user is idle with an open goal, you may offer the next step once.');
  return lines.join(' ');
}
