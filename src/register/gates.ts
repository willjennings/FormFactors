// Render gates derived from dials. ONE derivation feeds both the chip row and quick-fire
// (quickFireIndex bails on chipCount 0), so 'none' can never leave an invisible hot surface.
import type { DialValues } from './types';

export function visibleSuggestions<T>(
  suggestions: T[], chipDensity: DialValues['chipDensity'], groundingCount: number,
): T[] {
  if (chipDensity === 'none') return [];
  if (chipDensity === 'grounded' && groundingCount === 0) return [];
  return suggestions;
}
