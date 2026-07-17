# Real-Perception Deixis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perceive each scene tile's real pixels once with Gemini vision and substitute the perceived name for the fake registered title at the three name-facing sites (the "Pointing at" badge, the live deixis hints, and the model's static ON-SCREEN ELEMENTS list), with a full fallback to titles.

**Architecture:** A new isolated module `src/perception/perceiveTile.ts` holds pure helpers (`perceivePrompt`, `cleanPerceivedLabel`, `resolveTileName`) plus a thin Gemini wrapper (`perceiveTileLabel`) and a browser image→base64 loader. `App.tsx` gains a per-URL cache and an eager effect that perceives each tile once; three name-facing sites read the cache through `resolveTileName`, falling back to the registered title while pending/failed/keyless. Internal grounding stays title-keyed.

**Tech Stack:** TypeScript, React 19, `@google/genai` (already a dependency), vitest.

## Global Constraints

- Branch: work on `honest-mode`. Verify `git branch --show-current` before each commit.
- Pure module functions (`perceivePrompt`, `cleanPerceivedLabel`, `resolveTileName`) must not call `Date.now()` or touch the DOM/network.
- Additive + fail-soft: with no `GEMINI_API_KEY`, a CORS/crop failure, a Gemini error, or a still-`pending` tile, `resolveTileName` MUST return the registered title — i.e. exactly today's behavior. Never throw into render or the hint path.
- Internal identity stays title-keyed: do NOT change `hoveredObjectRef`, `interactiveObjects`, or `matchElement`. Only swap the human/model-facing name at the read sites.
- Vision model: `gemini-2.5-flash`. Reuse the existing `GoogleGenAI` client and `import { GoogleGenAI } from '@google/genai'` (already imported in `App.tsx:8`).
- No new dependencies.

---

## File Structure

- Create `src/perception/perceiveTile.ts` — `Perceived`/`PerceivedCache` types; pure `perceivePrompt`, `cleanPerceivedLabel`, `resolveTileName`; `perceiveTileLabel` (Gemini wrapper); `loadImageAsBase64` (browser-only).
- Create `src/perception/perceiveTile.test.ts` — vitest for the pure helpers + a stubbed-client test for `perceiveTileLabel`.
- Modify `src/App.tsx` — cache ref + version state + eager perceive effect + divergence log (Task 3); substitute at the badge, the two deixis hints, and the static list (Task 4).

---

### Task 1: Pure perception helpers

**Files:**
- Create: `src/perception/perceiveTile.ts`
- Create: `src/perception/perceiveTile.test.ts`

**Interfaces:**
- Produces:
  - `type Perceived = { status: 'pending' | 'done' | 'failed'; label?: string }`
  - `type PerceivedCache = Record<string, Perceived>`
  - `perceivePrompt(): string`
  - `cleanPerceivedLabel(raw: string): string`
  - `resolveTileName(title: string, url: string, cache: PerceivedCache): string`

- [ ] **Step 1: Write the failing test**

Create `src/perception/perceiveTile.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { perceivePrompt, cleanPerceivedLabel, resolveTileName } from './perceiveTile';
import type { PerceivedCache } from './perceiveTile';

describe('perceivePrompt', () => {
  it('asks for a short noun phrase', () => {
    const p = perceivePrompt();
    expect(p.toLowerCase()).toContain('noun phrase');
    expect(p.length).toBeGreaterThan(10);
  });
});

describe('cleanPerceivedLabel', () => {
  it('strips quotes, trailing punctuation, and a leading article', () => {
    expect(cleanPerceivedLabel('  "A window with curtains."  ')).toBe('window with curtains');
  });
  it('collapses whitespace and caps at 6 words', () => {
    expect(cleanPerceivedLabel('The  San Francisco skyline at dusk over the bay'))
      .toBe('San Francisco skyline at dusk over');
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(cleanPerceivedLabel('')).toBe('');
    expect(cleanPerceivedLabel('   ')).toBe('');
  });
});

describe('resolveTileName', () => {
  const cache: PerceivedCache = {
    'u-done': { status: 'done', label: 'window with curtains' },
    'u-pending': { status: 'pending' },
    'u-failed': { status: 'failed' },
    'u-empty': { status: 'done', label: '' },
  };
  it('returns the perceived label when done and non-empty', () => {
    expect(resolveTileName('Word Ribbon', 'u-done', cache)).toBe('window with curtains');
  });
  it('falls back to the title when pending, failed, empty, or absent', () => {
    expect(resolveTileName('Word Ribbon', 'u-pending', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-failed', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-empty', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-missing', cache)).toBe('Word Ribbon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/perception/perceiveTile.test.ts`
