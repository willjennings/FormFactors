# Keyless browser drive — desktop-metaphor shell (2026-07-29)

Task 9 of the 2026-07-28 desktop-metaphor-shell plan. HEAD `83aff82`. Viewport 1600×1000.

**Why this drive matters.** `vitest.config.ts` is `environment: 'node'` with no jsdom, so not one
line of `App.tsx`, `ShellFrame.tsx` or any skin part is covered by the 922-test suite; and
`tsc --noEmit` does not type-check React hook values or JSX props (no `@types/react`, no `strict`).
Every wiring seam this plan added was, until now, verified by reading.

## How it was driven

- **Browser:** `chrome-headless-shell` 145.0.7632.77 (already in `~/.cache/puppeteer`), driven by a
  **dependency-free CDP script** over node's global `WebSocket` — no `puppeteer-core`, no new repo
  dependency, nothing added to `package.json`. Scripts and screenshots live in `/tmp/ff-t9/`.
- **Server:** a dev server was already up on `:3002`, but it is built from `.env` and therefore
  bakes the **real** `GEMINI_API_KEY`/`AZURE_OPENAI_API_KEY` into the browser bundle. To keep this
  drive genuinely keyless I left `:3002` alone and started my own on **`:3011`** with stub env
  values passed inline (`GEMINI_API_KEY=STUBKEY9 AZURE_OPENAI_API_KEY=STUBAZ9
  AZURE_OPENAI_ENDPOINT=https://stub.invalid/ … npx vite --port 3011`). Verified in the page:
  `process.env.GEMINI_API_KEY === 'STUBKEY9'`. **`.env` was never read, written or touched.**
