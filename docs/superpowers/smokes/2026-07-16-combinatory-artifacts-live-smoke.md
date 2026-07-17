# Combinatory Artifacts — live smoke (spec §10), 2026-07-16

Driven at ccea655 on `localhost:3001` with the silent-mic stub; typed omnibox input; real Gemini Live session.

## Results

| Item | Result |
| --- | --- |
| Two sources → "combine into a summary" → provenance window | **PASS** — pointed at Excel (Cell C2), named the Word report; `Status Summary` (a1) created with `from: word + excel` line |
| Liberty audit vs MERIDIAN | **PASS** — every claim traces: $4.2M revenue, 18% margin, Riverside on schedule / topped out steel Sept, Dockside 2 wks behind, crane risk. No invented numbers, no contradictions |
| Closure (artifact as source) | **PASS** — pointed at `Status Summary`, asked for a project update with the photo; `Project Update` created with `from: a1 + photo`; photo represented ONLY by its caption ("Riverside Tower — steel topping out, Sept 2026"), no invented photo content |
| User-only close | **PASS** — × closed the duplicate windows; the model has no close tool (create-only surface enforces this structurally) |
| Cap rejection at 6 | **NOT EXERCISED LIVE** — reaching 6 artifacts needs 4+ more live turns over a link that drops between turns. Covered by unit tests (rejectedAtCap, reject-never-evict) and the capacity-simulation validator tests |
| M2 widget, feeds honest | **PASS** — `Status Widget` created: Lead Project static (no chip), Local Time **LIVE** ticking clock, Weather **LIVE** 32°C (open-meteo), MERI Stock **SIMULATED** $47.38; per-field `updated HH:MM:SS` stamps present. `[ARTIFACTS]` feeds clause pinned by exact-string unit test |

## Findings (logged, not blocking)

1. **Cold-start / reconnect first-typed-message drop, ×2.** On both a cold session start and an auto-restart after a link drop, the first typed message got a generic "Please tell me what you would like to do". **ROOT-CAUSED + FIXED 2026-07-17:** the Gemini SDK fires `callbacks.onopen` BEFORE its connect promise resolves, so during the App's onOpen flush the provider's `session` local was still null and `session?.sendClientContent(...)` silently dropped the queued text — deterministically, on every gemini cold start (retries worked because the session existed by then). Fix: all provider sends queue on `sessionPromise` like the audio pump (`geminiOpenFlush.test.ts` pins the SDK's onopen-before-resolve ordering). Verified live ×2: first typed turn now answered correctly. **Correction:** the "spurious teach_sequence overlay" reported here was a misdiagnosis — the numbered badges are the live-session DEBUG MARKINGS (element legend, Control Center toggle), not teach output. No teach call ever fired.
2. **Model repetition → triplicate artifact.** One closure turn produced `Project Update` ×3 (a2/a3/a4) — the three combine calls had slightly different args, so per-call dedupe keys legitimately differ. Create-only + user-close kept it honest but noisy. Design question: same-title+same-sources cooldown gate?
3. **Model source-picking.** Asked for a widget "from the Word report and the spreadsheet"; the model declared `from: a1 + photo` instead. The provenance display is honest about what the model declared — but the model ignored the requested sources. Model-side judgment, watch it.
