# Word-Level Interaction — Phase C (Outward Action) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user point at a word that names something (a restaurant, a person) and ask the agent to act outward on it — reserve, call, look up — as a **witnessed, honestly-simulated** action.

**Architecture:** A new `act_on` verb, wired exactly like the existing `share` verb: called without `confirm` it witness-renders the outward intent; called with `confirm=true` (after the user approves) it "commits" a **simulation** — nothing is really sent or booked, and the witness card says so. A parallel `actRequest` state + witness card mirrors `shareRequest` (share is untouched).

**Tech Stack:** React 19, TypeScript, Vitest (node), the existing witness/feedback grammar (`emitFeedback`, `sendToolResponse`, the witness-card render pattern).

**Spec:** `docs/superpowers/specs/2026-07-09-word-level-interaction-design.md` (Part C / §4). Phase C of 3 (A + B landed and pushed). Consumes Phase A's word referent (the pointed word feeds `act_on`'s `target`).

## Global Constraints

- **Simulated + labeled:** `act_on` sends/books/dials NOTHING. The witness card and feedback explicitly say "simulated". Same honesty stance as the existing `share` verb (which also sends nothing).
- **Always witnessed:** without `confirm` → witness-render; the outward "commit" happens only with `confirm=true` (model) or the confirm button (user). No silent outward action.
- **Mirror `share`, don't touch it:** add a PARALLEL `actRequest` state + `act_on` branch + `confirmAct`/`cancelAct` + a dedicated witness card. Do NOT modify the `share` verb, `shareRequest`, or its card.
- **Node test env:** the tool def + verb class get a small unit test; the App wiring gates on tsc + full suite + build; live behavior is human smoke.

---

### Task 1: `ACT_TOOL` + verb class

**Files:**
- Modify: `src/scenarios.ts`
- Test: `src/scenarios.test.ts` (add)

**Interfaces:**
- Produces: `ACT_TOOL: VoiceTool` (name `act_on`, params target/intent/details/confirm; required target+intent); `VERB_CLASS.act_on = 'share'`.

- [ ] **Step 1: Write the failing test**

Add to `src/scenarios.test.ts`:

```ts
import { ACT_TOOL, classOf } from './scenarios';

describe('act_on tool', () => {
  it('is defined with the outward-action params and simulation note', () => {
    expect(ACT_TOOL.name).toBe('act_on');
    const props = (ACT_TOOL.parameters as { properties: Record<string, unknown>; required: string[] });
    expect(Object.keys(props.properties)).toEqual(expect.arrayContaining(['target', 'intent', 'details', 'confirm']));
    expect(props.required).toEqual(['target', 'intent']);
    expect(ACT_TOOL.description.toLowerCase()).toContain('simulated');
  });

  it('classifies act_on as an outward (share-class) verb', () => {
    expect(classOf('act_on')).toBe('share');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scenarios.test.ts`
Expected: FAIL — `ACT_TOOL` is not exported.

- [ ] **Step 3: Implement**

In `src/scenarios.ts`, add to `VERB_CLASS`:

```ts
  act_on: 'share',
```

Export the tool (near `REVISE_TOOL`):

```ts
export const ACT_TOOL: VoiceTool = {
  name: 'act_on',
  description: 'Perform an outward real-world action on what an on-screen word names — e.g. reserve a table, call, or look it up. Provide target (the name, e.g. a restaurant), intent (what to do, e.g. "reserve a table"), and optional details. OUTWARD, high-commitment, and SIMULATED: call WITHOUT confirm to witness-render the request first; call with confirm=true only after the user explicitly approves. Nothing is really sent, booked, or dialed.',
  parameters: { type: 'object', properties: {
    target: { type: 'string', description: 'The thing the word names (e.g. a restaurant or person).' },
    intent: { type: 'string', description: 'The outward action, e.g. "reserve a table", "call".' },
    details: { type: 'string', description: 'Optional specifics, e.g. "party of 4 at 7pm".' },
    confirm: { type: 'boolean', description: 'Set true ONLY after the user explicitly confirms. Omit to witness-render first.' },
  }, required: ['target', 'intent'] },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scenarios.test.ts`
Expected: PASS (2 new + existing green).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/scenarios.ts src/scenarios.test.ts
git commit -m "feat(scenarios): ACT_TOOL + act_on verb class — outward simulated action (TDD)"
```

---

### Task 2: `act_on` App wiring — state, routing, witness card, tool, prompt

**Files:**
- Modify: `src/App.tsx`, `src/prompt/instructions.ts`

**Context:** Mirror the `share` verb exactly. `shareRequest` state is at `src/App.tsx:478`; the `share` branch at `~1114`; `confirmShare`/`cancelShare` at `~1286`; the share witness card at `~2728`; the idle-activity guard referencing `shareRequest` at `~525`; `voiceTools` memo at `~304`. Add the parallel `act_on` versions of each. Integration — gate tsc + suite + build.

- [ ] **Step 1: Import `ACT_TOOL`**

In `src/App.tsx`, add `ACT_TOOL` to the existing `import { ... } from './scenarios';` list (alongside `REVISE_TOOL`).

- [ ] **Step 2: Add `actRequest` state (mirror `shareRequest`)**

Immediately after the `shareRequest` state + ref (~line 478-481), add:

```ts
  const [actRequest, setActRequest] = useState<{ target: string; intent: string; details?: string; confirmed: boolean } | null>(null);
  const actRequestRef = useRef<typeof actRequest>(null);
  useEffect(() => { actRequestRef.current = actRequest; }, [actRequest]);
