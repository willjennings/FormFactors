import figma from '@figma/code-connect';
import { Select } from './Select';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Select, FIGMA_URL, {
  props: { ariaLabel: figma.string('Label') },
  example: ({ ariaLabel }) => (
    <Select ariaLabel={ariaLabel} value="" options={[]} onValueChange={() => {}} />
  ),
});
