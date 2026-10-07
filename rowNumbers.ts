/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { panelWidthOf } from './panelTiers.js';
import { parksForRoom } from './panelWindow.js';

/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
  /** True when any drawn entry carries settings whose `overflow` is 'scroll': the row scrolls instead of parking for room. */
  rowScroll: boolean;
  /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
  windowWidth: number;
  /** The width of every drawn entry plus one gap between each two. */
  stripWidth: number;
  /** The row's left margin: centring for a strip that fits, 0 for one that does not. */
  rowMarginLeft: number;
  /** The ids of the drawn entries, in row order. */
  ids: readonly string[];
  /** The width of each drawn entry, in the order of `ids`. */
  widths: readonly number[];
  /** Each drawn entry's resting x: the widths before it plus one gap each. */
  leftOffsets: readonly number[];
  /** The widest one panel can be in this row; `Infinity` before the row is measured. */
  maxLiveWidth: number;
  /** The widths of the drawn entries the row never parks for room. */
  reservedWidths: readonly number[];
  /** The widths of the drawn entries the row may park for room. */
  parkLiveWidths: readonly number[];
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the 0.1.0 numbers
 * (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, prices a tablet at its own
 * width and a desktop panel at no more than the window, and centres only a strip that fits.
 * @public
 */
export function computeRowNumbers(i: {
  /** The row's whole list; the entries `isPresent` drops (parked ones, the marker) are not drawn and are ignored. */
  entries: readonly PanelRowEntry[];
  /** The phone frame's width in px: what a phone panel and a fixed column are drawn at. */
  phoneWidth: number;
  /** The row container's measured width; 0 before the first measurement. */
  containerWidth: number;
  /** The row's gap in px. */
  gap: number;
  /** How many fixed columns a hand-built row prices its capacity from. Default: the drawn entries that are not collapsible. */
  fixedItemCount?: number;
}): RowNumbers {
  const present = i.entries.filter(isPresent);
  // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
  // and would turn every hand-built row into a scrolling one.
  const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
  const measured = i.containerWidth !== 0;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
  const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
  const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount });
  const widths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth));
  const parks = present.map((p) => parksForRoom(p));
  const parkLiveWidths = widths.filter((_, k) => parks[k]);
  const reservedWidths = widths.filter((_, k) => !parks[k]);
  const stripWidth = widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * i.gap;
  const leftOffsets: number[] = [];
  let running = 0;
  for (const width of widths) {
    leftOffsets.push(running);
    running += width + i.gap;
  }
  let rowMarginLeft: number;
  if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths };
}

/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n: RowNumbers): number {
  return Number.isFinite(n.windowWidth) ? Math.max(0, n.rowMarginLeft + n.stripWidth - n.windowWidth) : 0;
}
