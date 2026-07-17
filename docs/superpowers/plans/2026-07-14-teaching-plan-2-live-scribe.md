# Teaching Plan 2 (Live Scribe Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the completed teaching foundation to the live voice agent — the model drives guide/teach/just-do-it posture through `TEACH_TOOLS`, honoring two contracts: no double-advance between agent pacing and user clicks (Contract A), and no deixis-hint contention while a sequence is active (Contract B).

**Architecture:** Everything follows the already-tested annotation/goal live-wiring pattern: spread `TEACH_TOOLS` into the `voiceTools` memo, route `teach_*` calls through the pure `teachCallToEvent` mapper into `teachingDispatchRef`, and treat mapper errors as data returned to the model. Contract A is a new pure function `advanceOnClick` gating the click-site dispatch; Contract B is a guard on the proactive hover hint. A `teachingSnapshotRef` mirror gives both guards stale-closure-free reads. The reducer, selectors, `TeachingLayer`, mapper, and demo are foundation-complete and unchanged.

**Tech Stack:** React 18 + TypeScript (strict), vitest for pure units, `npm run lint` (tsc --noEmit) + `npm test` + `npm run build` for integration.

**Spec:** `docs/superpowers/specs/2026-07-13-teaching-plan-2-design.md`

## Global Constraints

- **No changes** to `src/teaching/teachingStore.ts`, `selectors.ts`, `TeachingLayer.tsx`, `teachTools.ts`, `teachingState.ts`, or `demoScript.ts` — the foundation is complete; Plan 2 only wires and prompts.
- **Errors are data:** an unresolvable teach target is reported via `sendToolResponse({ success: false, error })`, never thrown.
- **No new perception:** `serializeTeachingState` / `[TEACHING STATE]` and the vision-frame overlays already exist (C2a). Do not add hint sends.
- **G9 deduper is enough:** `handleVoiceToolCall`'s existing deduper handles model-side duplicate `teach_step_done` — add no new dedup code.
- Verbatim posture semantics: `guide` = agent-paced walkthrough; `teach` = user performs each step (agent demonstrates step 1 only); *just-do-it* = no teaching tool at all.
- Commit style: `feat(teach): …` / `test(teach): …`, matching `git log` conventions.
- Working branch: `honest-mode`.

---

### Task 1: `advanceOnClick` — the pure Contract A gate (TDD)

**Files:**
- Create: `src/teaching/advanceOnClick.ts`
- Test: `src/teaching/advanceOnClick.test.ts`

**Interfaces:**
- Consumes: `TeachPosture` from `src/teaching/types.ts` (`'guide' | 'teach'`).
- Produces: `advanceOnClick(isLive: boolean, posture: TeachPosture | null): boolean` — Task 3 imports this exact name from `./teaching/advanceOnClick`.

- [ ] **Step 1: Write the failing test**

Create `src/teaching/advanceOnClick.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { advanceOnClick } from './advanceOnClick';

describe('advanceOnClick — advancement authority (Contract A)', () => {
  it('demo (no agent): clicks pace any sequence', () => {
    expect(advanceOnClick(false, 'guide')).toBe(true);
    expect(advanceOnClick(false, 'teach')).toBe(true);
    expect(advanceOnClick(false, null)).toBe(true);
  });

  it('live guide: agent-paced via teach_step_done — clicks must not advance', () => {
    expect(advanceOnClick(true, 'guide')).toBe(false);
  });

  it('live teach: the user performs the steps — clicks advance', () => {
    expect(advanceOnClick(true, 'teach')).toBe(true);
  });

  it('live with no active sequence: nothing for a click to advance', () => {
    expect(advanceOnClick(true, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/teaching/advanceOnClick.test.ts`
Expected: FAIL — `Cannot find module './advanceOnClick'` (or equivalent resolve error).

- [ ] **Step 3: Write the minimal implementation**