```

- [ ] **Step 3: Keep the session alive while an act is pending**

In the guard at ~line 525 (currently `if ((pendingAction && !pendingAction.confirmed) || (shareRequest && !shareRequest.confirmed))`), add the act clause:

```ts
    if ((pendingAction && !pendingAction.confirmed) || (shareRequest && !shareRequest.confirmed) || (actRequest && !actRequest.confirmed)) {
```

And add `actRequest` to that effect's dependency array (currently `[pendingAction, shareRequest]` → `[pendingAction, shareRequest, actRequest]`).

- [ ] **Step 4: Add the `act_on` routing branch**

In `handleVoiceToolCall`, add a branch beside the `share` branch (place it before the `annotate_` branch):

```ts
    } else if (fc.name === 'act_on') {
      // C2b Part C: outward action on what a word names (reserve, call, look up). SIMULATED like
      // share — witness the intent, "commit" only on confirm, and never actually send/book/dial.
      const args = (fc.args ?? {}) as { target?: string; intent?: string; details?: string; confirm?: boolean };
      const target = typeof args.target === 'string' ? args.target : '';
      const intent = typeof args.intent === 'string' ? args.intent : '';
      const details = typeof args.details === 'string' ? args.details : undefined;
      const confirmed = args.confirm === true;
      if (!target || !intent) {
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: 'act_on needs a target and an intent.' });
      } else if (!confirmed) {
        addLog('tool', `Tool Call: act_on(witness) — ${intent} → ${target}${details ? `: ${details}` : ''}`);
        setActRequest({ target, intent, details, confirmed: false });
        emitFeedback({ outcome: 'needs-confirm', verbClass: 'share', label: `Confirm: ${intent} → ${target}` });
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, witnessed: true });
      } else {
        addLog('event', `Simulated: ${intent} → ${target}${details ? `: ${details}` : ''}`);
        setActRequest({ target, intent, details, confirmed: true });
        emitFeedback({ outcome: 'committed', verbClass: 'share', label: `${intent} → ${target} (simulated)` });
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, simulated: true });
      }
```

- [ ] **Step 5: Add `confirmAct`/`cancelAct` (mirror `confirmShare`/`cancelShare`)**

Immediately after `cancelShare` (~line 1296), add:

```ts
  const confirmAct = () => {
    if (!actRequest || actRequest.confirmed) return;
    setActRequest({ ...actRequest, confirmed: true });
    emitFeedback({ outcome: 'committed', verbClass: 'share', label: `${actRequest.intent} → ${actRequest.target} (simulated)` });
    providerRef.current?.sendTextHint('[SYSTEM: the user confirmed the action via button — it was SIMULATED (nothing really sent/booked). Do not re-call the tool; do not acknowledge.]');
  };
  const cancelAct = () => {
    if (!actRequest || actRequest.confirmed) return;
    setActRequest(null);
    providerRef.current?.sendTextHint('[SYSTEM: the user cancelled the action via button — drop it and wait.]');
  };
```

- [ ] **Step 6: Add `ACT_TOOL` to the live tool set**

In the `voiceTools` memo (~line 304), append `ACT_TOOL` (available in every program, like `share`):

```ts
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL],
```

- [ ] **Step 7: Add the act witness card**

In `src/App.tsx`, in the witness-cards container (the `<div>` after `{/* Witness cards ... */}` that renders `{shareRequest && (...)}`), add an act card AFTER the `shareRequest` card and before `{pendingAction && (...)}`:

```tsx
            {actRequest && (
              <section className={`shrink-0 bg-[var(--card-bg)] border rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300 ${actRequest.confirmed ? 'border-green-500/50' : 'border-amber-500/40'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {actRequest.confirmed
                    ? <CheckCircle size={16} className="text-green-500" />
                    : <Shield size={16} className="text-amber-500" />}
                  <span className={`text-[11px] font-mono font-bold uppercase tracking-widest ${actRequest.confirmed ? 'text-green-500' : 'text-amber-500'}`}>
                    {actRequest.confirmed ? 'Done · simulated' : 'About to act — confirm'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 mb-2">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Action</span>
                    <span className="font-semibold">{actRequest.intent}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Target</span>
                    <span className="font-semibold">{actRequest.target}</span>
                  </div>
                  {actRequest.details && (
                    <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <span className="text-[10px] font-mono uppercase text-[var(--text-secondary)] w-16 shrink-0">Details</span>
                      <span>{actRequest.details}</span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-mono text-[var(--text-secondary)] mb-3">Simulated — this prototype doesn't really send, book, or dial anything.</p>
                {!actRequest.confirmed && (
                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm" onClick={confirmAct}>Confirm</Button>
                    <Button variant="outline" size="sm" onClick={cancelAct}>Cancel</Button>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] ml-1">or say "yes"</span>
                  </div>
                )}
              </section>
            )}
```

- [ ] **Step 8: Add the prompt note**

In `src/prompt/instructions.ts`, add one sentence (near the revise_text note, matching the file's assembly style):

```
When the user points at a word that names something in the world (a restaurant, a person) and asks to act on it — reserve, call, look it up — call act_on with target (the name), intent (the action), and any details; it is witness-rendered and only "done" after the user confirms, and it is always simulated (this prototype sends nothing).
```

- [ ] **Step 9: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (201 + Task 1's 2 new).
Run: `npx vite build` → success.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/prompt/instructions.ts
git commit -m "feat(outward): act_on witnessed simulated outward action + card + prompt (C2b Part C)"
```

---

## Human smoke (owed — needs an API key)

- Point at a restaurant name in the doc, say "reserve a table here for 4" → an act witness card appears ("About to act — confirm", Action/Target/Details, "Simulated — …"); confirm → "Done · simulated"; nothing is really sent.
- Say "yes"/"cancel" (voice) resolves the card like share.
- Confirm the model is told (tool response + system hint) the action was simulated, so it doesn't claim a real booking.
