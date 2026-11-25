import type { WorkspaceHandle } from './workspaceCore.js';

/**
 * How the workspace the column moves to comes into view: from the side named, faded in where it stands (`fade`), or at once (`none`).
 * The workspace left goes out the opposite way, or fades out.
 * @public
 */
export type ColumnSlide = 'above' | 'below' | 'left' | 'right' | 'fade' | 'none';

/**
 * Picks the way each move of the column comes in, given the workspace left and the one arrived at. `from` may already have been
 * removed from the column, as when a delete moves on: it is still the handle that was current.
 * @public
 */
export type ColumnSlideFrom = (from: WorkspaceHandle, to: WorkspaceHandle) => ColumnSlide;

/** A side a cell rests on while out of view. @internal */
export type ParkSide = 'above' | 'below' | 'left' | 'right';

/** How a moving cell glides: its transform, or its opacity. @internal */
export type MoveKind = 'slide' | 'fade';

/** Where each cell stands and which are moving. Plain data, so a test reads it without drawing. @internal */
export interface ColumnMotion {
  /** The side each cell left by, kept until it comes back into view. A cell never moved rests above or below by its index. */
  readonly park: ReadonlyMap<string, ParkSide>;
  /** The cells gliding, and how, until their own transition ends. A cell that stopped gliding never jumps: it stays on its transition until then. */
  readonly moving: ReadonlyMap<string, MoveKind>;
  /** The cell arriving from a side it is not resting on, or by a fade: drawn once where it starts, with no transition, before it glides. */
  readonly pre: { readonly id: string; readonly slide: ColumnSlide } | null;
}

/** No cell moving. @internal */
export const STILL: ColumnMotion = { park: new Map(), moving: new Map(), pre: null };

const OPPOSITE: Record<ParkSide, ParkSide> = { above: 'below', below: 'above', left: 'right', right: 'left' };

/** The index-order side: what a column without `slideFrom` always did. @internal */
export const byIndex = (fromIndex: number, toIndex: number): ParkSide => (toIndex > fromIndex ? 'below' : 'above');

/**
 * The motion after the current workspace changes from `fromId` to `toId`, arriving by `slide`. A cell still sliding when it is
 * called back turns around from where it is; any other arriving cell is first put where it comes from.
 * @internal
 */
export function switchMotion(m: ColumnMotion, fromId: string, toId: string, slide: ColumnSlide, restOf: (id: string) => ParkSide): ColumnMotion {
  const park = new Map(m.park);
  const moving = new Map(m.moving);
  park.delete(toId);
  if (slide === 'none') {
    moving.delete(toId);
    moving.delete(fromId);
    return { park, moving, pre: null };
  }
  if (slide === 'fade') {
    moving.set(fromId, 'fade');
    moving.set(toId, 'fade');
    return { park, moving, pre: { id: toId, slide } };
  }
  park.set(fromId, OPPOSITE[slide]);
  const inFlight = m.moving.get(toId) === 'slide';
  const pre = inFlight || (m.park.get(toId) ?? restOf(toId)) === slide ? null : { id: toId, slide };
  moving.set(fromId, 'slide');
  moving.set(toId, 'slide');
  return { park, moving, pre };
}

/** The motion once `id`'s glide has ended. @internal */
export function settledMotion(m: ColumnMotion, id: string): ColumnMotion {
  if (!m.moving.has(id)) return m;
  const moving = new Map(m.moving);
  moving.delete(id);
  return { ...m, moving };
}

/** The motion with the cells no longer in the column forgotten. @internal */
export function prunedMotion(m: ColumnMotion, ids: ReadonlySet<string>): ColumnMotion {
  const stale = (id: string): boolean => !ids.has(id);
  if (![...m.park.keys(), ...m.moving.keys()].some(stale) && !(m.pre !== null && stale(m.pre.id))) return m;
  return {
    park: new Map([...m.park].filter(([id]) => !stale(id))),
    moving: new Map([...m.moving].filter(([id]) => !stale(id))),
    pre: m.pre !== null && stale(m.pre.id) ? null : m.pre,
  };
}

/** The transform of a cell off to `side`. @internal */
export const parkedTransform = (side: ParkSide, sideways: boolean): string => {
  if (!sideways) return `translateY(${side === 'above' ? -100 : 100}%)`;
  const x = side === 'left' ? -100 : side === 'right' ? 100 : 0;
  const y = side === 'above' ? -100 : side === 'below' ? 100 : 0;
  return `translate(${x}%, ${y}%)`;
};

/** The transform of a cell in view. @internal */
export const shownTransform = (sideways: boolean): string => (sideways ? 'translate(0%, 0%)' : 'translateY(0%)');
