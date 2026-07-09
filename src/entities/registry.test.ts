import { describe, it, expect } from 'vitest';
import {
  buildEntities, entityById, entityByTitle, displayName, resolveEchoedTarget,
  type SceneEntity,
} from './registry';
import { getProgram } from '../scenarios';
import type { PerceivedCache } from '../perception/perceiveTile';

const excel = getProgram('excel');
const box = (n: number) => ({ ymin: n, xmin: n, ymax: n + 100, xmax: n + 100 });
const layout = {
  items: excel.images.map((img, i) => ({ id: img.id, bbox: box(i * 10) })),
};
const perceived: PerceivedCache = {
  [excel.images[3].url]: { status: 'done', label: 'grid of numbers' }, // 'Cell A1' tile
};

describe('buildEntities', () => {
  it('builds one entity per image, ids stable and prefixed', () => {
    const es = buildEntities(excel, {}, layout);
    expect(es).toHaveLength(excel.images.length);
    expect(es[0].id).toBe(`excel-${excel.images[0].id}`);
  });
  it('merges perceived labels into aliases and displayName', () => {
    const es = buildEntities(excel, perceived, layout);
    const cell = entityByTitle(es, 'Cell A1')!;
    expect(cell.perceivedLabel).toBe('grid of numbers');
    expect(displayName(cell)).toBe('grid of numbers');
    expect(cell.aliases).toContain('cell a1');
    expect(cell.aliases).toContain('grid of numbers');
  });
  it('without layout returns entities with zero bboxes (not empty)', () => {
    const es = buildEntities(excel, {}, null);
    expect(es).toHaveLength(excel.images.length);
    expect(es[0].bbox).toEqual([0, 0, 0, 0]);
  });
  it('displayName falls back to title without perception; undefined → empty string', () => {
    const es = buildEntities(excel, {}, layout);
    expect(displayName(entityByTitle(es, 'SUM function'))).toBe('SUM function');
    expect(displayName(undefined)).toBe('');
    expect(entityById(es, undefined)).toBeUndefined();
  });
});

describe('resolveEchoedTarget', () => {
  const es = buildEntities(excel, perceived, layout);
  it('resolves exact and containment matches on titles', () => {
    expect(resolveEchoedTarget(es, 'Cell A1')!.entity.title).toBe('Cell A1');
    expect(resolveEchoedTarget(es, 'the SUM function please')!.entity.title).toBe('SUM function');
  });
  it('resolves via perceived-label aliases (the G5 fix)', () => {
    expect(resolveEchoedTarget(es, 'grid of numbers')!.entity.title).toBe('Cell A1');
  });
  it('REGRESSION (session 2026-07-02): "Cell A3" must NOT fuzzy-match the Cell A1 tile', () => {
    expect(resolveEchoedTarget(es, 'Cell A3')).toBeNull();
  });
  it('bare token overlap needs ≥2 tokens', () => {
    // 'AVERAGE function' vs 'the average of the function' → tokens {average, function} = 2 → resolves
    expect(resolveEchoedTarget(es, 'the average of the function')!.entity.title).toBe('AVERAGE function');
  });
  it('returns null for empty/unknown', () => {
    expect(resolveEchoedTarget(es, '')).toBeNull();
    expect(resolveEchoedTarget(es, 'the weather in Paris')).toBeNull();
  });
});

const ent = (id: string, aliases: string[]): SceneEntity =>
  ({ id: id as any, title: id, url: '', category: 'content', aliases, bbox: [0,0,10,10], sub: true });

describe('resolveEchoedTarget — dense alias sets (C1)', () => {
  const cells = ['a1','a3','a13','b2'].map(r => ent(`excel-cell-${r.toUpperCase()}`, [r, `cell ${r}`]));
  it('exact echo resolves to the right cell', () => {
    expect(resolveEchoedTarget(cells, 'cell a3')!.entity.id).toBe('excel-cell-A3');
    expect(resolveEchoedTarget(cells, 'A3')!.entity.id).toBe('excel-cell-A3');
  });
  it('near neighbor does NOT cross-resolve (a3 must not match a13, nor a1)', () => {
    const r = resolveEchoedTarget(cells, 'a3');
    expect(r!.entity.id).toBe('excel-cell-A3');           // not A13, not A1
  });
  it('a13 resolves to A13, not A1 or A3', () => {
    expect(resolveEchoedTarget(cells, 'cell a13')!.entity.id).toBe('excel-cell-A13');
  });
  it('slides: "slide 2" does not resolve to "slide 12"', () => {
    const slides = [2,12].map(n => ent(`powerpoint-slide-${n}`, [`slide ${n}`]));
    expect(resolveEchoedTarget(slides, 'slide 2')!.entity.id).toBe('powerpoint-slide-2');
  });
  it('below-threshold gibberish still returns null (honesty floor)', () => {
    expect(resolveEchoedTarget(cells, 'xyzzy')).toBeNull();
  });
});
