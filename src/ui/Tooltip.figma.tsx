import figma from '@figma/code-connect';
import { Tip } from './Tooltip';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Tip, FIGMA_URL, {
  props: { label: figma.string('Label'), children: figma.children('*') },
  example: ({ label, children }) => <Tip label={label}>{children}</Tip>,
});
