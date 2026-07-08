# Figma Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a portable, git-committed Figma workflow — a token-export script (from `src/index.css`), Code Connect mappings for the `src/ui/` primitives, config, and a handoff guide — so any team can mirror the shipping design system into Figma. Code stays canonical.

**Architecture:** A dependency-free Node script parses the CSS custom properties (an `@theme` single-mode block + themed `:root`/`.dark` blocks) into a two-mode tokens JSON; per-component `*.figma.tsx` files declare Figma↔code prop mappings via `@figma/code-connect`; a Markdown guide documents the repeatable process end to end.

**Tech Stack:** Node (ESM `.mjs`, no build step), Vitest, `@figma/code-connect` (dev-only — the one new dependency, required by Code Connect).

**Spec:** `docs/superpowers/specs/2026-07-08-figma-workflow-design.md`

## Global Constraints

- Branch `honest-mode`, work directly on it.
- **Code is canonical; Figma mirrors it** — one direction only. Every artifact documents/enforces this.
- Token source of truth: `src/index.css` — `@theme` block (`src/index.css:4`, single-value: `--font-dm`, `--font-inter`, `--font-mono`, `--color-box-bg`), `:root` (`:13`, 10 light colors), `.dark` (`:26`, same 10 dark colors).
- The token script is **dependency-free** (plain `node`, no packages) and runnable as `node scripts/tokens-to-figma.mjs`.
- `@figma/code-connect` is the ONLY new dependency (devDependency); nothing else added.
- Code Connect files live beside components in `src/ui/` as `<Component>.figma.tsx`; each carries a `FIGMA_URL` placeholder constant (no live Figma file is created by this plan).
- Do NOT run `npx figma connect publish` (needs auth + a live file — the team's action); do NOT modify `src/index.css`, `src/ui/*.tsx`, or shipping UI.
- Verify per task: `npx tsc --noEmit && npx vitest run` (baseline 145 tests). The `.figma.tsx` files must typecheck; they must NOT enter the app bundle (they're imported by nothing).
- Commit per task with the given message.

## File Structure

```
scripts/tokens-to-figma.mjs        CREATE  cssToTokens() + main runner (parse src/index.css → JSON)
scripts/tokens-to-figma.test.mjs   CREATE  vitest test for cssToTokens (plain JS — no TS coupling)
design/tokens.figma.json           CREATE  generated output, committed (the importable artifact)
figma.config.json                  CREATE  Code Connect config (include glob)
src/ui/Button.figma.tsx            CREATE  Code Connect mapping
src/ui/Select.figma.tsx            CREATE
src/ui/Switch.figma.tsx            CREATE
src/ui/Slider.figma.tsx            CREATE
src/ui/Sheet.figma.tsx             CREATE
src/ui/Tooltip.figma.tsx           CREATE
docs/figma-workflow.md             CREATE  the portable handoff guide
package.json                       MODIFY  + @figma/code-connect devDependency
```

---

### Task 1: Token export script + test (TDD) + generated output

**Files:**
- Create: `scripts/tokens-to-figma.mjs`, `scripts/tokens-to-figma.test.mjs`, `design/tokens.figma.json`

**Interfaces:**
- Produces: `export function cssToTokens(css: string): TokensDoc` where
  `TokensDoc = { $description: string, modes: ['Light','Dark'], color: Record<string, {$type:'color', Light:string, Dark:string}>, fontFamily: Record<string, {$type:'fontFamily', Light:string, Dark:string}> }`.
  Single-mode `@theme` tokens carry the same value in both modes; themed tokens carry per-block values. Colors = values matching `#` or `rgb(`; fontFamily = the three `--font-*`. `--color-box-bg` (a hex in `@theme`) is a color mirrored to both modes.

- [ ] **Step 1: Write the failing test** — `scripts/tokens-to-figma.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { cssToTokens } from './tokens-to-figma.mjs';

const CSS = `
@theme {
  --font-dm: "DM Sans", sans-serif;
  --color-box-bg: #1C2938;
}
:root {
  --accent-color: #1A74E8;
  --dot-color: rgba(26, 26, 26, 0.15);
}
.dark {
  --accent-color: #0076F0;
  --dot-color: rgba(255, 255, 255, 0.15);
}
`;

describe('cssToTokens', () => {
  const t = cssToTokens(CSS);
  it('emits two modes', () => {
    expect(t.modes).toEqual(['Light', 'Dark']);
  });
  it('themed color carries per-mode values', () => {
    expect(t.color['accent-color']).toEqual({ $type: 'color', Light: '#1A74E8', Dark: '#0076F0' });
    expect(t.color['dot-color']).toEqual({ $type: 'color', Light: 'rgba(26, 26, 26, 0.15)', Dark: 'rgba(255, 255, 255, 0.15)' });
  });
  it('@theme single-mode color mirrors into both modes', () => {
    expect(t.color['color-box-bg']).toEqual({ $type: 'color', Light: '#1C2938', Dark: '#1C2938' });
  });
  it('font family becomes a fontFamily token, mirrored', () => {
    expect(t.fontFamily['font-dm']).toEqual({ $type: 'fontFamily', Light: 'DM Sans, sans-serif', Dark: 'DM Sans, sans-serif' });
  });
  it('does not classify a font as a color', () => {
    expect(t.color['font-dm']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/tokens-to-figma.test.mjs`
Expected: FAIL — cannot find module / `cssToTokens` not exported.

- [ ] **Step 3: Implement `scripts/tokens-to-figma.mjs`**

```js
// Dependency-free token bridge: parse src/index.css → design/tokens.figma.json (two modes).
// Code is canonical; this mirrors the shipping tokens into a Figma-importable shape.
// Run: `node scripts/tokens-to-figma.mjs`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Extract the body of the first `selector { ... }` block (non-nested). */
function block(css, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  return m ? m[1] : '';
}

/** Parse `--name: value;` pairs from a block body into a Map. */
function vars(body) {
  const out = new Map();
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const isColor = (v) => /^#|^rgb|^hsl/i.test(v);
// Normalize a CSS font stack to a Figma-friendly family string (strip quotes).
const normFont = (v) => v.replace(/["']/g, '');

/** Pure: CSS text → two-mode tokens document. */
export function cssToTokens(css) {
  const theme = vars(block(css, '@theme'));
  const light = vars(block(css, ':root'));
  const dark = vars(block(css, '.dark'));

  const doc = {
    $description: 'Design tokens mirrored from src/index.css. Code is canonical — regenerate with `node scripts/tokens-to-figma.mjs`.',
    modes: ['Light', 'Dark'],
    color: {},
    fontFamily: {},
  };

  // Themed tokens: per-mode values from :root / .dark.
  for (const [name, lv] of light) {
    const dv = dark.get(name) ?? lv;
    doc.color[name] = { $type: 'color', Light: lv, Dark: dv };
  }
  // @theme tokens: single value → mirrored into both modes; classify color vs font.
  for (const [name, v] of theme) {
    if (name.startsWith('font-')) {
      const f = normFont(v);
      doc.fontFamily[name] = { $type: 'fontFamily', Light: f, Dark: f };
    } else if (isColor(v)) {
      doc.color[name] = { $type: 'color', Light: v, Dark: v };
    }
  }
  return doc;
}

// Main runner (only when executed directly, not when imported by the test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(here, '../src/index.css'), 'utf8');
  const doc = cssToTokens(css);
  const outDir = resolve(here, '../design');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'tokens.figma.json'), JSON.stringify(doc, null, 2) + '\n');
  const nc = Object.keys(doc.color).length, nf = Object.keys(doc.fontFamily).length;
  console.log(`Wrote design/tokens.figma.json — ${nc} color + ${nf} fontFamily tokens, Light/Dark modes.`);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run scripts/tokens-to-figma.test.mjs` → PASS.

- [ ] **Step 5: Generate the real artifact + full verify**

Run: `node scripts/tokens-to-figma.mjs` — expect it to print `Wrote design/tokens.figma.json — 11 color + 3 fontFamily tokens, Light/Dark modes.` (10 themed colors from `:root` + `--color-box-bg` from `@theme` = 11; 3 fonts).
Then `npx tsc --noEmit && npx vitest run` — clean, 145 + new tests green. (The `.mjs` test files are outside the `src` tsconfig include, so tsc ignores them; vitest runs them.)
Spot-check: `design/tokens.figma.json` has `color["accent-color"] = {Light:"#1A74E8", Dark:"#0076F0"}` and `fontFamily["font-mono"].Light === "Roboto Mono, monospace"`.

- [ ] **Step 6: Commit**

```bash
git add scripts/tokens-to-figma.mjs scripts/tokens-to-figma.test.mjs design/tokens.figma.json
git commit -m "feat(figma): token-export script — src/index.css → two-mode Figma tokens JSON (TDD)"
```

---

### Task 2: Code Connect dependency, config, and `src/ui/*.figma.tsx` mappings

**Files:**
- Modify: `package.json` (via npm install)
- Create: `figma.config.json`, `src/ui/{Button,Select,Switch,Slider,Sheet,Tooltip}.figma.tsx`

**Interfaces:**
- Consumes: the real `src/ui/` component signatures — `Button` (`variant?: 'primary'|'ghost'|'outline'`, `size?: 'sm'|'icon44'|'icon48'|'chip'`), `Switch` (`checked`, `onCheckedChange`, `label`, `hint`), `Slider` (`value`, `onValueChange`, `min`, `max`, `step`, `ariaLabel`), `Select` (`value`, `onValueChange`, `options`, `ariaLabel`), `Sheet` (`open`, `onOpenChange`, `title`, `children`), `Tip` (`label`, `children`).
- Produces: one Code Connect module per component, each importing `@figma/code-connect` and the real component, with a top `FIGMA_URL` placeholder the team fills in.

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-dev @figma/code-connect
```

- [ ] **Step 2: `figma.config.json`**

```json
{
  "codeConnect": {
    "include": ["src/ui/**/*.figma.tsx"],
    "parser": "react"
  }
}
```

- [ ] **Step 3: `src/ui/Button.figma.tsx`** (the exemplar — the richest mapping)

```tsx
import figma from '@figma/code-connect';
import { Button } from './Button';

// Paste this component's Figma node URL after building the library (see docs/figma-workflow.md
// → "Standing it up"). Until then Code Connect skips this file with a clear "unconnected" notice.
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';

figma.connect(Button, FIGMA_URL, {
  props: {
    // Map Figma component properties → the real Button props. Names in quotes are the Figma
    // property names a designer should create on the component (match these exactly).
    variant: figma.enum('Variant', { Primary: 'primary', Ghost: 'ghost', Outline: 'outline' }),
    size: figma.enum('Size', { sm: 'sm', icon44: 'icon44', icon48: 'icon48', chip: 'chip' }),
    label: figma.string('Label'),
  },
  example: ({ variant, size, label }) => <Button variant={variant} size={size}>{label}</Button>,
});
```

- [ ] **Step 4: The other five mappings** (each with its own `FIGMA_URL` placeholder)

`src/ui/Switch.figma.tsx`:

```tsx
import figma from '@figma/code-connect';
import { Switch } from './Switch';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Switch, FIGMA_URL, {
  props: {
    checked: figma.boolean('Checked'),
    label: figma.string('Label'),
    hint: figma.string('Hint'),
  },
  example: ({ checked, label, hint }) => (
    <Switch checked={checked} label={label} hint={hint} onCheckedChange={() => {}} />
  ),
});
```

`src/ui/Slider.figma.tsx`:

```tsx
import figma from '@figma/code-connect';
import { Slider } from './Slider';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Slider, FIGMA_URL, {
  props: { ariaLabel: figma.string('Label') },
  example: ({ ariaLabel }) => (
    <Slider ariaLabel={ariaLabel} value={50} min={0} max={100} step={1} onValueChange={() => {}} />
  ),
});
```

`src/ui/Select.figma.tsx`:

```tsx
import figma from '@figma/code-connect';
import { Select } from './Select';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Select, FIGMA_URL, {
  props: { ariaLabel: figma.string('Label') },
  example: ({ ariaLabel }) => (
    <Select ariaLabel={ariaLabel} value="" options={[]} onValueChange={() => {}} />
  ),
});
```

`src/ui/Sheet.figma.tsx`:

```tsx
import figma from '@figma/code-connect';
import { Sheet } from './Sheet';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Sheet, FIGMA_URL, {
  props: { title: figma.string('Title'), children: figma.children('*') },
  example: ({ title, children }) => (
    <Sheet open title={title} onOpenChange={() => {}}>{children}</Sheet>
  ),
});
```

`src/ui/Tooltip.figma.tsx` (the component is exported as `Tip`):

```tsx
import figma from '@figma/code-connect';
import { Tip } from './Tooltip';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Tip, FIGMA_URL, {
  props: { label: figma.string('Label'), children: figma.children('*') },
  example: ({ label, children }) => <Tip label={label}>{children}</Tip>,
});
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — clean (the `.figma.tsx` files typecheck against `@figma/code-connect` types + the real components).
Run: `npx vitest run` — 145 + Task 1 tests green (unchanged; no test imports the .figma files).
Run: `npx vite build` — clean; confirm `.figma.tsx` files are NOT in the bundle (nothing imports them; grep the build output dir for "figma.connect" should find nothing).
Run: `npx figma connect parse 2>&1 | head` — should parse the 6 files and report them as unconnected (placeholder URLs), NOT error. (Parse only — never `publish`.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json figma.config.json src/ui/*.figma.tsx
git commit -m "feat(figma): Code Connect mappings for the six ui primitives + config + dependency"
```

---

### Task 3: The portable workflow guide + final verification

**Files:**
- Create: `docs/figma-workflow.md`

**Interfaces:** none (declarative doc). Consumes the artifacts from Tasks 1-2 by reference.

- [ ] **Step 1: Write `docs/figma-workflow.md`**

Full content:

```markdown
# Figma Workflow — Code ↔ Design Bridge

**Ownership: code is the single source of truth; Figma mirrors it.** The tokens in
`src/index.css` and the components in `src/ui/` ship and are tested. This workflow generates the
Figma representation *from* them and keeps the two in sync in ONE direction. Do not invert it
(designing in Figma and regenerating code discards a working, tested layer).

## What's in git (the portable bundle)
- `scripts/tokens-to-figma.mjs` — parses `src/index.css` → `design/tokens.figma.json` (Light/Dark modes). Dependency-free.
- `design/tokens.figma.json` — the generated, importable tokens (regenerate any time).
- `src/ui/*.figma.tsx` — Code Connect mappings (Figma component props → real code). Each has a `FIGMA_URL` placeholder.
- `figma.config.json` — Code Connect config.
- This guide.

## Prerequisites
- A Figma account with edit access to a file you control.
- Node (already required by this repo).
- `@figma/code-connect` (installed as a devDependency).
- To publish: the Figma desktop app or a Figma personal access token (`FIGMA_ACCESS_TOKEN`).

## Standing it up (first run)
1. **Tokens → Figma Variables.** Run `node scripts/tokens-to-figma.mjs`. Import
   `design/tokens.figma.json` into your Figma file's Variables with two modes (Light, Dark) —
   via a Variables-import plugin or the `figma-generate-library` skill, which reads the JSON and
   creates the collections.
2. **Build the component library.** In Figma, create one component per `src/ui/` primitive
   (Button, Select, Switch, Slider, Sheet, Tooltip), binding fills/text to the Variables from
   step 1. Match the Figma property names to what the `.figma.tsx` files expect (e.g. Button:
   a `Variant` enum with Primary/Ghost/Outline, a `Size` enum, a `Label` text). The
   `figma-generate-library` skill can build these from the code automatically.
3. **Link Code Connect.** For each component, copy its Figma node URL (right-click → Copy
   link to selection) into the `FIGMA_URL` constant at the top of the matching
   `src/ui/<Component>.figma.tsx`.
4. **Publish.** Run `npx figma connect publish` (needs `FIGMA_ACCESS_TOKEN`). Now a designer
   selecting a component in Figma Dev Mode sees the real code snippet.

## Staying in sync
- **A token changed in `src/index.css`** → `node scripts/tokens-to-figma.mjs`, re-import the JSON.
- **A component's API changed** → update its `src/ui/*.figma.tsx` prop mapping, then
  `npx figma connect publish`.
- **A new `src/ui/` primitive** → add `src/ui/<New>.figma.tsx` (copy an existing one), build its
  Figma component, paste the URL, publish.
- Verify mappings parse before publishing: `npx figma connect parse`.

## Bringing it to another company
Everything needed is in git. A new team:
1. Clones the repo and reads this file.
2. Creates a Figma account + a new file.
3. Runs the four "Standing it up" steps.
There is no dependency on the original author's Figma account, and no bespoke config beyond what
is committed. Code remains canonical, so the code they clone IS the design system.

## Future option (not built)
A CI job can run `npx figma connect publish` on merge to `main` so Figma never drifts from
shipped code. Add it when a team wants automation; it needs `FIGMA_ACCESS_TOKEN` in CI secrets.
```

- [ ] **Step 2: Final verification**

Run: `npx vitest run` (all green), `npx tsc --noEmit` (clean), `npx vite build` (clean, pre-existing chunk warning only). Confirm the guide's referenced paths all exist: `test -f scripts/tokens-to-figma.mjs design/tokens.figma.json figma.config.json && ls src/ui/*.figma.tsx | wc -l` (expect 6).

- [ ] **Step 3: Commit**

```bash
git add docs/figma-workflow.md
git commit -m "docs(figma): portable workflow guide — stand-up, sync, and cross-company handoff"
```

---

## Self-Review Notes (already applied)

- Spec coverage: §2.1 token bridge + test → Task 1 (with the corrected token structure: `@theme` single-mode + `:root`/`.dark` themed, 11 colors + 3 fonts); §2.2 Code Connect mappings → Task 2 (6 files, `FIGMA_URL` placeholder, prop maps from real signatures); §2.3 guide → Task 3; §2.4 config + dependency → Task 2. §3 out-of-scope honored (no live file, no publish, no UI change). §4 testing → Task 1 test + each task's tsc/build/parse checks.
- Format note: the spec said "W3C DTCG format"; DTCG does not standardize *modes*, so the plan emits a documented DTCG-inspired two-mode shape (`{modes, color, fontFamily}` with `$type` + per-mode values) that Figma Variables importers and the `figma-generate-library` skill consume. This is a deliberate, documented refinement of the spec's intent (importable Light/Dark tokens), not a gap.
- Test-typing choice: `.test.mjs` (plain JS) instead of `.ts` avoids coupling an untyped `.mjs` import into the `src` tsconfig; vitest runs `.mjs` tests, tsc ignores them. Keeps the script truly dependency-free and portable.
- Type consistency: `cssToTokens` shape defined in Task 1 is consumed only by its own test + runner; the `.figma.tsx` prop names (`variant`/`size`/`label`/`checked`/`hint`/`ariaLabel`/`title`) match the real `src/ui/` signatures verified from source.
- Risk noted: if `@figma/code-connect`'s JSX-in-`example` needs a specific tsconfig `jsx` setting, the repo already compiles `.tsx` (React 19) so it is satisfied; Task 2 Step 5's `tsc --noEmit` is the gate that catches any mismatch.
