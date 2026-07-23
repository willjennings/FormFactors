# Register System (R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the interaction register a first-class, user-facing, telemetry-measured variable: one consolidated dial object, four named registers on a scaffold-density axis, a MenuBar pill + band + backtick chord, honest reconnect-on-switch, and named arms stamped on telemetry.

**Architecture:** Pure `src/register/` module (types, registry, helpers, band-key logic) + a mechanical App.tsx dial consolidation + thin render/prompt gates + reconnect machinery mirroring the existing honest-mode effect. A Register = named dial-point + prompt paragraph + telemetry arm; nothing else is new mechanism.

**Tech Stack:** TypeScript, vitest, existing vendored `src/ui/` primitives (Button/Tooltip/Select/Switch), lucide icons.

**Spec:** `docs/superpowers/specs/2026-07-23-register-system-design.md`

## Global Constraints

- The honesty floor is NEVER dialable: witnessed mutations, visual feedback floor, live/mic status.
- **Guided === today's defaults VERBATIM** (`honest:false, autonomy:'auto-safe', feedback:'earcon', confirmGoals:false, markings:false, chipDensity:'full', traceView:'ticker', teaching:'normal', proactivity:'on-goal'`) — the control-arm invariant, pinned by test. Terminal/Ambient/Cockpit pin `honest:true` (deliberate new arms).
- `chipDensity:'none'` must disable BOTH the chip row AND quick-fire digits (no invisible hot surfaces).
- `traceView:'hidden'` unmounts the ticker only — witness cards and toasts remain.
- Register switch mid-session RECONNECTS (honest-mode precedent, App.tsx:489-497) and is witnessed via the real activity seam.
- The dial consolidation task is ZERO behavior change — existing tests hold unmodified.
- Every task gate runs the FULL suite: `npx vitest run && npx tsc --noEmit` (Phase-0 lesson — no directory-scoped gates).
- Tap targets hit-24+; dark mode on all new surfaces; band/pill use `src/ui/` primitives.

---

### Task 1: The register module (pure)

**Files:**
- Create: `src/register/types.ts`, `src/register/registry.ts`
- Test: `src/register/registry.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `DialValues` (types.ts) — exact fields below; `Autonomy` imported from `../scenarios`, `FeedbackMode` from `../feedback`.
  - `DEFAULT_DIALS: DialValues` — today's app defaults (=== Guided's dials).
  - `RegisterDef = { key: string; label: string; glyph: string; era: 'old'|'today'|'emerging'|'maximal'; ethos: string; probe: string; dials: DialValues }`
  - `REGISTERS: RegisterDef[]` (order: terminal, ambient, guided, cockpit — minimal→maximal).
  - `resolveDials(key: string): DialValues` (throws `Error('unknown register: '+key)` on miss; returns a fresh copy).
  - `matchRegister(dials: DialValues): string | null` (named key on exact match, else null).
  - `diffDials(a: DialValues, b: DialValues): { dial: keyof DialValues; from: string; to: string }[]` (booleans stringified `'on'/'off'`).
  - `registerSection(key: string | null, dials: DialValues): string` — the prompt paragraph, fully DERIVED from dials (Custom gets a correct paragraph for free).

- [ ] **Step 1: Write the failing tests**

```ts
// src/register/registry.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_DIALS, REGISTERS, resolveDials, matchRegister, diffDials, registerSection } from './registry';

