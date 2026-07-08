// Dependency-free token bridge: parse src/index.css → design/tokens.figma.json (two modes).
// Code is canonical; this mirrors the shipping tokens into a Figma-importable shape.
// Run: `node scripts/tokens-to-figma.mjs`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Extract the body of the first `selector { ... }` block (non-nested). */
function block(css, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  return m ? m[1] : '';
}

/** Parse `--name: value;` pairs from a block body into a Map. */
function vars(body) {
  const out = new Map();
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const isColor = (v) => /^#|^rgb|^hsl/i.test(v);
// Normalize a CSS font stack to a Figma-friendly family string (strip quotes).
const normFont = (v) => v.replace(/["']/g, '');

/** Pure: CSS text → two-mode tokens document. */
export function cssToTokens(css) {
  const theme = vars(block(css, '@theme'));
  const light = vars(block(css, ':root'));
  const dark = vars(block(css, '.dark'));

  const doc = {
    $description: 'Design tokens mirrored from src/index.css. Code is canonical — regenerate with `node scripts/tokens-to-figma.mjs`.',
    modes: ['Light', 'Dark'],
    color: {},
    fontFamily: {},
  };

  // Themed tokens: per-mode values from :root / .dark.
  for (const [name, lv] of light) {
    const dv = dark.get(name) ?? lv;
    doc.color[name] = { $type: 'color', Light: lv, Dark: dv };
  }
  // @theme tokens: single value → mirrored into both modes; classify color vs font.
  for (const [name, v] of theme) {
    if (name.startsWith('font-')) {
      const f = normFont(v);
      doc.fontFamily[name] = { $type: 'fontFamily', Light: f, Dark: f };
    } else if (isColor(v)) {
      doc.color[name] = { $type: 'color', Light: v, Dark: v };
    }
  }
  return doc;
}

// Main runner (only when executed directly, not when imported by the test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(here, '../src/index.css'), 'utf8');
  const doc = cssToTokens(css);
  const outDir = resolve(here, '../design');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'tokens.figma.json'), JSON.stringify(doc, null, 2) + '\n');
  const nc = Object.keys(doc.color).length, nf = Object.keys(doc.fontFamily).length;
  console.log(`Wrote design/tokens.figma.json — ${nc} color + ${nf} fontFamily tokens, Light/Dark modes.`);
}
