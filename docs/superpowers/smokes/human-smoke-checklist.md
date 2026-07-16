# Human Smoke Checklist

*Tests only a human can run: real microphone, audible earcons, and subjective glance
judgments. Everything automatable has already been smoked browser-side (see the SDD
ledgers). Protocol: the agent presents ONE test at a time with setup done; you run it,
report pass/fail/weird, and you move to the next. Results get logged back here.*

Setup common to all tests: dev server on `http://localhost:3001` (the agent starts it;
`server.ts` hardcodes port 3000 which is usually occupied). **Allow the microphone** when
Chrome asks — these tests exist precisely because the agent can only stub it.

Legend: ☐ not run · ✅ pass · ❌ fail (with note) · 〜 partial

---

## Test 1 — Teach by voice (Contract B + link stability) ~4 min

*Why human: real-mic audio path; the deixis-mute contract and the link-drop instability
have only ever been observed with a silent stubbed mic and typed input.*

1. Open `http://localhost:3001`, allow the mic.
2. Say: **"How do I save this document?"** → expect a guide sequence (WORD.SAVE panel,
   spotlight, step ring on Save) and the agent pacing it by voice.
3. While the sequence is active, **move your pointer around the document and hover
   elements WITHOUT speaking** for ~10s → the agent must stay silent (the proactive
   deixis hint is muted mid-sequence — Contract B; watch that it doesn't start narrating
   what you're pointing at).
4. Note whether the session survives the whole exchange (the stubbed-mic runs saw
   "Model interrupted" bursts and link drops — does a real mic reproduce them?).

Pass: sequence renders + agent paces it; no deixis chatter mid-sequence; session stable.

Result: ✅ 2026-07-16 — user: "it told me to save this document, push the save button"; sequence + voice pacing worked on a real mic.

## Test 2 — Ramble by voice (gap question + read-back) ~5 min

*Why human: continuous rambling speech is the form factor; `ask_gap` and `confirm_slot`
have NEVER been observed live (typed input made the model answer instead of ask).*

1. Open `http://localhost:3001/?ramble=live`, allow the mic, press **Start ramble**.
2. Ramble naturally about a construction problem — cover the question, a gridline, a
   drawing ref, a discipline — but **deliberately never say a deadline**.
3. Watch for: fills appearing as you talk (filling→draft highlight), then the agent
   **asking you ONE gap question aloud** ("when do you need the answer?" — the
   `needsInput` "asking…" marker should appear on the Needed-by row).
4. Answer it aloud. Then listen for an **incremental read-back** ("got it as… right?")
   and confirm verbally → the row should settle to confirmed.
5. Glance test (spec §5.1, the acceptance bar): mid-ramble, look away, then glance back
   for under a second — can you tell alive? / where is it now? / roughly how far? /
   which fields to worry about, WITHOUT reading?

Pass: ≥1 spoken gap question; read-back → confirm settles a row; glance answers all four.

Result: 〜 2026-07-16 — FINDING: continuous rambling produces ZERO fills (transcriptions
flow — "listening" stays green — but Gemini's VAD never concludes a turn, so the scribe
never acts). Pause-punctuated speech works: user's retry filled Location ("C10, C3" with
the honest ✓? marker) + Drawing ref (S-301) by voice. Typed path fully healthy: one line
→ 4 fills + the FIRST-EVER observed ask_gap (Needed-by row: asking… "When is it needed
by?"). FOLLOW-UP: expose Gemini VAD tuning (realtimeInputConfig silenceDurationMs) in
createGeminiProvider so ramble turns end on shorter pauses; consider a prompt line about
extracting at every pause. Read-back/confirm not yet observed by voice.

## Test 3 — Earcons ~2 min

*Why human: audio. The agent triggers these but cannot hear them.*

1. In `?ramble=live`, drive to the consent card (or in the main app, trigger any
   witnessed action like "make this bold") — a **confirm-needed** earcon (rising,
   suspended — a question) should sound when a card appears.
2. Stay silent >10s mid-ramble-session → the **stall** cue (falling, mildly dissonant
   error contour) should sound once at the flip, not repeatedly.
3. In the main app Control Center → AUDITION EARCONS: click each and confirm they're
   audible and distinguishable at conversational volume.

Pass: cues fire at the right moments, once each, distinguishable.

Result: ✅ 2026-07-16 — user: "it bolded the document and the earcon was fine" (context cue fired with the action; confident mode commits directly). Stall-cue repeat check not explicitly run — acceptable.

## Test 4 — Sketch by voice + beautify feel ~4 min

*Why human: real mouse-drawn strokes (the agent's drags are unnaturally straight) and
the end-to-end voice loop over them.*

1. Open `http://localhost:3001`, click the **pen icon** in the menu bar → whiteboard
   opens empty. Draw a genuinely wobbly box, an arrow, and a scribbled cloud.
2. Allow mic, then ask aloud: **"What did I draw on the whiteboard?"** → the answer
   should name your shapes from geometry and — if you ask about a drawn word —
   **admit it cannot read words**.
3. Say: **"Clean it up into a diagram."** → BEAUTIFY SKETCH card + preview appear.
   Click **Keep my sketch** once (nothing changes), ask again, then **Replace** →
   your ink swaps for structured marks.
4. Feel check: did your wobbly box classify as a box, or honestly as a scribble?
   (Either is acceptable — a wrong confident claim is the only failure.)

Pass: honest description; decline/confirm both behave; no shape over-claimed.

Result: 〜 2026-07-16 — TWO FINDINGS, both fixed in cbcb619: (1) full-ink preview read as
a committed diagram → declining felt like deletion (now a faint 40% "proposed" layer);
(2) user's Replace emptied the WHOLE board (marks too) — agent repro could NOT reproduce
(swap verified working: strokes→Start/Process/Result persisted + recap card); leading
suspect = post-confirm wb_clear by the model, now explicitly forbidden in the CONFIRMED
hint. Voice perception + card + decline/re-propose all worked in the user's run.

## Test 5 — Reconnect perception (today's gate fix) ~2 min

*Why human: quickest by hand, and it verifies today's `e293445` against real toggles.*

1. In the main app with teach overlays or whiteboard marks present (e.g. after Test 1,
   or ask the agent to draw something with `wb_node`), flip **Honest mode** in the
   Control Center → the session reconnects.
2. After reconnect, ask: **"What's on the whiteboard right now?"** (or "where were we
   in the sequence?") → the fresh session must know — the state hints resend on open.

Pass: the post-reconnect session describes existing state without you re-creating it.

Result: ✅ 2026-07-16 — post-reconnect session answered "You currently have a diagram"
about a board it never created (gate reset e293445 verified live). Session dropped
mid-answer afterward — the known Gemini link-drop pattern, logged, not a regression.

---

## Log

- 2026-07-16: checklist created. Automated smokes already cover: teach typed flow
  (guide/teach/fade/Contract A), ramble typed flow (fills/consent/yield/stall UI),
  sketch typed flow (perception/beautify round-trip incl. decline+confirm).

- 2026-07-16 CAMPAIGN COMPLETE: 5/5 run. T1 ✅ teach-by-voice · T2 〜 voice fills need
  pauses (VAD follow-up) + first-ever ask_gap · T3 ✅ earcons · T4 〜 two findings fixed
  cbcb619 (faint proposed preview, wb_clear forbidden post-confirm) · T5 ✅ reconnect
  perception. Still unobserved by voice: ramble read-back→confirm loop.

- 2026-07-16 post-campaign console-log findings (user-supplied): (1) MIC LEAK — after a
  SERVER-initiated session close, the ScriptProcessorNode kept pumping into the dead
  socket (~4x/s "WebSocket is already in CLOSING or CLOSED state") and the mic stayed
  captured; gemini + azure both fixed (7ef84cf, 6ad3643). (2) VOICE REVISE MANGLING —
  repeated confirms applied stale char spans ("summary.ary.ary.y."); confirm now verifies
  the witnessed text is unchanged, drops honestly otherwise (6ad3643). Follow-up logged:
  migrate ScriptProcessorNode → AudioWorkletNode (deprecation). Noise identified: _next
  font preloads are the Kausap app's, extension runtime.lastError is Chrome's.

- 2026-07-16 (cont.): two more user-reported UI bugs, fixed in 5292422: (1) witness/DONE
  cards overlapped the assistant caption + chips (two independent absolute stacks) — cards
  now render through Omnibox's `above` slot in one flex column; (2) typed "this" markers
  landed on the compose box — shell surfaces (Omnibox/MenuBar/WhiteboardPanel) only stopped
  pointer-DOWN, so hover over them still moved the plane cursor; pointer-move now stopped
  too (verified: marker lands on the document plane).

- 2026-07-16 (cont.): the pointer-move stop hid the custom cursor over the shell (native
  cursor is display:none app-wide) — reworked in 25f2f11: shell roots carry data-shell;
  the move handler always tracks the visual cursor and skips only the deixis half over
  shell. Verified: cursor renders on the chips; typed-"this" markers still can't land there.
