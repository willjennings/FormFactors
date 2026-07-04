# Desktop Shell (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tourism-demo scaffolding with a true desktop shell — desktop plane, draggable/resizable program window + dock, talk-or-type omnibox with suggestion chips, debug drawer — and delete the map/London/photos-era subsystems, rewriting the system prompt as an honest desktop assistant.

**Architecture:** Demolition first (map + tourism tools, photos-era canvas, registry map entity), then the prompt rewrite (extracted to a pure module with a de-tourism regression test), then the shell components (each a focused file under `src/shell/`), then relocation (omnibox, drawer) and the witness buttons. Every task compiles and passes the suite independently. Slice A2 (the response rail) is a separate plan; the rail's dock position is reserved but nothing rail-specific is built here.

**Tech Stack:** React 19 + Vite 6 + Tailwind v4, TypeScript, Vitest, lucide-react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-desktop-shell-design.md` (decisions: window model (b) draggable/resizable single window + dock; tasks → omnibox suggestion chips).

## Global Constraints

- Branch: `honest-mode`. Work directly on it (repo convention; `main` is disconnected).
- **De-tourism is absolute:** after this plan, `grep -inE "london|landmark|itinerary|tour guide|tourism" src/` returns ZERO hits, and the prompt regression test (Task 4) forbids the vocabulary forever.
- **Kept verbs:** `explain` and `share` survive in `VOICE_TOOLS` (grammar generalized); `update_map`, `show_directions`, `synthesize` are deleted.
- Deixis mechanics are untouched: 0-1000 coordinate space over `<main>`, pointer painting, markers, `[data-element-id]` measurement, teaching overlays.
- `ProgramSurface` changes in exactly one way: its internal `TitleBar` render is removed (window chrome takes over). Elements, models, click wiring untouched.
- Direct clicks still commit immediately; voice Policy (`decideCommit`) untouched.
- No progress bars. Reducers never throw. Persistence is fail-soft (pattern: `src/teaching/persistence.ts`).
- Suggestion chips prefill the omnibox only — they NEVER auto-execute.
- Undo stays first-class: ⌘Z works everywhere; the drawer is not the only entry point.
- Verify per task: `npx tsc --noEmit && npx vitest run`. Final: `npx vite build`.
- Commit after every task with the message given.

## File Structure

```
src/prompt/instructions.ts        CREATE  buildInstructions extracted + rewritten (pure)
src/prompt/instructions.test.ts   CREATE  capabilities present + de-tourism regression
src/shell/windowState.ts          CREATE  pure window geometry: clamp/load/save (fail-soft)
src/shell/windowState.test.ts     CREATE  tests for the above
src/shell/ProgramWindow.tsx       CREATE  window chrome: title bar, drag, resize, ✕
src/shell/MenuBar.tsx             CREATE  app name, status dot, theme + drawer toggles
src/shell/Dock.tsx                CREATE  program icons, swap semantics
src/shell/Omnibox.tsx             CREATE  text + mic + status + inline errors + chips
src/shell/DebugDrawer.tsx         CREATE  all dials/log/testbed/world-state, slide-over
src/App.tsx                       MODIFY  demolition + shell mounting (many regions, anchored below)
src/scenarios.ts                  MODIFY  VERB_CLASS cleanup, task copy neutralized
src/entities/registry.ts          MODIFY  map entity removed; layout param simplified
src/entities/registry.test.ts     MODIFY  map expectations removed
src/teaching/TeachingLayer.tsx    MODIFY  vacuous map filters removed
src/teaching/demoScript.test.ts   MODIFY  layout fixture loses map
src/widgets/ProgramSurface.tsx    MODIFY  internal TitleBar render removed
src/widgets/surfaceModels.ts      MODIFY  + docStatusLabel(doc) for the window title bar
```

App.tsx demolition tasks name symbols + verify with greps; implementers locate by the quoted anchor snippets (line numbers are approximate — always search for the anchor text).

---

### Task 1: Map + tourism-tool excision

**Files:**
- Modify: `src/App.tsx` (VOICE_TOOLS ~179; handlers ~1489-1586; state ~494-496, ~751-753; trip pattern ~1931-1948; committer ~2193-2229; map-box JSX ~3155-3172; vision map draw ~2771-2780; layout hint ~705; updateLayout ~664-717; feedforward pill ~3080; on-map pointer special-cases ~2568-2593; itinerary UI ~3570-3591; listening-box `pendingMapUpdate` references ~3528-3545)
- Modify: `src/scenarios.ts` (VERB_CLASS ~496-511; TASK_LIBRARY 'pattern' + share copy ~205-216)

**Interfaces:**
- Produces: `VOICE_TOOLS` contains exactly `explain` and `share`. `updateLayout` no longer requires `.map-box` (guard becomes `if (photosEl)`); it passes a zero map bbox to `buildEntities` (removed for real in Task 3). No `mapUrl`/`mapType`/`mapQuery`/`directions`/`pendingMapUpdate`/`proposedItinerary` state anywhere.

- [ ] **Step 1: Delete the tourism tools and handlers**

In `src/App.tsx`:
- `VOICE_TOOLS` (~179): delete the `update_map`, `show_directions`, and `synthesize` entries. Keep `explain` and `share`. In `explain`'s description replace `The landmark or thing being identified.` with `The on-screen element or thing being identified.`; in `share`'s description replace `something (e.g. an itinerary) with another person (e.g. "share this with Lia")` with `the current document with another person`.
- In `handleVoiceToolCall`: delete the `update_map` (~1489-1508), `show_directions` (~1509-1531), and `synthesize` (~1538-1569) branches entirely (including the hardcoded London landmark arrays inside them). Keep `explain` and `share` branches; in the share branch, keep behavior identical.
- Delete the pending-map committer effect (search `pendingMapUpdate` — the effect ~2193-2229) and every `pendingMapUpdate` state/reference (listening-box conditions ~3528-3545 lose it from their boolean chains).
- Delete state: `mapQuery`, `mapType`, `directions` (~494-496), the `mapUrl` memo (~751-753), `proposedItinerary` state and its sidebar card (~3570-3591), `identifiedLandmarksRef` and the trip-pattern effect (~1931-1948 — the `[SYSTEM: TRIP PATTERN ...]` payload). Leave a one-line comment where the trip-pattern effect was: `// Proactive pattern-offer seam retired with the tourism payload; re-aim at program behavior when a goal model exists.`
- Delete the map-box JSX (~3155-3172, the `.map-box` div + iframe; the hidden `<canvas ref={persistentCanvasRef}>` inside it moves OUT temporarily — re-parent it directly under `<main>` unchanged; Task 2 deletes it).
- `updateLayout` (~664-717): change the guard `if (photosEl && mapEl) {` to `if (photosEl) {`; delete the `mapEl` query and `mRect`; pass `map: { ymin: 0, xmin: 0, ymax: 0, xmax: 0 }` into both `setLayoutBounds` and the `buildEntities` layout arg. Remove the ResizeObserver's `.map-box` observation (~718-721).
- Layout hint (~705): replace the hint string with:
```ts
providerRef.current.sendTextHint(`[SYSTEM UPDATE: The on-screen program elements are at these coordinates (ymin, xmin, ymax, xmax):\n${layoutInfo}\nUse these to identify what the user is pointing at when they say "this" or "here". DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]`);
```
- Vision compositor: delete the "Draw Map Box" block (~2811-2815, fills `layoutBounds.map`) and the "GOOGLE MAPS" label drawing that follows it.
- Feedforward pill (~3080-3082 and ~3121-3126): remove the `hoveredId !== MAP_ENTITY_ID` conditions (just `hoveredId`); remove the `MAP_ENTITY_ID` import once zero uses remain — if other uses remain (pointer special-cases below), remove them all in this step: search `MAP_ENTITY_ID` in App.tsx and eliminate every use (map hover ring ~3157 died with the JSX; `isActuallyOnMap`/"that's the map, try the camera roll" pointer-down special-case ~2568-2593 is deleted outright; circle-gesture "the map" hint copy ~1975 reworded to name empty space only).
- `handleReset` (~2990+): delete the `setMapQuery`/`setMapType`/`setDirections`/`setProposedItinerary` reset lines.