Create `src/teaching/advanceOnClick.ts` (verbatim from spec §3):

```ts
import type { TeachPosture } from './types';

/** Contract A — advancement authority. Pure. */
export function advanceOnClick(isLive: boolean, posture: TeachPosture | null): boolean {
  // Demo (no agent) → clicks pace any sequence. Live → clicks pace only teach posture
  // (the user performs the steps); live guide is agent-paced via teach_step_done.
  return !isLive || posture === 'teach';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/teaching/advanceOnClick.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/teaching/advanceOnClick.ts src/teaching/advanceOnClick.test.ts
git commit -m "feat(teach): advanceOnClick — pure Contract A advancement-authority gate (TDD)"
```

---

### Task 2: Live wiring — `TEACH_TOOLS` in `voiceTools` + `teach_*` routing

**Files:**
- Modify: `src/App.tsx` — the import block (~line 47), the `voiceTools` memo (~line 318), and `handleVoiceToolCall` (~line 1307, between the `wb_` and `annotate_` branches).

**Interfaces:**
- Consumes: `TEACH_TOOLS: VoiceTool[]` and `teachCallToEvent(call: { name: string; args: any }, entities: SceneEntity[]): TeachingEvent | { error: string }` from `src/teaching/teachTools.ts`; the existing `teachingDispatchRef` (App.tsx ~line 581) and `entitiesRef`.
- Produces: live `teach_highlight` / `teach_sequence` / `teach_step_done` / `teach_relate` / `teach_clear` routing. No new exports.

- [ ] **Step 1: Import the tools + mapper**

In `src/App.tsx`, next to the existing teaching imports (~line 47, `import { TeachingLayer } from './teaching/TeachingLayer';`), add:

```ts
import { TEACH_TOOLS, teachCallToEvent } from './teaching/teachTools';
```

- [ ] **Step 2: Add `TEACH_TOOLS` to the `voiceTools` memo**

At ~line 318, change:

```ts
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS, ...WB_TOOLS],
    [activeProgram],
  );
```

to:

```ts
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS, ...WB_TOOLS, ...TEACH_TOOLS],
    [activeProgram],
  );
```

- [ ] **Step 3: Add the `teach_*` branch in `handleVoiceToolCall`**

At ~line 1307, between the `wb_` branch's closing and the `annotate_` branch (spec §2 says before `annotate_`), insert:

