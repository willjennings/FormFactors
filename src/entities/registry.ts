// Stable identity for everything pointable in the scene (R2).
// Decisions run on EntityIds and aliases; titles/perceived labels are presentation data.

import type { Program, ElementCategory, MockDoc } from '../scenarios';
import type { PerceivedCache } from '../perception/perceiveTile';
import { SUB_ENTITY_DERIVERS } from './subEntities';

/** Branded so tsc flags any raw title string flowing into an id slot during the rekey. */
export type EntityId = string & { __brand: 'EntityId' };
const asId = (s: string): EntityId => s as EntityId;

export interface SceneEntity {
  id: EntityId;
  title: string;                              // registered name — data, not a reasoning key
  url: string;
  category: ElementCategory;
  perceivedLabel?: string;
  aliases: string[];                          // normalized names the model may use
  bbox: [number, number, number, number];     // ymin,xmin,ymax,xmax (0-1000)
  sub?: boolean;                              // true for sub-elements (cells, slides, etc.)
}

const normText = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

type LayoutBox = { ymin: number; xmin: number; ymax: number; xmax: number };
type Layout = { items: { id: string; bbox: LayoutBox }[] } | null;

const toTuple = (b: LayoutBox | undefined): [number, number, number, number] =>
  b ? [b.ymin, b.xmin, b.ymax, b.xmax] : [0, 0, 0, 0];

/** Single source for the scene: one entity per program element. Pure & derived. */
export function buildEntities(program: Program, doc: MockDoc, perceived: PerceivedCache, layout: Layout): SceneEntity[] {
  const bboxOf = (id: string) => toTuple(layout?.items.find((it) => it.id === id)?.bbox);
  const top: SceneEntity[] = program.images.map((img) => {
    const id = `${program.id}-${img.id}`;
    const p = perceived[img.url];
    const perceivedLabel = p && p.status === 'done' && p.label ? p.label : undefined;
    const aliases = [normText(img.title)];
    if (perceivedLabel) aliases.push(normText(perceivedLabel));
    return { id: asId(id), title: img.title, url: img.url, category: img.category, perceivedLabel, aliases, bbox: bboxOf(id), sub: false };
  });
  const subs: SceneEntity[] = (SUB_ENTITY_DERIVERS[program.id]?.(doc) ?? []).map((s) => {
    const id = `${program.id}-${s.idSuffix}`;
    const aliases = Array.from(new Set([normText(s.title), ...s.aliases.map(normText)]));
    return { id: asId(id), title: s.title, url: '', category: s.category, aliases, bbox: bboxOf(id), sub: true };
  });
  return [...top, ...subs];
}

export function entityById(entities: SceneEntity[], id: EntityId | null | undefined): SceneEntity | undefined {
  return id ? entities.find((e) => e.id === id) : undefined;
}

/** Edge adapter for text-domain subsystems (OCR, scenario focus titles). */
export function entityByTitle(entities: SceneEntity[], title: string | null | undefined): SceneEntity | undefined {
  return title ? entities.find((e) => e.title === title) : undefined;
}

/** What humans and the model see: the perceived name when we have one, else the registered title. */
export function displayName(e: SceneEntity | undefined): string {
  return e ? (e.perceivedLabel ?? e.title) : '';
}

const MIN_OVERLAP_TOKENS = 2;

/**
 * Resolve the model's echoed target against every alias of every entity.
 * matchElement's containment tiers, generalized — plus an honesty floor:
 * bare token overlap needs ≥2 tokens, else null ("below my resolution").
 * Regression anchor: "Cell A3" resolves to the A3 cell, never the A1 cell/grid — word-boundary
 * tokens keep dense near-identical alias sets (A1…D6) from cross-resolving.
 */
export function resolveEchoedTarget(
  entities: SceneEntity[], text?: string,
): { entity: SceneEntity; score: number } | null {
  if (!text) return null;
  const t = normText(text);
  if (!t) return null;
  const tTokens = t.split(' ');
  const tSet = new Set(tTokens);
  // Token-subset matching is order-agnostic and assumes aliases are pre-normalized (buildEntities
  // normText()s them): "average function" and "function average" both match. Deliberate — model
  // echoes are paraphrases; no alias set in this domain relies on word order for disambiguation.
  // A word-boundary "contains": every token of `needle` appears as a token of `hay`, in order-agnostic set terms.
  const tokenSubset = (needleTokens: string[], hayTokens: string[]) => {
    const haySet = new Set(hayTokens);
    return needleTokens.every(w => haySet.has(w));
  };
  let best: { entity: SceneEntity; score: number } | null = null;
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      const aTokens = alias.split(' ');
      let score = 0;
      if (t === alias) score = 1000;                                  // exact wins outright
      else if (tokenSubset(aTokens, tTokens)) score = 500 + alias.length; // echo contains the alias (word-boundary)
      else if (tokenSubset(tTokens, aTokens)) score = 100 + Math.round((t.length / alias.length) * 100); // alias contains the echo
      else {
        const overlap = aTokens.filter((w) => tSet.has(w)).length;
        score = overlap >= MIN_OVERLAP_TOKENS ? overlap : 0;          // honesty floor: ≥2 tokens
      }
      if (score > 0 && (!best || score > best.score)) best = { entity, score };
    }
  }
  return best;
}
