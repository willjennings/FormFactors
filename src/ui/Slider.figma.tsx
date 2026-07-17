import figma from '@figma/code-connect';
import { Slider } from './Slider';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Slider, FIGMA_URL, {
  props: { ariaLabel: figma.string('Label') },
  example: ({ ariaLabel }) => (
    <Slider ariaLabel={ariaLabel} value={50} min={0} max={100} step={1} onValueChange={() => {}} />
  ),
});