```ts
    } else if (fc.name.startsWith('teach_')) {
      // Plan 2: the live model drives teaching posture through the foundation's pure mapper.
      // An unresolvable target is DATA (reported to the model), never thrown — no partial
      // sequence starts. The G9 deduper above already drops a re-emitted teach_step_done.
      const mapped = teachCallToEvent(fc, entitiesRef.current);
      if ('error' in mapped) {
        addLog('tool', `Tool Call: ${fc.name} REJECTED — ${mapped.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else {
        teachingDispatchRef.current?.(mapped);
        addLog('tool', `Tool Call: ${fc.name}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
      }
```

so the chain reads `… wb_ branch } else if (teach_) { … } else if (annotate_) { …`.

- [ ] **Step 4: Verify — typecheck + full suite**

Run: `npm run lint && npm test`
Expected: tsc clean; all vitest suites PASS (no behavior change is unit-observable — this is integration-verified).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(teach): live wiring — TEACH_TOOLS in voiceTools + teach_* routing via teachCallToEvent (errors are data)"
```

---

### Task 3: Contract A — gate the click-site `user.stepAction` dispatch

**Files:**
- Modify: `src/App.tsx` — the teaching state declarations (~line 582) and `handleSurfaceElementClick` (~line 1357).

**Interfaces:**
- Consumes: `advanceOnClick` from Task 1; the existing `isLive` state (~line 380) and `teachingSnapshot` state (~line 582).
- Produces: `teachingSnapshotRef: React.MutableRefObject<TeachingState | null>` — Task 4 reads this same ref in the hover handler.

- [ ] **Step 1: Import the gate**

In `src/App.tsx`, next to the Task 2 import, add:

```ts
import { advanceOnClick } from './teaching/advanceOnClick';
```

- [ ] **Step 2: Mirror `teachingSnapshot` into a ref**

At ~line 582, directly after:

```ts
  const [teachingSnapshot, setTeachingSnapshot] = useState<TeachingState | null>(null);
```

add (matching the `goalStateRef` mirror pattern three lines below it):

```ts
  // Plan 2: stale-closure-free reads for the click gate (Contract A) + hover handler (Contract B).
  const teachingSnapshotRef = useRef<TeachingState | null>(null);
  useEffect(() => { teachingSnapshotRef.current = teachingSnapshot; }, [teachingSnapshot]);
```

- [ ] **Step 3: Gate the dispatch in `handleSurfaceElementClick`**

At ~line 1357, change:

```ts
  const handleSurfaceElementClick = (elementId: number) => {
    const entity = entitiesRef.current.find(e => e.id === `${program.id}-${elementId}`);
    if (entity) teachingDispatchRef.current?.({ type: 'user.stepAction', entityId: entity.id });
```

to:

```ts
  const handleSurfaceElementClick = (elementId: number) => {
    const entity = entitiesRef.current.find(e => e.id === `${program.id}-${elementId}`);
    // Contract A (advancement authority): live guide is agent-paced via teach_step_done — a
    // click still selects/grounds the element below; it just must not ALSO advance the sequence.
    if (entity && advanceOnClick(isLive, teachingSnapshotRef.current?.sequence?.posture ?? null)) {
      teachingDispatchRef.current?.({ type: 'user.stepAction', entityId: entity.id });
    }
```

The element-selection / grounding / rail dispatches below this line are UNCHANGED — only the teaching step-advance dispatch is gated.

- [ ] **Step 4: Verify — typecheck + full suite (incl. the four gate cases)**

Run: `npm run lint && npm test`
Expected: tsc clean; all suites PASS, including `advanceOnClick.test.ts`'s four cases (demo→true, live+guide→false, live+teach→true, live+null→false). The `?teach=1` demo path is `isLive === false`, so demo clicks still advance.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(teach): Contract A — advanceOnClick gates user.stepAction at the click site (no double-advance)"
```

---

### Task 4: Contract B — mute the proactive deixis hint mid-sequence

**Files:**
- Modify: `src/App.tsx` — the proactive-grounding hint condition (~line 2256, inside the mouse-move handler).

**Interfaces:**
- Consumes: `teachingSnapshotRef` from Task 3.
- Produces: nothing new — a guard only.

- [ ] **Step 1: Guard the hint send**

At ~line 2256, change:

```ts
    if (
      providerRef.current &&
      voiceBackendRef.current !== 'gemini' &&
      hovered &&
      hoverKey !== lastHoverHintRef.current &&
      now - lastHoverHintAtRef.current > HOVER_HINT_THROTTLE_MS
    ) {
```

to:

```ts
    // Contract B (deixis vs teaching): while a teach sequence is active, the proactive hint
    // would feed the model spurious "pointed command" context mid-teaching — mute it. The
    // "Pointing at" pill still renders locally; only this silent model hint is gated.
    if (
      providerRef.current &&
      voiceBackendRef.current !== 'gemini' &&
      !teachingSnapshotRef.current?.sequence &&
      hovered &&
      hoverKey !== lastHoverHintRef.current &&
      now - lastHoverHintAtRef.current > HOVER_HINT_THROTTLE_MS
    ) {
```

- [ ] **Step 2: Verify — typecheck + full suite**

Run: `npm run lint && npm test`
Expected: tsc clean; all suites PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(teach): Contract B — mute proactive deixis hint while a teach sequence is active"
```

---

### Task 5: The posture prompt — scribe judgment in `buildInstructions` (TDD)

**Files:**
- Modify: `src/prompt/instructions.ts` (~line 106, after the whiteboard paragraph)
- Test: `src/prompt/instructions.test.ts`

**Interfaces:**
- Consumes: nothing new — a static prompt section.
- Produces: the returned instructions string now names every `teach_*` tool and the posture rules; the live model reads it at connect time (`buildInstructions` is already called with `voiceTools` at ~App.tsx:1843).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('buildInstructions — honest desktop assistant', …)` block in `src/prompt/instructions.test.ts`:

```ts
  it('carries the teaching posture judgment (Plan 2)', () => {
    for (const s of [honest, confident]) {
      // The three postures and every teach tool the model may call:
      expect(s).toContain('teach_highlight');
      expect(s).toContain('teach_sequence');
      expect(s).toContain('teach_step_done');
      expect(s).toContain('teach_clear');
      expect(s).toMatch(/JUST DO IT/);
      expect(s).toMatch(/"guide"/);
      expect(s).toMatch(/"teach"/);
      // Intensity ∝ complexity + the automatic fade contract:
      expect(s).toMatch(/one-step task/i);
      expect(s).toMatch(/\[TEACHING STATE\]/);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/prompt/instructions.test.ts`
Expected: FAIL — `expected … to contain 'teach_highlight'`.

- [ ] **Step 3: Add the section to `buildInstructions`**

In `src/prompt/instructions.ts`, insert a new paragraph after the whiteboard paragraph (~line 106, `To explain a concept, you may sketch a diagram…`) and before the `revise_text` paragraph:

```ts
TEACHING vs DOING — pick the posture from what the user asked for:
- JUST DO IT (no teaching tool): the user wants the task DONE — "save it", "make it bold", "add a slide". Call the action verb (or respond) and skip teaching entirely.
- GUIDE (teach_sequence with posture "guide"): a quick walkthrough — "how do I save?", "walk me through it". Numbered markers appear on their screen; YOU pace it: speak one short sentence for the step, then call teach_step_done to advance to the next.
- TEACH (teach_sequence with posture "teach"): learn-by-doing — "show me how", "teach me", "let me try". You demonstrate step 1 only; the USER performs each remaining step by clicking the real control. Do not call teach_step_done past your demonstration — the app advances on their clicks.
- INTENSITY MATCHES COMPLEXITY: never build a sequence for a one-step task — just act, or use a single teach_highlight. Reserve teach_sequence for genuinely multi-step tasks. Use teach_relate to connect elements when the user asks how things relate.
- TERSE: each step instruction is ONE short sentence; your voice carries only the single guideLine — the detail lives in the on-screen overlays, not your speech.
- FADE IS AUTOMATIC: [TEACHING STATE] tells you the active posture and fade level. On a repeat of the same taskKey, be terser and re-explain less — the scaffolding recedes on its own. Call teach_clear when the task is done or the user moves on. An unresolvable target returns an error naming it — fix the name or highlight instead; never pretend a sequence started.
```

Concretely, change the end of the whiteboard paragraph:

```ts
To explain a concept, you may sketch a diagram on the whiteboard: wb_node (key, x, y 0-1000, text) places labelled nodes, wb_connect (from,to keys) wires them, wb_label adds captions; call wb_clear when done. Reuse each node's key to connect it; keep diagrams small and in service of one explanation.

When the user points at a word in the Word document…
```

to:

```ts
To explain a concept, you may sketch a diagram on the whiteboard: wb_node (key, x, y 0-1000, text) places labelled nodes, wb_connect (from,to keys) wires them, wb_label adds captions; call wb_clear when done. Reuse each node's key to connect it; keep diagrams small and in service of one explanation.

TEACHING vs DOING — pick the posture from what the user asked for:
- JUST DO IT (no teaching tool): the user wants the task DONE — "save it", "make it bold", "add a slide". Call the action verb (or respond) and skip teaching entirely.
- GUIDE (teach_sequence with posture "guide"): a quick walkthrough — "how do I save?", "walk me through it". Numbered markers appear on their screen; YOU pace it: speak one short sentence for the step, then call teach_step_done to advance to the next.
- TEACH (teach_sequence with posture "teach"): learn-by-doing — "show me how", "teach me", "let me try". You demonstrate step 1 only; the USER performs each remaining step by clicking the real control. Do not call teach_step_done past your demonstration — the app advances on their clicks.
- INTENSITY MATCHES COMPLEXITY: never build a sequence for a one-step task — just act, or use a single teach_highlight. Reserve teach_sequence for genuinely multi-step tasks. Use teach_relate to connect elements when the user asks how things relate.
- TERSE: each step instruction is ONE short sentence; your voice carries only the single guideLine — the detail lives in the on-screen overlays, not your speech.
- FADE IS AUTOMATIC: [TEACHING STATE] tells you the active posture and fade level. On a repeat of the same taskKey, be terser and re-explain less — the scaffolding recedes on its own. Call teach_clear when the task is done or the user moves on. An unresolvable target returns an error naming it — fix the name or highlight instead; never pretend a sequence started.

When the user points at a word in the Word document…
```

(The section lives in the template literal shared by both honest and confident variants, like the whiteboard/annotate paragraphs.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/prompt/instructions.test.ts`
Expected: PASS — all instructions tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/prompt/instructions.ts src/prompt/instructions.test.ts
git commit -m "feat(teach): posture prompt — guide/teach/just-do-it judgment + fade contract in buildInstructions (TDD)"
```

---

### Task 6: Integration verification + build

**Files:**
- None modified — verification only (fix regressions in place if any step fails).

- [ ] **Step 1: Full typecheck, suite, and production build**

Run: `npm run lint && npm test && npm run build`
Expected: tsc clean; ALL suites PASS; vite build succeeds.

- [ ] **Step 2: Demo regression — `?teach=1` still self-paces**

Run: `npx vitest run src/teaching/demoScript.test.ts src/teaching/teachingStore.test.ts src/teaching/teachTools.test.ts`
Expected: PASS — foundation untouched (Global Constraints), demo clicks advance because the demo path is `isLive === false` (Task 1, case demo→true).

- [ ] **Step 3: Commit (only if fixes were needed), then report the owed live smokes**

No commit if clean. Report to the user that the LIVE smoke checklist from spec §8 is owed and needs an API key (cannot be automated here):

1. "how do I save?" → agent-paced guide sequence (clicks don't advance it).
2. "teach me to add a slide" → teach posture; the user performs steps (agent stops at step 0).
3. "just save it" → the action fires, no sequence.
4. Repeat the same task → terser, less scaffold (fade).
5. Hover during an active sequence → no proactive `[CONTEXT: the cursor is over…]` hint sent (non-Gemini backend).
6. A sequence over a non-existent element → honest error returned to the model, no partial sequence.

---

## Self-review (done at plan time)

- **Spec coverage:** §2 live wiring → Task 2; §3 Contract A → Tasks 1+3; §4 Contract B → Task 4 (ref added in Task 3); §5 posture prompt → Task 5; §6 perception → no task (constraint: no new work); §7 honesty invariants → encoded in Tasks 2 (errors as data), 3 (no double-advance), 5 (fade honesty); §8 testing → Tasks 1/5 (pure TDD), 6 (integration), live smokes reported as owed; §9 files → all four files covered, two new.
- **Type consistency:** `advanceOnClick(isLive: boolean, posture: TeachPosture | null): boolean` is identical in Tasks 1 and 3; `teachingSnapshotRef` produced in Task 3, consumed in Task 4; `teachCallToEvent(fc, entitiesRef.current)` matches its export signature in `teachTools.ts:43`.
- **Placeholder scan:** every code step carries the actual code; no TBDs.
