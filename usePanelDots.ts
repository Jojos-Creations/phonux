/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the Embla row (emblaDots.ts), so a drag or a click never fights a glide or a gesture
 * already holding the row.
 */
import * as React from 'react';
import type { WorkspaceRowEntry } from './workspaceRow.js';
import { useEmblaPanelDots } from './emblaDots.js';

/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
  /** Each panel's dot in track px, at its place on the row's ruler: the drawn panels and the parked ones a scroll can bring in. `hollow` is the panel setting `hollowDot`. `riding` marks the dot of a panel that stays on screen as the row moves: it keeps to the oval's end and lies over the dots beneath it, so draw it on top. */
  readonly dots: readonly { readonly id: string; readonly left: number; readonly width: number; readonly hollow: boolean; readonly riding: boolean }[];
  /** The window oval in track px, over the dots of the panels on screen. */
  readonly oval: { readonly left: number; readonly width: number };
  /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
  readonly width: number;
  /** The ids of the panels on screen now, in px of the row and not of the bar: those held at an edge, and those the strip's window shows. */
  readonly shown: readonly string[];
  /** Centers the panel `id` in the window. A row that parks steps until the panel is as near the center as the panels beside it allow, bringing a parked one in on the way. Does nothing while a drag holds the row. */
  selectDot(id: string): void;
  /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
  startOvalDrag(): { drag(dx: number): void; end(): void } | null;
  /** The cursor the bar shows where the pointer rests now: `grabbing` while the oval is dragged, `grab` over the oval, `pointer` over a dot, else `default`. */
  readonly cursor: string;
  /**
   * Spread on the element that holds the dots and the oval. A press that begins on the oval and moves past a few px drags it; any
   * other press selects the dot it began on. The pointer is captured, so the drag follows it off the bar. On a row that cannot scroll, the oval
   * moves with the pointer and the row steps each time the oval passes half a dot, bringing in hidden panels; on release the oval
   * settles over the panels on screen. A drag carried past a scrolling row's end steps it one stop per dot it travels. A wheel over
   * the bar, either axis, steps the row too, and the oval follows each step.
   */
  readonly barProps: {
    readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onPointerCancel: () => void;
    readonly onWheel: (e: React.WheelEvent<HTMLElement>) => void;
    readonly style: { readonly touchAction: 'none'; readonly cursor: string };
    readonly 'data-dot-bar': '';
  };
  /** Spread on the oval: a focusable slider whose value is how far along the row the window is, 0 to 100. Give it an `aria-label`. */
  readonly ovalProps: {
    readonly role: 'slider';
    readonly tabIndex: 0;
    readonly 'aria-valuemin': 0;
    readonly 'aria-valuemax': 100;
    readonly 'aria-valuenow': number;
  };
  /** Spread on the dot of panel `id` (a button): it marks the dot for the bar and selects it on a keyboard activation. */
  dotProps(id: string): { readonly 'data-dot': string; readonly onClick: (e: React.MouseEvent<HTMLElement>) => void };
}

/**
 * The bar for one row. `entries` is every panel in row order (the hollow dot is the panel setting `hollowDot`); `scroller` is the
 * row's scroll container (the element with `data-row-scroller`). The bar grows and shrinks with the panels; the app sets no width
 * for it. Reduce Motion snaps its glides, under either the OS query or `MotionConfig`.
 *
 * Every panel has a dot at its place on the row's one strip and the oval spans
 * the panels the window shows, both read from where the strip is drawn this frame. Dragging the oval moves the row with the pointer,
 * one dot of travel to one slot, and on release the row glides to the nearest rest; a pointer held at the bar's visible end (its box
 * cut by any ancestor that clips it) keeps the row moving, faster the further past the end it is. A dot press glides the row to show
 * that panel; a wheel over the bar steps one slot.
 * @public
 */
export function usePanelDots(i: {
  entries: readonly WorkspaceRowEntry[];
  scroller: React.RefObject<HTMLElement | null>;
  /** How far the drawn oval reaches past the dots it encloses on each side, in px, so the cursor reads the oval as drawn. Default 0. */
  ovalSide?: number;
}): PanelDots {
  return useEmblaPanelDots(i) ?? NO_DOTS;
}

const noop = (): void => undefined;
/** Before the Embla row is mounted and measured: no dots, and the handlers do nothing. */
const NO_DOTS: PanelDots = {
  dots: [],
  oval: { left: 0, width: 0 },
  width: 0,
  shown: [],
  selectDot: noop,
  startOvalDrag: () => null,
  cursor: 'default',
  barProps: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerLeave: noop, onPointerCancel: noop, onWheel: noop, style: { touchAction: 'none', cursor: 'default' }, 'data-dot-bar': '' },
  ovalProps: { role: 'slider', tabIndex: 0, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
  dotProps: (id) => ({ 'data-dot': id, onClick: noop }),
};