describe('registry', () => {
  it('ships exactly terminal/ambient/guided/cockpit in minimal→maximal order', () => {
    expect(REGISTERS.map(r => r.key)).toEqual(['terminal', 'ambient', 'guided', 'cockpit']);
    for (const r of REGISTERS) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.glyph.length).toBeGreaterThan(0);
      expect(r.ethos.length).toBeGreaterThan(0);
      expect(r.probe.length).toBeGreaterThan(0);
    }
  });

  it('CONTROL-ARM INVARIANT: guided === today\'s defaults verbatim (incl. honest:false)', () => {
    expect(resolveDials('guided')).toEqual(DEFAULT_DIALS);
    expect(DEFAULT_DIALS.honest).toBe(false);
    expect(DEFAULT_DIALS).toEqual({
      honest: false, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
      markings: false, chipDensity: 'full', traceView: 'ticker', teaching: 'normal', proactivity: 'on-goal',
    });
  });

  it('the three non-control registers pin honest:true and match the spec table', () => {
    expect(resolveDials('terminal')).toEqual({
      honest: true, autonomy: 'autonomous', feedback: 'silent', confirmGoals: false,
      markings: false, chipDensity: 'none', traceView: 'ticker', teaching: 'off', proactivity: 'never',
    });
    expect(resolveDials('ambient')).toEqual({
      honest: true, autonomy: 'auto-safe', feedback: 'earcon', confirmGoals: false,
      markings: false, chipDensity: 'grounded', traceView: 'hidden', teaching: 'off', proactivity: 'never',
    });
    expect(resolveDials('cockpit')).toEqual({
      honest: true, autonomy: 'manual', feedback: 'speech', confirmGoals: true,
      markings: true, chipDensity: 'full', traceView: 'ledger', teaching: 'eager', proactivity: 'idle-offer',
    });
  });

  it('resolveDials returns a fresh copy (mutation cannot corrupt the registry)', () => {
    const a = resolveDials('guided');
    a.honest = true;
    expect(resolveDials('guided').honest).toBe(false);
  });

  it('resolveDials throws on unknown key', () => {
    expect(() => resolveDials('vim')).toThrow(/unknown register/);
  });

  it('matchRegister round-trips every register and returns null on any twiddle', () => {
    for (const r of REGISTERS) expect(matchRegister(resolveDials(r.key))).toBe(r.key);
    expect(matchRegister({ ...resolveDials('guided'), markings: true })).toBeNull();
  });

  it('diffDials lists exactly the changed dials with readable values', () => {
    const d = diffDials(resolveDials('guided'), resolveDials('terminal'));
    const byDial = Object.fromEntries(d.map(x => [x.dial, x]));
    expect(byDial.chipDensity).toEqual({ dial: 'chipDensity', from: 'full', to: 'none' });
    expect(byDial.honest).toEqual({ dial: 'honest', from: 'off', to: 'on' });
    expect(byDial.feedback).toEqual({ dial: 'feedback', from: 'earcon', to: 'silent' });
    expect(diffDials(resolveDials('guided'), resolveDials('guided'))).toEqual([]);
  });

  it('registerSection derives the paragraph from dials, not canned prose', () => {
    const t = registerSection('terminal', resolveDials('terminal'));
    expect(t).toContain('REGISTER: Terminal');
    expect(t).toMatch(/no suggestion chips/i);          // chipDensity none
    expect(t).toMatch(/confirms silently/i);            // feedback silent
    expect(t).toMatch(/never offer (a )?walkthrough/i); // teaching off
    expect(t).toMatch(/act or answer/i);
    const g = registerSection('guided', resolveDials('guided'));
    expect(g).toContain('REGISTER: Guided');
    expect(g).not.toMatch(/no suggestion chips/i);
    const c = registerSection(null, { ...resolveDials('guided'), teaching: 'eager' });
    expect(c).toContain('REGISTER: Custom');            // null key → Custom, still coherent
    expect(c).toMatch(/offer (a )?walkthrough/i);       // teaching eager
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/register/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/register/types.ts
// R1 (spec 2026-07-23-register-system-design.md §3): every user-facing dial that shapes
// the interaction, as ONE object. NOT included (debug-only): voiceBackend, sendFrequency,
// whiteboardMode. The honesty floor (witnessed mutations, visual feedback floor, live/mic
// status) is never dialable.
import type { Autonomy } from '../scenarios';
import type { FeedbackMode } from '../feedback';

export interface DialValues {
  honest: boolean;                                  // prompt variant A/B
  autonomy: Autonomy;                               // friction dial (decideCommit)
  feedback: FeedbackMode;                           // silent | earcon | speech
  confirmGoals: boolean;                            // C3 eval: set_goal asks first
  markings: boolean;                                // highlight rings + legend
  chipDensity: 'none' | 'grounded' | 'full';        // chips + quick-fire gate
  traceView: 'hidden' | 'ticker' | 'ledger';        // ActivityTrace presentation
  teaching: 'off' | 'normal' | 'eager';             // teach offers + fade baseline (prompt gate)
  proactivity: 'never' | 'on-goal' | 'idle-offer';  // suggest_next / idle behavior (prompt gate)
}
```

```ts
// src/register/registry.ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite + new tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/register/
git commit -m "feat(register): pure registry — 4 registers, dial resolution, diff, prompt section"
```

---

### Task 2: Dial consolidation in App.tsx (mechanical, zero behavior change)

**Files:**
- Modify: `src/App.tsx` — declarations at :415-418 (honestMode+showMarkings), :609-616 (autonomy+feedback), :727-729 (confirmGoals); read sites :623, :1399, :1412, :1507, :1986, :2136, :2183-2186, :2373, :2524, :2557, :3450; DebugDrawer props :3684-3697; honest reconnect effect :487-497.

**Interfaces:**
- Consumes: `DialValues`, `DEFAULT_DIALS` from Task 1.
- Produces: `dials: DialValues` state + `dialsRef` + `setDial(patch: Partial<DialValues>): void` in App — later tasks read `dialsRef.current.*` and call `setDial`. The five old state names are GONE.

- [ ] **Step 1: Replace the five useStates with one**

Remove the five declarations (`showMarkings` :415, `honestMode` :418, `autonomy` :609-610, `feedbackMode` :613-614, `confirmGoals` :727) and their three sync effects (:612, :616, :729). Add near :415 (keep the DIAL A/B comment lines with the new block):

```ts
  // ALL user-facing interaction dials as one object (R1 spec §3). DIAL A = autonomy
  // (friction), DIAL B = feedback modality; honest = prompt variant A/B; the rest gate
  // chips/trace/teaching/proactivity. Debug-only knobs (backend, sendFrequency,
  // whiteboardMode) stay separate.
  const [dials, setDials] = useState<DialValues>(DEFAULT_DIALS);
  const dialsRef = useRef(dials);
  useEffect(() => { dialsRef.current = dials; }, [dials]);
  const setDial = (patch: Partial<DialValues>) => setDials(d => ({ ...d, ...patch }));
```

Import `DEFAULT_DIALS` and `DialValues` from `./register/registry` / `./register/types`.

- [ ] **Step 2: Rewrite every read site mechanically**

- `:623` `emitFeedbackAudio(ev, feedbackModeRef.current)` → `emitFeedbackAudio(ev, dialsRef.current.feedback)`
- `:1399` `decideCommit(verbClass, autonomyRef.current, confirmed)` → `decideCommit(verbClass, dialsRef.current.autonomy, confirmed)`
- `:1412`, `:1986`, `:2136`, `:2186`, `:2373` — `honestModeRef.current` → `dialsRef.current.honest`
- `:1507` `confirmGoalsRef.current` → `dialsRef.current.confirmGoals`
- `:2183-2184` telemetry fields → `autonomy: dialsRef.current.autonomy, feedback: dialsRef.current.feedback`
- `:2524`, `:2557`, `:3450` — `showMarkings` → `dials.markings` (state read; keep it in the effect deps at :2557 as `dials.markings`)
- DebugDrawer props (:3684-3697): `honestMode={dials.honest} onHonestMode={(v) => setDial({ honest: v })}` and likewise `autonomy`/`feedbackMode`/`showMarkings`/`confirmGoals` from `dials` + `setDial` patches. DebugDrawer's own file is untouched.

- [ ] **Step 3: Rework the honest reconnect effect**

Replace :487-497 (the `honestModeRef` + effect block — `honestModeRef` is deleted in Step 1's sweep) with:

```ts
  // Prompt-affecting dials: flipping any of these mid-session reconnects so the (system)
  // prompt matches — the same contract as the original honest-mode toggle. Register
  // switches ride this same effect (they change dials wholesale).
  // (feedback joins this key in the register-prompt task — today nothing in the prompt reads it.)
  const promptDialsKey = `${dials.honest}|${dials.teaching}|${dials.proactivity}|${dials.chipDensity}|${dials.traceView}`;
  const isInitialPromptSync = useRef(true);
  useEffect(() => {
    if (isInitialPromptSync.current) { isInitialPromptSync.current = false; return; }
    if (isLive && providerRef.current) {
      addLog('info', `Interaction dials changed — reconnecting to apply prompt variant...`);
      providerRef.current.close(); // onClose sets isLive=false
      setTimeout(() => { startLiveSession(); }, 800);
    }
  }, [promptDialsKey]);
```

(`autonomy`/`confirmGoals`/`markings` are app-side policy — not in the prompt, no reconnect; same as today.)

- [ ] **Step 4: Full gate**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 572+ tests pass unmodified, tsc + build clean. tsc is the real net here — it catches every missed read site because the old identifiers no longer exist.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(shell): consolidate the five interaction dials into one DialValues state"
```

---

### Task 3: Arm in telemetry

**Files:**
- Modify: `src/telemetry.ts:26-33` (SessionConfig), the `TelemetryEvent` union, `:198-201` (filename)
- Modify: `src/App.tsx:2181-2188` (telemetry.start call)
- Test: `src/telemetry.test.ts` (extend, using the file's established exportJSON/toMatchObject idiom)

**Interfaces:**
- Consumes: `DialValues` (Task 1), `dialsRef` (Task 2).
- Produces: `Arm = { register: string; base?: string; dials: DialValues }`; `SessionConfig.arm?: Arm`; `telemetry.registerSwitch(from: string, to: string, midSession: boolean): void` emitting `{ t, type: 'register_switch', from, to, midSession }`. Filename: `testbed-${ff}-${arm}-${cfg}-${startedAt}.json` where `arm = this.config?.arm?.register ?? 'unset'`.

- [ ] **Step 1: Write the failing tests**

Read `src/telemetry.test.ts` first; extend with its idiom:

```ts
it('stamps the arm on session config and register_switch events', () => {
  telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word',
    honest: false, device: DEVICE,
    arm: { register: 'guided', dials: DEFAULT_DIALS } });
  telemetry.registerSwitch('guided', 'terminal', true);
  const json = JSON.parse(telemetry.toJSON());   // or the file's export idiom
  expect(json.config.arm.register).toBe('guided');
  expect(json.events.find((e: any) => e.type === 'register_switch'))
    .toMatchObject({ from: 'guided', to: 'terminal', midSession: true });
});
```

(Adapt `DEVICE` and the export accessor to the file's real fixtures — it already has both.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/telemetry.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `src/telemetry.ts`: import `type { DialValues } from './register/types'`; add above SessionConfig:

```ts
export interface Arm {
  register: string;        // named register key, or 'custom'
  base?: string;           // when custom: the named register the twiddle started from
  dials: DialValues;       // fully resolved — the cohort definition
}
```

`SessionConfig` gains `arm?: Arm;` (optional — RambleLive's start call keeps compiling). Add the event to the union: `| { t: number; type: 'register_switch'; from: string; to: string; midSession: boolean }` and the method:

```ts
  registerSwitch(from: string, to: string, midSession: boolean) {
    this.events.push({ t: this.t(), type: 'register_switch', from, to, midSession });
  }
```

(Match the file's actual timestamp idiom — it may be `Date.now() - startedAt` inline.) Filename line :199:

```ts
      const arm = this.config?.arm?.register ?? 'unset';
      const cfg = this.config ? `${arm}-${this.config.backend}-${this.config.autonomy}-${this.config.feedback}` : 'session';
```

In `src/App.tsx` :2181-2188, add to the start config: `arm: { register: registerKeyRef.current ?? 'custom', dials: { ...dialsRef.current } },` — **Task 5 defines `registerKeyRef`; for THIS task use** `arm: { register: 'guided', dials: { ...dialsRef.current } },` **with a `// Task 5 threads the live register key` comment** (the key is still always 'guided' at this point — accurate).

- [ ] **Step 4: Full gate** — `npx vitest run && npx tsc --noEmit` → green/clean.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry.ts src/telemetry.test.ts src/App.tsx
git commit -m "feat(telemetry): named Arm on session config + register_switch event"
```

---

### Task 4: Render gates — chips and trace

**Files:**
- Create: `src/register/gates.ts` + `src/register/gates.test.ts`
- Modify: `src/App.tsx` (suggestions memo :337-343; ActivityTrace mount :3447)
- Modify: `src/shell/ActivityTrace.tsx` (add `variant` prop)

**Interfaces:**
- Consumes: `DialValues['chipDensity']` (Task 1), `dials` (Task 2).
- Produces: `visibleSuggestions<T>(suggestions: T[], chipDensity: DialValues['chipDensity'], groundingCount: number): T[]`; `ActivityTrace` gains `variant?: 'ticker' | 'ledger'` (default `'ticker'`).

- [ ] **Step 1: Write the failing gate test**

```ts
// src/register/gates.test.ts
import { describe, it, expect } from 'vitest';
import { visibleSuggestions } from './gates';

const CHIPS = [{ key: 'a' }, { key: 'b' }];

describe('visibleSuggestions', () => {
  it('none → empty (kills the chip row AND quick-fire, whose count comes from the same list)', () => {
    expect(visibleSuggestions(CHIPS, 'none', 0)).toEqual([]);
    expect(visibleSuggestions(CHIPS, 'none', 2)).toEqual([]);
  });
  it('grounded → chips only while the grounding buffer is non-empty', () => {
    expect(visibleSuggestions(CHIPS, 'grounded', 0)).toEqual([]);
    expect(visibleSuggestions(CHIPS, 'grounded', 1)).toEqual(CHIPS);
  });
  it('full → always', () => {
    expect(visibleSuggestions(CHIPS, 'full', 0)).toEqual(CHIPS);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement the gate + wire it**

```ts
// src/register/gates.ts
// Render gates derived from dials. ONE derivation feeds both the chip row and quick-fire
// (quickFireIndex bails on chipCount 0), so 'none' can never leave an invisible hot surface.
import type { DialValues } from './types';

export function visibleSuggestions<T>(
  suggestions: T[], chipDensity: DialValues['chipDensity'], groundingCount: number,
): T[] {
  if (chipDensity === 'none') return [];
  if (chipDensity === 'grounded' && groundingCount === 0) return [];
  return suggestions;
}
```

In `src/App.tsx`, rename the :337 memo to `allSuggestions`, then derive what BOTH consumers use (Omnibox prop :3645 and `suggestionsRef` :344-345, which quick-fire reads):

```ts
  const suggestions = useMemo(
    () => visibleSuggestions(allSuggestions, dials.chipDensity, grounding.length),
    [allSuggestions, dials.chipDensity, grounding.length],
  );
```

(`suggestionsRef` keeps mirroring `suggestions` — quick-fire goes inert for free because `chipCount` is 0.)

ActivityTrace mount :3447 becomes:

```tsx
        {dials.traceView !== 'hidden' && (
          <ActivityTrace state={activity} variant={dials.traceView} onOpenStream={() => setDrawerOpen(true)} />
        )}
```

- [ ] **Step 4: ActivityTrace `ledger` variant**

Read `src/shell/ActivityTrace.tsx` first. Add `variant?: 'ticker' | 'ledger'` to props (default `'ticker'`). `'ledger'` differences ONLY: render ALL entries in `state.entries` (not the VISIBLE_MAX window), skip the fade-out timer/opacity (rows persist), fixed right-edge column layout (`fixed right-2 top-14 bottom-24 w-64 overflow-y-auto`), same row rendering + click-to-open-stream. Keep the ticker path byte-identical when `variant` is absent. Dark mode + hit-24 on interactive rows.

- [ ] **Step 5: Full gate** — `npx vitest run && npx tsc --noEmit && npx vite build` → green/clean.

- [ ] **Step 6: Commit**

```bash
git add src/register/gates.ts src/register/gates.test.ts src/App.tsx src/shell/ActivityTrace.tsx
git commit -m "feat(register): chipDensity + traceView render gates (quick-fire inert with chips)"
```

---

### Task 5: Register state, prompt section, honest switch machinery

**Files:**
- Modify: `src/prompt/instructions.ts` (5th optional param), `src/prompt/instructions.test.ts`
- Modify: `src/App.tsx` (register state + applyRegister + connect site :2162-2163 + arm stamp from Task 3 + witnessed switch)

**Interfaces:**
- Consumes: `resolveDials`, `matchRegister`, `registerSection`, `REGISTERS` (Task 1); `setDials`/`dialsRef` (Task 2); `telemetry.registerSwitch` (Task 3).
- Produces: `buildInstructions(honest, program, entities, contextToken?, registerText?): string` (5th optional param — absent → byte-identical output); App: `registerKey: string | null` state (`'guided'` initial), `registerKeyRef`, `applyRegister(key: string): void` — Task 6's band calls `applyRegister`.

- [ ] **Step 1: Failing prompt test**

Append to `src/prompt/instructions.test.ts` (reuse its fixtures):

```ts
describe('register section', () => {
  it('appends the register paragraph when provided; absent → byte-identical legacy output', () => {
    const legacy = buildInstructions(true, program, [], 'tok-1');
    const withReg = buildInstructions(true, program, [], 'tok-1', 'REGISTER: Terminal. Be terse.');
    expect(withReg).toContain('REGISTER: Terminal. Be terse.');
    expect(buildInstructions(true, program, [], 'tok-1')).toBe(legacy);
    expect(withReg.replace('\n\nREGISTER: Terminal. Be terse.', '')).toBe(legacy);
  });
});
```

- [ ] **Step 2: Run to verify failure** — 5th arg ignored.

- [ ] **Step 3: Implement**

`buildInstructions` signature gains `registerText?: string`; at the very end of the returned template append `${registerText ? `\n\n${registerText}` : ''}`.

In App.tsx:

```ts
  const [registerKey, setRegisterKey] = useState<string | null>('guided');
  const registerKeyRef = useRef(registerKey);
  useEffect(() => { registerKeyRef.current = registerKey; }, [registerKey]);

  const applyRegister = (key: string) => {
    const from = registerKeyRef.current ?? 'custom';
    if (key === from) return;
    setRegisterKey(key);
    setDials(resolveDials(key));
    telemetry.registerSwitch(from, key, isLiveRef.current);
    // Witnessed through the real activity seam — the floor answers "did it work?" even
    // in trace-hidden registers (the pill also re-renders with the new register).
    activityDispatch({ /* match the exact shape reduceActivity expects for a kind:'done' row — read the reducer */
      type: 'activity.request', /* … */ });
  };
```

**Implementer note:** read `src/shell/activityStore.ts` and one existing dispatch site to construct a correct single `done`-row event (label `Register: ${from} → ${key} (reconnecting · N dials changed)` using `diffDials(dialsRef.current, resolveDials(key)).length` BEFORE setDials). Also: any manual `setDial` patch must fork to custom — extend `setDial` (Task 2's helper):

```ts
  const setDial = (patch: Partial<DialValues>) => {
    setDials(d => {
      const next = { ...d, ...patch };
      const m = matchRegister(next);
      setRegisterKey(m);           // named key if it lands exactly on one, else null = custom
      return next;
    });
  };
```

Connect site :2162-2163: `buildInstructions(honest, program, entitiesRef.current, contextToken, registerSection(registerKeyRef.current, dialsRef.current))`. Task 3's arm stamp becomes `arm: { register: registerKeyRef.current ?? 'custom', base: registerKeyRef.current ? undefined : 'guided', dials: { ...dialsRef.current } }` — and fix the Task-3 comment. (Reconnect-on-switch needs NO new code — `applyRegister`'s `setDials` changes prompt dials, so Task 2's `promptDialsKey` effect fires. Verify this in the report by tracing.) Task 5 ALSO adds `|${dials.feedback}` back into promptDialsKey (the prompt now reads feedback via registerSection — reconnect-on-feedback-flip becomes required for honesty).

- [ ] **Step 4: Full gate** — `npx vitest run && npx tsc --noEmit && npx vite build` → green/clean.

- [ ] **Step 5: Commit**

```bash
git add src/prompt/instructions.ts src/prompt/instructions.test.ts src/App.tsx
git commit -m "feat(register): applyRegister — resolve dials, stamp arm, witness + reconnect via prompt-dials effect"
```

---

### Task 6: Pill, band, backtick chord

**Files:**
- Create: `src/register/bandKeys.ts` + `src/register/bandKeys.test.ts`, `src/shell/RegisterBand.tsx`
- Modify: `src/shell/MenuBar.tsx` (pill), `src/App.tsx` (band state + chord handler + MenuBar props)

**Interfaces:**
- Consumes: `REGISTERS`, `diffDials`, `resolveDials`, `matchRegister` (Task 1), `applyRegister` + `registerKey` + `dials` (Task 5), `isEditableTarget` (`../shell/quickFire`).
- Produces: `bandKeyAction(key: string, targetIsEditable: boolean, bandOpen: boolean, notchCount: number): 'open' | 'close' | number | null` (pure); `RegisterBand` component `{ current: string | null; dials: DialValues; onSelect: (key: string) => void; onCustom: () => void; onClose: () => void }`; MenuBar props gain `{ registerLabel: string; registerGlyph: string; onRegisterPill: () => void }`.

- [ ] **Step 1: Failing bandKeys test**

```ts
// src/register/bandKeys.test.ts
import { describe, it, expect } from 'vitest';
import { bandKeyAction } from './bandKeys';

describe('bandKeyAction', () => {
  it('backtick opens when closed, closes when open; inert in editable targets', () => {
    expect(bandKeyAction('`', false, false, 5)).toBe('open');
    expect(bandKeyAction('`', false, true, 5)).toBe('close');
    expect(bandKeyAction('`', true, false, 5)).toBeNull();
  });
  it('digits select a notch only while open and in range', () => {
    expect(bandKeyAction('1', false, true, 5)).toBe(0);
    expect(bandKeyAction('5', false, true, 5)).toBe(4);
    expect(bandKeyAction('6', false, true, 5)).toBeNull();
    expect(bandKeyAction('1', false, false, 5)).toBeNull(); // closed → digits are quick-fire's
  });
  it('Escape closes; everything else null', () => {
    expect(bandKeyAction('Escape', false, true, 5)).toBe('close');
    expect(bandKeyAction('x', false, true, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement bandKeys**

```ts
// src/register/bandKeys.ts
// Chord grammar for the register band, sibling of quickFire.ts: backtick toggles, digits
// 1-N select while open, Esc closes. Closed-band digits stay quick-fire's — the two
// grammars never contend because the band swallows digits only while visibly open.
export function bandKeyAction(
  key: string, targetIsEditable: boolean, bandOpen: boolean, notchCount: number,
): 'open' | 'close' | number | null {
  if (targetIsEditable) return null;
  if (key === '`') return bandOpen ? 'close' : 'open';
  if (!bandOpen) return null;
  if (key === 'Escape') return 'close';
  if (/^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    return i < notchCount ? i : null;
  }
  return null;
}
```

- [ ] **Step 4: Build the band + pill + wire the chord**

`src/shell/RegisterBand.tsx` — a fixed top-center panel (below MenuBar, `z-50`), `role="dialog"` `aria-label="Register"`: 5 notches (4 from `REGISTERS` + Custom) in a horizontal `flex gap-1`; each notch a `Button variant={active ? 'default' : 'ghost'}` (hit-24+) showing glyph, label, era tag (`text-[10px] opacity-60`), keycap `<kbd>` 1–5; active = `current === r.key` (Custom active when `current === null`). Hover/focus a notch → a caption row under the strip: the register's `ethos`, its `probe`, and the `diffDials(dials, resolveDials(r.key))` preview rendered as `chipDensity full→none · feedback earcon→silent · …` (for Custom: "twiddle individual dials"). Click notch → `onSelect(key)` (Custom → `onCustom()`); Esc and outside-click → `onClose()`. Dark mode per existing panel idioms (`bg-background border`).

MenuBar: props gain `registerLabel/registerGlyph/onRegisterPill`; render after the wordmark span (:13):

```tsx
      <button onClick={onRegisterPill} className="hit-24 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:bg-accent" aria-label={`Register: ${registerLabel} — open register band`}>
        <span aria-hidden>{registerGlyph}</span>{registerLabel}<kbd className="text-[9px] opacity-50">`</kbd>
      </button>
```

App: `bandOpen` state; window keydown handler alongside the quick-fire one (or inside it, FIRST):

```ts
      const act = bandKeyAction(e.key, isEditableTarget(e.target), bandOpenRef.current, REGISTERS.length + 1);
      if (act === 'open') { setBandOpen(true); e.preventDefault(); return; }
      if (act === 'close') { setBandOpen(false); return; }
      if (typeof act === 'number') {
        e.preventDefault(); setBandOpen(false);
        if (act === REGISTERS.length) setDrawerOpen(true); // Custom notch → Dial Bench home (drawer for R1)
        else applyRegister(REGISTERS[act].key);
        return;
      }
```

CRITICAL: this must run BEFORE the quick-fire branch in the same handler so an open band swallows digits (closed band → falls through to quick-fire; the pure tests pin that). Mount `<RegisterBand …>` when `bandOpen`; pill props: `registerLabel={REGISTERS.find(r => r.key === registerKey)?.label ?? 'Custom'}` etc. (For R1, Custom's `onCustom` opens the DebugDrawer — the dedicated Dial Bench extraction is R2, per spec §8/§10. The switch ECHO for R1 is the pill re-rendering + the witnessed activity row from Task 5 — no separate transient echo pill; note this deliberate simplification in your report.)

- [ ] **Step 5: Full gate + keyless smoke**

Run: `npx vitest run && npx tsc --noEmit && npx vite build` → green/clean.
Browser (no key needed): `npx vite --port 3001` → pill shows `◆ Guided`; backtick opens band; `1` → Terminal (pill updates, chips vanish, echo/activity row appears); backtick + `3` → back to Guided (chips return); DebugDrawer honest toggle → pill flips to Custom. Drive via DOM `.click()`/keyboard events per the harness note (first CDP click misses).

- [ ] **Step 6: Commit**

```bash
git add src/register/bandKeys.ts src/register/bandKeys.test.ts src/shell/RegisterBand.tsx src/shell/MenuBar.tsx src/App.tsx
git commit -m "feat(register): pill + band + backtick chord — slippy register switching"
```

---

## Verification (after all tasks)

1. `npx vitest run && npx tsc --noEmit && npx vite build` — all green/clean.
2. Keyless browser drive (Task 6 Step 5 list) + dark-mode glance at pill/band/ledger.
3. **Human smoke (needs key; fold into the sitting):** switch Guided→Terminal mid-session → reconnect, model acknowledges terse register (ask "what can you see?"); Terminal: digits inert + no chips; Ambient: trace hidden but witness cards render on an action; export telemetry under two registers → `arm` stamps + filename register segment differ.
