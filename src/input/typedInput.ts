const MAX_TYPED_CHARS = 500;

/** Normalize a typed submission: trim; '' for empty/whitespace; cap length. */
export function parseTypedSubmit(raw: string): string {
  if (!raw) return '';
  return raw.trim().slice(0, MAX_TYPED_CHARS);
}
