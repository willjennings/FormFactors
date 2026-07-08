import figma from '@figma/code-connect';
import { Button } from './Button';

// Paste this component's Figma node URL after building the library (see docs/figma-workflow.md
// → "Standing it up"). Until then Code Connect skips this file with a clear "unconnected" notice.
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';

figma.connect(Button, FIGMA_URL, {
  props: {
    // Map Figma component properties → the real Button props. Names in quotes are the Figma
    // property names a designer should create on the component (match these exactly).
    variant: figma.enum('Variant', { Primary: 'primary', Ghost: 'ghost', Outline: 'outline' }),
    size: figma.enum('Size', { sm: 'sm', icon44: 'icon44', icon48: 'icon48', chip: 'chip' }),
    label: figma.string('Label'),
  },
  example: ({ variant, size, label }) => <Button variant={variant} size={size}>{label}</Button>,
});
