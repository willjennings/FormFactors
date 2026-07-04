# Task 5 Report: respond tool + prompt contract + ANSWER routing + telemetry

**Status:** DONE
**Commit:** `08e1afa feat(rail): respond tool + strict response contract in the prompt; explain answers land as ANSWER cards`

---

## TDD Evidence

### RED Phase
Added `it('carries the response contract', ...)` to `src/prompt/instructions.test.ts` before touching `instructions.ts`. Confirmed 1 failure:
```
❯ expect(honest).toContain('RESPONSE CONTRACT')  → fail
Test Files  1 failed | Tests  1 failed | 4 passed
```

### GREEN Phase
Inserted the RESPONSE CONTRACT block between CONFIRMATION POLICY and RESPONSE STYLE in `src/prompt/instructions.ts`. All 5 tests pass.

### Full suite
`npx vitest run` → **134 tests pass, 30 test files** (was 133 + 1 new)

---

## Changes

### `src/prompt/instructions.test.ts`
- Added `it('carries the response contract', ...)` asserting `RESPONSE CONTRACT`, `respond`, `guideLine` in honest; `RESPONSE CONTRACT` in confident.

### `src/prompt/instructions.ts`
- Inserted 7-line RESPONSE CONTRACT block between CONFIRMATION POLICY and RESPONSE STYLE (mode-independent; outside honest/confident conditionals).

### `src/telemetry.ts`
- Extended `TelemetryEvent` guidance `kind` union: added `card_dealt | why_opened | card_flipped | show_me | check_auto_pass | check_auto_fail | check_user_confirmed | rail_complete | rail_abandoned`
- Extended `guidance()` method signature to match.

### `src/App.tsx`
- **Imports**: added `railComplete` to railStore import; added `respondCallToRail` from `./rail/respondCallToRail`.
- **VOICE_TOOLS**: added `respond` as first entry (full schema per brief).
- **railDispatch**: replaced inline one-liner with telemetry-wired version using `railStateRef`:
  - reads `prev` from ref, computes `next = reduceRail(prev, e, now)`
  - emits `why_opened` / `card_flipped` on interaction events
  - emits `rail_abandoned` on dismiss with active index
  - emits `rail_complete` when `railComplete` flips false→true
  - emits `check_auto_pass` / `check_auto_fail` on auto-verify check card state transitions
  - emits `check_user_confirmed` when user confirm advances the check
  - calls `setRailState(next)`
- **railDispatchRef**: changed from `useRef(railDispatch)` (stale) to `railDispatchRef.current = railDispatch` each render.
- **explain branch**: replaced body with ANSWER card mapping via `respondCallToRail`; dispatches to rail with `guideLine: undefined`.
- **respond branch**: new `else if (fc.name === 'respond')` — maps args via `respondCallToRail`, on error rejects with `{ success: false, error }`, on success dispatches `rail.set`, emits `card_dealt` per card, acks with `{ success: true, rendered: N }`.
- **onShowMe**: added `telemetry.guidance('show_me', ...)` emission.

---

## Concerns

None. All anchors matched. TypeScript clean.

---

## Fix wave

Four follow-on fixes applied to `src/App.tsx` and `src/rail/respondCallToRail.test.ts`:

### Fix 1 (CRITICAL) — explain ANSWER rail never rendered
`guideLine: ' '` (whitespace-only) caused `respondCallToRail` to reject every explain call. Changed to `guideLine: 'answer'`. The existing `{ ...mapped.rail, guideLine: undefined }` strip before dispatch remains, so the placeholder never reaches the panel. New test `a single ANSWER card with a one-word guideLine maps cleanly (the explain path)` added to `respondCallToRail.test.ts` pinning this path.

### Fix 2 (Important) — `check_user_confirmed` false-fired on dismiss/replace
Guard was `prevCard.verify === 'user' && next.rail?.activeIndex !== ci`, which passed on any event that changed activeIndex (including `rail.dismiss`). Added `e.type === 'user.checkConfirm'` to the condition so the telemetry event fires only on an explicit confirmation.

### Fix 3 (Important) — stale ref baseline on rapid double-dispatch
`railStateRef.current` was only updated at render, so two dispatches in one tick both reduced from the same stale snapshot. Added `railStateRef.current = next;` immediately after computing `next` (before `setRailState(next)`).

### Fix 4 (Minor) — telemetry fires on both toggle directions
`why_opened` and `card_flipped` fired on open and close. Changed to emit `why_opened` only when `next.openWhy !== null && next.openWhy !== prev.openWhy`, and `card_flipped` only when `next.flipped.length > prev.flipped.length`.

### Verification
- `npx tsc --noEmit` — clean
- `npx vitest run src/rail/respondCallToRail.test.ts` — 10 green
- `npx vitest run` — 135 green (was 134 + 1 new test)