In `src/scenarios.ts`:
- `VERB_CLASS`: delete the `update_map`, `show_directions`, and `synthesize` entries and the `// tourism / map verbs` comment (keep `explain`, `share`).
- `TASK_LIBRARY`: delete the `pattern` task (`key: 'pattern'`, "It spots a pattern"). In `share-person`, change the description's `'Share this with Lia'` hint to `'Share this with my editor'` and the hint field to `'Say "Share this with my editor"'`.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx vitest run
grep -cn "update_map\|show_directions\|synthesize\|pendingMapUpdate\|mapUrl\|proposedItinerary\|identifiedLandmarks\|MAP_ENTITY_ID" src/App.tsx  # expect 0
grep -in "London\|landmark" src/App.tsx src/scenarios.ts  # expect ONLY buildInstructions hits (rewritten in Task 4)
```
Expected: type check clean; suite green (registry/demoScript tests still pass — the registry still builds a zero-bbox map entity until Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/scenarios.ts
git commit -m "feat(shell): excise the map and tourism tools — explain and share survive, generalized"
```

---

### Task 2: Photos-era canvas subsystem excision

**Files:**
- Modify: `src/App.tsx` (INITIAL_IMAGE ~105; persistentCanvasRef ~463; mount-load ~789-824; resetCanvas ~2945-2985 and its caller in handleReset; captureImageArea ~630-658; executeImageEdit + pendingEdit + getClosestAspectRatio ~1059-1266 and `pendingEdit` threading in the pending-action committer ~2174+; circle-gesture crop send ~2630-2668; control-center magnifier `currentImage`/`currentCoords` ~3699-3724; listening-box `pendingEdit` references ~3528-3545)

**Interfaces:**
- Produces: no image-generation or hidden-canvas code remains. The circle gesture still draws paint paths and drops markers; it no longer crops/sends pixels (Gemini crop-attach path removed — deixis hints and markers carry the meaning).

- [ ] **Step 1: Delete the subsystem**

In `src/App.tsx`, delete: the `INITIAL_IMAGE` and `BASE_SIZE` constants; `persistentCanvasRef` and the re-parented hidden canvas element (Task 1 moved it under `<main>`); the mount-time image load effect (~789-824, draws INITIAL_IMAGE); `resetCanvas` and its call in `handleReset`; `captureImageArea`; `executeImageEdit`, `getClosestAspectRatio`, the `pendingEdit` state (~378-387) and every reference (the pending-action committer keeps ONLY the `pendingAction` path; listening-box conditions drop `pendingEdit` from their boolean chains and the `pendingEdit?.prompt` fallback); the circle-gesture block that awaits `captureImageArea` and sends cropped pixels via `sendClientContent` (~2630-2668) — keep the marker drop and the pointing hint that precede it; the control-center "AI Vision State" magnifier section (~3697-3725) and the now-unused `currentImage`/`currentCoords` state; any `[HARD RESET ...]` hint sends that lived in the image-edit flow.

Remove imports that become unused (tsc will name them).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npx vitest run
grep -cn "INITIAL_IMAGE\|persistentCanvas\|captureImageArea\|executeImageEdit\|pendingEdit\|getClosestAspectRatio" src/App.tsx  # expect 0
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(shell): delete the photos-era canvas/image-edit subsystem"
```

---

### Task 3: Registry loses the mandatory map entity (TDD)

**Files:**
- Modify: `src/entities/registry.ts`, `src/entities/registry.test.ts`, `src/teaching/demoScript.test.ts`, `src/teaching/TeachingLayer.tsx`, `src/App.tsx` (buildEntities call sites ~699, ~2970; computePointingConfidence ~148-152; layoutBounds `map` field)

**Interfaces:**
- Produces: `buildEntities(program, perceived, layout)` with `type Layout = { items: { id: number; bbox: LayoutBox }[] } | null` (no `map`). `MAP_ENTITY_ID` deleted. `SceneEntity.category: ElementCategory` (no `'map'`). Entity count per program = 4.

- [ ] **Step 1: Update the tests first**

`src/entities/registry.test.ts`: remove `map` from every layout fixture (`{ items: [...] }` only); change any assertion expecting the map entity (entity count 5 → 4, no `'Google Maps'`/`MAP_ENTITY_ID` expectations). `src/teaching/demoScript.test.ts`: `layoutFor` drops the `map` field. Run `npx vitest run src/entities src/teaching/demoScript.test.ts` — expect FAIL (type errors: layout requires `map`).

- [ ] **Step 2: Implement**

`src/entities/registry.ts`: delete `MAP_ENTITY_ID`; `SceneEntity.category` becomes `ElementCategory`; `Layout` loses `map`; `buildEntities` returns `tiles` only (delete the map entity block). Update the doc comment ("one entity per program image + the map" → "one entity per program element").
`src/teaching/TeachingLayer.tsx`: the two `e.category !== 'map'` filters (demo gate ~55, scrim ids ~77 — scrim keeps `e.category !== 'program'`) drop the vacuous map test; `buildDemoScript`'s `entities.filter((e) => e.category !== 'map')` in demoScript.ts likewise if present.
`src/App.tsx`: `buildEntities` call sites drop the `map` arg (`{ items: ... }`); delete the `layoutBounds.map` field and the zero-bbox placeholder from Task 1; `computePointingConfidence` drops the `o.category === 'map'` filter line.

- [ ] **Step 3: Verify**

Run: `npx vitest run` then `npx tsc --noEmit`. Expected: green/clean.
`grep -rn "MAP_ENTITY_ID\|'map'" src/entities src/teaching src/App.tsx | grep -v "\.test\." ` — expect no entity-category hits (string 'map' may legitimately appear in unrelated words; judge hits).

- [ ] **Step 4: Commit**

```bash
git add src/entities src/teaching src/App.tsx
git commit -m "feat(entities): registry drops the mandatory map entity — the scene is the program"
```

---

### Task 4: Prompt extraction + honest desktop rewrite (TDD)

**Files:**
- Create: `src/prompt/instructions.ts`, `src/prompt/instructions.test.ts`
- Modify: `src/App.tsx` (delete inline `buildInstructions` ~1369-1478; import from the new module)

**Interfaces:**
- Produces: `buildInstructions(honest: boolean, program: Program, entities: SceneEntity[]): string` — pure, same signature, new content. Consumed at the `connect` call (~2101) unchanged.

- [ ] **Step 1: Write the failing test**

`src/prompt/instructions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInstructions } from './instructions';
import { getProgram, buildActionTools } from '../scenarios';
import { buildEntities } from '../entities/registry';

