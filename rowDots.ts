/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centring scroll sit. Internal; `usePanelDots` is the one public door.
 */

/** A dot's place in the bar's track, in px, and whether it is the hollow one. */
export interface DotPlace {
  readonly id: string;
  readonly left: number;
  readonly width: number;
  readonly hollow: boolean;
}

/** Every dot plus the oval for the visible window, all in track px. */
export interface DotLayout {
  readonly dots: readonly DotPlace[];
  readonly oval: { readonly left: number; readonly width: number };
}

/** The track px per strip px; 0 before the row has a strip to scale. */
export function trackScale(trackWidth: number, stripWidth: number): number {
  return stripWidth > 0 && Number.isFinite(stripWidth) ? trackWidth / stripWidth : 0;
}

/**
 * Dots at the panels' strip positions scaled to the track, so a wide panel is a wide dot. A dot never narrows below
 * `minDotPx`. The oval is the window in track px: the whole track while the window is not measured or the row fits.
 */
export function dotLayout(i: {
  ids: readonly string[];
  widths: readonly number[];
  leftOffsets: readonly number[];
  hollow: readonly boolean[];
  stripWidth: number;
  windowWidth: number;
  scrollLeft: number;
  trackWidth: number;
  minDotPx: number;
}): DotLayout {
  const f = trackScale(i.trackWidth, i.stripWidth);
  const dots = i.ids.map((id, k) => ({
    id,
    left: (i.leftOffsets[k] ?? 0) * f,
    width: Math.max(i.minDotPx, (i.widths[k] ?? 0) * f),
    hollow: i.hollow[k] === true,
  }));
  const width = Number.isFinite(i.windowWidth) ? Math.min(i.trackWidth, i.windowWidth * f) : i.trackWidth;
  const left = Math.min(Math.max(0, i.scrollLeft * f), Math.max(0, i.trackWidth - width));
  return { dots, oval: { left, width } };
}

/**
 * The scroll that centres panel `index` in the window, clamped to the row's legal range. Null when the row cannot
 * scroll or the window is not measured: a click on a dot then does nothing.
 */
export function centreScroll(i: { index: number; leftOffsets: readonly number[]; widths: readonly number[]; windowWidth: number; maxScroll: number }): number | null {
  if (!(i.maxScroll > 0) || !Number.isFinite(i.windowWidth)) return null;
  const centre = (i.leftOffsets[i.index] ?? 0) + (i.widths[i.index] ?? 0) / 2;
  return Math.min(Math.max(centre - i.windowWidth / 2, 0), i.maxScroll);
}

/** The scroll after the oval has been dragged `dx` track px from where the drag began, clamped to the row's range. */
export function dragScroll(i: { startScroll: number; dx: number; trackWidth: number; stripWidth: number; maxScroll: number }): number {
  const f = trackScale(i.trackWidth, i.stripWidth);
  if (!(f > 0)) return i.startScroll;
  return Math.min(Math.max(i.startScroll + i.dx / f, 0), i.maxScroll);
}
