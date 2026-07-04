// Stable identity for everything pointable in the scene (R2).
// Decisions run on EntityIds and aliases; titles/perceived labels are presentation data.

import type { Program, ElementCategory } from '../scenarios';
import type { PerceivedCache } from '../perception/perceiveTile';

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
}

const normText = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

type LayoutBox = { ymin: number; xmin: number; ymax: number; xmax: number };
type Layout = { items: { id: number; bbox: LayoutBox }[] } | null;

const toTuple = (b: LayoutBox | undefined): [number, number, number, number] =>
  b ? [b.ymin, b.xmin, b.ymax, b.xmax] : [0, 0, 0, 0];

/** Single source for the scene: one entity per program element. Pure & derived. */
export function buildEntities(program: Program, perceived: PerceivedCache, layout: Layout): SceneEntity[] {
  const tiles: SceneEntity[] = program.images.map((img) => {
    const p = perceived[img.url];
    const perceivedLabel = p && p.status === 'done' && p.label ? p.label : undefined;
    const aliases = [normText(img.title)];
    if (perceivedLabel) aliases.push(normText(perceivedLabel));
    return {
      id: asId(`${program.id}-${img.id}`),
      title: img.title,
      url: img.url,
      category: img.category,
      perceivedLabel,
      aliases,
      bbox: toTuple(layout?.items.find((it) => it.id === img.id)?.bbox),
    };
  });
  return tiles;
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
 * Regression anchor: "Cell A3" must NOT resolve to the "Cell A1" tile.
 */
export function resolveEchoedTarget(
  entities: SceneEntity[], text?: string,
): { entity: SceneEntity; score: number } | null {
  if (!text) return null;
  const t = normText(text);
  if (!t) return null;
  const tokens = new Set(t.split(' '));
  let best: { entity: SceneEntity; score: number } | null = null;
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      let score = 0;
      if (t === alias) score = 1000;
      else if (t.includes(alias)) score = 500 + alias.length;
      else if (alias.includes(t)) score = 100 + Math.round((t.length / alias.length) * 100);
      else {
        const overlap = alias.split(' ').filter((w) => tokens.has(w)).length;
        score = overlap >= MIN_OVERLAP_TOKENS ? overlap : 0;
      }
      if (score > 0 && (!best || score > best.score)) best = { entity, score };
    }
  }
  return best;
}
