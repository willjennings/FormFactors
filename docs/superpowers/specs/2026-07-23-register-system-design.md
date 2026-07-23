# Register System — Design (R1, blindspot B4)

**Date:** 2026-07-23
**Status:** Approved 2026-07-22 as Part I of the five-blindspots master plan (user ruled: R1 is the first post-hardening phase; Guided is the control arm). This spec extracts the approved design for the R1 slice only — pill/band/chord, dial consolidation, four day-one registers, arms in telemetry. Paired comparison (R2) and the substrate-dependent registers (Workbench/Ledger, R3) are separate later phases.
**Closes:** Blindspot B4 — interaction intensity is scattered debug toggles; no user-facing register control; no named-arm abstraction tying a dial-set to a telemetry cohort.

## 1. Problem

Six-plus policy dials exist (honest-mode, autonomy, feedback verbosity, confirmGoals, whiteboardMode, refresh rate, markings) — all buried in the DebugDrawer as ~10 scattered `useState`s in App.tsx, each with a ref-mirror. `AGENTUILEARNINGS.md` already holds the principle ("verbosity and friction are separable — two dials beat one chattiness knob"), and telemetry stamps a `SessionConfig` at start — but comparison is offline JSON export only. The thesis is comparing interaction form factors; the *register* (how much interface is between the user and the agent) is not itself a first-class, measured variable.

## 2. Core stance

**A Register is not a new mechanism.** It is a *named point in the existing dial space + a matching prompt paragraph + a telemetry arm*. The honesty floor is NEVER dialable: witnessed mutations, the visual feedback floor, live/mic status. Minimal ≠ dishonest.

## 3. Dial consolidation (`src/register/types.ts` + App refactor)

One `dials: DialValues` state + one `dialsRef` replaces the scattered `useState`s (honestMode, autonomy, feedbackMode, confirmGoals, markings). Excluded (stays debug-only): voiceBackend, sendFrequency, whiteboardMode.

```ts
export interface DialValues {
  honest: boolean;                                  // prompt variant A/B
  autonomy: Autonomy;                               // existing friction dial (decideCommit)
  feedback: FeedbackMode;                           // silent | earcon | speech
  confirmGoals: boolean;
  markings: boolean;                                // highlight rings + legend
  chipDensity: 'none' | 'grounded' | 'full';        // NEW render gate: suggestion chips + quick-fire
  traceView: 'hidden' | 'ticker' | 'ledger';        // NEW render gate: ActivityTrace presentation
  teaching: 'off' | 'normal' | 'eager';             // NEW prompt gate: teach offers + fade baseline
  proactivity: 'never' | 'on-goal' | 'idle-offer';  // NEW prompt gate: suggest_next / idle behavior
}
```

New-dial semantics:
- `chipDensity`: `'none'` renders no suggestion row AND quick-fire digits are inert (no invisible affordances — honest); `'grounded'` shows chips only while the grounding buffer is non-empty; `'full'` = today.
- `traceView`: `'hidden'` unmounts the activity ticker (witness cards + toasts remain — floor); `'ticker'` = today; `'ledger'` = persistent right-edge column, full CAP list, no fade. (`'ledger'` ships in R1 as a *renderable option*; the Ledger *register* that features it is R3.)
- `teaching`: `'off'` → prompt says never offer teach sequences (act or answer only); `'eager'` → teach offers encouraged, fade baseline 0; `'normal'` = today's competence fade.
- `proactivity`: `'never'` → prompt forbids unprompted suggest_next/idle offers; `'on-goal'` = today; `'idle-offer'` → prompt invites an offer when the user is idle with an open goal.

The consolidation is mechanical — existing consumers (`decideCommit`, `emitFeedbackAudio`, `buildInstructions`, hint builders) read fields off `dials`/`dialsRef`; no behavior change; existing tests hold.

## 4. The registry (`src/register/registry.ts`, pure, TDD)

Named registers + Custom on ONE legible axis — scaffold density. R1 ships four:

| dial | **Terminal** | **Ambient** | **Guided** (control) | **Cockpit** |
|---|---|---|---|---|
| era / ethos | old — CLI: the trace is the interface | old-emerging — calm computing | today | maximal scaffold |
| honest | true | true | **false** (today's A/B default — control arm is literally today's app) | true |
| autonomy | autonomous | auto-safe | auto-safe | manual |
| feedback | silent | earcon | earcon | speech |
| confirmGoals | false | false | false | true |
| markings | false | false | false | true |
| chipDensity | none | grounded | full | full |
| traceView | ticker (monospace op-log restyle) | hidden | ticker | ledger |
| teaching | off | off | normal | eager |
| proactivity | never | never | on-goal | idle-offer |

Registry entry shape: `{ key, label, glyph, era: 'old'|'today'|'emerging'|'maximal', ethos, probe, dials }` — the single source of truth for the pill, band, prompt section, and arm stamp. `probe` = the pre-registered hypothesis, rendered in the band (the register is honestly framed as an experiment):
- **Terminal** — zero-scaffold fastest for experts? Wins = lowest mission duration WITHOUT correction/error spikes.
- **Ambient** — calm periphery costs nothing? Wins = Guided-equal completions with fewer interactions/stalls.
- **Guided** — the fixed control arm.
- **Cockpit** — maximal scaffold helps first contact + transfer? Wins = run-0 completion + run-1 unaided beats Guided.

