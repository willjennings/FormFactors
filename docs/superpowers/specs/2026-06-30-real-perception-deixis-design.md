# Real-Perception Deixis — Design Spec

*Make the point-and-speak scene report what the user is *actually* pointing at, by perceiving each
tile's real pixels (Gemini vision) instead of echoing a pre-registered label. Directly addresses the
"fake vision" gap (`docs/superpowers/specs/2026-06-27-gap-analysis.md`, F1): today the tiles are
random `picsum.photos` images labeled as Word/Excel UI elements, so pointing at a photo of a window
reports "Word Ribbon".*

Date: 2026-06-30
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: perceive each visible tile once, cache it, and substitute the perceived name at the three
name-facing sites (the "Pointing at" badge, the live deixis hint, and the model's static ON-SCREEN
ELEMENTS list). Internal title-keyed grounding logic is untouched. Additive with a full fallback to
today's behavior.

---

## 1. Problem

`ph(seed) = https://picsum.photos/seed/<seed>/400/533` (`scenarios.ts:106`) yields a random stock
photo per seed. The Word program's tiles are `ph('word-ribbon')` … titled "Word Ribbon", "Save
button", etc. (`scenarios.ts:113-116`). The "Pointing at: X" badge and the model's deixis hint use
the tile's **registered title**, never the pixels — so pointing at a curtain photo reports "Word
Ribbon". This is the learnings-doc §4 trap ("feeding labels you already computed") made visible.

## 2. Goal / non-goals

**Goal:** the identity surfaced for "what am I pointing at" reflects the tile's real content, derived
from Gemini vision, cached once per image.

**Non-goals (this slice):**
- Changing the internal grounding identity (stays title-keyed so `matchElement` etc. are unchanged).
- Perceiving the map (cross-origin iframe — out of scope, unchanged).
- Any change to the scenario task names or the `?ramble=1` monitor.

## 3. Architecture & data flow

```
scene tiles loaded  +  Gemini key present
        │  (once per image url)
        ▼
   crop tile → base64 ──► Gemini generateContent(perceivePrompt) ──► cleanPerceivedLabel(text)
        │                                                                    │
        └──────────────► perceivedLabels[url] = { status:'done', label }  ◄──┘

at hover / utterance / connect:
   resolveTileName(title, url, cache) = cache[url]?.label (if 'done') ?? title
        ├─► "Pointing at: <perceived>"   (badge display)
        ├─► deixis hint  [USER JUST SAID "THIS" WHILE POINTING AT: <perceived> …]  (App.tsx:1942)
        └─► static ON-SCREEN ELEMENTS list in the system prompt   (App.tsx:1448-1449)
```

Internal `hoveredObjectRef` / `interactiveObjects` stay **title-keyed**; `resolveTileName` swaps only
the human/model-facing name at the three sites above.

## 4. New module — `src/perception/perceiveTile.ts`

- `perceivePrompt(): string` — the tight vision prompt (pure):
  *"In 3-5 words, name what this photo shows. Reply with only a short noun phrase — no punctuation,
  no preamble."*
- `cleanPerceivedLabel(raw: string): string` — pure: trim; strip surrounding quotes; drop trailing
  punctuation; collapse whitespace; cap to ~6 words; strip a leading "a "/"an "/"the ". Returns `''`
  for empty/whitespace input.
- `perceiveTileLabel(genai, base64: string, mimeType?: string): Promise<string>` — thin wrapper:
  calls `genai.models.generateContent({ model: 'gemini-2.5-flash', contents:[{ parts:[{ inlineData:{
  data, mimeType } }, { text: perceivePrompt() }] }] })`, reads
  `resp.candidates?.[0]?.content?.parts?.find(p=>p.text)?.text ?? ''`, returns `cleanPerceivedLabel`.
  Throws are the caller's concern (caller marks `failed`).
