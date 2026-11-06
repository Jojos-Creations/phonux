/**
 * The bands above and below a column cell's row: an ordered list of named slots in each, which an app replaces, hides or adds to
 * by id without touching the defaults. DESIGN.md, "Column bands and slots".
 */
import * as React from 'react';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import type { PhonuxLabels } from './labels.js';
import type { WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspaceHandle } from './workspaceCore.js';
import { MAX_WORKSPACE_NAME } from './workspaceName.js';

/** The height of a workspace name input and of the column's neighbor buttons, in px. @public */
export const WORKSPACE_NAME_CONTROL_HEIGHT = 24;
/** The attribute the workspace name input carries, so a stylesheet can select it without a class name. @public */
export const WORKSPACE_NAME_INPUT_ATTRIBUTE = 'data-workspace-name-input';
/** The attribute every slot's box carries, set to the slot's id. @public */
export const COLUMN_SLOT_ATTRIBUTE = 'data-column-slot';
/** The attribute each band's box carries, set to `above` or `below`. @public */
export const COLUMN_BAND_ATTRIBUTE = 'data-column-band';

// The room between the above band's last slot and the row's padding, and between the below band's last slot and the window's foot.
const ABOVE_BAND_CLEARANCE = 28;
const BELOW_BAND_EDGE = 2;

/** What every slot component is given. @public */
export interface ColumnSlotProps {
  /** The workspace whose cell this slot is drawn in. */
  workspace: WorkspaceHandle;
  /** The column the workspace is in. */
  column: WorkspaceColumnHandle;
  /** The workspace's index in the column, top first. */
  index: number;
  /** The workspace above, or undefined for the first. */
  above: WorkspaceHandle | undefined;
  /** The workspace below, or undefined for the last. */
  below: WorkspaceHandle | undefined;
  /** Whether this workspace is the one in view. */
  active: boolean;
  /** The column's labels, every one resolved. */
  labels: PhonuxLabels;
  /** The slot this one replaced through `withSlotChanges`, to wrap or fall back to; undefined for a slot that replaced nothing. */
  Default: React.ComponentType<ColumnSlotProps> | undefined;
}

/** One named slot in a band. @public */
export interface ColumnSlot {
  /** The slot's name, unique across both bands. `withSlotChanges` finds a slot by it. */
  id: string;
  /** Px the slot takes in its band. The slot's box is exactly this tall. */
  height: number;
  /** What the slot draws. It returns null to draw nothing in a given workspace and keeps its height. */
  component: React.ComponentType<ColumnSlotProps>;
  /**
   * Where the slot's content sits across the cell's width.
   * @defaultValue 'center'
   */
  align?: 'start' | 'center' | 'end';
  /** The component this slot replaced; given to `component` as `Default`. Set by `withSlotChanges`. */
  base?: React.ComponentType<ColumnSlotProps>;
}

/** One band: its slots from top to bottom, and how they share the band's height. @public */
export interface ColumnBand {
  /** The slots, top first. */
  slots: readonly ColumnSlot[];
  /**
   * The band's height as a CSS length, for a band whose slots spread through more room than they need, such as
   * `'var(--row-above)'`. Unset: the sum of its slots' heights.
   */
  size?: string;
  /**
   * How the slots share the band's height when `size` gives it more than they need.
   * @defaultValue 'start' above the row, 'end' below it
   */
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-evenly';
  /**
   * Px between the band and its window edge: under the column's `topInset` for the band above, over the window's foot for the band below.
   * @defaultValue 0 above the row, 2 below it
   */
  edge?: number;
}

/** The two bands of every cell of a column. @public */
export interface ColumnBands {
  /** Between the column's `topInset` and the row. */
  above: ColumnBand;
  /** Between the row and the window's foot. */
  below: ColumnBand;
}

/** A slot `withSlotChanges` adds, and where. @public */
export interface AddedColumnSlot extends ColumnSlot {
  /** The band it goes in. */
  band: 'above' | 'below';
  /** The id of the slot it goes before; ahead of `after`. */
  before?: string;
  /** The id of the slot it goes after. With neither, it goes last in its band. */
  after?: string;
}

