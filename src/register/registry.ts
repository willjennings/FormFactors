// A Register is a named point in dial space + a prompt paragraph + a telemetry arm —
// no new mechanism (spec §2). Single source of truth for pill, band, prompt, arm stamp.
import type { DialValues } from './types';
import type { ArmAggregate } from '../eval/armAggregate';
import { UNDERPOWERED_N } from '../eval/armAggregate';
import type { ProbeVerdict } from '../eval/types';

// Task 5 (spec §4): `probe` is the prose a human pre-registered; `winsWhen` is the predicate the
// machine checks against it. Kept beside each other deliberately — a divergence between what the
// sentence claims and what the predicate actually tests is itself a finding, not a bug to hide by
// quietly rewriting one to match the other.
//
// `underpowered` is checked FIRST, by name, in every predicate below — never folded into
// `not-met` — because reporting "no effect" from a handful of sessions is the likeliest way this
// apparatus misleads its own author (spec §4, task-5 brief). `underpoweredVerdict` is the single
// place that check lives; every `winsWhen` below calls it before touching a single comparison.
function underpoweredVerdict(a: ArmAggregate, control: ArmAggregate): ProbeVerdict | null {
  if (a.n >= UNDERPOWERED_N && control.n >= UNDERPOWERED_N) return null;
  const parts: string[] = [];
  if (a.n < UNDERPOWERED_N) parts.push(`arm n=${a.n} < ${UNDERPOWERED_N}`);
  if (control.n < UNDERPOWERED_N) parts.push(`control n=${control.n} < ${UNDERPOWERED_N}`);
  return { verdict: 'underpowered', because: parts.join('; ') };
}

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
  // The machine-checkable companion to `probe` (spec §4). Optional: Guided is the fixed control
  // arm every other register is measured AGAINST, so it has none — see the comment on its entry
  // below for why a self-comparison predicate was rejected rather than shipped as a null result.
  winsWhen?: (a: ArmAggregate, control: ArmAggregate) => ProbeVerdict;
}