const program = getProgram('word');
const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });

describe('buildInstructions — honest desktop assistant', () => {
  const honest = buildInstructions(true, program, entities);
  const confident = buildInstructions(false, program, entities);

  it('never speaks tourism', () => {
    for (const s of [honest, confident]) {
      expect(s).not.toMatch(/london|landmark|itinerary|tour.?guide|google map|map view|gallery of|screenshots/i);
    }
  });

  it('describes the real world: the program window and its elements', () => {
    expect(honest).toContain(program.label);
    for (const img of program.images) expect(honest).toContain(img.title);
    expect(honest).toMatch(/window/i);
  });

  it('carries the program action verbs and the kept tools', () => {
    for (const t of buildActionTools(program.id)) expect(honest).toContain(t.name);
    expect(honest).toContain('explain');
    expect(honest).toContain('share');
  });

  it('keeps the grounding grammar: confidence, witness, silence-on-success', () => {
    expect(honest).toMatch(/confidence/i);
    expect(honest).toMatch(/WITNESS-RENDER/);
    expect(honest).toMatch(/grounding_mismatch/);
    expect(honest).toMatch(/STAY SILENT/);
    expect(confident).not.toMatch(/confidence: low/i);
  });
});
```

Run: `npx vitest run src/prompt` — FAIL (module not found).

- [ ] **Step 2: Implement `src/prompt/instructions.ts`**

Port the existing structure, de-tourismed. Full content:

```ts
import type { Program } from '../scenarios';
import { buildActionTools } from '../scenarios';
import type { SceneEntity } from '../entities/registry';
import { displayName } from '../entities/registry';

/** The system prompt: an honest desktop assistant over one live program window.
 *  Same grounding grammar as the tourism-era prompt (confidence tiers, witness-render,
 *  commitment × confidence, grounding-mismatch protocol) — zero tourism vocabulary,
 *  describing exactly the world that renders. */
export function buildInstructions(honest: boolean, program: Program, entities: SceneEntity[]): string {
  const actionTools = buildActionTools(program.id);
  const ACTIONS_SECTION = actionTools.length ? `

${program.label.toUpperCase()} ACTIONS:
${actionTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}
- Every action verb takes (target, detail, confirm). These are HIGH-COMMITMENT — they change the document. ${honest
  ? 'WITNESS-RENDER your interpretation first: state WHAT you will do and WHERE (e.g. "Make the document body bold?") and WAIT for an explicit "yes". Only then call again with confirm=true. Never mutate the document on a low-confidence or unconfirmed guess.'
  : 'Call the verb with confirm=true and do it immediately.'}
- GROUNDING CHECK: if a tool response comes back with "grounding_mismatch": true, your read of the element disagreed with where the user is actually pointing (app_referent). Do NOT proceed — ask which one they mean, then act on their answer.
- The result appears live in the program window.` : '';

  const POINTING_TRUTH_CONFIDENT = `- The hints are the ABSOLUTE SOURCE OF TRUTH. If it says "Save button", the user IS pointing at the Save button.`;
  const POINTING_TRUTH_HONEST = `- The hints carry a CONFIDENCE, e.g. "(confidence: high)" or "(confidence: low — could also be the Save As button)". Treat confidence as a first-class signal, NOT as absolute truth.
- HIGH CONFIDENCE + a low-stakes request ("what is this?"): act immediately with one short answer. Do NOT ask, do NOT hedge. Being sure means staying fluid; asking when you already know is annoying.
- LOW CONFIDENCE, or a hint listing multiple candidates: do NOT call any tool yet. Ask ONE short disambiguating question — e.g. "I think that's Save — or did you mean Save As next to it?" — then act on the user's answer. Never silently pick one of two plausible candidates.
- HONEST UNCERTAINTY is a valid, first-class answer. If the hint says "Nothing (Empty Space)" or you genuinely cannot tell, say so briefly — "I'm not sure what you're pointing at — could you point again?" — and do NOT invent an element.
- GRICEAN QUALITY (do not assert what you are unsure of): when confidence is low, HEDGE — "I think that's the Crop tool" rather than "Here's the Crop tool."
- COMMITMENT scales the friction, not just confidence. Document-changing verbs are HIGH-COMMITMENT — witness-render before committing even when reasonably confident. Low-commitment identification never gets this gate — gating it would be nagging.`;

  const CONFIDENT_VERB_RULES = `DEEPER REQUESTS:
- If the user asks to "share this with <name>", call share(recipient, payload, confirm=true) and send it.`;
  const HONEST_VERB_RULES = `DEEPER REQUESTS (honest — inference scales the verification loop UPSTREAM):
- OUTWARD ACTIONS are the highest commitment of all — they act on another person and can't be taken back. For "share this with <name>", call share(recipient, payload) WITHOUT confirm first to witness-render exactly WHO and WHAT goes out — "Send the ${program.label} document to Sam?" — and wait. Only after an explicit yes, call share(recipient, payload, confirm=true). Never send to a person without showing the recipient and payload first.
- NEVER act on an inferred intention without an explicit yes.`;

  return `You are a point-and-speak desktop assistant. The user is working in ${program.label}, shown in a live program window on their desktop; you help them operate it by pointing and speaking or typing. Act on what they point at and explicitly ask for.
CRITICAL: You MUST remain completely silent unless the user has explicitly spoken to you with a clear command or question. Do not initiate conversation, do not greet the user, and do not speak if there is only background noise or silence.
Wait for the user to finish their instructions before responding.
CRITICAL: Do NOT repeat yourself or say the same sentence twice in a row.
Only speak after being asked to do something. Do not provide intros or ask if there's anything else you can help with.

CRITICAL - CONFIRMATION POLICY (read first):
- DO NOT verbally confirm or narrate successful actions. The APP signals success to the user (a sound + an on-screen cue) — your voice is NOT the confirmation channel.
- After you call a tool and it succeeds, STAY SILENT. Do not say "Here's...", "Done", "Okay", or describe what you did.
- Speak ONLY to: (a) ask a clarifying/disambiguating question, (b) honestly hedge when you are genuinely unsure, or (c) report a problem/error. In those cases, one short sentence.
- This means most successful turns produce a tool call and NO speech. That is correct and intended.

CRITICAL - RESPONSE STYLE:
- ALWAYS respond in the same language the user uses.
- Keep any verbal responses (questions, hedges, errors) extremely short and direct.
- Avoid filler words like "Perfect", "Sure", "Okay".
- Be concise. One short sentence is the maximum.

CRITICAL - ACTION LOGIC:
- NEVER perform any actions based on just pointing or hovering.
- You MUST wait for an explicit verbal or typed command before calling any tools.
- If the user just names an element without a command, STAY SILENT.
- Pointing is ONLY context for when the user speaks.
- Once you understand the command, call the tool immediately.
- CRITICAL: Whenever you act, you MUST call the corresponding tool. Never just say you are doing something without the tool call — and per the CONFIRMATION POLICY, do not narrate the success at all; just call the tool.

The user is looking at a live ${program.label} window. Its interactive elements are real controls they can click, and you can act on.

MARKERS (Visual Anchors):
- When the user circles something, a marker labeled M1, M2, etc., is placed at that location.
- These markers are visible in your video feed as gold circles with labels.
- Use them to identify locations the user refers to (e.g., "this one and that one").
- CRITICAL: When a new request starts, ignore all previous markers. ALWAYS use the most recent visual information and pointing hints.

ON-SCREEN ELEMENTS (the user points at these — use these names exactly):
${entities.length
  ? entities.map(e => `- ${displayName(e)}`).join('\n')
  : program.images.map(img => `- ${img.title}`).join('\n')}

USER CAPABILITIES:
1. Point at an element and ask "what is this?" / "what does this do?". This is an IDENTIFICATION request — call explain(subject) and answer verbally by naming the element. It changes nothing.
2. Point at an element and ask to act on it (edit, format, insert, save, a photo edit). Call the matching ${program.label} action verb.
3. Ask to "share this with <name>". This is an OUTWARD request — call share(recipient, payload). See DEEPER REQUESTS below.

CRITICAL - POINTING LOGIC:
- You will receive hints in the format: [USER JUST SAID "THIS" WHILE POINTING AT: Element Name].
- When the user says "this", "here", "that", or "there", they are ALWAYS referring to the element in the [USER JUST SAID ...] message that arrived MOST RECENTLY BEFORE or DURING that word.
${honest ? POINTING_TRUTH_HONEST : POINTING_TRUTH_CONFIDENT}
- ALWAYS ignore elements from previous requests. Each new command starts fresh with the pointing hints.
- If the hint says "Nothing (Empty Space)", ask the user to point at an element.
- Once the intent is clear, call the tools to act — and per the CONFIRMATION POLICY, stay silent on success.
- CRITICAL: After you receive a tool response (success: true), do NOT speak. The app has already confirmed it to the user.
- DO NOT REPEAT YOURSELF.

${honest ? HONEST_VERB_RULES : CONFIDENT_VERB_RULES}
${ACTIONS_SECTION}

COORDINATE SYSTEM:
- The entire view is 1000x1000. The program window's elements are at the coordinates given in layout updates.

When the user points and speaks or types a command, call the appropriate tool and STAY SILENT on success (the app confirms). Speak only to ask, hedge, or report an error.`;
}
```

- [ ] **Step 3: Swap App.tsx onto the module**

Delete the inline `buildInstructions` (~1369-1478); add `import { buildInstructions } from './prompt/instructions';`. The call site (~2101) is unchanged.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/prompt` then `npx tsc --noEmit && npx vitest run` — all green.
`grep -inE "london|landmark|itinerary|tour" src/` — expect 0 hits.

