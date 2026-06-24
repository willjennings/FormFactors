<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/06c24b00-f5b9-4a6f-a54a-0033e2330f47

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

---

## Honest mode — the honest AI-pointer

This fork adds a **Honest mode** toggle (top of the Session Controls panel) that demonstrates the same
point-and-speak interaction two ways:

- **OFF (Google baseline):** the pointing hint is treated as the *absolute source of truth*. The guide
  acts immediately and confidently — and when a photo is genuinely ambiguous, it can route you to the
  **wrong place, silently**.
- **ON (honest):** the hint carries a **confidence**, and the response *scales with the situation* along
  three axes — **confidence** (sure → ambiguous → can't tell), **commitment** (showing a map → routing you
  → sending to a person), and **inference depth** (locate → synthesize → infer intention). It stays fluid
  when it's sure, and asks / hedges / proposes only when a wrong guess would be both likely and costly.

The headline contrast is **St Pancras vs King's Cross** — adjacent, near-identical Gothic façades. Point
at the St Pancras photo and ask *"directions here from the London Eye"*: the baseline routes silently; the
honest version shows a dashed amber **"?"** marker and asks *"I think that's St Pancras — or did you mean
King's Cross next door?"* before routing.

### Demo arc (run the toggle both ways)
1. **S1 — clear landmark** (London Eye, "show me this"): honest mode acts immediately, *no* friction —
   proves honesty isn't nagging.
2. **S2 — St Pancras vs King's Cross**: the money shot — honest mode asks before routing.
3. **S3 — point at nothing** ("what's that?"): an honest shrug, no fabricated marker.
4. **S4 — "from here to there"**: directions witness-render both endpoints before sending (commitment
   scales the friction, not just confidence).
5. **S5 — "plan a day from these"**: the plan is *proposed as a hypothesis* and confirmed before it's built.
6. **S6 — unprompted trip pattern**: after a few points, the guide *offers* an itinerary, states its
   reasoning, and **never builds it unasked**.

Open the **debug panel** to see the confidence drill-down (level, reason, candidates) per point.

### Honest framing of this prototype's own limits
The confidence here is a **demo-grade proxy** — a geometric margin plus a small seeded confusable-pairs
table (`St Pancras Station ↔ King's Cross`) — **not** a research-grade perception-confidence model. That's
on-thesis: the artifact demonstrates the *interaction grammar* (a hint carries confidence → low confidence
triggers an honest ask), not a novel confidence estimator. Being upfront that the confidence is synthesized
is the honesty thesis applied to the prototype itself. The `share` verb is likewise simulated (no real
outward integration) — it exists to demonstrate the outward-commitment witness-render.

---

## Voice backend — Gemini vs RTV2 (OpenAI Realtime)

A **Voice backend** dropdown (in the Session Controls panel, under the Honest-mode toggle) runs the *same*
point-and-speak interaction — identical hints, tools, confidence logic, and honest-mode behavior — on
either of two live voice models, so you can A/B the experience:

- **Gemini** (default) — Google's Gemini Live API.
- **RTV2 (OpenAI Realtime)** — OpenAI's Realtime API over WebRTC.

Both backends speak. Switching the dropdown while live reconnects on the new backend automatically.

### Setup for RTV2
Add your OpenAI key (with Realtime access) to `.env.local`:

```
OPENAI_API_KEY="sk-..."
```

The key stays **server-side**: `server.ts` exposes `POST /api/realtime/session`, which mints a short-lived
**ephemeral token** the browser uses to open the WebRTC connection. The real key never reaches the client.

### Architecture
Both backends sit behind a small `VoiceProvider` interface (`src/voice/types.ts`); the honest-mode logic
in `App.tsx` is provider-agnostic. Adapters: `src/voice/gemini.ts`, `src/voice/openai.ts`.

### Known caveats
- **Hint timing.** Gemini streams partial transcripts mid-speech; OpenAI's transcription tends to arrive
  at end-of-turn, so the cursor↔hint correlation can differ — the two backends may not feel identical.
- **Vision.** Gemini receives the annotated marker frame as continuous video; OpenAI takes discrete
  `input_image` snapshots (a sparse heartbeat + a frame coupled to each deixis hint).
- **Secondary cues.** A few Gemini-specific context injections (image-evolve, painting/layout hints) flow
  only to Gemini; the core deixis/honest-mode loop works on both.
- The OpenAI path is implemented against the current GA Realtime API and verified against the docs, but
  should be confirmed with a live key.