/** What an app changes about a set of bands. Every member is optional. @public */
export interface ColumnSlotChanges {
  /** By id: the component that draws the slot instead, or that component with a new height. The replaced component is its `Default`. */
  replace?: Readonly<Record<string, React.ComponentType<ColumnSlotProps> | { component: React.ComponentType<ColumnSlotProps>; height?: number }>>;
  /** The ids of slots to take out. */
  hide?: readonly string[];
  /** Slots to add, applied after `replace` and `hide`, in order, so one may sit next to another added before it. */
  add?: readonly AddedColumnSlot[];
  /** A new `size`, `justify` or `edge` for the band above. */
  above?: Omit<ColumnBand, 'slots'>;
  /** A new `size`, `justify` or `edge` for the band below. */
  below?: Omit<ColumnBand, 'slots'>;
}

const edgeOf = (side: 'above' | 'below', band: ColumnBand): number => band.edge ?? (side === 'above' ? 0 : BELOW_BAND_EDGE);
const slotSum = (band: ColumnBand): number => band.slots.reduce((n, s) => n + s.height, 0);

/**
 * The least px the bands keep clear of the row: each band's edge and slot heights, plus 28 px between the band above and the row.
 * The band above's room is under the column's `topInset`.
 * @public
 */
export function columnBandRoom(bands: ColumnBands): { above: number; below: number } {
  return { above: edgeOf('above', bands.above) + slotSum(bands.above) + ABOVE_BAND_CLEARANCE, below: edgeOf('below', bands.below) + slotSum(bands.below) };
}

const warned = new Set<string>();
const unknownSlot = (id: string, verb: string): void => {
  if (warned.has(`${verb}:${id}`)) return;
  warned.add(`${verb}:${id}`);
  console.warn(`phonux: withSlotChanges cannot ${verb} '${id}': no slot has that id; the change is skipped`);
};

/**
 * `bands` with `changes` applied: a new value, `bands` itself untouched. An id that names no slot is skipped with one console
 * warning per id, never thrown, so a default renamed upstream leaves the app's change undone rather than breaking the app.
 * Call it once, not on every render: each call makes new slot objects.
 * @example
 * ```ts
 * const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { replace: { 'neighbor-above': DiscoverLink }, hide: ['workspace-name'] });
 * ```
 * @public
 */
export function withSlotChanges(bands: ColumnBands, changes: ColumnSlotChanges): ColumnBands {
  const known = new Set([...bands.above.slots, ...bands.below.slots].map((s) => s.id));
  for (const id of Object.keys(changes.replace ?? {})) if (!known.has(id)) unknownSlot(id, 'replace');
  for (const id of changes.hide ?? []) if (!known.has(id)) unknownSlot(id, 'hide');
  const hidden = new Set(changes.hide ?? []);
  const change = (slot: ColumnSlot): ColumnSlot => {
    const r = changes.replace?.[slot.id];
    if (r === undefined) return slot;
    const { component, height } = typeof r === 'function' ? { component: r, height: undefined } : r;
    return { ...slot, component, base: slot.component, ...(height !== undefined ? { height } : {}) };
  };
  const lists = {
    above: bands.above.slots.filter((s) => !hidden.has(s.id)).map(change),
    below: bands.below.slots.filter((s) => !hidden.has(s.id)).map(change),
  };
  for (const { band, before, after, ...slot } of changes.add ?? []) {
    const list = lists[band];
    const anchor = before ?? after;
    const at = anchor === undefined ? -1 : list.findIndex((s) => s.id === anchor);
    if (anchor !== undefined && at < 0) unknownSlot(anchor, `place '${slot.id}' next to`);
    list.splice(at < 0 ? list.length : before !== undefined ? at : at + 1, 0, slot);
  }
  return {
    above: { ...bands.above, ...changes.above, slots: lists.above },
    below: { ...bands.below, ...changes.below, slots: lists.below },
  };
}

const controlSx = {
  maxWidth: 'calc(100% - 32px)',
  height: WORKSPACE_NAME_CONTROL_HEIGHT,
  minHeight: 0,
  py: 0,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: 'block',
} as const;