- [ ] **Step 5: Commit**

```bash
git add src/prompt src/App.tsx
git commit -m "feat(prompt): honest desktop-assistant instructions, extracted + regression-tested against tourism vocabulary"
```

---

### Task 5: Window state (TDD) + ProgramWindow on the desktop plane

**Files:**
- Create: `src/shell/windowState.ts`, `src/shell/windowState.test.ts`, `src/shell/ProgramWindow.tsx`
- Modify: `src/widgets/surfaceModels.ts` (+ `docStatusLabel`), `src/widgets/surfaceModels.test.ts`, `src/widgets/ProgramSurface.tsx` (remove internal TitleBar renders), `src/App.tsx` (main layout: photos-box → windowed desktop; updateLayout `.program-window`; layoutBounds `photos` → `window`; vision compositor rename + desktop background)

**Interfaces:**
- Produces:
  - `WindowRect = { x: number; y: number; w: number; h: number }` (px, relative to the desktop plane).
  - `clampWindow(rect: WindowRect, plane: { width: number; height: number }): WindowRect` (min 320×240; fully on-plane).
  - `loadWindowRect(programId: string): WindowRect | null` / `saveWindowRect(programId: string, rect: WindowRect): void` — sessionStorage key `shell.window.<programId>`, fail-soft.
  - `docStatusLabel(doc: MockDoc): string` → `'Saved' | 'Saved as <name>' | 'Edited'`.
  - `ProgramWindow` props: `{ title: string; statusLabel: string; rect: WindowRect; onRectChange: (r: WindowRect) => void; onClose: () => void; planeRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }`; root div `className="program-window ..."`.

- [ ] **Step 1: Write the failing tests**

`src/shell/windowState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampWindow, loadWindowRect, saveWindowRect } from './windowState';

describe('windowState', () => {
  it('clamps below minimum size up to 320x240', () => {
    expect(clampWindow({ x: 0, y: 0, w: 100, h: 100 }, { width: 1200, height: 800 })).toEqual({ x: 0, y: 0, w: 320, h: 240 });
  });
  it('keeps the window fully on the plane', () => {
    const r = clampWindow({ x: 1100, y: 700, w: 400, h: 300 }, { width: 1200, height: 800 });
    expect(r.x + r.w).toBeLessThanOrEqual(1200);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it('round-trips through sessionStorage and fails soft on garbage', () => {
    saveWindowRect('word', { x: 10, y: 20, w: 640, h: 480 });
    expect(loadWindowRect('word')).toEqual({ x: 10, y: 20, w: 640, h: 480 });
    sessionStorage.setItem('shell.window.excel', '{nope');
    expect(loadWindowRect('excel')).toBeNull();
    expect(loadWindowRect('missing')).toBeNull();
  });
});
```

Add to `src/widgets/surfaceModels.test.ts`:

```ts
import { docStatusLabel } from './surfaceModels';
// inside the describe block:
  it('docStatusLabel covers every doc kind', () => {
    expect(docStatusLabel(initialMockDoc('word'))).toBe('Edited');
    expect(docStatusLabel({ ...word(), saved: true })).toBe('Saved');
    expect(docStatusLabel({ ...word(), saved: true, savedAs: 'X.docx' })).toBe('Saved as X.docx');
    expect(docStatusLabel(initialMockDoc('photo'))).toBe('Edited');
  });
```

Run: `npx vitest run src/shell src/widgets/surfaceModels.test.ts` — FAIL (modules/functions missing).

