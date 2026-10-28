import * as React from 'react';
import { createSvgIcon } from '@mui/material/utils';

/**
 * Every icon the library draws itself, so a host swaps in its own set instead of forking a component. Each is any React
 * node, drawn in the place of the default at the same spot; the defaults are small inline SVGs in `currentColor`.
 * @public
 */
export interface PhonuxIcons {
  /** The grip on a panel's grab strip. Default a six-dot drag indicator. */
  grab: React.ReactNode;
  /** The dimmed glyph a header with no actions shows at its right edge. Default three dots in a row. */
  noActions: React.ReactNode;
  /** The width that is `slots` phones wide, in the width control. Default a phone, fold, tablet, desktop and ultrawide monitor, then the desktop. */
  size: (slots: number) => React.ReactNode;
  /** The width control's entry that grows the panel to fill the window, and its button while the panel fills it. Default four corners. */
  fullscreen: React.ReactNode;
}

// Paths from Material Icons (Apache-2.0, see THIRD_PARTY_NOTICES.md), except Fold and Ultrawide, which Material lacks.
const DragIndicatorIcon = createSvgIcon(<path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2m-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2" />, 'DragIndicator');
const MoreHorizIcon = createSvgIcon(<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2" />, 'MoreHoriz');
const SmartphoneIcon = createSvgIcon(<path d="M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99M17 19H7V5h10z" />, 'SmartphoneOutlined');
/** Two outlined phones side by side, the fold drawn as the gap between them. */
const FoldIcon = createSvgIcon(<path d="M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v12h6V6h-6z" />, 'Fold');
const TabletIcon = createSvgIcon(<path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 1.99-.9 1.99-2L23 6c0-1.1-.9-2-2-2m-2 14H5V6h14z" />, 'TabletOutlined');
const DesktopIcon = createSvgIcon(<path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H3V4h18z" />, 'DesktopWindowsOutlined');
/** The outlined desktop monitor with the screen drawn wide and short. */
const UltrawideIcon = createSvgIcon(<path d="M21 5H3c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 9H3V7h18v7z" />, 'Ultrawide');
const FullscreenIcon = createSvgIcon(<path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" />, 'FullscreenOutlined');

/** One icon per width, by slots. The outlined set throughout: a filled monitor is solid beside the hollow phone and tablet. */
const SIZE_ICONS = [SmartphoneIcon, FoldIcon, TabletIcon, DesktopIcon, UltrawideIcon] as const;

/** The icons the library draws when a host overrides none. @internal */
export const DEFAULT_ICONS: Readonly<PhonuxIcons> = {
  grab: <DragIndicatorIcon aria-hidden="true" fontSize="small" />,
  noActions: <MoreHorizIcon fontSize="small" />,
  size: (slots) => {
    const Icon = SIZE_ICONS[slots - 1] ?? DesktopIcon;
    return <Icon fontSize="small" />;
  },
  fullscreen: <FullscreenIcon fontSize="small" />,
};

/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export function resolveIcons(given?: Partial<PhonuxIcons>): PhonuxIcons {
  if (given === undefined) return DEFAULT_ICONS;
  const out: PhonuxIcons = { ...DEFAULT_ICONS };
  for (const key of Object.keys(DEFAULT_ICONS) as (keyof PhonuxIcons)[]) {
    const value = given[key];
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}
