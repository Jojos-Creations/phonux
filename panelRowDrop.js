/**
 * The row side of a drag that starts outside the row: the geometry that parts the row for it (shared with the header
 * drag), the controller PanelRow provides, and the state it drives. The hook a view calls is in usePanelRowDrop.ts.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { accepted, refused } from './panelManager.js';
import { isPresent } from './panelRowEntry.js';
import { panelKey } from './panelSettings.js';
import { openEdgeHold, endEdgeHold, stepEdgeHold } from './panelRowDropScroll.js';
import { closestRowScroller, rowScrollerFor } from './rowScroller.js';
import { landPanelIn } from './workspaceCore.js';
/** The neighbors `steps` hops would cross. */
export const crossedBy = (walk, steps) => (steps > 0 ? walk.right : walk.left).slice(0, Math.abs(steps));
/** How far a panel moves when it hops over `crossed`: each neighbor's width plus the gap. */
export const travelOver = (crossed, gap) => crossed.reduce((sum, n) => sum + n.width + gap, 0);
/** Every panel the drag would cross moves by the dragged panel's own `span`, away from the side it is dragged toward. */
export function partShifts(walk, steps, span) {
    const shifts = new Map();
    if (steps === 0)
        return shifts;
    for (const crossed of crossedBy(walk, steps))
        shifts.set(crossed.id, steps > 0 ? -span : span);
    return shifts;
}
/**
 * How the row parts for `preview`. A panel in view moves to the slot its hops end in while the neighbors it crossed
 * slide aside by its span. A hidden one leaves a gap its own width at the slot its hops end in: every present panel
 * after its place in the array moves right by the span, and the ones it crossed take that back.
 */
export function dropParts(preview, row) {
    const span = row.width + row.rowGap;
    const shifts = partShifts(row.walk, preview.steps, span);
    const crossed = crossedBy(row.walk, preview.steps);
    const travel = travelOver(crossed, row.rowGap) * Math.sign(preview.steps);
    if (!preview.hidden) {
        if (preview.steps !== 0)
            shifts.set(preview.id, travel);
        return { shifts, gap: null };
    }
    const at = row.entries.findIndex((p) => p.id === preview.id);
    const after = row.entries.slice(at + 1).filter(isPresent);
    const before = row.entries.slice(0, at).filter(isPresent);
    for (const p of after)
        shifts.set(p.id, (shifts.get(p.id) ?? 0) + span);
    const next = after[0];
    const last = before[before.length - 1];
    const rest = next !== undefined ? (row.leftById.get(next.id) ?? 0) : last !== undefined ? (row.leftById.get(last.id) ?? 0) + (row.widthById.get(last.id) ?? 0) + row.rowGap : 0;
    return { shifts, gap: { left: rest + travel, width: row.width } };
}
/** Where a hidden panel lands after `steps` hops, as the placement the engine takes; 'in-place' for none. */
export function dropPlacement(walk, steps, keyOf) {
    const crossed = crossedBy(walk, steps);
    const last = crossed[crossed.length - 1];
    if (last === undefined)
        return 'in-place';
    return steps > 0 ? { after: keyOf(last.id) } : { before: keyOf(last.id) };
}
/** Provided by PanelRow to the views it renders; absent outside a row. */
export const RowDropContext = React.createContext(undefined);
/**
 * The state and controller behind a row drop: the preview PanelRow draws, and the begin/update/end/cancel the hook
 * calls. The controller keeps one identity; it reads the row through a ref, so a call always sees the latest render.
 */
