# Figma Workflow — Design Spec (portable code↔design bridge)

*A documented, repeatable workflow bridging this repo's design tokens (`src/index.css` CSS
variables) and vendored component library (`src/ui/`) with Figma — so the built, shipping UI is
mirrored into Figma Variables + components, wired via Code Connect, and any team (including one at
another company) can pick it up from git alone. Code is canonical; Figma reflects it.*

Date: 2026-07-08
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record: direction = **code is canonical → mirror into Figma** (not designer-owned, not
round-trip); deliverable = **git artifacts only** (workflow doc + Code Connect mappings +
token-export script); building the live Figma file is a separate action requiring the team's own
Figma auth and is explicitly out of scope.

---

## 1. Principle (the rule that survives the handoff)

**Code is the single source of truth. Figma mirrors it.** The tokens in `src/index.css` and the
components in `src/ui/` already exist, ship, and are tested; the workflow generates the Figma
representation *from* them and keeps the two in sync in one direction. A new team must not invert
this (designing in Figma and regenerating code would discard a working, tested layer). Every
artifact below enforces or documents this rule.

## 2. Artifacts (all committed to git)

### 2.1 Token bridge — `scripts/tokens-to-figma.mjs` (+ test)
A dependency-free Node script (ESM, run with `node`). It parses `src/index.css`, extracts the CSS
custom properties declared for the light theme (the `:root` block, `src/index.css:13`) and the
dark theme (the `.dark` block, `src/index.css:26`), and emits `design/tokens.figma.json` in the
**W3C Design Tokens Community Group format**
with two modes named `Light` and `Dark`. Color tokens (`--accent-color`, `--card-bg`,
`--card-border`, `--text-primary`, `--text-secondary`, `--bg-color`, `--inner-box-bg`,
`--color-box-bg`, `--dot-color`, `--inverse-bg`, `--inverse-text`) become `$type: "color"`;
font tokens (`--font-dm`, `--font-inter`, `--font-mono`) become `$type: "fontFamily"`. A token
present in only one theme carries the same value in both modes. The script is the "tokens never
drift" seam: re-run on any CSS change, re-import into Figma Variables.

**Test — `scripts/tokens-to-figma.test.ts`:** given a small CSS fixture with a `:root` block and
a dark block, the emitted JSON has both modes, the right `$type` per token, and single-theme
tokens mirrored into both modes. (This is the one artifact with real parsing logic; the rest are
declarative.)

### 2.2 Code Connect mappings — `src/ui/<Component>.figma.tsx` (one per component)
Per the `figma-code-connect` skill: `Button`, `Select`, `Switch`, `Slider`, `Sheet`, `Tooltip`
(NOT `cn.ts` — it's a utility, no component). Each file uses `@figma/code-connect` to map the
Figma component's properties to the real `src/ui/` component's props, so clicking the Figma
component surfaces the shipping code snippet. Because no live Figma file exists yet (git-only
deliverable), each file is authored complete **except** the Figma node URL: a
`const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';` constant sits at the top with a comment pointing
to the workflow doc's "standing it up" step. The prop mappings ARE fully specified from the real
component signatures (e.g. Button's `variant: 'primary'|'ghost'|'outline'` and
`size: 'sm'|'icon44'|'icon48'|'chip'` → `figma.enum(...)`), so a team's only manual step is
pasting each node URL.

### 2.3 Workflow guide — `docs/figma-workflow.md`
The portable handoff document. Sections:
- **Ownership** — §1's rule, stated first so a new team can't miss it.
- **Prerequisites** — a Figma account with edit access; Node (already required by the repo);
  `@figma/code-connect` (§2.4); the Figma desktop app or a personal access token for publishing.
- **Standing it up (first run)** — (1) `node scripts/tokens-to-figma.mjs` → import
  `design/tokens.figma.json` into a new Figma file's Variables (two modes); (2) build the
  component library in Figma mirroring `src/ui/` — by hand, or via the `figma-generate-library`
  skill which reads the code and builds variant sets bound to the imported Variables; (3) paste
  each Figma component's node URL into the matching `src/ui/*.figma.tsx` `FIGMA_URL`; (4)
  `npx figma connect publish` to link Figma ↔ code.
- **Staying in sync** — on a token change: re-run the script, re-import. On a component
  API change: update the `.figma.tsx` prop mapping, re-publish. The doc names exactly which
  command re-runs for which change.
- **Bringing it to another company** — the minimal checklist: clone the repo, read this doc, get
  a Figma account, run the four "standing it up" steps. No dependency on the original author's
  Figma account or any bespoke config beyond what's in git.

### 2.4 Config + dependency — `figma.config.json`
The Code Connect config with an `include` glob over `src/ui/**/*.figma.tsx`, and
`@figma/code-connect` added as a **devDependency** (a genuinely required, dev-only dependency —
Code Connect cannot function without it; the workflow doc names it explicitly). No other new
dependencies.

## 3. Out of scope
Building/populating the live Figma file (the team's action, their auth); a CI job to auto-publish
Code Connect on merge (documented as a future option in the guide, not built); any change to
`src/index.css`, `src/ui/`, or shipping UI; designer-owned or round-trip directions (rejected in
the decision record); mirroring bespoke surfaces or rail cards (only the `src/ui/` primitive
library is bridged — matching the usability project's chrome/bespoke boundary).

## 4. Testing & verification
- `scripts/tokens-to-figma.test.ts` (vitest) — the parser, per §2.1.
- `node scripts/tokens-to-figma.mjs` runs clean and writes valid JSON against the real
  `src/index.css`.
- `npx tsc --noEmit` stays clean (the `.figma.tsx` files must typecheck against
  `@figma/code-connect` types and the real component imports).
- The existing suite stays green; `npx vite build` unaffected (the `.figma.tsx` files and the
  script are outside the app bundle — confirm the Code Connect glob / tsconfig include doesn't
  pull them into the build).

## References
- Figma Code Connect docs (the `@figma/code-connect` React API: `figma.connect`, `figma.enum`,
  `figma.boolean`, `figma.children`).
- W3C Design Tokens Community Group format (the `tokens.figma.json` shape).
- The `figma-code-connect` and `figma-generate-library` skills (the execution aids the workflow
  doc points a team to).
