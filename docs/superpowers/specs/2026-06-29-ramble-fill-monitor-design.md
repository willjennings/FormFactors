# Ramble-Fill + Glanceable Monitor — Design Spec

*A new interaction "form factor" for FormFactors: the user is handsfree and rambling, an
agent-as-scribe fills an RFI form in the background, and a low-density glanceable monitor lets a
sub-second glance answer "is it still working, and is it getting it right?" Built in the existing
`honest-mode` app, reusing its voice tool-call loop, witness→commit consent gate, confidence/honesty
layer, earcons, and telemetry. Source: `RAMBLE_FILL_AND_GLANCEABLE_MONITOR.md`.*

Date: 2026-06-29
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **Walking skeleton** — one RFI form (~6 slots), fixed schema, the full loop end-to-end
(ramble → fill → live monitor → read-back → recap → consent). Follow-on specs deepen each subsystem.

---

## 1. Purpose & scope

The point-and-speak mode (today's `honest-mode`) is *deixis*: point at a thing, speak a command.
This mode is its inverse: **no pointing, continuous speech, agent-as-scribe.** One photo teaches the
form's shape; the conversation fills it; every fill is a draft held until confirmed; the user can
reach in and correct any field and the agent must yield it instantly.

**In scope (skeleton):** the state model + §6 event contract; the glanceable monitor; the scribe
running on the existing `VoiceProvider`; gap questions; incremental read-back; recap + consent gate;
reducer-enforced yield.

**Out of scope (follow-on specs):** real photo→schema vision parsing (skeleton uses a fixed RFI
schema; the "capture" is a cosmetic form-select); the full edit pass (validation, formatting,
reordering, side-by-side source); the transcript drill-in beyond storing provenance ids; multi-form
/ long-form support (this mode "fits a bounded high-value artifact" and is not forced onto routine
many-field forms).

---

## 2. Architecture

### 2.1 The seam (the event contract)

```
VoiceProvider (reused)              SessionStore (new, pure)        Monitor (new)
  ramble audio ─► scribe model      reducer(state, event) ─► state   render(state)
       │           emits tool calls        │  + derived selectors        │
       ▼                                    ▼                            ▼
  scribeTools: fill_slot / ask_gap /   SessionState  ──(§4 events)──►  per-field
  confirm_slot / recap / submit ───────► transitions                  visual states
       │                                    ▲                            │
       └──── submit() ─► witness_render gate (reused) ◄── UI→Agent: editStart/Commit/Cancel/openFullEditor
```

The §4 event contract is the only seam: the scribe produces Agent→UI events (via tool calls), the
store reduces them, the monitor renders state. The UI emits UI→Agent events (edits) that the store
applies locally *and* the app forwards to the scribe as hints.

### 2.2 Reuse map (not rebuilt — all from `honest-mode`)

| Need | Reused mechanism |
|---|---|
| Hear ramble + emit structured calls | `VoiceProvider` (Gemini/OpenAI/Azure) + the tool-call loop |
| Submit consent (`externalTxn`, high blast radius) | `decideCommit` / `setPendingAction` witness→commit gate |
| Confidence / `inferred` markers | the honesty/confidence layer |
| Liveness + read-back audio cues | `feedback` / `earcons` |
| Per-session metrics | `telemetry` (extended) |

### 2.3 New modules (one responsibility each)

- `src/ramble/types.ts` — `FormSchema`, `Slot`, `SlotFill`, `SessionState`, and the event union.
- `src/ramble/rfiSchema.ts` — the fixed RFI `FormSchema`.
- `src/ramble/sessionStore.ts` — **pure reducer** `(state, event) → state` + derived selectors.
- `src/ramble/scribeTools.ts` — scribe tool definitions + pure `toolCallToEvent(call)` mapper.
- `src/ramble/scribePrompt.ts` — the scribe system prompt.
- `src/ramble/Monitor.tsx`, `SlotRow.tsx`, `LivenessIndicator.tsx` — the glanceable screen (pure render).

### 2.4 Integration

A **mode switch** in `App`: `point-and-speak` (today) vs `ramble-fill` (new). Selecting ramble-fill
swaps the scene to `<Monitor>` and points the `VoiceProvider` at the scribe prompt + tools instead
of the deixis prompt + tools. The provider dropdown, consent gate, earcons, and telemetry are shared.

---

## 3. State model

Types are the source spec's §1.2 verbatim:

```ts
type SlotType = 'text' | 'shortText' | 'date' | 'number' | 'enum' | 'reference';

interface FormSchema { formId: string; title: string; slots: Slot[]; capturedAt: number }
interface Slot { id: string; label: string; type: SlotType; required: boolean; constraint?: string; order: number }

type SlotStatus = 'empty' | 'filling' | 'draft' | 'confirmed' | 'needsInput';
type SlotSource = 'heard' | 'inferred' | 'asked' | 'userEdited';
type SlotOwner  = 'agent' | 'user';

interface SlotFill {
  slotId: string;
  value: string | null;
  status: SlotStatus;
  confidence: number;          // 0..1
  source: SlotSource;
  owner: SlotOwner;            // once 'user', the agent never overwrites
  provenanceUtteranceIds?: string[];
  updatedAt: number;
}

type Phase = 'capturing' | 'conversing' | 'recapping' | 'awaitingConsent' | 'submitting' | 'done';
type Activity = 'listening' | 'thinking' | 'filling' | 'asking' | 'readingBack' | 'idle' | 'stalled';

interface SessionState {
  phase: Phase;
  activity: Activity;
  activeSlotId: string | null;  // the ONE slot filling now — the liveness anchor
  lastUpdateAt: number;         // drives stall detection
  fills: SlotFill[];
}
```

`status`: `empty` (nothing) · `filling` (writing it *now*, exactly one at a time) · `draft` (filled,
not yet read-back-confirmed) · `confirmed` (read back + accepted, or user-edited) · `needsInput` (a
gap question pending). `source`: `heard` · `inferred` (**flagged** at recap) · `asked` · `userEdited`.

### 3.1 The fixed RFI schema (`rfiSchema.ts`)

| order | slotId | label | type | required | constraint / note |
|---|---|---|---|---|---|
| 0 | `question` | Question | text | ✓ | the RFI body |
| 1 | `location` | Location / gridline | shortText | ✓ | e.g. "C-3" |
| 2 | `drawingRef` | Drawing ref | reference | ✓ | e.g. "S-301" |
| 3 | `neededBy` | Needed by | date | ✓ | drives a gap question if unsaid |
| 4 | `discipline` | Discipline | enum | ✗ | `Architectural\|Structural\|Mechanical\|Electrical` |
| 5 | `dateSubmitted` | Date | date | ✓ | seeded `inferred` = today (flagged at recap) |

Initial `SessionState`: `phase='conversing'`, `activity='listening'`, `activeSlotId=null`, every slot
`{ value:null, status:'empty', confidence:0, source:'heard', owner:'agent' }` — except `dateSubmitted`
seeded `{ value: today, status:'draft', confidence:1, source:'inferred', owner:'agent' }` so the
inferred-flag + recap path is exercised from the start.

---

## 4. Event contract & reducer

### 4.1 Events (§4 of source)

**Agent → UI:** `slot.fillingStart(slotId)` · `slot.valueUpdate(slotId, partialValue)` ·
`slot.draft(slotId, value, confidence, source)` · `slot.needsInput(slotId, question)` ·
`slot.confirmed(slotId)` · `activity.change(activity)` · `session.phaseChange(phase)` · `heartbeat()`.

**UI → Agent:** `user.editStart(slotId)` · `user.editCommit(slotId, value)` ·
`user.editCancel(slotId)` · `user.openFullEditor()`.

Modeled as a discriminated-union `RambleEvent` type. The reducer is `(state, event) => state`, pure.

### 4.2 Reducer transitions

| Event | Effect |
|---|---|
| `slot.fillingStart(id)` | `activeSlotId=id`; slot→`filling`; `activity='filling'`; bump `lastUpdateAt` |
| `slot.valueUpdate(id, partial)` | set slot `value=partial`; bump `updatedAt`+`lastUpdateAt` |
| `slot.draft(id, value, conf, source)` | slot→`{value, status:'draft', confidence:conf, source}`; if `activeSlotId===id`, clear anchor; `activity='thinking'` |
| `slot.needsInput(id, q)` | slot→`needsInput`; stash `q` (pendingQuestion); `activity='asking'` |
| `slot.confirmed(id)` | slot→`confirmed`; bump timestamps |
| `activity.change(a)` | `activity=a`; bump `lastUpdateAt` |
| `session.phaseChange(p)` | `phase=p` |
| `heartbeat()` | bump `lastUpdateAt` only |

### 4.3 Yield enforcement (the #1 trust rule — lives in the pure reducer)

Once a slot's `owner==='user'`, the reducer **drops** any `slot.fillingStart` / `slot.valueUpdate` /
`slot.draft` targeting it (returns state unchanged for that slot). The agent therefore *cannot*
overwrite a user-owned slot, by construction.

| Event | Effect |
|---|---|
| `user.editStart(id)` | snapshot the prior `SlotFill` (for cancel); `owner='user'`; if slot was `filling`, clear `activeSlotId` |
| `user.editCommit(id, value)` | `{value, source:'userEdited', status:'confirmed', owner:'user'}` |
| `user.editCancel(id)` | restore the snapshot; `owner='agent'` |

`user.openFullEditor` is handled by the app (navigation), not the reducer.

### 4.4 Derived selectors (pure; the UI reads these, never stored)

- `activeSlot(state)` → the `filling` slot or null.
- `recentSlots(state, n=2)` → the last `n` updated slots excluding the active one (by `updatedAt`).
- `isStalled(state, now)` → `state.phase==='conversing' && now - state.lastUpdateAt > STALL_MS`
  (`STALL_MS = 10_000`). Stall is derived, never stored; the agent only `heartbeat()`s.

---

## 5. The glanceable monitor

### 5.1 Acceptance criterion

The **glance test** (§2.1 of source): under one second, peripheral, no reading, resolve exactly —
**alive? · where is it now? · roughly how far? · which fields to worry about?** — and nothing else.
If a reviewer must *read* the screen to know it's working, the density is wrong.

### 5.2 Layout

```
┌───────────────────────────────────────────────┐
│ RFI                          ● filling    ·10s │ ← LivenessIndicator (highest-value pixel)
├───────────────────────────────────────────────┤
│ Question     S-301 beam conflicts with A-5▏    │ ← FILLING: highlight + caret/pulse (anchor)
│ Location     C-3                               │ ← recent (normal contrast)
│ Drawing ref  S-301                       ✓?    │ ← draft + inferred/low-conf marker
│ Needed by    asking… "by when?"                │ ← needsInput (quiet "asking" marker)
│ Discipline   ·                                 │ ← empty (faint, recedes)
│ Date         6/29/2026                   ✓?    │ ← inferred=today (flagged)
└───────────────────────────────────────────────┘
         (no transcript; tap any field to edit)
```

### 5.3 Per-field visual = base(`status`) + overlays (`SlotRow.tsx`)

Base treatment: `empty` faint/recedes · `filling` highlighted + live (caret/subtle pulse — the
anchor) · `draft` normal contrast + subtle "provisional" tint · `confirmed` calm/settled ·
`needsInput` quiet "agent is asking" marker.

Overlays (independent of base):
- `source==='inferred'` OR `confidence < CONF_THRESHOLD (0.6)` → a single quiet `✓?` marker.
  **Confident fields get no marker** — marking only the uncertain makes the glance *targeted*.
- `owner==='user'` → a subtle **"yours"** marker (agent will not overwrite).

Rules: exactly one `filling`; confidence overlay on uncertain only; recency foregrounding; **no
error/validation states here** (deferred to the edit pass).

### 5.4 LivenessIndicator (`LivenessIndicator.tsx`)

Renders `activity`: `listening` (calm) / `filling` / `asking` / **`stalled`**. `stalled` (from
`isStalled`) is **visually distinct** at a peripheral glance (e.g. amber + "no update Ns") so "has it
silently died?" — the first thing a glance must answer — is answerable without reading. Reuses an
earcon cue on `stalled` and on read-back.

### 5.5 Recency, not completeness

Foreground the active slot + last 1–2 updated (via `recentSlots`); the rest recede. **No counter, no
progress bar** — the calm-to-faint ratio *is* the "how far" sense.

### 5.6 Yield UI (discoverable, not advertised)

No persistent edit buttons. Tap a slot → inline field, `owner='user'` instantly, "yours" marker
appears, agent stops (reducer-enforced). Commit → `confirmed`+yours; cancel → revert. One quiet
"open full editor" link; the editor is **not** embedded.

---

## 6. The scribe

Runs on the existing `VoiceProvider` with a scribe system prompt + a small tool set; each tool maps
1:1 to an Agent→UI event via pure `toolCallToEvent(call)`:

| Tool | → event | purpose |
|---|---|---|
| `fill_slot(slotId, value, confidence, source)` | `slot.draft` (preceded by `slot.fillingStart`) | provisional fill |
| `ask_gap(slotId, question)` | `slot.needsInput` | one gap question at a time |
| `confirm_slot(slotId)` | `slot.confirmed` | after read-back accepted |
| `recap()` | `session.phaseChange('recapping')` | voice whole form + flag inferred |
| `submit()` | `session.phaseChange('awaitingConsent')` | → `witness_render` gate |

Streaming `slot.valueUpdate` is best-effort; the live "filling" feel comes from the
`fillingStart → draft` transition + `activity`. Character-level streaming is a later enhancement.

### 6.1 Prompt discipline (`scribePrompt.ts`)

- **Content-vs-chatter:** discard asides / thinking-aloud; only `fill_slot` on genuine content; when
  unsure, hold **low-confidence** and confirm — never silently file.
- **Gap-driven, one at a time:** compute missing **required** slots; `ask_gap` singly; gate on genuine
  ambiguity, not model unease.
- **Incremental read-back is dialogue:** the model *voicing* "got it as: at C-3, S-301 conflicts with
  A-502 — right?" is allowed (read-back is a question — the one role reserved for the model's voice).
  `confirm_slot` on acceptance; a correction patches the slot and re-confirms.
- **Recap before submit is mandatory:** `recap()` flags every `inferred` field explicitly, *then*
  `submit()` hits the consent gate. The user is submitting a record they never fully saw.

### 6.2 Yield (defense in depth)

On `user.editStart`, the app sends the scribe a hint ("user is editing Location — don't fill it") via
`sendTextHint`, *and* the reducer blocks user-owned slots — yield holds even if the model ignores the
hint.

### 6.3 Consent to submit

`submit()` → `phase='awaitingConsent'` → reuse the existing witness→commit consent UI
(`setPendingAction` + the pending-action confirmation), treating submit as **unconditionally
witnessed** (highest blast radius — no autonomy level may auto-commit it, so `decideCommit` is
bypassed for this action rather than extended) → user confirms → `phase='submitting'` →
`phase='done'`. The mandatory full recap (6.1) precedes this gate.

---

## 7. Telemetry (extend `telemetry.ts`)

New events: `fill` (slotId, source, confidence), `correction` (user edit over an agent fill — the key
trust signal), `gap_question` (slotId), `readback` (accepted vs patched), `stall` (occurred),
`session_complete` (timeToCompleteMs, slotsFilled, inferredCount). Exported via the existing JSON
export so the ramble mode is comparable as a form factor.

---

## 8. Error handling & graceful degradation

- Unknown `slotId` in any event → reducer returns state unchanged (no crash).
- Voice provider drop → `activity` goes quiet → `isStalled` surfaces it (the monitor's whole job).
- Consent declined → stays `awaitingConsent` (no submit).
- A `fill_slot` on a `user`-owned slot → dropped by the reducer (yield).

---

## 9. Testing

- **Pure (vitest, headless):** `sessionStore` reducer — every transition, **yield enforcement**,
  cancel-revert; selectors (`isStalled`, `recentSlots`, `activeSlot`); `toolCallToEvent`; `rfiSchema`
  initial state (incl. seeded inferred `dateSubmitted`).
- **Scripted-events harness (vitest):** feed a recorded Agent→UI event sequence into the store and
  assert the derived view-model — this *is* "prove the glance with mocked events," and doubles as the
  skeleton's demo with no live model.
- **Build + deferred live smoke** (like F1): a real scribe run with an API key is a human-verified
  step (ramble → fills appear → gap question → read-back → recap flags inferred → consent → done).

---

## 10. Build order (informs the plan)

1. `types.ts` + `rfiSchema.ts` + initial state.
2. `sessionStore.ts` reducer + selectors (TDD) — the foundation everything renders from.
3. `Monitor.tsx` / `SlotRow.tsx` / `LivenessIndicator.tsx` from state; prove the glance with the
   scripted-events harness (no agent).
4. Yield choreography end-to-end with mocked edits.
5. `scribeTools.ts` + `scribePrompt.ts`; wire the scribe onto the `VoiceProvider`; mode switch in App.
6. Recap + consent gate (`witness_render`) with inferred-field flagging.
7. Telemetry extension.

Steps 1–4 have **no agent dependency** and are fully testable with scripted events — land and prove
the glanceable monitor before the scribe is wired.

---

## 11. Caveats (from source §7 — binding constraints)

- **The glance test is the acceptance test.** Cut density until alive/where/how-far/which-to-worry
  resolve pre-attentively.
- **Mark only the uncertain.** Confidence markers on every field re-create the audit the glance avoids.
- **Yield must be instant and visible.** `owner='user'` is sticky, immediate, shown, and
  reducer-enforced — non-negotiable.
- **Recap-before-submit is mandatory** here — the agent submits a record the user never fully saw.
- **This mode fits a bounded, high-value artifact** (one RFI); it degrades for long routine forms —
  don't force it on those.
- **Don't embed the editor in the monitor** — it breaks the "check intermittently" premise.
