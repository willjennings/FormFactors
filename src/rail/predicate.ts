import type { MockDoc } from '../scenarios';

/** Dot-path predicate against the reducer state. Returns null when the path is absent
 *  on this doc kind (mapper: whole-call error; store: treated as fail). Never throws. */
export function evaluatePredicate(doc: MockDoc, expect: { path: string; equals: unknown }): boolean | null {
  let cur: unknown = doc;
  for (const seg of expect.path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === expect.equals;
}