- [ ] **Step 2: Implement the pure modules**

`src/shell/windowState.ts`:

```ts
// Pure window geometry + fail-soft persistence for the single program window.
export type WindowRect = { x: number; y: number; w: number; h: number };

export const MIN_W = 320;
export const MIN_H = 240;

export function clampWindow(rect: WindowRect, plane: { width: number; height: number }): WindowRect {
  const w = Math.min(Math.max(rect.w, MIN_W), plane.width);
  const h = Math.min(Math.max(rect.h, MIN_H), plane.height);
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, plane.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, plane.height - h));
  return { x, y, w, h };
}

const key = (programId: string) => `shell.window.${programId}`;

export function loadWindowRect(programId: string): WindowRect | null {
  try {
    const raw = sessionStorage.getItem(key(programId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && typeof p?.w === 'number' && typeof p?.h === 'number') return p;
    return null;
  } catch { return null; }
}

export function saveWindowRect(programId: string, rect: WindowRect): void {
  try { sessionStorage.setItem(key(programId), JSON.stringify(rect)); } catch { /* fail-soft */ }
}
```

`src/widgets/surfaceModels.ts` — add:

```ts
/** Window-chrome status for any doc kind (the surfaces' internal TitleBar retired into window chrome). */
export function docStatusLabel(doc: MockDoc): string {
  return doc.kind === 'word' ? status(doc.saved, doc.savedAs) : status(doc.saved);
}
```

Run the two test files — PASS.

- [ ] **Step 3: ProgramWindow component**

`src/shell/ProgramWindow.tsx`:

```tsx
import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { clampWindow, type WindowRect } from './windowState';

type Props = {
  title: string;
  statusLabel: string;
  rect: WindowRect;
  onRectChange: (r: WindowRect) => void;
  onClose: () => void;
  planeRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

/** The single program window: real chrome over a ProgramSurface. Drag by title bar,
 *  resize from the corner. Geometry is clamped to the desktop plane; measurement
 *  (data-element-id) re-runs automatically via the existing ResizeObserver. */
export function ProgramWindow({ title, statusLabel, rect, onRectChange, onClose, planeRef, children }: Props) {
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: WindowRect } | null>(null);

  const plane = () => {
    const el = planeRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
  };

  const begin = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation(); // the plane's pointer handlers own deixis painting, not window drags
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { mode, startX, startY, start } = drag.current;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    onRectChange(clampWindow(
      mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy },
      plane(),
    ));
  };
  const end = () => { drag.current = null; };

  return (
    <div
      className="program-window absolute z-10 flex flex-col rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[var(--card-border)] bg-[var(--bg-color)] cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{title}</span>
          <span className={`text-[10px] font-mono font-bold ${statusLabel === 'Edited' ? 'text-[var(--text-secondary)] opacity-60' : 'text-green-500'}`}>{statusLabel}</span>
        </div>
        <button onClick={onClose} title="Close window" className="p-1 rounded hover:bg-[var(--card-border)] text-[var(--text-secondary)]">
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 min-h-0 p-2">{children}</div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
        onPointerDown={begin('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        title="Resize"
      />
    </div>
  );
}
```

- [ ] **Step 4: Retire ProgramSurface's internal TitleBar and mount the window in App**

`src/widgets/ProgramSurface.tsx`: remove the `<TitleBar .../>` line from each of the four surfaces (WordSurface, ExcelSurface, PptSurface, PhotoSurface). Keep the `TitleBar` component exported but unused by surfaces — delete it entirely if nothing else imports it (grep first).

`src/App.tsx`:
- Add imports: `import { ProgramWindow } from './shell/ProgramWindow'; import { clampWindow, loadWindowRect, saveWindowRect, type WindowRect } from './shell/windowState'; import { docStatusLabel } from './widgets/surfaceModels';`
- Add state near the other UI state:

```ts
  const defaultWindowRect = (): WindowRect => clampWindow({ x: 48, y: 48, w: 680, h: 620 },
    { width: mainContainerRef.current?.clientWidth ?? 1200, height: mainContainerRef.current?.clientHeight ?? 800 });
  const [windowRect, setWindowRect] = useState<WindowRect>(() => loadWindowRect(DEFAULT_PROGRAM) ?? { x: 48, y: 48, w: 680, h: 620 });
  const [windowOpen, setWindowOpen] = useState(true);
  useEffect(() => { setWindowRect(loadWindowRect(activeProgram) ?? defaultWindowRect()); setWindowOpen(true); }, [activeProgram]);
  useEffect(() => { saveWindowRect(activeProgram, windowRect); }, [activeProgram, windowRect]);
```
- Replace the photos-box block (the `.photos-box` div ~3125-3153 with its "Camera roll"-era wrapper and the `col-span-2` ProgramSurface mount) with:

```tsx
          {windowOpen && (
            <ProgramWindow
              title={program.label}
              statusLabel={docStatusLabel(mockDoc)}
              rect={windowRect}
              onRectChange={setWindowRect}
              onClose={() => setWindowOpen(false)}
              planeRef={mainContainerRef}
            >
              <ProgramSurface ref={surfaceRef} program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick} />
            </ProgramWindow>
          )}
```
- `<main>` gets the desktop-plane treatment: keep its ref/pointer handlers/classes but make it `relative` full-size and add a wallpaper: append to its className `bg-[var(--bg-color)]` and add inside it (first child) `<div aria-hidden className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:24px_24px]" />`. Remove the old two-box flex sizing classes (`lg:pl-24`, `gap-2 lg:gap-0`, `items-center lg:justify-start justify-center`) — the window positions itself absolutely.
- `updateLayout`: query `main.querySelector('.program-window')` for the window bbox; rename `layoutBounds.photos` → `layoutBounds.window` (type ~572-576 and all readers). The `photosEl` guard becomes the window query (`if (!winEl) return;` measurement waits for a window); `[data-element-id]` scan now runs against `winEl`. ResizeObserver observes `.program-window` instead of `.photos-box`.
- Vision compositor: the "Draw Photos Box" block (~2736) draws `layoutBounds.window` instead of `photos`; the surface-snapshot draw's fallback `layoutBounds.surface ?? layoutBounds.photos` becomes `?? layoutBounds.window`. Add a desktop background fill first (`ctx.fillStyle = '#f1f3f7'` full canvas already exists — keep).
- The teach-mode gate and TeachingLayer mount are untouched (entities still measure).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run` — green.
Manual: `npm run dev` — window renders with title chrome; drag + resize work; overlays/badges track after a drag (`?teach=1` rings follow); ✕ closes; program switch restores per-program geometry.

- [ ] **Step 6: Commit**

```bash
git add src/shell src/widgets src/App.tsx
git commit -m "feat(shell): draggable/resizable program window on a desktop plane"
```

---

### Task 6: MenuBar + Dock; welcome/onboarding demolition

**Files:**
- Create: `src/shell/MenuBar.tsx`, `src/shell/Dock.tsx`
- Modify: `src/App.tsx` (mount both; delete welcome modal ~3782-3837 and onboarding coach-mark ~3839-3873 + `showWelcome`/`showOnboarding` state; relocate the floating theme toggle ~3216-3224 into MenuBar; `firstRunHint` state added for Task 7)

**Interfaces:**
- Produces: `MenuBar` props `{ isLive: boolean; isConnecting: boolean; isDarkMode: boolean; onToggleTheme: () => void; onToggleDrawer: () => void }`. `Dock` props `{ active: ProgramId; onSelect: (id: ProgramId) => void; onReopen: () => void }` (selecting the active program re-opens a closed window).

- [ ] **Step 1: Components**

`src/shell/MenuBar.tsx`:

```tsx
import React from 'react';
import { Sun, Moon, Settings2 } from 'lucide-react';