Expected: FAIL — `Cannot find module './perceiveTile'`.

- [ ] **Step 3: Write the pure helpers**

Create `src/perception/perceiveTile.ts`:
```ts
export type Perceived = { status: 'pending' | 'done' | 'failed'; label?: string };
export type PerceivedCache = Record<string, Perceived>;

/** The vision prompt: a tight, punctuation-free short noun phrase. */
export function perceivePrompt(): string {
  return 'In 3-5 words, name what this photo shows. Reply with only a short noun phrase — no punctuation, no preamble.';
}

/** Normalize the model's reply to a short, clean noun phrase (pure). */
export function cleanPerceivedLabel(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();   // surrounding quotes
  s = s.replace(/[.,;:!?]+$/g, '').trim();          // trailing punctuation
  s = s.replace(/\s+/g, ' ');                        // collapse whitespace
  s = s.replace(/^(a|an|the)\s+/i, '');              // leading article
  const words = s.split(' ').filter(Boolean);
  return words.slice(0, 6).join(' ');
}

/** The substitution point: perceived label when available, else the registered title. */
export function resolveTileName(title: string, url: string, cache: PerceivedCache): string {
  const p = cache[url];
  if (p && p.status === 'done' && p.label) return p.label;
  return title;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/perception/perceiveTile.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/perception/perceiveTile.ts src/perception/perceiveTile.test.ts
git commit -m "feat(perception): pure tile-perception helpers (prompt, clean, resolve)"
```

---

### Task 2: Gemini wrapper + image loader

**Files:**
- Modify: `src/perception/perceiveTile.ts`
- Modify: `src/perception/perceiveTile.test.ts`

**Interfaces:**
- Consumes: `perceivePrompt`, `cleanPerceivedLabel` (Task 1).
- Produces:
  - `perceiveTileLabel(genai: any, base64: string, mimeType?: string): Promise<string>`
  - `loadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }>` (browser-only; not unit-tested)

- [ ] **Step 1: Add the failing test**

Append to `src/perception/perceiveTile.test.ts`:
```ts
import { perceiveTileLabel } from './perceiveTile';

describe('perceiveTileLabel', () => {
  const stub = (text: string) => ({
    models: { generateContent: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) },
  });

  it('reads the model text and returns a cleaned label', async () => {
    const label = await perceiveTileLabel(stub('  "A window with curtains."  ') as any, 'BASE64');
    expect(label).toBe('window with curtains');
  });

  it('returns empty string when the response has no text', async () => {
    const noText = { models: { generateContent: async () => ({ candidates: [{ content: { parts: [] } }] }) } };
    expect(await perceiveTileLabel(noText as any, 'BASE64')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/perception/perceiveTile.test.ts`
Expected: FAIL — `perceiveTileLabel is not exported` / not a function.

- [ ] **Step 3: Add the wrapper + loader**

Append to `src/perception/perceiveTile.ts`:
```ts
/**
 * Ask Gemini to name the image. `genai` is a GoogleGenAI instance. Returns a cleaned
 * label (possibly ''). Throwing is the caller's concern (it marks the tile 'failed').
 */
export async function perceiveTileLabel(genai: any, base64: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const resp = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ parts: [{ inlineData: { data: base64, mimeType } }, { text: perceivePrompt() }] }],
  });
  const text: string = resp?.candidates?.[0]?.content?.parts?.find((p: any) => p?.text)?.text ?? '';
  return cleanPerceivedLabel(text);
}

/**
 * Browser-only: load a (CORS-clean) image and rasterize it to a base64 JPEG so it can be
 * sent to Gemini. Rejects if the image can't load clean or the canvas can't encode.
 */
export function loadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no 2d context'));
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({ base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/perception/perceiveTile.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/perception/perceiveTile.ts src/perception/perceiveTile.test.ts
git commit -m "feat(perception): Gemini perceiveTileLabel wrapper + crossOrigin image loader"
```

