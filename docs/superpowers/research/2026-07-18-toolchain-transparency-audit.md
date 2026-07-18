# Toolchain transparency audit — what the user sees while the model works

**Date:** 2026-07-18. Driven live at `2605151` (quick-fire flows, witness/commit flows; combine
and error flows observed across this week's smokes). User request: "I need to see a
transparency layer of what the model is doing."

## Stage-by-stage visibility today

| Stage | Surface today | Verdict |
| --- | --- | --- |
| 1. Request sent (typed/voice/quick-fire) | Quick-fire echo pill (4s), transcript italic line, op-stream `⌨/User:` | OK but transient; no persistent chain |
| 2. Model working | Busy dots until first token | OK for "alive", says nothing about WHAT |
| 3. Tool call dispatched | **Nothing** (drawer op-stream only) | **GAP G1** — the actions layer is invisible |
| 4. Tool rejected (errors-as-data) | **Nothing** (drawer only); model retries silently | **GAP G2** — user sees unexplained dead air; worst during multi-call chains (read_sources→combine, annotate bursts, beautify rejections) |
| 5. Witness/confirm | Witness cards (good, explicit) | OK |
| 6. Commit | DONE card + toast + earcon + doc badge | Good — the strongest stage |
| 7. History | Control Center op-stream | Buried; nothing glanceable in the main UI |

The honest machinery exists end-to-end (every call, ack, rejection, and commit already flows
through two seams: `handleVoiceToolCall`/`ack()` and `emitFeedback`) — it is simply only
rendered inside the debug drawer. Stages 3–4 are where the thesis ("never lie, show the work")
is under-served: the system is honest in DATA but silent in PIXELS.

## Design: the Activity Trace

A slim model-activity ticker, bottom-right (mirrors the dock; empty real estate), fed ONLY
from the real seams — never from model narration:

- `→ What is this? · Save button` — request accepted into the pipeline (voice, typed, and
  quick-fire uniformly, from processInputTranscript; replaces/generalizes the quick-fire pill)
- `⚙ save_file (Save button)` — tool call dispatched (from handleVoiceToolCall, post-dedupe)
- `⧖ awaiting your confirm` — witness decision pending
- `✓ Saved` / `✗ unknown target "Sve button" — model informed` — outcome (from ack()/emitFeedback)

Rows: newest at bottom, cap ~4 visible, fade ~7s after the turn settles; the full history
remains the drawer's op-stream (a click on the trace opens it). Pure `activityStore` reducer
(cap, coalescing), `ActivityTrace` component, App feeds at the two seams + request entry.

Honesty invariants: entries reflect dispatched calls and actual acks only; rejections are
shown as rejections (the retry becomes visible instead of dead air); no invented progress.
