import React from 'react';
import type { ShellSkin } from '../types';

type Variant = ShellSkin['slots']['background'];

// The ground the desk sits on. Pure CSS on the plane, BEHIND the windows — App ranks the visible
// ones from 10 upward, and today that tops out at 16, since the swap effect keeps at most one
// program window un-minimized and `MAX_ARTIFACTS` is 6 — and never a pointer target:
// `pointer-events-none` means the deixis painter on <main> still receives every event that lands
// here, exactly as it does over the bare plane today.
//
// No `data-shell` and no stopPropagation, deliberately — those mark chrome that must SWALLOW
// pointer events, and the background is the opposite: it is the plane, and pointing at empty
// desk must keep working.
const LAYERS: Record<Variant, { className: string; style?: React.CSSProperties }> = {
  // A · Familiar — a gradient wallpaper. Recognisably "someone's desktop", not a canvas.
  wallpaper: {
    className: 'bg-gradient-to-br from-indigo-200/70 via-sky-100/60 to-slate-200/70 dark:from-indigo-950 dark:via-slate-900 dark:to-slate-950',
  },
  // B · Material — paper ground, warm and matte, with a faint horizontal ruling so made things
  // read as sitting ON something rather than floating in space.
  paper: {
    className: 'bg-[#f4efe6] dark:bg-[#1b1814]',
    style: {
      backgroundImage:
        'repeating-linear-gradient(0deg, rgba(120,96,64,0.05) 0px, rgba(120,96,64,0.05) 1px, transparent 1px, transparent 28px)',
    },
  },
  // C · Provenance — near-black, session-oriented, with a centre vignette so the timeline at the
  // foot of the plane reads as the lit edge of the record.
  dark: {
    className: 'bg-[#0b0f14]',
    style: { backgroundImage: 'radial-gradient(120% 90% at 50% 0%, rgba(56,89,140,0.28) 0%, rgba(11,15,20,0) 60%)' },
  },
  // D · Conversation — flat, the theme's own ground. The centre column is the figure; the desk
  // must not compete with it.
  flat: { className: 'bg-[var(--bg-color)]' },
};

export function Background({ variant }: { variant: Variant }) {
  const layer = LAYERS[variant];
  return <div aria-hidden className={`absolute inset-0 z-0 pointer-events-none ${layer.className}`} style={layer.style} />;
}