export const REGISTERS: RegisterDef[] = [
  {
    key: 'terminal', label: 'Terminal', glyph: '▮', era: 'old',
    ethos: 'The trace is the interface — zero scaffold, the hand on the keyboard.',
    probe: 'Is zero-scaffold fastest for experts? Wins: lowest mission time WITHOUT correction/error spikes.',
    dials: { honest: true, autonomy: 'autonomous', feedback: 'silent', confirmGoals: false,
             markings: false, chipDensity: 'none', traceView: 'ticker', teaching: 'off', proactivity: 'never' },
    // "lowest mission time" -> the arm's median duration strictly below control's. "WITHOUT
    // correction/error spikes" -> two named guards translating the two nouns: `wrong` (the
    // undo-makes-it-wrong outcome — the closest thing this ledger has to "error") must not be
    // WORSE than control's, and `corrected` must not "spike" above it. "Not spiking" has no fixed
    // meaning in the spec prose; 1.5x control's corrected rate is a JUDGMENT CALL pre-registered
    // here, not derived — a different multiplier is equally defensible and changing it later is a
    // one-line, one-place edit, not a silent redefinition.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      const aDur = a.medianDurationMs.value;
      const cDur = control.medianDurationMs.value;
      if (aDur === null || cDur === null) {
        return {
          verdict: 'not-met',
          because: `duration unmeasured — arm medianDurationMs.n=${a.medianDurationMs.n}, control medianDurationMs.n=${control.medianDurationMs.n}`,
        };
      }
      const faster = aDur < cDur;
      const errorOk = a.wrong.value <= control.wrong.value;
      const notSpiking = a.corrected.value <= control.corrected.value * 1.5;
      const because = `medianDurationMs ${aDur} vs control ${cDur} (faster=${faster}); wrong ${a.wrong.value.toFixed(2)} vs control ${control.wrong.value.toFixed(2)} (n=${a.n} vs ${control.n}); corrected ${a.corrected.value.toFixed(2)} vs control ${control.corrected.value.toFixed(2)} x1.5=${(control.corrected.value * 1.5).toFixed(2)} (notSpiking=${notSpiking})`;
      return { verdict: faster && errorOk && notSpiking ? 'met' : 'not-met', because };
    },
  },
  {
    key: 'ambient', label: 'Ambient', glyph: '◌', era: 'emerging',
    ethos: 'Calm computing — the periphery informs, nothing demands.',
    probe: 'Does calm periphery cost outcomes? Wins: Guided-equal completions with fewer interactions/stalls.',
    dials: { honest: true, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
             markings: false, chipDensity: 'grounded', traceView: 'hidden', teaching: 'off', proactivity: 'never' },
    // "Guided-equal completions" -> arm completion within COMPLETION_EQUAL_EPS of control's, not
    // required to exceed it (a judgment call, pre-registered here: 0.05, i.e. within five points).
    // "fewer interactions/stalls" -> `ArmAggregate` carries no separate stall count, so `medianTurns`
    // is used as the SINGLE proxy standing in for both nouns in the probe sentence — stated here,
    // not silently assumed, per the task-5 brief's instruction to translate honestly with what the
    // aggregate actually carries.
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      const COMPLETION_EQUAL_EPS = 0.05;
      const aTurns = a.medianTurns.value;
      const cTurns = control.medianTurns.value;
      if (aTurns === null || cTurns === null) {
        return {
          verdict: 'not-met',
          because: `turns unmeasured — arm medianTurns.n=${a.medianTurns.n}, control medianTurns.n=${control.medianTurns.n}`,
        };
      }
      const guidedEqual = a.completion.value >= control.completion.value - COMPLETION_EQUAL_EPS;
      const fewerInteractions = aTurns < cTurns;
      const because = `completion ${a.completion.value.toFixed(2)} vs control ${control.completion.value.toFixed(2)} (eps=${COMPLETION_EQUAL_EPS}, guidedEqual=${guidedEqual}); medianTurns ${aTurns} vs control ${cTurns} (n=${a.n} vs ${control.n}, fewerInteractions=${fewerInteractions}, medianTurns standing in for "interactions/stalls" — no separate stall count in ArmAggregate)`;
      return { verdict: guidedEqual && fewerInteractions ? 'met' : 'not-met', because };
    },
  },
  {
    key: 'guided', label: 'Guided', glyph: '◆', era: 'today',
    ethos: 'Today\'s balance — chips, guidance, and witnessed actions. The control arm.',
    probe: 'The fixed control arm — every other register is measured against this.',
    dials: { ...DEFAULT_DIALS },
    // DELIBERATELY NO `winsWhen`. Guided is what every other arm's `winsWhen` compares against,
    // not something checked against itself — a self-comparison predicate can only ever compute
    // `a === control`, i.e. `n=X vs control n=X`, a tautology with no evidentiary content, and
    // `underpowered` would be the wrong verdict name for a check that isn't really a check
    // (rejected per the task-5 brief's own framing of that option). Callers already have to know
    // which arm is control to BUILD the `control: ArmAggregate` argument passed to every other
    // register's `winsWhen` in the first place, so they can skip Guided directly rather than call
    // into a predicate manufactured only to return a fixed non-answer.
  },
  {
    key: 'cockpit', label: 'Cockpit', glyph: '▣', era: 'maximal',
    ethos: 'Maximal scaffold — every affordance visible, every action narrated and previewed.',
    probe: 'Does maximal scaffold help first contact + transfer? Wins: run-0 completion + run-1 unaided beats Guided.',
    dials: { honest: true, autonomy: 'manual', feedback: 'speech', confirmGoals: true,
             markings: true, chipDensity: 'full', traceView: 'ledger', teaching: 'eager', proactivity: 'idle-offer' },
    // The probe's win condition is a CONJUNCTION of two halves: "run-0 completion" (measurable —
    // `ArmAggregate.completion`, the whole population this aggregate was built from) AND "run-1
    // unaided beats Guided" (NOT measurable from one `ArmAggregate` — that half needs a per-run
    // split, tracking which attempts came from a session's later, scaffold-off run, which this
    // struct does not carry; that is a Task 8-shaped instrumentation gap, not something to fake
    // here). Because the transfer half can never be checked, this predicate can never honestly
    // return 'met' — doing so would claim half a conjunction stands for the whole of it. It
    // reports the measurable half's numbers and NAMES the unmeasurable half explicitly rather than
    // silently dropping it (task-5 brief).
    winsWhen: (a, control) => {
      const under = underpoweredVerdict(a, control);
      if (under) return under;
      const run0Better = a.completion.value >= control.completion.value;
      return {
        verdict: 'not-met',
        because: `run-0 completion ${a.completion.value.toFixed(2)} (n=${a.n}) vs control ${control.completion.value.toFixed(2)} (n=${control.n}) [beats-or-equal=${run0Better}] is the only measurable half of this probe; "run-1 unaided beats Guided" requires a per-run split ArmAggregate does not carry, so the transfer half is unmeasured and 'met' is never claimed`,
      };
    },
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
