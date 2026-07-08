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