- **Sessions:** rows that need a live session (SH-6, SH-8's timeline, SH-11, the minimize question)
  were driven against a **stub realtime server**: `window.WebSocket` is proxied by an injected
  document-start script so that only sockets to `stub.invalid` are faked (Vite's HMR socket passes
  through untouched). The app runs its **real** Azure provider, real `onToolCall` dispatch, real
  gate, real telemetry; nothing leaves the browser. Every byte the app tried to send is captured in
  `window.__ws.sent`, which is what the "what the model was told" evidence below is read from.
- **No source was patched.** Task 7's ask-card drive needed a temporary `?askdemo` patch; this one
  did not — the ask is produced by feeding a real `function_call` down the provider callback.

## Checklist

| # | Row | Result | Evidence actually observed |
| --- | --- | --- | --- |
| SH-1 | boot on `?shell=familiar`: wallpaper + taskbar + one window (sparse start), clock ticking | **PASS** | Storage cleared first, so this is a genuine first-ever boot. `.program-window` count **1**, `.artifact-window` count **0**. Background div class `bg-gradient-to-br from-indigo-200/70 …`. Taskbar `[aria-label="Open windows"]` at `{x:0,y:956,w:1600,h:44}` holding `Microsoft Word — in front` + three launchers. Clock aria-label `Clock — 6:45:41 AM` → `Clock — 6:45:43 AM` 2.2 s later. Pill `◆Guided·⊞Familiar`. Shot `SH1-familiar-boot.png` |
| SH-2 | minimize from the window control → taskbar item dims → click → restores at the SAME rect | **PASS** | `.program-window` → absent; bar label flips to `Microsoft Word — put away — click to bring it back`; computed `opacity` of that chip **1 → 0.45** (`opacity-45`). Click it: inline style `{left:48px, top:48px, width:680px, height:620px}` — byte-identical to before. Shots `SH2-minimized.png`, `SH2-restored.png` |
| SH-3 | `?artifacts=1`: artifact windows appear in the bar as they are created; close one → bar item leaves | **PASS** | Sampled the bar as the demo replayed: `[Word]` → `[Word, Q3 Status Brief]` → `[Word, Q3 Status Brief, Status Board]`, desk icons tracking the two pieces. Then `Close artifact` on Status Board: artifacts `[Q3 Status Brief]`, bar `[Microsoft Word, Q3 Status Brief, +3 launchers]`, desk icons `[Q3 Status Brief]` — the item **leaves**, it does not go to "put away" (that is what the `−` control does, verified separately) |
| SH-4 | drag a window, switch skin via the band, switch back → rect preserved byte-identical | **PASS** | Dragged Word to `left:268px top:288px`. Then Familiar → Material → Provenance → Conversation → Familiar, each via `[data-register-pill]` + `[aria-label="Shell: X"]`. Inline styles of the program window **and both artifact windows** compared as one JSON string against the pre-switch baseline: identical at **every** step. Pill tracked `◆Guided·◈Material` / `·◷Provenance` / `·◍Conversation` / `·⊞Familiar` |
| SH-5 | after a skin switch, hover an entity → deixis pill names it (re-measurement proof) | **PASS** | Mouse parked off-target, then moved to the centre of `[data-entity-id="word-1"]` inside the dragged window after **each** of the four switches. Pill read `Pointing at: Word Ribbon` all four times. (Note the entity's own centre moved 373↔374 px between skins because window chrome height differs — the scene really was re-measured, not cached) |
| SH-6 | all four skins: ask card, candidate chips, quick-fire digits; ordinary chips intact under a bare ask | **PASS** | Two paths, both real. (a) `ask_content` with 3 candidates → card `question / What should the heading say?` + chips `1 Q3 Structural Summary`, `2 Riverside Tower Update`, `3 Q4 Risk Note` in **all four** skins; pressing `2` put `Riverside Tower Update` on the wire as the user's own words (`conversation.item.create` + `response.create`) and closed the ask. (b) The **gate's own backstop**: `edit_content {target:'heading'}` with no detail → app opens `question / What would you like the heading to say?` in all four skins, omnibox placeholder becomes the question, and the **ordinary 8-chip row is untouched**; the ack returned to the model reads `success:false … that question is now on the user's screen and edit_content was NOT applied`. Shots `SH6-*.png` |
| SH-7 | conversation skin: minimized window restores from the column list (`restoreVia` proof) | **PASS** | Skin D renders no `What is on your desk` and no `Session timeline`; `[aria-label="Open windows"]` is the column strip at `{x:460,y:56,w:680,h:27}`. With **three** windows open all three chips measured inside the column (`right` 588 / 722 / 844 vs column right edge 1140) and `scrollWidth === clientWidth` — Task 7's third-window fix holds. Minimized the program window from its own `−` → restored from the column at the identical rect; minimized the third window (Status Board) → its chip stayed visible in the list and restored it |
| SH-8 | provenance: artifact window shows `agent`; program window shows `yours`; timeline shows the ask as `agent` lane + `waiting` | **PARTIAL — one clause fails by design** | Program window title bar reads `YOURS` ✅. Timeline rows read exactly `you Riverside Tower Update` / `agent ask_content` / `agent What should the body say?` / `waiting waiting — nothing written until you answer` ✅. **Artifact windows carry no `agent` tag** — they carry their kind badge (`DOC`, `WIDGET`) instead. This is deliberate and documented in `src/artifacts/ArtifactWindow.tsx:181-193`: the desk stamps every artifact window `origin:'agent'` because `artifact.create` writes `owner:'agent'` for a user's *pin* too, so an `agent` tag would be a false authorship claim in the one skin whose premise is legible authorship. **Spec §3 C ("every window title bar carries a `yours`/`agent` tag") and the shipped code disagree; the code is the more honest of the two.** Flagged for a spec amendment, not a fix |
| SH-9 | band: skin hover captions show ethos/probe/assumesRung; digits still select registers only | **PASS** | Skin row renders 4 notches with **0** `<kbd>` hints. Hover captions verbatim: Familiar → *"A computer you already know — the agent is the only new thing in the room. — Does a conventional desktop make the agent's reach legible fastest? / assumes no prior learning"*; Material → *"…/ assumes you already believe what it makes is material you keep"*; Provenance → *"…/ assumes you already believe it acts visibly, and you can undo"*; Conversation → *"…/ assumes no prior learning"*. With the band open, `2` moved the register (`◆Guided·⊞Familiar` → `◌Ambient·⊞Familiar`) and closed the band; `6`,`7`,`8`,`9` were **inert** (pill unchanged, band still open); Escape closed it |
| SH-10 | journal: switch skin + move a window, reload → desk restores (skin + rects + minimized set); `New desk` → sparse start returns | **PASS** | Switched to Provenance, dragged Word to `448,380`, put Status Board away. Journal desk entries: `window.open, window.open, desk.skin:provenance, window.focus, window.move, window.minimize`. Reloaded to **`/` with no query params at all** — skin `provenance`, pill `◆Guided·◷Provenance`, program style `{448px,380px,680px,620px}`, artifact style `{560px,80px,380px}`, bar `[Word — in front, Q3 Status Brief — bring to front, Status Board — put away]`: all three comparisons byte-identical. Then drawer → `New desk…` → `Erase`: 1 program window, 0 artifacts, skin `familiar`, rect back to `48,48,680,620`, `localStorage['ff-journal']` **null**. Shots `SH10-*.png` |
| SH-11 | export: session file carries `shell` on the arm and a `shell_switch` event | **PASS** | Drawer → `Export session JSON`, blob intercepted. Filename `testbed-desktop-guided-familiar-azure-auto-safe-earcon-1785333512519.json`. `config.arm` = `{register:'guided', shell:'familiar', dials:{9 keys}}`. Four `shell_switch` events, each `midSession:true`: `familiar→material`, `material→provenance`, `provenance→conversation`, `conversation→provenance`. (`arm.shell` is the shell **at connect time** by design — the switches are their own event stream) |
| — | owed live-smoke rows appended to the standing sitting doc | **DONE** | `docs/superpowers/smokes/2026-07-24-human-smoke-sitting.md` Part 9, all `pending`, with the reconnect blocker restated and sharpened |

**Tally: 10 PASS, 1 PARTIAL (SH-8, one clause is a deliberate documented deviation), 0 FAIL,
0 BLOCKED.**

## The minimize-staleness question — what the model is actually told

**Answer: nothing. While the program window is minimized the app sends the model no layout update
at all, and the model's last-known layout keeps describing the window as if it were on screen.**

`App.tsx:1463-1472` — the `!winEl` branch honestly zero-bboxes the local `entities`, then
**`return`s**, and the `providerRef.current.sendTextHint(...)` layout push lives at line 1499-1502,
*after* that return. Observed, not inferred, with a live (stubbed) session:

- **Baseline.** 4 layout hints sent; the last one names `Word Ribbon: [102, 36, 165, 449]`,
  `Save button`, `Save As button`, `Document body: [173, 36, 635, 449]`, plus the two artifacts.
  Menu-bar meter: `live · 25f · 6h`.
- **Minimize an ARTIFACT window** (program window still mounted): **3 new layout hints** go out, and
  the vanished entity is honestly zeroed — `Q3 Status Brief: [0, 0, 0, 0]`. Meter `… · 9h`. This is
  the behaviour the mechanism was designed for, and it works.
- **Minimize the PROGRAM window:** `.program-window` gone from the DOM; **0 new layout hints**;
  **0 new messages of any kind**; hint meter frozen at `9h` while the frame counter kept climbing
  `34f → 50f`. The model's last-known layout is still the one above — Word Ribbon, Save button,
  Save As button and Document body at live coordinates, under a preamble that tells the model
  *"Use these to identify what the user is pointing at when they say 'this' or 'here'."*
- **It is not just the minimize event that is lost — the freeze lasts.** With the program window
  still away I closed an artifact window (2 → 1 on screen, a real scene change): **0 new layout
  hints**. Every subsequent scene change is swallowed by the same early return.
- **Restoring** the window sends **3** layout hints and the picture recovers.

So the honest characterisation: the app *knows* correctly (its own `entities` are zeroed, so the
deixis pill and the numbered-target path degrade correctly), but it *says* nothing, and the last
thing it said is now false. The one mitigation is that the vision frame pump keeps running
(`25f → 50f`), so a vision-capable model does receive images of the empty desk — but the coordinate
list, which the prompt frames as authoritative for "this"/"here", still names four elements that
are not there. This was written for *close*, which is rare; **minimize is an everyday act, and this
plan made it the primary window control (the `×` minimizes too)**, so the exposure is new and much
larger. Characterised here, not fixed, per the task.

## Defects and findings, worst first

### 1. A mid-session reconnect leaves a ZOMBIE session that still reads `live` (pre-existing, sharpened)

Known and already logged in the sitting doc as "reconnect never comes back". Driving it here shows
it is worse than logged on the Azure backend:

**Repro (keyless, ~20 s):** start a session; from the taskbar click `Open Microsoft Excel`.

Observed at t = 1/2/4/8 s after the swap:

```
live · 29f · 9h   program: Microsoft Excel   ws opens 1  closes 1  readyState 3
live · 36f · 9h   …
live · 56f · 9h   …
live · 103f · 9h  ws opens 1 (never reopened)
messages actually delivered to the socket since the swap: 0
app log: "Reconnecting to load Microsoft Excel tools + prompt..." then nothing
```

- The socket is closed and **never** reopened, exactly as logged.
- **New:** the UI still shows the green dot and `live`, and the **frame counter keeps climbing**
  (`withTrafficCount` increments before the provider's `readyState === OPEN` check drops the frame
  on the floor). The burn meter is reporting traffic that is not happening.
- **New:** it is **unrecoverable from the UI**. Clicking the mic twice (end, then start) leaves it
  at `live · 69f · 9h`, `ws opens 1`. Only a reload recovers.
- **Two independent causes, both live.** (a) `azure.ts:191-201` — an app-initiated `close()` sets
  `closed = true` first, so `ws.onclose`'s `if (!closed) cb.onClose()` suppresses the callback and
  `setIsLive(false)` never runs. (b) `App.tsx:3061` — `startLiveSession`'s first line is
  `if (isLive || connectInFlightRef.current) return;`, and the `setTimeout(startLiveSession, 800)`
  in each reconnect effect holds the closure from the render where `isLive` was `true`;
  `isLiveRef` exists at `App.tsx:512-513` and is used two lines away at 525/1027. Fixing (b) alone
  fixes Gemini (whose `gemini.ts:137` calls `cb.onClose()` unconditionally, so that backend shows
  `off` and is at least restartable by hand); Azure needs (a) too.

### 2. Spec §3 C vs. the artifact window's missing `yours`/`agent` tag

See SH-8 above. Not a code defect — a **spec/code divergence that should be closed on the spec
side**, since the code's reason (an `agent` tag on a user's pin would be a false authorship claim)
is the stronger argument. Left alone here.

### 3. Digit-addressable chips can sit outside the visible chip row (minor, pre-existing)

The Familiar boot offers 8 quick-fire chips; the row is `overflow-x-auto` inside the 640 px omnibox
column, so chips **7 (`Share this with my editor`) and 8 (`Email this to my team`) are scrolled out
of view** at 1600×1000 while remaining addressable by pressing `7`/`8`. Measured: chip 7's rect
extends past `window.innerWidth`-clipped visible area (`visible:false` for 7 and 8, `true` for 1-6).
Not introduced by this plan; noted because "the digit fires a target you cannot see" is the same
family of honesty wrinkle this phase exists to close.

## What each skin actually looks like at 1600×1000

Shots: `SKIN-familiar.png`, `SKIN-material.png`, `SKIN-provenance.png`, `SKIN-conversation.png`
(same desk in each: one Word window at `48,48` plus two agent-made pieces).

- **A · Familiar** reads unambiguously as *someone's desktop*: indigo→sky gradient wallpaper, a
  brand + register pill on the left of the menu bar, a live clock on the right, and a full-width
  taskbar carrying `Microsoft Word · Q3 Status Brief · Status Board │ Excel · PowerPoint · Photo
  Editor`. The agent's two pieces sit in the bar as peers of Word, which is the point. The desk
  icons at the far left are half-covered by the Word window (they are `z-5`, below the windows, by
  design) — correct as a metaphor, but at the default window rect they are barely legible.
- **B · Material** has the strongest furniture story: warm ruled paper, `Your desk 2 pieces · 1
  source` where a menu would be, a 56 px `SOURCES` rail down the left, and a shelf of tiles kicked
  `SOURCE` / `PIECE` with an accent spine on the pieces. **But it does not yet read as "what you
  made is the desk."** The largest, brightest object on the plane is still the Word window; the two
  pieces are small windows tucked behind it. The skin asserts the inversion in the chrome and the
  geometry contradicts it — and the geometry is exactly what a skin is forbidden to change
  (spec §1: `desk.skin` passes `windows` through by identity). Worth carrying into the probe design:
  B may need the *default rects* for made material to differ, which is a desk-level change, not a
  skin-level one.
- **C · Provenance** is legible and genuinely session-shaped: near-black ground with a blue vignette,
  `SESSION 2 pieces · 1 source · 6 steps recorded`, a `YOURS` tag on the program window, an `OPEN`
  strip of windows and a four-lane timeline at the foot (`YOU / AGENT / AGENT / WAITING`).
  **It reads about 70% "record", 30% "debug view."** What pushes it toward debug: the lanes are
  lowercase monospace, the agent row prints the **raw tool name** `ask_content` rather than
  anything a participant would say, and the activity ticker in the bottom-right repeats the same
  material in a second, differently-styled list. Two changes would move it: humanise the tool-name
  row, and suppress the ticker in the skin whose bottom bar already *is* the ticker.
- **D · Conversation** is the least realised of the four, for a structural reason. The centre column
  holds the window list, the ask card, the chips and the omnibox, and a `pointer-events-none` veil
  dims the plane — but **the windows do not orbit anything**: they stay wherever the desk put them,
  so at the default rect Word sits top-left straddling the column rather than at the edge. Same root
  cause as B: the skin may not move windows. The result is a large empty middle with dimmed windows
  overlapping the column's top. Everything *works* (SH-6 and SH-7 both pass here); it just does not
  yet look like the thing it names.

## What could not be exercised keylessly, stated plainly

- **The model's own words.** Everything above proves the app's half of each seam. A stub cannot
  choose a question, speak it, or mis-ground a "this". The owed rows are in the sitting doc, Part 9.
- **The real reconnect path against a real backend.** Reproduced against the stub; the Azure
  suppression (cause (a)) is provider code and behaves identically, but the Gemini variant's
  visible-but-dead `off` state has not been re-confirmed live since it is gated behind the same
  blocker.
- **Anything requiring a real microphone.** The headless shell used the fake capture device
  throughout; no real audio path was exercised.
- **`?shell=` with an unknown key.** `resolveSkin` returning `null` is unit-tested; the "journal
  names a skin this build does not have" fallback (`FALLBACK_SLOTS` in `ShellFrame.tsx`) was not
  driven in the browser — it needs a hand-forged journal and was out of scope for this checklist.

## Global constraints at the end of the drive

```
$ npx vitest run      → Test Files 104 passed (104)   Tests 922 passed (922)
$ npx tsc --noEmit    → clean (no output)
$ npx vite build      → ✓ built in 1.43s (the >500 kB chunk warning is pre-existing)
$ git status --short  → only this file, the sitting-doc part, and the untracked report
```

No new repo dependencies (`package.json` and `package-lock.json` untouched). `JOURNAL_VERSION`
untouched (still 2). Console-error capture was on for every run; the only page error seen in the
whole drive was one `Uncaught (in promise)` from `src/voice/azure.ts` in the stub-close path — an
artefact of the stub socket closing under the provider, not reproduced in normal operation.

**Environment warning:** the falsely-"intentional" system-reminder that has fired for other agents
in this session **did not occur** during this task. `git status --short` and `git diff HEAD` were
checked after every write and showed only intended changes.
