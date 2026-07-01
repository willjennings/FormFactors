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