**Custom** = any manual dial twiddle; forks to `custom` with `base: '<register>'` recorded — drift is never silently attributed to a named arm.

Pure helpers: `resolveDials(registerKey): DialValues` (throws on unknown key), `matchRegister(dials): string | null` (which named register these dials equal, else null → custom), `diffDials(a, b): {dial, from, to}[]` (feeds the band's hover preview and the witnessed switch line), `registerSection(registerKey, dials): string` (prompt paragraph).

## 5. Named arms in telemetry (`src/telemetry.ts`)

```ts
export interface Arm { register: string; base?: string; dials: DialValues; }
// SessionConfig gains: arm: Arm  (existing fields stay for backward compat)
// New event: { t; type: 'register_switch'; from: string; to: string; midSession: boolean }
```

A register switch reconnects (§6), so every session is single-arm by construction — arm stamped once at `session_start`. Export filename gains the register key. (pairId/compare_leg are R2.)

## 6. The control: pill, band, chord

- **Register pill** in the MenuBar next to the wordmark: glyph + name, hit-24, permanently visible — the register is the experiment; the condition must stay legible.
- **Register Band** (opens on pill click or chord): a horizontal strip of 5 notches (Terminal · Ambient · Guided · Cockpit · Custom) ordered minimal→maximal, visually one dial. Each notch: glyph, name, era tag, keycap 1–5; hover/focus shows the `diffDials` preview vs current ("chips off · actions commit without preview · app goes silent"). Esc closes. Custom's notch opens the Dial Bench (§8).
- **Backtick chord**: `` ` `` (guarded by the existing `isEditableTarget`, reusing quick-fire's repeat/cooldown guards) opens the band with keycaps armed; digit selects; second backtick cycles highlight for arrow/Enter. Transient echo pill mirrors `quickFireEcho` ("` 4` → Cockpit").
- Pure `src/register/bandKeys.ts` (or extend `quickFire.ts`): chord/digit logic TDD'd like `quickFire.ts`.

## 7. Honest mid-session switching

Follows the honest-mode reconnect precedent exactly (App.tsx ~L482-496):
1. **The session reconnects** — the prompt is register-dependent; a live model must never operate under a stale contract. Doc/corpus/artifacts/undo persist (app-owned); only the agent session is new.
2. **The model is told**: `buildInstructions` gains `registerSection(...)` — names the register and what the user can/cannot see. E.g. Terminal: "REGISTER: Terminal. The user sees no suggestion chips and no teaching overlays; the app confirms silently with a visual log line only. Be maximally terse. Never offer walkthroughs — act or answer." The model must know the feedback channel state or it double-confirms / under-informs.
3. **The switch is witnessed** through the real activity seam (`reduceActivity`, kind `'done'`): `Register: Guided → Terminal (reconnected · 6 dials changed)`. In trace-hidden registers the pill itself flashes the transition — the floor still answers "did it work?".
4. `register_switch` telemetry with `midSession`; a mid-mission switch marks the run mixed (consumed by R2).

## 8. Dial Bench — DEFERRED TO R2 (master-plan sequencing governs)

The dedicated `DialBench.tsx` extraction lands in R2 alongside paired comparison, per the approved master plan's phase list. In R1 the band's **Custom notch opens the existing DebugDrawer** (all five dials are already twiddlable there); twiddling any dial while in a named register forks to Custom (`base` recorded) — that forking DOES land in R1.

## 9. Testing

- Pure TDD: registry (every register's dials complete + distinct; resolve/match round-trip; Guided === today's defaults VERBATIM incl. honest:false — the control-arm invariant; the other three pin honest:true as deliberate new arms), `diffDials`, `registerSection` (per-register content; token-fence rule unaffected), band chord logic, arm stamping (telemetry export idiom).
- `instructions.test.ts`: registerSection composes with the existing prompt (de-tourism + fence regressions untouched).
- Component paths (pill, band, bench, gates) build-verified + human smoke per repo convention: switch mid-session live → reconnect + model acknowledges new register terms; chipDensity 'none' → no chips AND digits inert; Ambient → trace hidden but witness cards still render.

## 10. Out of scope (later phases)

Paired comparison / pairStore / CompareCard (R2); Workbench + Ledger registers, history rail, provenance links (R3); any journal dependency; `historyRail` dial (added in S5-S6 when the rail exists — YAGNI now).

## 11. Risks

- The App.tsx dial consolidation touches many read sites — mechanical but wide; land it as its own reviewed task with zero behavior change before any new gate.
- Reconnect-on-switch loses in-flight model turns (accepted: honest-mode toggle already behaves this way; the switch is user-initiated).
- `chipDensity:'none'` must also disable quick-fire (an invisible hot surface would be dishonest) — pin with a test.
