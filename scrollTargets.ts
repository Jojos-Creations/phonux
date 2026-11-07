/**
 * Where the row scrolls to: pure functions of the row's numbers and the container's measured width, so the same
 * target comes out of the executor, the gesture and the tests. Nothing here reads the DOM.
 */
import type { ScrollAlign } from './panelSettings.js';

// A start within this of the base is the base itself: a glide ends on a fractional value.
const SAME_STOP_PX = 0.5;

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * The `scrollLeft` that shows a panel. `left` is the panel's left edge in scroll coordinates (gap + the row's left
 * margin of the same commit + its offset). The window is `scrollLeft + gap` to `scrollLeft + clientWidth - gap`;
 * 'into-view' moves the least distance that puts the whole panel inside it (the left edge wins for a panel wider than
 * the window). The result is clamped to `[0, maxScroll]`, the strip's bound from the row numbers.
 */
export function scrollTargetFor(i: { left: number; width: number; scrollLeft: number; clientWidth: number; maxScroll: number; gap: number; align: ScrollAlign }): number {
  let target: number;
  if (i.align === 'start') target = i.left - i.gap;
  else if (i.align === 'center') target = i.left + i.width / 2 - i.clientWidth / 2;
  else if (i.left < i.scrollLeft + i.gap) target = i.left - i.gap;
  else if (i.left + i.width > i.scrollLeft + i.clientWidth - i.gap) target = Math.min(i.left + i.width - i.clientWidth + i.gap, i.left - i.gap);
  else target = i.scrollLeft;
  return clamp(target, i.maxScroll);
}

/**
 * The stop one step from `base` toward `direction`: the next panel start past it, held to `[0, maxScroll]`. Null at the
 * strip's end. `panelStarts` are the panels' left edges less the gap, ascending.
 */
export function stepTarget(direction: 'left' | 'right', base: number, panelStarts: readonly number[], maxScroll: number): number | null {
  if (direction === 'right') {
    const next = panelStarts.find((start) => start > base + SAME_STOP_PX);
    const target = clamp(next ?? maxScroll, maxScroll);
    return target > base + SAME_STOP_PX ? target : null;
  }
  const before = panelStarts.filter((start) => start < base - SAME_STOP_PX);
  const target = clamp(before.length === 0 ? 0 : before[before.length - 1]!, maxScroll);
  return target < base - SAME_STOP_PX ? target : null;
}

/** A hidden panel the gesture may bring back. */
interface HiddenCandidate {
  id: string;
  /** How many live panels precede it in the row. */
  liveBefore: number;
  /** True when a person hid it and it stays hidden until shown. */
  held: boolean;
  /** Its `revealOnScroll`. */
  policy: 'edges' | 'any' | 'never';
}

/**
 * What one step does. The nearest hidden panel in the direction (past the window's edge) is shown when its policy
 * allows and no live panel lies between the window's edge and its slot, so a held panel is never reached by skipping
 * live ones; an engine-parked one under 'edges' also needs no live panel beyond the window on that side. Otherwise
 * the row scrolls one panel start, and with neither there is nothing to do.
 */
export function gestureTarget(i: {
  direction: 'left' | 'right';
  base: number;
  clientWidth: number;
  maxScroll: number;
  liveStarts: readonly number[];
  liveWidths: readonly number[];
  /** Where whole panels are shown, ascending; the step lands on these. Absent or empty: the panel starts. */
  stops?: readonly number[];
  gap: number;
  hidden: readonly HiddenCandidate[];
  /** The root's place among the live panels. It never leaves the row for a parked panel, so a parked one does not wait behind it; any other live panel beyond the window still counts. Absent or -1: no root in the list. */
  rootAt?: number;
  /** One phone's width: a panel wider than this that the window's edge cuts comes in before any parked panel. Absent: no panel does. */
  phoneWidth?: number;
  /** The row's slot grid, as `gridEdgesOf` gives it: nothing draws past it, so a panel in the margin beside it is out of the view. Absent: the view is the window less a gap each side. */
  grid?: { lo: number; hi: number };
}): { kind: 'show'; id: string } | { kind: 'scroll'; to: number } | { kind: 'none' } {
  const windowLeft = i.base + i.gap + (i.grid?.lo ?? 0);
  const windowRight = i.grid === undefined ? i.base + i.clientWidth - i.gap : i.base + i.gap + i.grid.hi;
  const lefts = i.liveStarts.map((start) => start + i.gap);
  const overlaps = lefts.map((left, k) => left < windowRight && left + i.liveWidths[k]! > windowLeft);
  const firstInView = overlaps.indexOf(true);
  const lastInView = overlaps.lastIndexOf(true);
  const count = i.liveStarts.length;
  // With nothing in view every hidden panel is on both sides; the nearest one wins.
  const sideRight = (h: HiddenCandidate): boolean => h.liveBefore > lastInView;
  const sideLeft = (h: HiddenCandidate): boolean => h.liveBefore <= (firstInView < 0 ? count : firstInView);
  const candidates = i.hidden.filter((h) => h.policy !== 'never' && (i.direction === 'right' ? sideRight(h) : sideLeft(h)));
  // A wide panel the window's edge still cuts comes in first: a parked panel swapped in now would leave it unseen, and it may be the one that parks.
  const edgePanel = i.direction === 'right' ? lastInView : firstInView;
  const edgeCut = i.phoneWidth !== undefined && edgePanel >= 0 && i.liveWidths[edgePanel]! > i.phoneWidth + 1 && (i.direction === 'right' ? lefts[edgePanel]! + i.liveWidths[edgePanel]! > windowRight + 1 : lefts[edgePanel]! < windowLeft - 1);
  const canScroll = stepTarget(i.direction, i.base, i.stops !== undefined && i.stops.length > 0 ? i.stops : i.liveStarts, i.maxScroll) !== null;
  if (candidates.length > 0 && !(edgeCut && canScroll)) {
    const nearest = candidates.reduce((best, h) => (i.direction === 'right' ? (h.liveBefore < best.liveBefore ? h : best) : h.liveBefore >= best.liveBefore ? h : best));
    const between = i.direction === 'right' ? nearest.liveBefore - 1 - lastInView : (firstInView < 0 ? count : firstInView) - nearest.liveBefore;
    const beyondWindow = i.liveStarts.filter((_, k) => k !== i.rootAt && (i.direction === 'right' ? k > lastInView : k < firstInView)).length;
    const reachable = nearest.held || nearest.policy === 'any' ? between <= 0 : between <= 0 && beyondWindow <= 0;
    if (reachable) return { kind: 'show', id: nearest.id };
  }
  const to = stepTarget(i.direction, i.base, i.stops !== undefined && i.stops.length > 0 ? i.stops : i.liveStarts, i.maxScroll);
  return to === null ? { kind: 'none' } : { kind: 'scroll', to };
}
