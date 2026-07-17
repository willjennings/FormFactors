# FormFactors

An **honest virtual desktop**: talk or type to an agent while pointing at real program UI. The
agent operates the app, teaches you how, and answers in typed cards — and it never claims to see,
point at, or act on something it can't. "Honest" is the whole thesis: where a normal assistant
guesses and sounds confident, this one surfaces its uncertainty, asks when it isn't sure, and
witnesses consequential actions before committing them.

It is a front-end research prototype for exploring **interaction form factors** — how voice,
typing, pointing, teaching overlays, and a structured response surface combine into a desktop that
feels alive and trustworthy.

> **Branch note:** active development lives on **`honest-mode`**, not `main`. `main` is a
> disconnected stub with unrelated history; `honest-mode` is the real trunk. Clone and check out
> `honest-mode`.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in at least GEMINI_API_KEY (see "Voice backends")
npm run dev               # Express + Vite dev server → http://localhost:3000
```

The app runs fully **without any API key** for everything that doesn't need a live model — direct
manipulation of the program surfaces, the scripted demos, the debug drawer, undo. A key is only
needed for a live voice/typed session with the model.

### Run modes (URL params)

| URL | What it shows |
|---|---|
| `http://localhost:3000/` | The desktop shell — program window, dock, talk-or-type omnibox, response rail |
| `…/?teach=1` | Scripted teaching demo — on-element overlays, numbered steps, soft-block, fade (no key needed) |
| `…/?rail=1` | Scripted response-rail demo — the typed card grammar, driven through the real mapper (no key needed) |
| `…/?ramble` | The ramble-fill monitor (a separate alternate demo app) |

### Scripts

- `npm run dev` — dev server (tsx + Express + Vite) on port 3000
- `npm run build` — production build (`vite build`)
- `npm test` — the Vitest suite (~151 tests)
- `npm run lint` — `tsc --noEmit` (type check)

## Voice backends

Three realtime voice providers sit behind one `VoiceProvider` interface (`src/voice/`), selectable
in the debug drawer:

- **Gemini Live** (`GEMINI_API_KEY`) — the default; continuous video + streaming transcripts.
- **OpenAI Realtime** (`OPENAI_API_KEY`) — WebRTC. The key stays server-side: `server.ts` mints a
  short-lived ephemeral token via `POST /api/realtime/session`; the real key never reaches the browser.
- **Azure AI Foundry Realtime / "RTV2"** (`AZURE_OPENAI_ENDPOINT`, `AZURE_REALTIME_DEPLOYMENT`,
  `AZURE_OPENAI_API_KEY`, optional `AZURE_TRANSCRIBE_DEPLOYMENT`) — WebSocket. Use the bare
  resource endpoint (`https://<res>.openai.azure.com`); the provider normalizes it.

Keys live in `.env` (gitignored). A live session streams continuously until ended — the menu-bar
**traffic meter** shows exactly what's been sent (`off — nothing sent` / `live · Nf · Nh`), and an
**idle watchdog** ends an abandoned session after 5 minutes.

## Architecture

The interaction grammar is a MAPE-K control loop, kept clean across every surface:

**Intent** (a tool call or typed command) → **Command** → **Policy** (`decideCommit` — confirm vs
witness) → **Effect** (`applyAction`, a pure reducer) → **Feedback** (earcon + visual toast; the
model is contractually silent on success). Policy is kept out of Effect; undo falls out of the
reducer + mementos for free.

### Source map

| Path | Responsibility |
|---|---|
| `src/App.tsx` | The shell orchestrator (session, deixis timing, grounding, vision frame, mounts) |
| `src/ui/` | Vendored Radix/shadcn primitives — the design-system layer (Button, Select, Sheet, Switch, Slider, Tooltip) |
| `src/shell/` | Desktop chrome — window, dock, menu bar, omnibox, debug drawer, traffic/idle |
| `src/widgets/` | The four program surfaces (Word/Excel/PowerPoint/Photo) — real MockDoc-bound mini-apps |
| `src/rail/` | The response grammar — typed cards, the honest `respondCallToRail` mapper, the rail store/renderer |
| `src/teaching/` | Teaching overlays — the guide→teach→fade reducer, on-element scaffolding, soft-block |
| `src/entities/` | Stable identity — `SceneEntity` ids + `resolveEchoedTarget` (the honest pointer's resolver) |
| `src/voice/` | The pluggable realtime providers (Gemini / OpenAI / Azure) |
| `src/prompt/` | The system prompt (`buildInstructions`) — the honest-desktop grounding grammar |
| `src/scenarios.ts` | Single source of truth for content + `MockDoc` model + `applyAction` reducer + policy |
| `src/telemetry.ts` | Instrumentation — deixis accuracy, grounding agreement, guidance rubric |
| `src/ramble/` | The ramble-fill monitor (`?ramble`) — a separate demo app |

## Honest about the prototype's own limits

The honesty thesis is applied to the artifact itself. The pointing **confidence** is a demo-grade
proxy (a geometric margin plus a threshold-based name resolver over hand-authored element ids), not
a research-grade perception model — it exists to demonstrate the *interaction grammar* (a signal
carries confidence → low confidence triggers an honest ask), not a novel estimator. The `share`
verb is simulated (no real outward integration) — it demonstrates the outward-commitment
witness-render. Where the model "sees," it sees a reconstructed vision frame plus the live
DOM/structured state, not raw pixels of the whole OS. These limits are documented rather than
hidden — being upfront about them is the thesis.

## Documentation

The design record is the project's memory — every substantial change went through a written
spec → plan → subagent-reviewed implementation. Start here to understand *why* the code is shaped
the way it is:

- **`docs/superpowers/specs/`** — one design spec per feature, dated. The architecture review
  (`2026-07-01-virtual-desktop-architecture-review.md`) is the best single overview of the whole
  thesis and its trajectory.
- **`docs/superpowers/plans/`** — the implementation plans those specs became.
- **`docs/AGENTUILEARNINGS.md`** — transferable learnings on multimodal/voice-agent UI (feedback,
  autonomy, grounding). The rubric the project is measured against.
- **`docs/superpowers/research/2026-07-02-learning-teaching-deep-dive.md`** — the evidence base
  for the teaching form factor.
- **`docs/figma-workflow.md`** — the code↔design bridge: how to mirror the design tokens
  (`src/index.css`) and the `src/ui/` component library into Figma via Code Connect, and how to
  hand that off to another team. Code is canonical; Figma mirrors it.

## Tech stack

React 19 · Vite 6 · Tailwind v4 · TypeScript · Vitest · Express (dev server) · Radix UI primitives.

## License

Apache-2.0 (see SPDX headers in source files).
