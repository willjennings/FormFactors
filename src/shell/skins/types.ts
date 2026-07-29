// A ShellSkin is a named point in slot-space + an ethos sentence and a pre-registered
// probe hypothesis — the same idea as register/registry.ts's RegisterDef, applied to the
// desktop's furniture instead of its dials, so metaphor and interaction style can be varied
// independently (spec §2, §0b). Nothing under src/shell/skins/ may import from src/shell/desk/.
export type SkinKey = 'familiar' | 'material' | 'provenance' | 'conversation';

export interface ShellSkin {
  key: SkinKey; label: string; glyph: string;
  ethos: string;   // one sentence: what this skin believes
  probe: string;   // the pre-registered hypothesis (rendered in the UI — honest experiment framing)
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