---

### Task 3: App cache + eager perceive effect

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `perceiveTileLabel`, `loadImageAsBase64`, `PerceivedCache` (Tasks 1–2); existing `PHOTOS` (`= program.images`), `GoogleGenAI` (imported L8), `addLog`.
- Produces: `perceivedLabelsRef` (`useRef<PerceivedCache>`) and `perceivedVersion` state, populated once per tile URL. No name substitution yet (Task 4).

Verified by typecheck + build + a manual check that the log stream prints `perceived "…" vs registered "…"`.

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after the existing `./scenarios` import block (near L55), add:
```tsx
import { perceiveTileLabel, loadImageAsBase64, resolveTileName } from './perception/perceiveTile';
import type { PerceivedCache } from './perception/perceiveTile';
```

- [ ] **Step 2: Add the cache ref + version state**

Find `const [hoveredObject, setHoveredObject] = useState<string | null>(null);` (L402). Immediately after it, add:
```tsx
  const perceivedLabelsRef = useRef<PerceivedCache>({});
  const [perceivedVersion, setPerceivedVersion] = useState(0);
```

- [ ] **Step 3: Add the eager perceive effect**

Find the `// Vision pipeline` effect (the `useEffect` that begins near L2665). Immediately BEFORE it, add a new effect:
```tsx
  // Real-perception: name each tile from its actual pixels once, cached by URL. Fail-soft —
  // any failure leaves the tile without a perceived label, so resolveTileName falls back to title.
  useEffect(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    const genai = new GoogleGenAI({ apiKey });
    let cancelled = false;
    (async () => {
      for (const photo of PHOTOS) {
        if (perceivedLabelsRef.current[photo.url]) continue; // perceive once per URL
        perceivedLabelsRef.current[photo.url] = { status: 'pending' };
        try {
          const { base64, mimeType } = await loadImageAsBase64(photo.url);
          if (cancelled) return;
          const label = await perceiveTileLabel(genai, base64, mimeType);
          if (cancelled) return;
          perceivedLabelsRef.current[photo.url] = label ? { status: 'done', label } : { status: 'failed' };
          if (label) addLog('info', `perceived "${label}" vs registered "${photo.title}"`);
        } catch (e: any) {
          if (cancelled) return;
          perceivedLabelsRef.current[photo.url] = { status: 'failed' };
          addLog('info', `perception failed for ${photo.title}: ${e?.message ?? e}`);
        }
        setPerceivedVersion((v) => v + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [PHOTOS]);
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: both pass with no errors referencing App.tsx.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(perception): eager per-tile Gemini perception cache in App"
```

---

### Task 4: Substitute the perceived name at the three sites

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `resolveTileName`, `perceivedLabelsRef` (Task 3), existing `PHOTOS`, `hoveredObject`, `foundObject`, `program`.
- Produces: no new exports — the badge, the two deixis hints, and the static list now show perceived names with title fallback.

Verified by typecheck + build + a manual smoke.

- [ ] **Step 1: Substitute in the "Pointing at" badge**

In `src/App.tsx`, find the badge expression (L3043):
```tsx
                  ? `Pointing at: ${hoveredWord ? `"${hoveredWord}" in ${hoveredObject}` : hoveredObject}`
```
Replace it with a version that resolves the hovered object's name (guard against a null `hoveredObject`; `resolveTileName` returns the title for a URL it can't find, e.g. "Google Maps"):
```tsx
                  ? `Pointing at: ${hoveredWord ? `"${hoveredWord}" in ${resolveTileName(hoveredObject ?? '', PHOTOS.find(p => p.title === hoveredObject)?.url ?? '', perceivedLabelsRef.current)}` : resolveTileName(hoveredObject ?? '', PHOTOS.find(p => p.title === hoveredObject)?.url ?? '', perceivedLabelsRef.current)}`
```
(`perceivedVersion` already causes a re-render when a label resolves, so the badge updates.)

- [ ] **Step 2: Substitute in the primary deixis hint**