export function useRowDrop(input) {
    const [preview, setPreview] = React.useState(null);
    const latest = React.useRef(input);
    latest.current = input;
    const configReduced = useReducedMotionConfig() === true;
    const systemReduced = useReducedMotion() === true;
    const reduced = configReduced || systemReduced;
    const reducedRef = React.useRef(reduced);
    reducedRef.current = reduced;
    const active = React.useRef(null);
    const controller = React.useMemo(() => {
        const entryOf = (a) => latest.current.entries.find((p) => p.id === a.engineId);
        const releaseHold = (a) => {
            if (a.hold !== null)
                endEdgeHold(a.hold, latest.current.dragScroll, reducedRef.current);
            a.hold = null;
        };
        const finish = (a) => {
            releaseHold(a);
            if (a.live)
                latest.current.chrome.setDragging(a.engineId, false);
            active.current = null;
            setPreview(null);
        };
        /** The hops the pointer asks for now. */
        const recompute = (a) => {
            const row = latest.current;
            const entry = entryOf(a);
            if (entry === undefined || a.x === null)
                return;
            const rect = row.boxRef.current?.getBoundingClientRect();
            const centre = (rect?.left ?? 0) + row.centreOf(entry, !a.live);
            a.steps = row.stepsFor(entry, a.x - centre);
            setPreview((now) => (now?.id === a.engineId && now.steps === a.steps ? now : { id: a.engineId, steps: a.steps, hidden: !a.live }));
        };
        const tick = (a) => (nowMs) => {
            const h = a.hold;
            const slot = latest.current.dragScroll;
            if (h === null || active.current !== a)
                return;
            h.frame = null;
            if (slot === undefined)
                return;
            stepEdgeHold(h, nowMs, a.x ?? Number.NaN, slot, reducedRef.current);
            recompute(a);
            h.frame = requestAnimationFrame(tick(a));
        };
        return {
            begin(key, source) {
                if (active.current !== null)
                    return false;
                const row = latest.current;
                const state = row.workspace.panels.getSnapshot().panels.find((p) => p.id === key);
                if (state === undefined)
                    return false;
                if (state.status !== 'live' && state.status !== 'parked')
                    return false;
                if (state.engineId === row.rootId)
                    return false;
                if (source === 'person' && !state.settings.movable)
                    return false;
                const entry = row.entries.find((p) => p.id === state.engineId);
                if (entry === undefined || entry.marker === true)
                    return false;
                const a = { engineId: entry.id, key, source, live: state.status === 'live', hold: null, x: null, steps: 0 };
                active.current = a;
                if (a.live)
                    row.chrome.setDragging(a.engineId, true);
                const scrollerEl = row.boxRef.current === null ? null : closestRowScroller(row.boxRef.current);
                const slot = row.dragScroll;
                if (scrollerEl !== null && slot !== undefined && slot.mode === 'edge') {
                    a.hold = openEdgeHold(scrollerEl, rowScrollerFor(scrollerEl).scrollLeft(), slot, a.engineId);
                    if (a.hold !== null)
                        a.hold.frame = requestAnimationFrame(tick(a));
                }
                setPreview({ id: a.engineId, steps: 0, hidden: !a.live });
                return true;
            },
            update(clientX) {
                const a = active.current;
                if (a === null)
                    return;
                a.x = clientX;
                recompute(a);
            },
            end() {
                const a = active.current;
                if (a === null)
                    return refused('unknown-panel', 'no row drop is in progress');
                const row = latest.current;
                const entry = entryOf(a);
                const steps = a.steps;
                const walk = entry === undefined ? undefined : row.walkOf(entry);
                const nowLive = entry !== undefined && isPresent(entry);
                finish(a);
                if (entry === undefined || walk === undefined)
                    return refused('is-closed', `panel '${a.key}' left the row during the drag`);
                if (nowLive !== a.live)
                    return refused('busy', `panel '${a.key}' changed under the drag`);
                if (a.live) {
                    if (steps === 0)
                        return accepted(false);
                    const handle = row.workspace.panels.get(a.key);
                    return handle === undefined ? refused('unknown-panel', `no panel '${a.key}' in this workspace`) : handle.move(steps, a.source);
                }
                const keyOf = (id) => {
                    const found = row.entries.find((p) => p.id === id);
                    return found === undefined ? id : panelKey(found);
                };
                return landPanelIn(row.workspace, a.key, dropPlacement(walk, steps, keyOf), a.source);
            },
            cancel() {
                const a = active.current;
                if (a !== null)
                    finish(a);
            },
        };
    }, []);
    // A drag whose panel left the row by other means has nothing left to preview or hold.
    const gone = preview !== null && !input.entries.some((p) => p.id === preview.id);
    React.useEffect(() => {
        if (gone)
            controller.cancel();
    }, [gone, controller]);
    React.useEffect(() => () => controller.cancel(), [controller]);
    return { preview, controller };
}