- `resolveTileName(title: string, url: string, cache: PerceivedCache): string` — pure selector:
  returns `cache[url]?.label` when `status==='done'` and label non-empty, else `title`.

Types:
```ts
type Perceived = { status: 'pending' | 'done' | 'failed'; label?: string };
type PerceivedCache = Record<string, Perceived>;   // keyed by image url
```

## 5. Integration in `App.tsx`

- `perceivedLabelsRef = useRef<PerceivedCache>({})` (+ a state mirror to trigger re-render of the
  badge when a label resolves).
- **Perceive effect:** when the tiles' `crossOrigin` images are loaded (reuse the existing
  `visionImgCacheRef` clean-image path) and `process.env.GEMINI_API_KEY` is set, iterate the current
  `PHOTOS`; for each `url` absent from the cache: set `pending`, crop that image to a base64 JPEG
  from an offscreen canvas (same taint-safe path as the vision frame — only clean images), call
  `perceiveTileLabel`, store `{status:'done', label}` or `{status:'failed'}`. One pass; static
  images ⇒ never repeated.
- **Badge:** the "Pointing at: …" indicator renders `resolveTileName(hoveredTitle, hoveredUrl,
  cache)`.
- **Deixis hint (`App.tsx:1942`):** build the hint with `resolveTileName(foundObject.name, url, …)`
  in place of `foundObject.name`. (The tile's `url` is available via `PHOTOS.find(p => p.title ===
  foundObject.name)`.)
- **Static ON-SCREEN ELEMENTS list (`App.tsx:1448-1449`):** map each `program.images[i]` through
  `resolveTileName(i.title, i.url, cache)` instead of `i.title`. Timing: instructions are built at
  connect. To pick up labels that resolve after first render, `buildInstructions` (a `useMemo`)
  gains the cache **state mirror** in its deps so it recomputes when a label lands; a session started
  after eager perception completes therefore uses perceived names. A session already live when a
  label resolves is **not** retroactively re-prompted (realtime system prompts aren't re-sent
  mid-session) — but the live deixis hint already carries the perceived name, so per-utterance
  grounding stays correct. If perception hasn't finished at connect, the list falls back to titles.
- **Divergence log:** on each `done` perception, emit `addLog('info', 'perceived "<label>" vs
  registered "<title>"')` (reuses the existing log stream) so the registered-vs-perceived gap is
  visible. A structured `telemetry` event (seeding F2 disagreement-confidence) is a follow-up, out of
  this slice to avoid a `telemetry.ts` change.

## 6. Error handling & graceful degradation

- No Gemini key → the perceive effect no-ops; `resolveTileName` returns titles (today's behavior).
- A tile that isn't CORS-clean / fails to crop → `failed` → title fallback.
- A `generateContent` throw/timeout → `failed` → title fallback; logged via `addLog`, never thrown
  into render.
- While `pending` → title shown; the badge updates when the label resolves.

## 7. Testing

- **Pure (vitest):**
  - `cleanPerceivedLabel` — quotes/punctuation/preamble stripping, word cap, empty input → `''`,
    leading-article strip.
  - `resolveTileName` — returns perceived when `done`+non-empty; falls back to title when
    `pending`/`failed`/absent/empty-label.
- **Build + manual smoke:** point at a tile → badge shows real content ("window with curtains");
  say "what is this" → the model's answer reflects the photo; remove the key + reload → badge falls
  back to titles with no errors.

## 8. Build order (informs the plan)

1. `perceiveTile.ts` pure pieces (`perceivePrompt`, `cleanPerceivedLabel`, `resolveTileName`) + tests.
2. `perceiveTileLabel` Gemini wrapper.
3. App integration: cache + perceive effect + crop-to-base64.
4. Substitute at the badge + the deixis hint; add the divergence log.
5. Substitute in the static ON-SCREEN ELEMENTS list (cache state-mirror into the `buildInstructions`
   memo deps); manual smoke of both a pre-perception and post-perception session start.