Find the hint at L1942:
```tsx
          const hintText = `[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: ${foundObject.name}${subTag}${confidenceTag}. ${isCommand ? "NOTE: This is part of an explicit command." : "NOTE: This is just a mention, stay silent unless they give a command."}${refCtx ? ` ${refCtx}` : ''}]`;
```
Replace `${foundObject.name}` with the resolved name:
```tsx
          const perceivedName = resolveTileName(foundObject.name, PHOTOS.find(p => p.title === foundObject.name)?.url ?? '', perceivedLabelsRef.current);
          const hintText = `[USER JUST SAID "${kw.toUpperCase()}" WHILE POINTING AT: ${perceivedName}${subTag}${confidenceTag}. ${isCommand ? "NOTE: This is part of an explicit command." : "NOTE: This is just a mention, stay silent unless they give a command."}${refCtx ? ` ${refCtx}` : ''}]`;
```

- [ ] **Step 3: Substitute in the secondary cursor-context hint**

This is the same category of pointing hint as Step 2 (the spec's intent is "the deixis hint"; this is its silent-context sibling). Find L2467:
```tsx
      providerRef.current.sendTextHint(`[CONTEXT: the cursor is currently over "${hovered}". If the user says "this", "here", or "that", they are pointing at ${hovered}. This is silent context — DO NOT RESPOND OR SPEAK.]`);
```
Replace with a resolved name (compute it just above the call):
```tsx
      const hoveredResolved = resolveTileName(hovered, PHOTOS.find(p => p.title === hovered)?.url ?? '', perceivedLabelsRef.current);
      providerRef.current.sendTextHint(`[CONTEXT: the cursor is currently over "${hoveredResolved}". If the user says "this", "here", or "that", they are pointing at ${hoveredResolved}. This is silent context — DO NOT RESPOND OR SPEAK.]`);
```
(If `hovered` isn't in scope by that exact name at L2467, use the same variable the existing line interpolates as `${hovered}`.)

- [ ] **Step 4: Substitute in the static ON-SCREEN ELEMENTS list**

Find the list in `buildInstructions` (L1448-1449):
```tsx
ON-SCREEN ELEMENTS (the user points at these — use these names exactly):
${program.images.map(i => `- ${i.title}`).join('\n')}
```
Replace the `.map(...)` so each element resolves to its perceived name (read fresh at connect via the ref):
```tsx
ON-SCREEN ELEMENTS (the user points at these — use these names exactly):
${program.images.map(i => `- ${resolveTileName(i.title, i.url, perceivedLabelsRef.current)}`).join('\n')}
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Manual smoke (record evidence)**

Run `npm run dev` (with `GEMINI_API_KEY` set), open `http://localhost:3000`, wait a moment for the log to show `perceived "…" vs registered "…"` lines, then hover a tile: the **"Pointing at:"** badge shows the real content (e.g. "window with curtains"), not "Word Ribbon". Start a session and say "what is this?" while pointing — the model's answer reflects the photo. Then blank `GEMINI_API_KEY` in `.env`, restart, reload: the badge falls back to the registered titles with no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(perception): show perceived tile names at badge, deixis hints, and prompt list"
```

---

## Self-Review notes

- **Spec coverage:** perceive-once-per-URL cache + eager effect (Task 3); the three substitution sites — badge, deixis hint, static list (Task 4, plus the L2467 sibling hint, flagged); pure module with `perceivePrompt`/`cleanPerceivedLabel`/`resolveTileName` + Gemini wrapper (Tasks 1–2); divergence log via `addLog` (Task 3); title fallback everywhere (Global Constraints + `resolveTileName`).
- **Beyond the spec's cited lines:** the spec named the badge, L1942, and L1448-1449. Task 4 Step 3 also fixes the L2467 silent-context hint — the same pointing-hint category — so the model isn't handed the fake label there either. Called out explicitly, not silent.
- **Fail-soft:** every failure path (`no key` / `loadImageAsBase64` reject / `perceiveTileLabel` throw / `pending`) leaves no `done` label, so `resolveTileName` returns the title. No throws into render or hints.
- **Internal identity untouched:** `hoveredObjectRef`, `interactiveObjects`, `matchElement` unchanged; only display/hint strings are resolved.
- **Type consistency:** `Perceived`, `PerceivedCache`, `perceivePrompt`, `cleanPerceivedLabel`, `resolveTileName`, `perceiveTileLabel`, `loadImageAsBase64` used identically across tasks.
```