export function MenuBar({ isLive, isConnecting, isDarkMode, onToggleTheme, onToggleDrawer }: {
  isLive: boolean; isConnecting: boolean; isDarkMode: boolean;
  onToggleTheme: () => void; onToggleDrawer: () => void;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-9 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur">
      <span className="text-[12px] font-semibold text-[var(--text-primary)]">FormFactors</span>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-secondary)]">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-amber-500 animate-pulse' : 'bg-slate-400 opacity-40'}`} />
          {isLive ? 'live' : isConnecting ? 'connecting' : 'off'}
        </span>
        <button onClick={onToggleTheme} title="Toggle theme" className="p-1.5 rounded hover:bg-[var(--bg-color)] text-[var(--text-primary)]">
          {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button onClick={onToggleDrawer} title="Debug drawer" className="p-1.5 rounded hover:bg-[var(--bg-color)] text-[var(--text-primary)]">
          <Settings2 size={14} />
        </button>
      </div>
    </div>
  );
}
```

`src/shell/Dock.tsx`:

```tsx
import React from 'react';
import { FileText, Table, Presentation, Image as ImageIcon } from 'lucide-react';
import { PROGRAMS, type ProgramId } from '../scenarios';

const ICONS: Record<ProgramId, React.ReactNode> = {
  word: <FileText size={18} />, excel: <Table size={18} />,
  powerpoint: <Presentation size={18} />, photo: <ImageIcon size={18} />,
};

