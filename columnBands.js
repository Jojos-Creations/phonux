import { jsx as _jsx } from "react/jsx-runtime";
/**
 * The bands above and below a column cell's row: an ordered list of named slots in each, which an app replaces, hides or adds to
 * by id without touching the defaults. DESIGN.md, "Column bands and slots".
 */
import * as React from 'react';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import { MAX_WORKSPACE_NAME } from './workspaceName.js';
/** The height of a workspace name input and of the column's neighbour buttons, in px. @public */
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
const edgeOf = (side, band) => band.edge ?? (side === 'above' ? 0 : BELOW_BAND_EDGE);
const slotSum = (band) => band.slots.reduce((n, s) => n + s.height, 0);
/**
 * The least px the bands keep clear of the row: each band's edge and slot heights, plus 28 px between the band above and the row.
 * The band above's room is under the column's `topInset`.
 * @public
 */
export function columnBandRoom(bands) {
    return { above: edgeOf('above', bands.above) + slotSum(bands.above) + ABOVE_BAND_CLEARANCE, below: edgeOf('below', bands.below) + slotSum(bands.below) };
}
const warned = new Set();
const unknownSlot = (id, verb) => {
    if (warned.has(`${verb}:${id}`))
        return;
    warned.add(`${verb}:${id}`);
    console.warn(`phonux: withSlotChanges cannot ${verb} '${id}': no slot has that id; the change is skipped`);
};
/**
 * `bands` with `changes` applied: a new value, `bands` itself untouched. An id that names no slot is skipped with one console
 * warning per id, never thrown, so a default renamed upstream leaves the app's change undone rather than breaking the app.
 * Call it once, not on every render: each call makes new slot objects.
 * @example
 * ```ts
 * const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { replace: { 'neighbour-above': DiscoverLink }, hide: ['workspace-name'] });
 * ```
 * @public
 */
export function withSlotChanges(bands, changes) {
    const known = new Set([...bands.above.slots, ...bands.below.slots].map((s) => s.id));
    for (const id of Object.keys(changes.replace ?? {}))
        if (!known.has(id))
            unknownSlot(id, 'replace');
    for (const id of changes.hide ?? [])
        if (!known.has(id))
            unknownSlot(id, 'hide');
    const hidden = new Set(changes.hide ?? []);
    const change = (slot) => {
        const r = changes.replace?.[slot.id];
        if (r === undefined)
            return slot;
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
        if (anchor !== undefined && at < 0)
            unknownSlot(anchor, `place '${slot.id}' next to`);
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
};
function Neighbour({ side, column, index, above, below, labels }) {
    const target = side === 'above' ? above : below;
    const go = () => {
        column.scrollTo(target ?? column.addWorkspace({ index: side === 'above' ? index : index + 1 }));
    };
    return (_jsx(Button, { "data-workspace-neighbour": side, size: "small", onClick: go, "aria-label": target === undefined ? labels.newWorkspace : labels.goToWorkspace(target.name), sx: controlSx, children: target === undefined ? labels.newWorkspace : target.name }));
}
/** The default slot `neighbour-above`: names the workspace above and moves there, or creates one above when there is none. @public */
export function NeighbourAboveSlot(props) {
    return _jsx(Neighbour, { ...props, side: "above" });
}
/** The default slot `neighbour-below`: names the workspace below and moves there, or creates one below when there is none. @public */
export function NeighbourBelowSlot(props) {
    return _jsx(Neighbour, { ...props, side: "below" });
}
/** The default slot `workspace-name`: the workspace's name as an input that renames it on Enter or blur, and Escape undoes. @public */
export function WorkspaceNameSlot({ workspace, labels }) {
    const [draft, setDraft] = React.useState(null);
    const commit = () => {
        if (draft !== null)
            workspace.rename(draft);
        setDraft(null);
    };
    return (_jsx(InputBase, { value: draft ?? workspace.name, onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
            if (e.key === 'Enter')
                e.currentTarget.blur();
            if (e.key === 'Escape') {
                setDraft(null);
                e.currentTarget.blur();
            }
        }, inputProps: { 'aria-label': labels.workspaceName, maxLength: MAX_WORKSPACE_NAME, [WORKSPACE_NAME_INPUT_ATTRIBUTE]: '', style: { textAlign: 'center', padding: 0, height: WORKSPACE_NAME_CONTROL_HEIGHT } }, sx: { width: 280, maxWidth: 'calc(100% - 32px)', height: WORKSPACE_NAME_CONTROL_HEIGHT, fontSize: 14 } }));
}
/**
 * The bands a column draws when its options give none: the link to the workspace above and the name input above the row, the
 * link to the workspace below under it.
 * @public
 */
export const DEFAULT_COLUMN_BANDS = {
    above: {
        slots: [
            { id: 'neighbour-above', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: NeighbourAboveSlot },
            { id: 'workspace-name', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: WorkspaceNameSlot },
        ],
    },
    below: { slots: [{ id: 'neighbour-below', height: WORKSPACE_NAME_CONTROL_HEIGHT, component: NeighbourBelowSlot }] },
};
// The column's own controls sit inside the device's safe areas, as the row does; env() is 0 unless the page sets viewport-fit=cover.
const belowSafeTop = (px) => `calc(${px}px + env(safe-area-inset-top, 0px))`;
const aboveSafeBottom = (px) => `calc(${px}px + env(safe-area-inset-bottom, 0px))`;
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' };
/** One band of one cell. The band and each slot box let clicks through to the row under them; only a slot's own content takes them. @internal */
export function Band({ side, band, inset, props }) {
    const edge = edgeOf(side, band);
    const justify = band.justify ?? (side === 'above' ? 'start' : 'end');
    return (_jsx("div", { [COLUMN_BAND_ATTRIBUTE]: side, style: {
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
        }, children: band.slots.map(({ id, height, component: Slot, align, base }) => (_jsx("div", { [COLUMN_SLOT_ATTRIBUTE]: id, style: { flex: 'none', height, display: 'flex', alignItems: 'center', justifyContent: ALIGN[align ?? 'center'] }, children: _jsx("div", { style: { display: 'contents', pointerEvents: 'auto' }, children: _jsx(Slot, { ...props, Default: base }) }) }, id))) }));
}
