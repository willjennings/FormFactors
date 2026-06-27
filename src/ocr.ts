/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// On-device OCR (Tesseract.js / WASM) for SUB-ELEMENT perception (G3): read the words in a
// gallery screenshot + their bounding boxes, so the user can point at a specific WORD ("the
// word 'Quarterly'") rather than just the whole tile. Fully opt-in and graceful: if the model
// assets can't load (offline / blocked CDN), ocrImage rejects and the app falls back to
// whole-tile pointing with no change in behavior. Bboxes are returned NORMALIZED (0..1) within
// the source image so the caller can map them into the app's 0–1000 layout space.

import { createWorker, type Worker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  conf: number;
  // Normalized 0..1 within the source image (x0,y0 = top-left, x1,y1 = bottom-right).
  nx0: number;
  ny0: number;
  nx1: number;
  ny1: number;
}

let workerPromise: Promise<Worker> | null = null;
const cache = new Map<string, Promise<OcrWord[]>>();

async function getWorker(): Promise<Worker> {
  // Lazy: the (multi-MB) language model is only fetched the first time OCR is actually used.
  if (!workerPromise) workerPromise = createWorker('eng');
  return workerPromise;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`OCR image load failed: ${url}`));
    img.src = url;
  });
}

/** Recognize the words in an image (by URL). Cached per URL. Rejects on any failure. */
export async function ocrImage(url: string): Promise<OcrWord[]> {
  const existing = cache.get(url);
  if (existing) return existing;

  const p = (async (): Promise<OcrWord[]> => {
    const img = await loadImage(url);
    const W = img.naturalWidth || 1;
    const H = img.naturalHeight || 1;
    const worker = await getWorker();
    // Request word-level output via the blocks tree (Tesseract.js v6+ shape).
    const ret: any = await worker.recognize(img, {}, { blocks: true } as any);

    const out: OcrWord[] = [];
    const pushWord = (w: any) => {
      const text = (w?.text || '').trim();
      if (!text || !w?.bbox) return;
      out.push({
        text,
        conf: typeof w.confidence === 'number' ? w.confidence : 0,
        nx0: w.bbox.x0 / W,
        ny0: w.bbox.y0 / H,
        nx1: w.bbox.x1 / W,
        ny1: w.bbox.y1 / H,
      });
    };

    for (const b of ret?.data?.blocks ?? [])
      for (const para of b?.paragraphs ?? [])
        for (const line of para?.lines ?? [])
          for (const w of line?.words ?? []) pushWord(w);
    // Fallback for builds that expose a flat words array.
    if (out.length === 0 && Array.isArray(ret?.data?.words)) ret.data.words.forEach(pushWord);

    return out;
  })();

  cache.set(url, p);
  p.catch(() => cache.delete(url)); // don't poison the cache on failure — allow retry
  return p;
}

export function clearOcrCache(): void {
  cache.clear();
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    (await workerPromise).terminate();
  } catch {
    /* ignore */
  }
  workerPromise = null;
}
