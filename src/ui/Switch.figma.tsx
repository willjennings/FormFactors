import figma from '@figma/code-connect';
import { Switch } from './Switch';
const FIGMA_URL = 'PASTE_FIGMA_NODE_URL_HERE';
figma.connect(Switch, FIGMA_URL, {
  props: {
    checked: figma.boolean('Checked'),
    label: figma.string('Label'),
    hint: figma.string('Hint'),
  },
  example: ({ checked, label, hint }) => (
    <Switch checked={checked} label={label} hint={hint} onCheckedChange={() => {}} />
  ),
});
