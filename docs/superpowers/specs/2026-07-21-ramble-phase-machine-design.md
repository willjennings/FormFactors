# Ramble Phase Machine Constraints — Design (B)

**Date:** 2026-07-21
**Status:** Approved in brainstorm (legal-transition table / phase-seal on fills / stall-scope = conversing+recapping only / decline → conversing). Spec awaiting user review.
**Closes:** The probe-campaign design gap — "the ramble phase machine is unconstrained (conversing→done in one event; fills land after done); isStalled is dark outside 'conversing' (a stuck recap/consent is unmonitored)."

## 1. Problem

The ramble machine (`src/ramble/`) is a plain reducer, and three things are unguarded:

1. **Transitions are a blind assignment.** `sessionStore.ts:45-46` is `phase = event.phase` with
   no source-phase check and no legal-transition table. `conversing → done` in one event is
   possible; `submit` is never checked to have followed `recap`. Only the event *producers*
   (`scribeCallToEvents`, the UI consent handler) keep the real app orderly — the machine itself
   enforces nothing.
2. **Fills ignore phase.** The slot-mutation cases (`sessionStore.ts:20-42`) guard only on
   `hasSlot` and `ownerOf===user`; **none read `state.phase`**. A late/in-flight `slot.draft`
   after `done` still mutates `fills`, flips activity to `thinking`, and bumps `lastUpdateAt`.
   `done` provides no seal.
3. **Stall monitoring is `conversing`-only.** `selectors.ts:17-19` is literally
   `phase === 'conversing' && now - lastUpdateAt > STALL_MS`. A recap that goes silent mid-readback
   is unmonitored.

Phases in play (`types.ts:36`, `capturing` is defined but unused; runtime starts at `conversing`
per `rfiSchema.ts:24`): `conversing → recapping → awaitingConsent → submitting → done`.

## 2. Fix 1 — legal-transition table

Replace the unguarded `session.phaseChange` case with a table of allowed edges:

```
conversing      -> recapping          (recap tool)
recapping       -> conversing         (more info surfaced; keep filling)
recapping       -> awaitingConsent    (submit tool)
awaitingConsent -> submitting         (Submit button)
awaitingConsent -> conversing         (decline — see Fix 4)
submitting      -> done               (700ms commit timer)
<any>           -> <same>             (idempotent self-transition, no-op)
```

Everything else — `conversing → done`, `conversing → awaitingConsent` (skipping recap), any
`done → *` — is **illegal**.

- **Reducer** (defense in depth): an illegal `session.phaseChange` returns state unchanged.
- **Host model-facing honesty** (`RambleLive.handleToolCall`, mirroring the existing user-owned-slot
  guard at RambleLive.tsx:80-89): a `submit` tool-call from a non-`recapping` phase responds
  `{ success:false, error:"recap the collected slots before submitting" }` and does not run the
  mapped event — the model is told the truth rather than getting a false success. `recap` from a
  non-`conversing`/`recapping` phase (e.g. after `done`) responds honestly too.

A pure `legalTransition(from, to): boolean` (or `nextPhase(from, event): Phase | null`) in
`sessionStore.ts`, TDD'd.

## 3. Fix 2 — phase seal on fills

Slot-mutation cases gain a phase gate. Fills are accepted only while the session is **open for
input**: `conversing` or `recapping` (recapping must stay open — that is where readback→patch
re-fills live, RambleLive.tsx:97). In `awaitingConsent`, `submitting`, `done`:

- **Reducer:** the `slot.*` agent-driven cases no-op (return unchanged) — the seal `done` lacks.
- **Host:** a `fill_slot`/`ask_gap`/`confirm_slot` arriving in a sealed phase responds
  `{ success:false, error:"the form is awaiting your consent / already submitted; cannot modify" }`,
  kept out of the deduper like the other truthful rejections.

Reuse the existing two-layer pattern (reducer guard + host ack-truth). A pure
`fillsAllowedIn(phase): boolean` predicate, TDD'd.

## 4. Fix 3 — stall scope (ruled in brainstorm)

`isStalled` monitors the phases where **the system/model owes progress**, and only those:

```ts
const STALL_PHASES = new Set<Phase>(['conversing', 'recapping']);
export function isStalled(state, now) {
  return STALL_PHASES.has(state.phase) && now - state.lastUpdateAt > STALL_MS;
}
```

- `recapping` is added — a recap that goes silent is genuinely stuck.
- **`awaitingConsent` is deliberately NOT monitored** — it is a *human-wait* (Submit / Not yet is
  the user's call, open-ended by nature). Flagging it "stalled" would be dishonest: nothing is
  stuck. This is a principled *no* to the memory note's "stuck consent unmonitored" framing.
- `submitting` (transient, 700ms) and `done` (terminal) stay unmonitored.

`LivenessIndicator` and the RambleLive stall-edge effect (telemetry.stall + error earcon) are
unchanged in wiring — they just now fire in `recapping` as well, because `isStalled` can go true
there.

## 5. Fix 4 — decline returns to conversing (ruled in brainstorm)

`declineSubmit` (RambleLive.tsx:226-228) today sends a hint only, so the machine sticks in
`awaitingConsent` (a phase that, post-Fix-3, is intentionally stall-dark) and the consent card
lingers. Change: decline dispatches `session.phaseChange: 'conversing'` (now a legal edge per
Fix 1) **in addition to** the existing hint. The consent card dismisses (it renders on
`phase === 'awaitingConsent'`, RambleLive.tsx:271), normal fill-monitoring resumes, the user keeps
rambling. No re-recap is forced; the model may `recap` again when ready.

## 6. Testing

- `sessionStore.test.ts`: legal edges pass; every illegal edge (incl. `conversing→done`,
  `done→*`, `conversing→awaitingConsent`) no-ops; idempotent self-transitions no-op cleanly.
- `sessionStore.test.ts`: `slot.*` events no-op in `awaitingConsent`/`submitting`/`done`; still
  apply in `conversing`/`recapping`; user-owned-slot guard still holds (compose with phase gate).
- `selectors.test.ts`: stalled true in `conversing` and `recapping` past `STALL_MS`; **false in
  `awaitingConsent`** regardless of elapsed; false in `submitting`/`done`.
- New host tests (or extend probe suite): `submit` before `recap` → honest error, no phase change;
  late `fill_slot` after `done` → honest error, `fills` unchanged; decline → phase back to
  `conversing`, card gone.
- Re-run the ramble probe regressions — the "fills land after done" and "conversing→done in one
  event" probes should now be closed.

## 7. Out of scope

The `capturing` dead phase (leave as-is unless a use appears); any change to the 700ms commit
timer or the non-blocking consent-card UX; telemetry schema changes beyond firing the existing
stall event in `recapping`.
