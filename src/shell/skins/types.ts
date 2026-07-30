// A ShellSkin is a named point in slot-space + an ethos sentence and a pre-registered
// probe hypothesis — the same idea as register/registry.ts's RegisterDef, applied to the
// desktop's furniture instead of its dials, so metaphor and interaction style can be varied
// independently (spec §2, §0b). Nothing under src/shell/skins/ may import from src/shell/desk/.
import type { ArmAggregate } from '../../eval/armAggregate';
import type { ProbeVerdict } from '../../eval/types';

export type SkinKey = 'familiar' | 'material' | 'provenance' | 'conversation';

export interface ShellSkin {
  key: SkinKey; label: string; glyph: string;
  ethos: string;   // one sentence: what this skin believes
  probe: string;   // the pre-registered hypothesis (rendered in the UI — honest experiment framing)
  // The machine-checkable companion to `probe` (spec §4) — see registry.ts for the per-skin
  // translations and why several of these can never honestly return 'met' with what
  // `ArmAggregate` carries today (`../../eval/armAggregate` and `../../eval/types` only —
  // still no import from `src/shell/desk/`, keeping this file's one-way discipline intact).
  winsWhen?: (a: ArmAggregate, control: ArmAggregate) => ProbeVerdict;
  assumesRung: 'none' | 'R2' | 'R4';   // the prior learning-ladder rung this skin presumes
  slots: {
    background: 'wallpaper' | 'paper' | 'dark' | 'flat';
    topBar: 'menu' | 'desk' | 'session' | 'minimal';
    bottomBar: 'taskbar' | 'shelf' | 'timeline' | 'none';
    sideRail: 'icons' | 'sources' | 'none';
    windowChrome: 'full' | 'minimal' | 'provenance';
    surfaces: 'float' | 'material' | 'column';
    restoreVia: 'bottomBar' | 'column';   // where a minimized window is recovered from
  };
}