export function Dock({ active, onSelect, onReopen }: {
  active: ProgramId; onSelect: (id: ProgramId) => void; onReopen: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-4 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/85 backdrop-blur shadow-lg">
      {PROGRAMS.map(p => (
        <button
          key={p.id}
          onClick={() => (p.id === active ? onReopen() : onSelect(p.id))}
          title={p.label}
          className={`p-2 rounded-xl transition-all active:scale-90 ${p.id === active
            ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-color)] hover:text-[var(--text-primary)]'}`}
        >
          {ICONS[p.id]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount + demolish**

In `src/App.tsx`:
- Mount inside `<main>` (after the wallpaper div): `<MenuBar isLive={isLive} isConnecting={isConnecting} isDarkMode={isDarkMode} onToggleTheme={() => setIsDarkMode(!isDarkMode)} onToggleDrawer={() => setDrawerOpen(o => !o)} />` and `<Dock active={activeProgram} onSelect={handleProgramChange} onReopen={() => setWindowOpen(true)} />`. Add `const [drawerOpen, setDrawerOpen] = useState(false);` (consumed in Task 8; until then the button is inert state).
- Delete the floating theme-toggle button block (~3216-3224 in the old numbering — search `Switch to Light Mode`).
- Delete the welcome modal JSX (search `Point and Speak with the AI-Pointer`), the onboarding coach-mark JSX (search `Try to complete these tasks`), and the `showWelcome`/`showOnboarding` state + effects. Add `const [firstRunHint, setFirstRunHint] = useState(true);` (rendered by the Omnibox in Task 7).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — green. Manual: menu bar + dock render; dock swaps programs; theme toggles.

```bash
git add src/shell src/App.tsx
git commit -m "feat(shell): menu bar + dock; welcome modal and onboarding retired"
```

---

### Task 7: Omnibox + suggestion chips; carousel retired

**Files:**
- Create: `src/shell/Omnibox.tsx`
- Modify: `src/App.tsx` (mount; delete the task-carousel section ~3178-3343 + `currentTaskIndex`/`completedTaskIds`/`slideDirection`/confetti/`goToTask`/`isCongratulationsPage` machinery; delete the "Listening Box" section ~3526-3568 — its typed form moves into the Omnibox; keep `focusTitle` derivation working)

**Interfaces:**
- Consumes: `sendTypedInput(text)`, `startLiveSession()`, `providerRef.current?.close()`, `isLive`/`isConnecting`/`lastError`/`liveTranscription`, `TASKS` (`tasksForProgram`), `firstRunHint`/`setFirstRunHint`.
- Produces: `Omnibox` props `{ isLive: boolean; isConnecting: boolean; error: string | null; transcript: string | null; suggestions: { key: string; label: string; phrase: string; color: string }[]; firstRunHint: boolean; onSubmit: (text: string) => void; onMicToggle: () => void }`.
- **focusTitle:** with the carousel gone, `activeTask` no longer exists. Replace the `focusTitle` derivation (~767): `const [focusTitle, setFocusTitle] = useState<string | undefined>(undefined);` — set it when a suggestion chip is tapped (`setFocusTitle(TASKS.find(t => t.key === s.key)?.targetElement)`) and clear it on submit. The "Point here" affordance now follows chip intent instead of carousel position.

- [ ] **Step 1: Component**

`src/shell/Omnibox.tsx`:

```tsx
import React, { useState } from 'react';
import { Mic, MicOff, CornerDownLeft } from 'lucide-react';

export type Suggestion = { key: string; label: string; phrase: string; color: string };

export function Omnibox({ isLive, isConnecting, error, transcript, suggestions, firstRunHint, onSubmit, onMicToggle, onChipTap }: {
  isLive: boolean; isConnecting: boolean; error: string | null; transcript: string | null;
  suggestions: Suggestion[]; firstRunHint: boolean;
  onSubmit: (text: string) => void; onMicToggle: () => void; onChipTap: (s: Suggestion) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(640px,90vw)] flex flex-col items-stretch gap-2">
      {firstRunHint && !isLive && (
        <p className="text-center text-[11px] font-mono text-[var(--text-secondary)]">Point at things and ask — or type.</p>
      )}
      {suggestions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
          {suggestions.map(s => (
            <button key={s.key}
              onClick={() => { setDraft(s.phrase); onChipTap(s); }}
              className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-mono border bg-[var(--card-bg)]/85 backdrop-blur border-[var(--card-border)] text-[var(--text-primary)] hover:border-[var(--accent-color)] transition-colors"
              style={{ boxShadow: `inset 2px 0 0 rgb(${s.color})` }}
              title={s.label}
            >
              {s.phrase}
            </button>
          ))}
        </div>
      )}
      {(error || transcript) && (
        <p className={`text-center text-[11px] font-mono ${error ? 'text-red-500' : 'text-[var(--text-secondary)] italic'}`}>
          {error ?? transcript}
        </p>
      )}
      <form
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSubmit(draft); setDraft(''); } }}
      >
        <button type="button" onClick={onMicToggle} disabled={isConnecting}
          title={isLive ? 'End voice session' : 'Start voice session'}
          className={`p-2 rounded-xl transition-all active:scale-90 ${isLive ? 'bg-green-500/15 text-green-500' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-color)]'} disabled:opacity-40`}>
          {isLive ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask or tell me anything — point while you type"
          disabled={isConnecting}
          className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        <button type="submit" disabled={isConnecting || !draft.trim()}
          className="p-2 rounded-xl text-[var(--accent-color)] hover:bg-[var(--accent-color)]/10 disabled:opacity-30 transition-colors">
          <CornerDownLeft size={15} />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Mount + demolish in App.tsx**

- Derive suggestions (near `TASKS`):

```ts
  const suggestions = useMemo(() => TASKS.map(t => ({
    key: t.key,
    label: t.title,
    phrase: t.hint.match(/"(.*?)"/)?.[1] ?? t.title,
    color: ACTION_CATEGORIES[t.action].color,
  })), [TASKS]);
```
- Mount inside `<main>`:

```tsx
          <Omnibox
            isLive={isLive} isConnecting={isConnecting}
            error={lastError} transcript={liveTranscription || null}
            suggestions={suggestions} firstRunHint={firstRunHint}
            onSubmit={(text) => { setFirstRunHint(false); setFocusTitle(undefined); sendTypedInput(text); }}
            onMicToggle={() => { setFirstRunHint(false); isLive ? providerRef.current?.close() : startLiveSession(); }}
            onChipTap={(s) => setFocusTitle(TASKS.find(t => t.key === s.key)?.targetElement)}
          />
```
- Replace the `focusTitle` derivation per the Interfaces note (state instead of carousel-derived; keep the `focusTitleRef` sync effect).
- Delete: the task-carousel `<section id="task-section">` (~3178-3343) and all its machinery (`currentTaskIndex`, `completedTaskIds`, `slideDirection`, `goToTask`, `isCongratulationsPage`, `isCurrentTaskDone`, `allTasksCompleted`, the `confetti` import); the "Listening Box" section (~3526-3568) including the old typed `<form>` (Omnibox replaces it) — keep `typedDraft` deletion in mind: the old `typedDraft` state dies with it (Omnibox owns its draft; `sendTypedInput` signature unchanged).
- The `motion`/`AnimatePresence` imports may become unused — remove if tsc says so.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — green. Manual: chips render per program and prefill (never auto-send); typed submit works; mic toggles session; error/transcript render at the omnibox; "Point here" ring appears on chip tap.

```bash
git add src/shell/Omnibox.tsx src/App.tsx
git commit -m "feat(shell): talk-or-type omnibox with suggestion chips; task carousel retired"
```

---

### Task 8: Debug drawer; the sidebar dies

**Files:**
- Create: `src/shell/DebugDrawer.tsx`
- Modify: `src/App.tsx` (delete the whole `<aside id="sidebar-section">` ~3176-3762; mount the drawer; ⌘Z keybinding; undo affordance on the feedback toast; the root layout div loses its two-column flex)

**Interfaces:**
- Produces: `DebugDrawer` props carry everything the sidebar owned. To keep the interface finite the drawer receives grouped props:

```ts
type DrawerProps = {
  open: boolean; onClose: () => void;
  honestMode: boolean; onHonestMode: (v: boolean) => void;
  voiceBackend: ProviderKind; onVoiceBackend: (v: ProviderKind) => void;
  autonomy: Autonomy; onAutonomy: (v: Autonomy) => void;
  feedbackMode: FeedbackMode; onFeedbackMode: (v: FeedbackMode) => void;
  sendFrequency: number; onSendFrequency: (v: number) => void;
  worldState: string;               // serializeMockDoc(mockDoc)
  undoCount: number; onUndo: () => void;
  onEndSession: () => void; onReset: () => void; isLive: boolean;
  logs: { time: string; type: string; message: string }[];
  isEmbedded: boolean;
};
```

- [ ] **Step 1: Component**

`src/shell/DebugDrawer.tsx` — a right slide-over (`fixed right-0 top-9 bottom-0 w-[360px] z-40`, translate-x transition, backdrop click closes). Content, in order, reusing the exact control patterns from the current sidebar (copy the JSX blocks when deleting them from App): honest-mode toggle; voice-backend select; autonomy select; feedback select; earcon audition buttons (`EARCON_KINDS.map(...)`); testbed telemetry block + Export JSON; refresh-rate slider; embedded-preview warning (`isEmbedded && !isLive`); End Session / Reset buttons (`isLive` gated); World state line + Undo button (undo enabled regardless of `isLive` — drop the old `isLive &&` gate around the world-state section); Operation Stream log list. Each block is the existing JSX relocated verbatim with props swapped for the drawer's prop names — no visual redesign.

- [ ] **Step 2: Demolish + rewire in App.tsx**

- Delete the entire `<aside id="sidebar-section">` (from `<aside` ~3176 to `</aside>` ~3762) INCLUDING the hidden Control Center. Blocks relocated into the drawer per Step 1; the program `<select>` block is deleted outright (the Dock owns switching); the session Start button is deleted (the omnibox mic owns it).
- Root layout: the wrapper div that made `main + aside` a two-column flex row loses the row classes; `<main>` becomes the full viewport under the menu bar (`h-full w-full`).
- Mount `<DebugDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} ... />` after `<main>` with all props wired.
- ⌘Z: in the existing keyboard effect (~2231), add before the number-key branch:

```ts
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); handleUndo(); return; }
```
  and remove the effect's early `isLive` gate for this branch only (undo must work offline; keep number keys live-gated).
- Undo affordance on the toast: in the feedback toast JSX (~3104-3122), when `feedbackToast.outcome !== 'error'` and `undoStack.length > 0`, append inside the toast: `<button onClick={handleUndo} className="pointer-events-auto ml-1 underline decoration-dotted text-[11px] font-mono">undo</button>` and change the toast container from `pointer-events-none` to `pointer-events-none [&>button]:pointer-events-auto`.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — green.
`grep -cn "sidebar-section\|Camera roll\|Mark as complete\|Start Point and Speak" src/App.tsx` — expect 0.
Manual: drawer opens from ⚙ with every dial working; ⌘Z undoes offline; toast shows undo.

```bash
git add src/shell/DebugDrawer.tsx src/App.tsx
git commit -m "feat(shell): debug drawer replaces the sidebar; undo goes first-class (⌘Z + toast)"
```

---

### Task 9: Witness cards get buttons and float above the omnibox

**Files:**
- Modify: `src/App.tsx` (pendingAction card ~3622-3655 and shareRequest card ~3594-3618 relocate + gain buttons; a shared confirm/cancel path)

**Interfaces:**
- Produces: `confirmPendingAction()` — commits the witnessed verb exactly as a model `confirm=true` call would: `applyAction` + undo memento + feedback + `[DOCUMENT STATE ...]` hint + `setPendingAction({ ...p, confirmed: true })` + a `[SYSTEM: the user confirmed via button — the action was applied. Do not re-call the tool.]` text hint. `cancelPendingAction()` — clears it + `[SYSTEM: the user cancelled — drop the pending action.]` hint. Share: `confirmShare()`/`cancelShare()` mirror it (share is simulated send: set `confirmed: true` + feedback, as the voice path does).

- [ ] **Step 1: Implement the handlers**

Add near `handleSurfaceAction` (they reuse its body's commit steps):

```ts
  // Witness cards are keyboard/click-confirmable — voice is no longer the only path (gap 9).
  const confirmPendingAction = () => {
    const p = pendingAction;
    if (!p || p.confirmed) return;
    const prevDoc = mockDocRef.current;
    const nextDoc = applyAction(prevDoc, p.verb, { target: p.target, detail: p.detail });
    mockDocRef.current = nextDoc;
    setMockDoc(nextDoc);
    setUndoStack(s => [...s, { doc: prevDoc, label: `${p.label} ${p.target}` }]);
    telemetry.action(p.verb, classOf(p.verb), 'commit', 'direct');
    emitFeedback({ outcome: 'committed', verbClass: classOf(p.verb), label: `${p.label} ${p.target}` });
    setPendingAction({ ...p, confirmed: true });
    providerRef.current?.sendTextHint(`[SYSTEM: the user confirmed via button — the action was applied. DOCUMENT STATE: ${serializeMockDoc(nextDoc)}. Do not re-call the tool; do not acknowledge.]`);
  };
  const cancelPendingAction = () => {
    if (!pendingAction || pendingAction.confirmed) return;
    setPendingAction(null);
    providerRef.current?.sendTextHint('[SYSTEM: the user cancelled the pending action via button — drop it and wait.]');
  };
  const confirmShare = () => {
    if (!shareRequest || shareRequest.confirmed) return;
    setShareRequest({ ...shareRequest, confirmed: true });
    emitFeedback({ outcome: 'committed', verbClass: 'share', label: `Shared with ${shareRequest.recipient}` });
    providerRef.current?.sendTextHint('[SYSTEM: the user confirmed the share via button — it was sent. Do not re-call the tool; do not acknowledge.]');
  };
  const cancelShare = () => {
    if (!shareRequest || shareRequest.confirmed) return;
    setShareRequest(null);
    providerRef.current?.sendTextHint('[SYSTEM: the user cancelled the share via button — drop it and wait.]');
  };
```

(If `setShareRequest`'s state name differs, match the existing declaration — search `shareRequest`.)

- [ ] **Step 2: Relocate + add buttons**

Move both cards out of the deleted sidebar's position (they were relocated implicitly when the aside died — re-home them): render inside `<main>`, stacked above the omnibox:

```tsx
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(560px,88vw)] flex flex-col gap-2">
            {/* shareRequest card JSX here (unchanged content), replacing the 'Say "yes, send it"' line with: */}
            {/* pendingAction card JSX here (unchanged content), replacing the 'Say "yes, do it"' line with: */}
          </div>
```

In BOTH cards, replace the say-to-confirm paragraph with:

```tsx
              {!___.confirmed && (
                <div className="flex items-center gap-2">
                  <button onClick={confirm___} autoFocus
                    className="px-4 py-1.5 rounded-full text-[12px] font-bold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all">
                    Confirm
                  </button>
                  <button onClick={cancel___}
                    className="px-4 py-1.5 rounded-full text-[12px] font-mono border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all">
                    Cancel
                  </button>
                  <span className="text-[10px] font-mono text-[var(--text-secondary)] ml-1">or say "yes"</span>
                </div>
              )}
```

(`___` = `pendingAction`/`shareRequest` with their respective handlers.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` — green.
Manual: trigger a witnessed action (autonomy = Confirm changes, click Save via voice/typed or lower autonomy) → card floats above omnibox; Enter (autofocus) confirms; the doc mutates; Cancel clears; voice "yes" still works.

```bash
git add src/App.tsx
git commit -m "feat(shell): witness cards float above the omnibox with Confirm/Cancel buttons"
```

---

### Task 10: Final sweep + verification

**Files:**
- Modify: `src/App.tsx` (dead imports/state), `index.css` (dead rules), memory of prior tasks

- [ ] **Step 1: Dead-code sweep**

```bash
grep -inE "london|landmark|itinerary|tour|camera roll|photos-box|map-box|AI-Pointer" src/ index.css  # expect 0 (judge incidental word hits)
npx tsc --noEmit  # names any unused imports — remove them
```
Delete `.photos-box`/`.map-box` CSS rules if any exist in `index.css`.

- [ ] **Step 2: Full verification**

Run: `npx vitest run` (all green) then `npx tsc --noEmit && npx vite build` (clean; pre-existing chunk-size warning acceptable).

Manual checklist (`npm run dev`):
- [ ] Desktop plane + menu bar + dock + omnibox render; no sidebar; no map anywhere.
- [ ] Window drags, resizes, persists per program, closes (✕) and reopens from the dock.
- [ ] All four programs work in the window; direct clicks commit; `?teach=1` overlays track a moved window.
- [ ] Chips prefill and never auto-send; "Point here" follows chip tap; typed submit round-trips (with key).
- [ ] Mic toggles the session; no-key shows an honest inline error at the omnibox.
- [ ] Drawer holds every dial + logs + world state + telemetry export; ⌘Z undoes offline; toast offers undo.
- [ ] Witness card: buttons confirm/cancel; voice confirm still works.
- [ ] Vision debug (with key): frame shows desktop + window pixels + cursor; no "GOOGLE MAPS" box.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(shell): A1 final sweep — the tourism demo is gone; the desktop stands"
```

---

## Self-Review Notes (already applied)

- Spec §2-§8 map to Tasks 5/6 (plane, window, dock), 7 (omnibox/chips/first-run), 4+1 (prompt + demolition), 8 (drawer, ⌘Z, undo toast), 9 (witness buttons), 1-3 (demolition + registry), 10 (sweep). §4's rail placeholder is deliberately NOT built — the teaching layer already renders sequences on-element; the rail arrives whole in A2 (spec allows: "shell first … rail second").
- Compile-safety ordering: Task 1 keeps a zero-bbox map in `layoutBounds` so `buildEntities` still typechecks until Task 3 removes the parameter; Task 5's `layoutBounds.photos → window` rename happens with the window mount so no orphan field ever exists.
- `focusTitle` ownership moves from carousel-derived to chip-driven state in Task 7 — the only behavioral change to deixis affordances, and it is spec-mandated (§5).
- Deletion tasks name symbols + grep-zero checks instead of reproducing hundred-line legacy blocks; all NEW code is complete in-plan.
