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
