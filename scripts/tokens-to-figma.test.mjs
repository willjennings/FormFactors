import { describe, it, expect } from 'vitest';
import { cssToTokens } from './tokens-to-figma.mjs';

const CSS = `
@theme {
  --font-dm: "DM Sans", sans-serif;
  --color-box-bg: #1C2938;
}
:root {
  --accent-color: #1A74E8;
  --dot-color: rgba(26, 26, 26, 0.15);
}
.dark {
  --accent-color: #0076F0;
  --dot-color: rgba(255, 255, 255, 0.15);
}
`;

describe('cssToTokens', () => {
  const t = cssToTokens(CSS);
  it('emits two modes', () => {
    expect(t.modes).toEqual(['Light', 'Dark']);
  });
  it('themed color carries per-mode values', () => {
    expect(t.color['accent-color']).toEqual({ $type: 'color', Light: '#1A74E8', Dark: '#0076F0' });
    expect(t.color['dot-color']).toEqual({ $type: 'color', Light: 'rgba(26, 26, 26, 0.15)', Dark: 'rgba(255, 255, 255, 0.15)' });
  });
  it('@theme single-mode color mirrors into both modes', () => {
    expect(t.color['color-box-bg']).toEqual({ $type: 'color', Light: '#1C2938', Dark: '#1C2938' });
  });
  it('font family becomes a fontFamily token, mirrored', () => {
    expect(t.fontFamily['font-dm']).toEqual({ $type: 'fontFamily', Light: 'DM Sans, sans-serif', Dark: 'DM Sans, sans-serif' });
  });
  it('does not classify a font as a color', () => {
    expect(t.color['font-dm']).toBeUndefined();
  });
});
