# Keyless browser drive — projected geometry (2026-07-30)

Task 6 of the 2026-07-29 projected-geometry plan. HEAD `71c5fab`. Driven at **three** planes —
1600×1000, 1200×800, 1024×620 — plus a below-gate testbed plane (900×600), per the task-4/5
review's binding additions to the plan's own PG-1…PG-10 row list.

## How it was driven

- **Browser:** `chrome-headless-shell` 145.0.7632.77, driven by a **dependency-free CDP script**
  over node's global `WebSocket`/`fetch` — no `puppeteer-core`, no new repo dependency, nothing
  added to `package.json`. Scripts, screenshots and raw JSON evidence live in `/tmp/ff-t6/`
  (`cdp.mjs` the CDP client, `lib.mjs` shared helpers, `pg1.mjs`…`pg10.mjs` one script per row).
- **Server:** started fresh on **`:3021`** (never `:3000`/`:3002`/`:3003` — `:3002`/`:3003` are the
  user's own real-key servers) with **inline stub env**:
  `GEMINI_API_KEY=STUBKEYPG AZURE_OPENAI_API_KEY=STUBAZPG AZURE_OPENAI_ENDPOINT=https://stub.invalid/
  AZURE_REALTIME_DEPLOYMENT=stub-realtime AZURE_TRANSCRIBE_DEPLOYMENT=stub-transcribe npx vite
  --port 3021 --strictPort`. Verified in-page: `process.env.GEMINI_API_KEY === 'STUBKEYPG'`.
  `.env` was never read, written or touched.
- **Origin storage** (`localStorage`, IndexedDB, cookies) was cleared via `Storage.clearDataForOrigin`
  before every scenario boot, so every "fresh boot" row is a genuine first-ever load.
- **The ask card (PG-7) and the hint-count row (PG-10)** needed a live session: same technique as
  the 2026-07-29 shell drive — `window.WebSocket` is proxied by a `Page.addScriptToEvaluateOnNewDocument`
  script so only sockets to `stub.invalid` (this drive's Azure endpoint) are faked; the real Vite
  HMR socket passes through untouched. The app runs its real Azure provider code path (real
  `onToolCall` dispatch, real `sendTextHint`), driven by hand-scripted server frames
  (`response.done` carrying a `function_call` item, `conversation.item.input_audio_transcription.completed`
  to satisfy the "ignore tool calls before first transcription" guard). Reached by genuinely
  operating the UI: Debug drawer → Voice backend select → "RTV2 (Azure Realtime)" → mic button —
  the backend defaults to Gemini, so PG-7/PG-10 could not be driven without this.
- **No source was patched anywhere in this drive.** Every row was produced by operating the real
  UI (clicks, drags, reloads, viewport emulation) and reading the real DOM/localStorage. One
  tooling lesson paid for mid-drive: CDP tabs opened via `/json/new` must be explicitly closed via
  `/json/close/<id>` — closing only the debugger WebSocket leaves the tab running, and 59 stray
  tabs accumulated across earlier runs were slowing the browser enough to make ordinary drags stop
  registering. Fixed in `cdp.mjs`'s `Session.close()`; all screenshots and numbers below were
  re-captured after the fix.

## Checklist

| # | Row | Result | Evidence actually observed |
| --- | --- | --- | --- |
| PG-1 | Material foregrounds artifacts — largest object on screen is an artifact, not Word | **PASS at n≤2, FAIL by rendered pixels at n=6** (geometry itself correct; see below) | At 1600×1000, n=2 (`?artifacts=1`): program dock `370×242=89,701px²`; artifacts `78,125px²` and **`185,017px²`** — artifact clearly largest. Same shape at 1200×800 (dock `76,800` vs artifact `81,921`) and 1024×620 (dock `76,800` vs artifact `115,995`). At n=6 (`?corpus=wide`), the **allotted** slot (359×315≈113,135px²) is still bigger than the dock (89,701px²) — the projection is honoring its own contract — but `ArtifactWindow` renders with `maxHeight`, not `height`, so short-content cards **shrink to content** and the largest MEASURED artifact box was `51,043px²` (1600×1000) / `53,439px²` (1200×800) / `75,666px²` (1024×620) — all **smaller** than the docked program window in that same run. Screenshots `pg1-*.png` |
| PG-2 | Conversation windows sit outward from the column and are smaller than in Familiar | **PASS** (size); **overlap defect confirmed at laptop widths, see IMPORTANT-1 below** | At every plane, Conversation's program window area is smaller than Familiar's identical-corpus baseline (e.g. 1600×1000: Familiar program `536×560=300,160px²` vs Conversation `352×240=84,480px²`). At 1600×1000 no window overlaps the 680px centre column (`columnLeft=460, columnRight=1140`). At 1200×800 and 1024×620 the program window clamps to `x=0` and DOES overlap the column (measured below) |
| PG-3 | Drag a projected window, cycle all four skins, return — rect byte-identical, not re-projected | **PASS** | Material dock at `{56, 282.95, 370.55, 242.08}` dragged by exactly `(180, 90)` → `{236, 372.95, 370.55, 242.08}` (pixel-exact delta). Journal: one `window.move` with `byUser:true`, rect matching. Cycled Provenance → Conversation → Familiar → Material: rect **identical at every step**, `identicalToPromoted: true` all four times. Shots `pg3-cycle-*.png` |
| PG-4 | An unplaced window IS re-projected on skin switch; authored rect in journal never changed | **PASS** | Artifact `a1`'s authored `window.open` rect: `{600,80,344,300}` (fixed for the whole test). Measured DOM rect across Familiar→Material→Conversation→Provenance→Familiar: `{600,80,w:344,h:111.5}` → `{588.7,76.5,w:849.2,h:92}` → `{84,357,w:352,h:111.5}` → `{600,80,w:344,h:111.5}` → `{600,80,w:344,h:111.5}` — visibly different per skin, returns to the SAME Familiar value. Journal after all four switches: **zero** `window.move` entries for `artifact:a1`, one `window.open` only |
| PG-5 | Pointing resolves a projected artifact correctly in every skin (pill text per skin) | **PASS** | Hovering the CONTENT region's centre (not the whole card — see finding below) resolved correctly in all four skins: `Paragraph 1 — "Q3 Status Brief"` (Familiar/Material/Conversation/Provenance) and `MERI — "Status Board"` (all four) — 8/8 hits. Finding: hovering the geometric centre of the whole visual CARD (title bar + provenance line + content) missed in several skins at compact heights — e.g. Familiar `h=111.5` card has only `55px` of pointable content below `56.5px` of chrome, so "point at the middle of what you see" is not reliable for small projected cards. Pre-existing chrome cost, not a projection defect, but now hit routinely at Material's/Conversation's smaller drawn sizes |
| PG-6 | Minimize/restore works in all four skins, including Conversation's column list | **PASS** | All four skins: minimize removes `.program-window`; restore control found in the correct bar (`aria-label="Open windows"` for Familiar/Provenance/Conversation, `aria-label="What is on your desk"` for Material's Shelf — genuinely different label, both work); restored rect byte-identical to pre-minimize rect in all four |
| PG-7 | Ask card + candidate chips render in all four skins | **PASS** | Real `ask_content` function-call over the (stubbed) Azure wire, field `heading`, 3 candidates. `question` label + `"What should the heading say?"` text and all 3 chips (`Q3 Structural Summary` / `Riverside Tower Update` / `Q4 Risk Note`) rendered identically in Familiar, Material, Provenance, Conversation. Shots `pg7-*.png` |
| PG-8 | Reload restores `placed` + skin; a v2 journal is refused with the honest message, not half-restored | **PASS** | **Restore:** promoted Word to `{196,342.95,370.55,242.08}` in Material, switched to Conversation, reloaded a BARE url (`/`, no `?shell=`) — rect and skin both byte-identical after reload (`◍Conversation` pill, same rect). Note: `?shell=X` left IN the url wins over a restored journal skin on every mount (`App.tsx:1274-1284`, confirmed by reproducing the wrong result first with the param still present) — by design, not a defect. **v2 refusal:** hand-forged `{v:2, entries:[window.open, window.move]}` in `localStorage['ff-journal']`, reload → visible toast **"Your previous desk couldn't be restored (unsupported version 2). Starting fresh."**, program window at the fresh DEFAULT rect `{48,48,536,560}` (not the v2 payload's `{200,200}`), `ff-journal` cleared to `null`, `ff-journal-quarantine` holds the rejected `v:2` payload |
| PG-9 | No projected window ever off-plane at 1024×620, or below it in testbed mode | **PASS** | **Sweep:** `?corpus=wide` (n=6) at 1024×620 in all four skins — **zero** off-plane rects among 1 program + 6 artifact windows per skin (24 checked, 0 violations). **Below-gate testbed:** 900×600 (< the 1024 device-gate floor) shows the "We can't quite fit everything" gate; clicked "Continue anyway — testbed mode ↗"; n=6 corpus at 900×600, Material skin — **zero** off-plane violations. **Parked-tension extension: see below** |
| PG-10 | `updateLayout` invocation count at rest is unchanged from before this branch | **PASS (frozen; no clean SH-era baseline to diff against)** | Boot Familiar (no demo), select the Azure backend, start a live (stubbed) session. The hint counter (`traffic.hints`, incremented once per `updateLayout` call that reaches `sendTextHint` — every branch of `updateLayout` calls it unconditionally when a session is live, so this counter IS the invocation count) reads `5h` at +500ms and stays **exactly `5h`** through +33s of idle, while the unrelated vision-frame counter climbs `6f→83f` in the same window. No polling, no scan storm. The pre-projected-geometry drive (`2026-07-29-shell-browser-drive.md`) recorded "4 layout hints" but that number is AFTER its own artifacts demo opened 2 extra windows — not a clean "just connected, nothing else happened" baseline — so it is not a fair diff target; this branch's own frozen at-rest count (5, for a bare single-window boot) is recorded as the reference point per the task's fallback instruction |
| — | Owed live-smoke rows appended, marked `pending`, noting B/D spatial admissibility | **DONE** | `docs/superpowers/smokes/2026-07-24-human-smoke-sitting.md`, new **Part 10**, 6 rows (PG-S1…PG-S6), with the explicit note that Material/Conversation's spatial probes are now measurable because the geometry a person sees is the geometry the plan claims |

**Tally: 8 clean PASS (PG-3, PG-4, PG-6, PG-7, PG-8, PG-9, PG-10, and PG-2's size claim), 1 PASS
with a confirmed-not-new geometry defect at laptop widths (PG-2's overlap clause, routed from
Task 5 as IMPORTANT-1), 1 mixed result (PG-1: clean PASS at ordinary density, a real measured FAIL
at high density that is a rendering/content-sizing interaction, not a projection-arithmetic
defect), 0 BLOCKED.**

## PG-9 extension — the Task-2 PARKED tension, resolved empirically

**The tension, restated.** `projectDesk.ts:222` — `if (w.placed) return w.rect;` — returns before
the function's own final `clampWindow` call. Read in isolation, a `placed` window whose authored
rect fit a wide plane could be handed to a narrower one unclamped. Task 2's review parked this
exact question for this drive.

**What was actually driven.** At 1600×1000: dragged Word to `{600,100,536,560}` (settles, journals
`window.move … byUser:true`). Confirmed the drag journaled correctly (`journaledMoveEntry` above).
Emulated the viewport down to 1024×620 (`Emulation.setDeviceMetricsOverride`, same mechanism a
real narrower window uses) and reloaded. Sampled the rendered rect at `+0, +60, +150, +400, +900,
+1800` ms after `Page.loadEventFired`, then again at `+6s`:

```
every sample: {"x":488,"y":60,"w":536,"h":560}   offPlane: false
```

`488+536=1024` and `60+560=620` — clamped to the EXACT plane edge, at every single sample including
the very first. **No off-plane frame was ever observed.** Switching to Material after reload showed
the SAME `{488,60,536,560}` rect (not Material's dock geometry), confirming the window is still
`placed:true` — the correction did not un-place it, and it is still drawn identically in every
skin.

**Where the correction comes from.** Not `projectDesk` — its placed-branch genuinely never clamps,
confirmed by re-reading the current source. It is **`App.tsx:1367-1379`'s `fitWindows` boot-fit
effect**, which runs `fitWindows(deskRef.current, planeSize())` on mount (and on every settled
resize) against **every** window — placed or not — via `clampWindow(w.rect, plane)`, and dispatches
a corrected `window.move` (no `byUser`, so the sticky `placed` flag survives) whenever a window's
AUTHORED rect doesn't fit the CURRENT plane. This runs before the corrected state is ever visible,
so `projectDesk`'s theoretical gap is masked in practice by a mechanism outside its own contract —
exactly as Task 2's review anticipated ("Masked in the live app by App's debounced fitWindows
resize effect… outside projectDesk's contract").

**One genuine, minor wrinkle found while confirming this (not a user-visible defect).** In this
StrictMode dev server, the `fitWindows` correction's own journal entry can sit in memory
(`journalRef.current`) unsaved to `localStorage` until a LATER, unrelated dispatch happens to
re-arm the 500ms save debounce: React StrictMode's mount→cleanup→remount cycle runs the "clear the
pending save timer" cleanup (registered for an unrelated effect, at `App.tsx`'s unmount-guard for
`journalSaveTimer`) between the first pass (which dispatches the correction and arms a save timer)
and the second pass (which finds `deskRef.current` already corrected, so dispatches nothing and
arms no new timer). Verified directly: `localStorage['ff-journal']` held only the original
`byUser:true` entry for 6+ idle seconds after reload, but a single trivial follow-up drag flushed
**both** the original entry and a `{"label":"fit to this screen", rect:{488,60,536,560}}` entry at
once. The render and the in-memory desk state are correct throughout this window — only that one
correction's durability to disk is deferred. Not reproduced in a way that loses data (a second
reload with no further action would simply re-derive and re-apply the identical correction). No fix
made, per this task's no-src-changes constraint — flagged for whoever next touches the journal-save
debounce or investigates journal completeness.

**Verdict for the final review:** the PARKED finding is **not exploitable in the live app**. It
remains true as a statement about `projectDesk`'s own isolated contract (worth fixing or
documenting on its own terms), but nothing a user can do reaches an off-plane frame, because
`fitWindows` is unconditional over all windows, not just unplaced ones.

## IMPORTANT-1 evidence (routed from Task 5, Conversation's fixed column)

Measured at all three planes, Familiar vs. Conversation, same 2-artifact corpus:

| Plane | Column (`left`/`right`) | Conversation program rect | Overlaps column? | Artifacts overlap column? |
| --- | --- | --- | --- | --- |
| 1600×1000 | 460 / 1140 | `{84,126,352,240}` | No | No / No |
| 1200×800 | 260 / 940 | `{0,106,320,240}` | **Yes** | **Yes / Yes** |
| 1024×620 | 172 / 852 | `{0,88,320,240}` | **Yes** | **Yes / Yes** |

At 1600×1000 the fixed 680px column has room either side and everything sits cleanly outside it
(screenshot `pg2-1600x1000-conversation.png`). At 1200×800 and 1024×620 the column doesn't shrink
with the plane, so `columnLeft − rw − GAP` goes negative and every orbiting window (program AND
both artifacts) clamps to `x=0` — sitting UNDER the column's own chip strip
(`pg2-1200x800-conversation.png` shows Word's title bar directly behind the "Microsoft Word / Q3
Status Brief / Status Board" chip row). Same class of defect as Task 4's Material-dock finding one
skin over: disclosed there as an acceptable-at-this-phase deviation, not a regression introduced by
this task. Confirms the ledger's own description exactly ("column wants plane-relative").

## IMPORTANT-2 evidence (Task 5 review, ruling wanted — identity skins under furniture at 1024×620)

Not independently re-measured pixel-by-pixel here (Task 5's review already pinned the exact
numbers: up to 292px of program content and 88px of artifact content under the omnibox/shelf
furniture at 1024×620 in identity skins) — this drive's contribution is PG-9's sweep confirming
those same identity-skin rects are still **on-plane** (never off-screen) at that floor, and PG-5's
finding that a compact card's pointable CONTENT region is smaller than its visual box even before
furniture is considered. The transient-furniture case (Task 5 concern 4 — `OMNIBOX_H` reserves only
the resting column, a witness card/tray stacks higher) was **not** driven here (no cheap path to a
witness card without a live model turn) — it is one of the owed rows in the sitting doc (PG-S5).
The ruling itself (ship as-is vs. inset further) is not this task's call; the evidence above plus
Task 5's own numbers are what the final review has to work with.

## Global constraints at the end of the drive

```
$ npx vitest run       → Test Files 116 passed (116)   Tests 1254 passed (1254)
$ npx tsc --noEmit     → clean (no output)
$ npx vite build       → ✓ built in 1.74s (the >500 kB chunk warning is pre-existing)
$ git status --short   → only this file and the sitting-doc Part 10 addition
```

No new repo dependencies (`package.json`/`package-lock.json` untouched). `JOURNAL_VERSION`
untouched (still 3, set in Task 1). `.env` never read, written or touched. No `src/` file was
modified at any point in this drive — every finding above (including the parked-tension mechanism
attribution) was reached by operating the real UI and reading the real DOM/localStorage/React
state (a React-fiber walk from a DOM node, used only to confirm `placed` survived the fit
correction — read-only, no source change). Console-error capture was on for every scenario; no page
errors were observed in any run.
