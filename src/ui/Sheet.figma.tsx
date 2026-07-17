import figma from '@figma/code-connect';
import { Sheet } from './Sheet';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Sheet, FIGMA_URL, {
  props: { title: figma.string('Title'), children: figma.children('*') },
  example: ({ title, children }) => (
    <Sheet open title={title} onOpenChange={() => {}}>{children}</Sheet>
  ),
});
