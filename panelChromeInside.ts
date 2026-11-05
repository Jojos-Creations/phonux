/**
 * The header and footer drawn inside the frame (`tuning.chrome.where` 'inside'): inset pills over the content, which a panel
 * that scrolls hides while it scrolls down and brings back as soon as it scrolls up. A panel that never scrolls keeps them.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { CHROME_ATTRIBUTE, CHROME_PARTS } from './panelChrome.js';
import { BAR_HEIGHT_PX } from './panelChromeSize.js';

/** The attribute on a panel's root while its header and footer are inside its frame. @public */
export const CHROME_INSIDE_ATTRIBUTE = 'data-panel-chrome-inside';

/** Px from the frame's edge to a pill inside it. */
const INSET_PX = 6;
/** Px a scroll must move before it counts, so a trackpad's tremble does not flicker the pills. */
const SCROLL_NOISE_PX = 4;
const SLIDE_MS = 180;

/**
 * The room a pill takes from the frame's top or bottom, in px: what a scrolling view pads its content by, through the
 * `--panel-chrome-inset` variable the panel's root carries, so its first rows start clear of the pill.
 * @public
 */
export const PANEL_CHROME_INSET_PX = BAR_HEIGHT_PX + 2 * INSET_PX;

const header = `[${CHROME_ATTRIBUTE}="${CHROME_PARTS.header}"]`;
const footer = `[${CHROME_ATTRIBUTE}="${CHROME_PARTS.footer}"]`;

/** The root's rules; set on the root, so they outrank the parts' own offsets without touching them. */
export const chromeInsideSx = {
  '--panel-chrome-inset': `${PANEL_CHROME_INSET_PX}px`,
  [`& ${header}`]: {
    top: INSET_PX,
    bottom: 'auto',
    left: INSET_PX,
    right: INSET_PX,
    zIndex: 2,
    borderRadius: 999,
    bgcolor: 'color-mix(in srgb, var(--mui-palette-background-paper, Canvas) 72%, transparent)',
    backdropFilter: 'blur(12px)',
    boxShadow: 1,
  },
  [`& ${footer}`]: { top: 'auto', bottom: INSET_PX, left: INSET_PX, right: INSET_PX, zIndex: 2 },
} as const;

/** Slides `el` off toward `edge` or back, from wherever it is. The default theme turns CSS motion off, so this goes through the animation API. */
function slide(el: HTMLElement, edge: -1 | 1, away: boolean, reduced: boolean): void {
  const gone = { transform: `translateY(${edge * 100}%)`, opacity: 0 };
  const here = { transform: 'none', opacity: 1 };
  el.style.pointerEvents = away ? 'none' : '';
  el.animate?.(away ? [here, gone] : [gone, here], { duration: reduced ? 0 : SLIDE_MS, easing: 'ease-out', fill: 'forwards' });
}

/** Tracks scrolling under `root` while `inside`, and slides its header and footer. Returns the root's capture-phase scroll handler. */
export function useChromeScrollAway(root: React.RefObject<HTMLElement | null>, inside: boolean): (event: React.UIEvent<HTMLElement>) => void {
  const reduced = useReducedMotionConfig() === true || useReducedMotion() === true;
  const [away, setAway] = React.useState(false);
  const last = React.useRef(new WeakMap<EventTarget, number>());
  const shown = React.useRef(false);
  React.useEffect(() => {
    if (!inside) setAway(false);
  }, [inside]);
  React.useEffect(() => {
    if (shown.current === away) return;
    shown.current = away;
    const box = root.current;
    const top = box?.querySelector<HTMLElement>(header);
    const bottom = box?.querySelector<HTMLElement>(footer);
    if (top) slide(top, -1, away, reduced);
    if (bottom) slide(bottom, 1, away, reduced);
  }, [away, reduced, root]);
  return React.useCallback((event) => {
    if (!inside) return;
    const target = event.target as HTMLElement;
    // React carries a scroll out of a portal, so a dialog the panel opened reports here without being under it.
    if (!event.currentTarget.contains(target)) return;
    const now = target.scrollTop;
    const before = last.current.get(target) ?? 0;
    if (now <= 0) {
      last.current.set(target, 0);
      setAway(false);
      return;
    }
    if (Math.abs(now - before) < SCROLL_NOISE_PX) return;
    last.current.set(target, now);
    setAway(now > before);
  }, [inside]);
}