function Neighbour({ side, column, index, above, below, labels }: ColumnSlotProps & { side: 'above' | 'below' }): React.ReactElement {
  const target = side === 'above' ? above : below;
  const go = (): void => {
    column.scrollTo(target ?? column.addWorkspace({ index: side === 'above' ? index : index + 1 }));
  };
  return (
    <Button data-workspace-neighbour={side} size="small" onClick={go} aria-label={target === undefined ? labels.newWorkspace : labels.goToWorkspace(target.name)} sx={controlSx}>
      {target === undefined ? labels.newWorkspace : target.name}
    </Button>
  );
}

/** The default slot `neighbour-above`: names the workspace above and moves there, or creates one above when there is none. @public */
export function NeighbourAboveSlot(props: ColumnSlotProps): React.ReactElement {
  return <Neighbour {...props} side="above" />;
}

/** The default slot `neighbour-below`: names the workspace below and moves there, or creates one below when there is none. @public */
export function NeighbourBelowSlot(props: ColumnSlotProps): React.ReactElement {
  return <Neighbour {...props} side="below" />;
}

/** The default slot `workspace-name`: the workspace's name as an input that renames it on Enter or blur, and Escape undoes. @public */
export function WorkspaceNameSlot({ workspace, labels }: ColumnSlotProps): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = (): void => {
    if (draft !== null) workspace.rename(draft);
    setDraft(null);
  };
  return (
    <InputBase
      value={draft ?? workspace.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      inputProps={{ 'aria-label': labels.workspaceName, maxLength: MAX_WORKSPACE_NAME, [WORKSPACE_NAME_INPUT_ATTRIBUTE]: '', style: { textAlign: 'center', padding: 0, height: WORKSPACE_NAME_CONTROL_HEIGHT } }}
      sx={{ width: 280, maxWidth: 'calc(100% - 32px)', height: WORKSPACE_NAME_CONTROL_HEIGHT, fontSize: 14 }}
    />
  );
}

/**
 * The bands a column draws when its options give none: the link to the workspace above and the name input above the row, the
 * link to the workspace below under it.
 * @public
 */
export const DEFAULT_COLUMN_BANDS: ColumnBands = {
  above: {
    slots: [
      { id: 'neighbour-above', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: NeighbourAboveSlot },
      { id: 'workspace-name', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: WorkspaceNameSlot },
    ],
  },
  below: { slots: [{ id: 'neighbour-below', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: NeighbourBelowSlot }] },
};

// The column's own controls sit inside the device's safe areas, as the row does; env() is 0 unless the page sets viewport-fit=cover.
const belowSafeTop = (px: number): string => `calc(${px}px + env(safe-area-inset-top, 0px))`;
const aboveSafeBottom = (px: number): string => `calc(${px}px + env(safe-area-inset-bottom, 0px))`;

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

/** One band of one cell. The band and each slot box let clicks through to the row under them; only a slot's own content takes them. @internal */
export function Band({ side, band, inset, props }: { side: 'above' | 'below'; band: ColumnBand; inset: number; props: Omit<ColumnSlotProps, 'Default'> }): React.ReactElement {
  const edge = edgeOf(side, band);
  const justify = band.justify ?? (side === 'above' ? 'start' : 'end');
  return (
    <div
      {...{ [COLUMN_BAND_ATTRIBUTE]: side }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(side === 'above' ? { top: belowSafeTop(inset + edge) } : { bottom: aboveSafeBottom(edge) }),
        height: band.size ?? `${slotSum(band)}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify === 'start' || justify === 'end' ? `flex-${justify}` : justify,
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      {band.slots.map(({ id, height, component: Slot, align, base }) => (
        <div key={id} {...{ [COLUMN_SLOT_ATTRIBUTE]: id }} style={{ flex: 'none', height, display: 'flex', alignItems: 'center', justifyContent: ALIGN[align ?? 'center'] }}>
          {/* No box of its own, so the slot box's empty width stays click-through; the slot's own content inherits `auto`. */}
          <div style={{ display: 'contents', pointerEvents: 'auto' }}>
            <Slot {...props} Default={base} />
          </div>
        </div>
      ))}
    </div>
  );
}
