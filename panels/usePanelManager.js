/**
 * The panel capacity machinery: how many live collapsible panels the row shows at once (`capacity`),
 * parking/revealing to stay at it, revive-with-demotion (`handleActivatePanel`), and the row gesture
 * (`scrollRow`) that brings a hidden panel back from either side. Every hide is a park (`live: false`,
 * never a removal) pushed onto `collapseOrderRef`, so `revealMostRecentlyCollapsed` keeps working
 * regardless of which path did the parking, except a park that is held: that one stays parked until a person
 * shows it (`holdPanel`, `heldIds`).
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fewestParksThatSettle, isParkLive, rowPricing, settleKeeping } from './rowSettle.js';
import { placePanel, reportNotes } from '../panelPlacement.js';
import { resetEntries } from '../panelReset.js';
import { isPresent } from '../panelRowEntry.js';
import { FIXED, effective, holdUnlistedNote } from '../panelSettings.js';
import { DROP_TIE_BREAK, RETURN_TIE_BREAK, ROW_GAP } from '../rowConstants.js';
import { firstParkedAfter, lastParkedBefore, leastRecentlyTouchedId, leftmostLiveIndex, movePanelBy, parkLevers, parksForRoom, promoteToLive, recordOverride, rightmostLiveIndex, setSlots, sideOfLiveRange, } from '../panelWindow.js';
import { createOperationGate } from './operationGate.js';
export function usePanelManager(panels, setPanels, phoneWidth, containerWidth, 
/** How many always-rendered columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
fixedColumnCount, rootId, options) {
    const returnTieBreak = options?.tuning?.returnTieBreak ?? RETURN_TIE_BREAK;
    const dropTieBreak = options?.tuning?.dropTieBreak ?? DROP_TIE_BREAK;
    const gap = options?.tuning?.rowGap ?? ROW_GAP;
    const maxLive = options?.tuning?.maxLivePanels ?? null;
    const env = { phoneWidth, containerWidth, gap, fixedColumnCount, maxLive, dropTieBreak };
    const pricing = (row) => rowPricing(env, row);
    const settledKeeping = (next, keep) => settleKeeping(env, next, keep);
    const { widthOf, capacityFor, settles } = pricing(panels);
    const capacity = capacityFor(panels.filter(isParkLive));
    /**
     * Parked ids in park order, most recent last. A ref, not state: only handlers and the reconcile effect below
     * read it, so a push or pop need not re-render.
     */
    const collapseOrderRef = useRef([]);
    /**
     * When each panel was last touched: created, shown again, or focused. Session only, because a restored row has no
     * touch order to restore and starts every panel tied, which the row order then settles. A panel not stamped yet
     * counts as the newest, so one opened in the update being decided is never the one parked.
     */
    const touchedRef = useRef(new Map());
    const touchPanel = (id) => {
        if (touchedRef.current.has(id))
            touchedRef.current.set(id, performance.now());
    };
    const touchedAt = (id) => touchedRef.current.get(id) ?? Number.POSITIVE_INFINITY;
    /**
     * The panels the next capacity-reconcile DROP must keep live, in the order they were acted on: each one just
     * resized, opened or activated, so acting on a panel never parks it, and each of several actions in one
     * update keeps its own. The value is the array the action read: a reconcile still on it ran before the action.
     */
    const ownKeepLive = useRef(new Map());
    const keepLiveRef = options?.keepLiveRef ?? ownKeepLive;
    const markKeepLive = (id) => {
        keepLiveRef.current = new Map(keepLiveRef.current).set(id, panels);
    };
    /** Every id a park must leave alone: those just acted on. */
    const keptIds = () => new Set(keepLiveRef.current.keys());
    /** Slot counts resizePanel queued on `seen` that have not reached `panels` yet, so a later action in the same handler can price them. */
    const pendingSlotsRef = useRef({ seen: null, slots: new Map() });
    /** `row` (read in this render) with those slot counts applied. */
    const withPendingSlots = (row) => {
        const { seen, slots } = pendingSlotsRef.current;
        return seen === panels ? [...slots].reduce((acc, [id, count]) => setSlots(acc, id, count), row) : row;
    };
    const ownCapParked = useRef([]);
    const capParkedRef = options?.capParkedRef ?? ownCapParked;
    /** Nonzero inside this hook's own flushSync: a reconcile run there is mid-handler, before later actions land. */
    const flushingRef = useRef(0);
    const flushOwn = (update) => {
        flushingRef.current++;
        try {
            flushSync(update);
        }
        finally {
            flushingRef.current--;
        }
    };
    const enteringViaAnchorRef = useRef(new Set());
    const markEnteringViaAnchor = (id) => {
        enteringViaAnchorRef.current = new Set(enteringViaAnchorRef.current).add(id);
    };
    const forgetEnteringViaAnchor = (id) => {
        if (!enteringViaAnchorRef.current.has(id))
            return;
        const next = new Set(enteringViaAnchorRef.current);
        next.delete(id);
        enteringViaAnchorRef.current = next;
    };
    const enterSideRef = useRef(new Map());
    const [exitRightIds, setExitRightIds] = useState(new Set());
    const [swapExitIds, setSwapExitIds] = useState(new Set());
    /** Every path that makes an id live must forget any stale exit mark from a PREVIOUS park of the same id -- ids cycle live/parked repeatedly over a session. Put here, once, so no reveal path can skip it. */
    const purgeExitRight = (id) => {
        const without = (prev) => {
            if (!prev.has(id))
                return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        };
        setExitRightIds(without);
        setSwapExitIds(without);
    };
    /** No flushSync needed: the mark only has to be in the commit that mounts the slot, like enteringViaAnchorRef's. */
    const setEnterSide = (id, side) => {
        enterSideRef.current = new Map(enterSideRef.current).set(id, side);
        purgeExitRight(id);
    };
    /** Forces the NEXT mount of `id` back to the default (anchor formula / right), overriding a stale gesture mark from an earlier reveal of the same id. */
    const clearEnterSide = (id) => {
        if (enterSideRef.current.has(id)) {
            const next = new Map(enterSideRef.current);
            next.delete(id);
            enterSideRef.current = next;
        }
        purgeExitRight(id);
    };
    /** flushSync BEFORE the parking setPanels -- see `UsePanelManagerResult.exitRightIds`'s own doc comment for why. */
    const markExitRight = (id) => {
        flushOwn(() => setExitRightIds((prev) => new Set(prev).add(id)));
    };
    const pushCollapsed = (ids) => {
        const parkedSet = new Set(ids);
        collapseOrderRef.current = [...collapseOrderRef.current.filter((x) => !parkedSet.has(x)), ...ids];
    };
    const forgetCollapsed = (id) => {
        collapseOrderRef.current = collapseOrderRef.current.filter((x) => x !== id);
    };
    /**
     * The 'manual' panels the CAPACITY parked, most recent last. They are held 'sticky' and off the collapse stack, so
     * this is the only record that tells them from a host hide; only a raise of `maxLivePanels` reads it. recordPark
     * appends in the order it is given (the cap's choice, `dropTieBreak` included), a hide removes the id, and the
     * reconcile effect drops any id that is live, closed or gone.
     */
    const capParkedOrderRef = useRef([]);
    const forgetCapParked = (id) => {
        capParkedOrderRef.current = capParkedOrderRef.current.filter((x) => x !== id);
    };
    /** Session only, and a new Map per change so `heldIds` is a snapshot; the counter re-renders for a change no `setPanels` carries. */
    const heldRef = useRef(new Map());
    const [, bumpHeld] = useState(0);
    const writeHold = (id, hold) => {
        const next = new Map(heldRef.current);
        if (hold === null) {
            if (!next.delete(id))
                return false;
        }
        else {
            next.set(id, hold);
        }
        heldRef.current = next;
        bumpHeld((n) => n + 1);
        return true;
    };
    const releaseHold = (id) => writeHold(id, null);
    /** The ids `holdPanel` took on this render's list: a second call in the same handler still reads the list the first did not change. */
    const inFlightRef = useRef({ seen: null, ids: new Set() });
    const inFlight = () => (inFlightRef.current.seen === panels ? inFlightRef.current.ids : new Set());
    const markInFlight = (id) => {
        if (inFlightRef.current.seen !== panels)
            inFlightRef.current = { seen: panels, ids: new Set() };
        inFlightRef.current.ids.add(id);
    };
    const [published, release] = useReducer((a, b) => Math.max(a, b), 0);
    const [{ gate, settle }] = useState(() => createOperationGate(release));
    // No dependency list: every commit deletes the tokens whose call finished before it was rendered.
    useLayoutEffect(() => settle(published));
    /** Free slots a row leaves for `live` (its live collapsible panels): capacity priced from their own widths, less their count. Infinity while unmeasured. */
    const freeSlots = (live) => capacityFor(live) - live.length;
    const liveParkable = (row) => row.filter(isParkLive);
    /** Whether an 'until-room' hold still keeps `id` parked beside `base`, the live set it would join. */
    const heldBack = (id, base) => {
        const hold = heldRef.current.get(id);
        return typeof hold === 'object' && !(freeSlots(base) > hold.freeAfterPark);
    };
    const notedRef = useRef(new Set());
    const noteOnce = (note) => {
        const at = `${note.panelId}:${note.code}`;
        if (notedRef.current.has(at))
            return;
        notedRef.current = new Set(notedRef.current).add(at);
        try {
            options?.onNote?.(note);
        }
        catch {
            // A reporter that throws must not break the park that raised the note.
        }
    };
    /**
     * The one place a park is classified. A hold keeps the id off the collapse stack ('sticky') or on it behind a
     * threshold ('until-room'); a park for room goes on the stack unless the panel's `capacityReturn` is 'manual',
     * which holds it like a sticky hide.
     */
    const recordPark = (ids, cause) => {
        for (const id of ids) {
            if (cause.kind === 'hide') {
                if (cause.stickiness === 'until-room') {
                    writeHold(id, { freeAfterPark: freeSlots(cause.liveAfter) });
                    pushCollapsed([id]);
                }
                else {
                    writeHold(id, 'sticky');
                    forgetCollapsed(id);
                }
                forgetCapParked(id);
                continue;
            }
            const parked = panels.find((p) => p.id === id);
            if (parked !== undefined && parkLevers(parked).capacityReturn === 'manual') {
                writeHold(id, 'sticky');
                forgetCollapsed(id);
                capParkedOrderRef.current = [...capParkedOrderRef.current.filter((x) => x !== id), id];
            }
            else {
                pushCollapsed([id]);
            }
        }
    };
    /** What a placement of `p` resolves against: the row's root and the panel's own `placeFallback`. */
    const placing = (p) => ({ rootId, fallback: FIXED.placeFallback, ...(options?.order !== undefined ? { order: options.order } : {}) });
    const noteHold = (p) => {
        if (!effective(p).listed)
            noteOnce(holdUnlistedNote(p.id));
    };
    /** `row` with `id` placed by `placeAs`. */
    const landOn = (row, id, placeAs) => {
        const target = row.find((p) => p.id === id);
        if (target === undefined)
            return { row: [...row], notes: [] };
        return placePanel(row, id, placeAs, placing(target));
    };
    /** `row` with `id` landed and live, or null when `id` is unknown or already live: the one lift every path that shows a panel runs inside its update. */
    const liftOn = (row, id, placeAs, cap, keep) => {
        if (!row.some((p) => p.id === id && !p.live))
            return null;
        const landed = landOn(row, id, placeAs);
        if (landed.row.some((p) => p.id === id && p.live))
            return landed.row;
        return promoteToLive(landed.row, id, cap, touchedAt, keep);
    };
    const wouldEmptyRow = (ids) => {
        const gone = new Set([...ids, ...inFlight(), ...gate.leaving()]);
        return !panels.some((p) => isPresent(p) && !(p.collapsible && gone.has(p.id)));
    };
    const holdPanel = (id, kind) => {
        const target = panels.find((p) => p.id === id);
        if (!target?.collapsible)
            return false;
        if ((!target.live && heldRef.current.has(id)) || inFlight().has(id))
            return false;
        if (FIXED.hideWhenLast === 'refuse' && wouldEmptyRow([id]))
            return false;
        const liveAfter = liveParkable(panels).filter((p) => p.id !== id && !inFlight().has(p.id));
        noteHold(target);
        if (!target.live) {
            recordPark([id], { kind: 'hide', stickiness: kind, liveAfter });
            return true;
        }
        markInFlight(id);
        if (sideOfLiveRange(panels, id) === 'right')
            markExitRight(id);
        recordPark([id], { kind: 'hide', stickiness: kind, liveAfter });
        setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, live: false } : p)));
        return true;
    };
    /** Reads the last committed list, not this render's: a creation path calls it in the commit that added the panel. */
    const markHeld = (id, kind) => {
        const row = committedRef.current;
        const target = row.find((p) => p.id === id);
        if (!target?.collapsible || target.live)
            return false;
        recordPark([id], { kind: 'hide', stickiness: kind, liveAfter: liveParkable(row) });
        noteHold(target);
        return true;
    };
    /**
     * Before a panel is shown -- a new one from PanelsAPI.create(), or usePanelClosing's undo restoring a LIVE
     * one -- parks whatever is necessary to stay at capacity (by count, then by width), in the SAME update that
     * reveals it. `apply` is called once, purely (no side effect), against `panelsNow` to learn the id and array
     * position of whatever it adds/restores; the real commit re-runs it against the LATEST state instead of
     * trusting this snapshot.
     */
    const revealPanelProactively = (panelsNow, apply) => {
        const afterInsert = apply(panelsNow);
        const targetId = afterInsert.find((p) => !panelsNow.some((q) => q.id === p.id))?.id;
        if (targetId !== undefined)
            markKeepLive(targetId);
        const keep = [...keptIds()];
        const settledApply = (prev) => settledKeeping(apply(prev), keep);
        // The new panel may itself be a reserved one, which takes room from the parkable panels already live.
        const capacityAfter = targetId === undefined ? capacity : pricing(afterInsert).capacityFor(afterInsert.filter(isParkLive), panels.filter(isParkLive).map(widthOf));
        if (targetId === undefined || capacityAfter === Number.POSITIVE_INFINITY) {
            setPanels(settledApply);
            return;
        }
        const targetIndex = afterInsert.findIndex((p) => p.id === targetId);
        const liveParkableCountAfter = afterInsert.filter(isParkLive).length;
        const overCapacity = Math.max(0, liveParkableCountAfter - capacityAfter);
        if (overCapacity === 0) {
            setPanels(settledApply);
            return;
        }
        const toPark = [];
        const exempt = keptIds();
        let scratch = afterInsert;
        for (let i = 0; i < overCapacity; i++) {
            const id = leastRecentlyTouchedId(scratch, touchedAt, exempt);
            if (!id)
                break;
            toPark.push(id);
            scratch = scratch.map((p) => (p.id === id ? { ...p, live: false } : p));
        }
        if (toPark.length === 0) {
            setPanels(settledApply);
            return;
        }
        const rightParks = toPark.filter((id) => sideOfLiveRange(afterInsert, id) === 'right');
        if (rightParks.length > 0) {
            flushOwn(() => setExitRightIds((prev) => {
                const next = new Set(prev);
                for (const id of rightParks)
                    next.add(id);
                return next;
            }));
        }
        recordPark(toPark, { kind: 'capacity' });
        const parkedSet = new Set(toPark);
        setPanels((current) => settledKeeping(apply(current).map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)), keep));
    };
    /** The capacity `promoteToLive` judges `target` going live against in `row`: this render's, or under a cap the one that counts `target` if the cap counts it. */
    const capacityShowing = (row, target) => {
        if (maxLive === null)
            return capacity;
        const priced = pricing(row);
        const live = row.filter(isParkLive);
        return priced.capacityFor(parksForRoom(target) ? [...live, target] : live, live.map(priced.widthOf));
    };
    /** See `UsePanelManagerResult.swapPanels`'s own doc comment. */
    const swapPanels = (hide, show) => {
        const flying = inFlight();
        const leaving = hide.filter(({ id }) => {
            const target = panels.find((p) => p.id === id);
            return target?.collapsible === true && target.live && !flying.has(id);
        });
        const arriving = show.filter(({ id }) => panels.some((p) => p.id === id && !p.live));
        if (leaving.length === 0 && arriving.length === 0)
            return false;
        const leavingSet = new Set(leaving.map(({ id }) => id));
        const liveAfter = liveParkable(panels).filter((p) => !leavingSet.has(p.id) && !flying.has(p.id));
        for (const { id, stickiness } of leaving) {
            markInFlight(id);
            noteHold(panels.find((p) => p.id === id));
            recordPark([id], { kind: 'hide', stickiness, liveAfter });
        }
        for (const { id } of arriving) {
            markKeepLive(id);
            // No side: a swap's arrival enters as an open does, whatever an earlier reveal of the same id marked.
            forgetEnteringViaAnchor(id);
            clearEnterSide(id);
            forgetCollapsed(id);
            releaseHold(id);
        }
        const keep = [...keptIds()];
        // Its own commit before the one that parks them, as `markExitRight` has: the leaving slots' last render carries the mark.
        if (leaving.length > 0)
            flushOwn(() => setSwapExitIds((prev) => new Set([...prev, ...leavingSet])));
        setPanels((prev) => {
            let row = prev.map((p) => (leavingSet.has(p.id) ? { ...p, live: false } : p));
            for (const { id, place } of arriving) {
                const target = row.find((p) => p.id === id);
                if (target === undefined || target.live)
                    continue;
                row = liftOn(row, id, place ?? effective(target).placeOnShow, capacityShowing(row, target), new Set(keep)) ?? row;
            }
            return settledKeeping(row, keep);
        });
        return true;
    };
    /**
     * Clicking ANY row -- live or parked alike -- activates it (promoteToLive's own doc
     * comment has the full "make/keep it live, preserve array order" spec).
     */
    const handleActivatePanel = (id, from = panels, placeAs) => {
        const target = from.find((p) => p.id === id);
        if (!target || target.live)
            return;
        markKeepLive(id);
        const keep = [...keptIds()];
        // A manual History-row activation enters from the right (or by its own `anchoredEnter`), so it drops any
        // anchor-entry or gesture-side mark left from an earlier reveal of this id.
        forgetEnteringViaAnchor(id);
        clearEnterSide(id);
        // Re-placed before it goes live, in the same update; the updaters below place again over the latest list.
        const showAt = placeAs ?? effective(target).placeOnShow;
        const landed = landOn(from, id, showAt);
        const before = showAt === 'in-place' ? from : landed.row;
        const result = before.some((p) => p.id === id && p.live) ? before : promoteToLive(before, id, capacityShowing(before, target), touchedAt, keptIds());
        if (!result)
            return;
        reportNotes(options?.onNote, landed.notes);
        if (showAt !== 'in-place')
            setEnterSide(id, sideOfLiveRange(result, id));
        forgetCollapsed(id);
        releaseHold(id);
        const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
        if (!demoted) {
            // An updater, not `result`: `result` is built from this render's array and would drop an update queued
            // earlier in the same handler.
            setPanels((prev) => settledKeeping(liftOn(prev, id, showAt, Number.POSITIVE_INFINITY) ?? prev, keep));
            return;
        }
        if (sideOfLiveRange(before, demoted.id) === 'right')
            markExitRight(demoted.id);
        recordPark([demoted.id], { kind: 'capacity' });
        // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
        // Infinity guarantees that for this call only), then the panel it displaces is parked.
        setPanels((prev) => liftOn(prev, id, showAt, Number.POSITIVE_INFINITY) ?? prev);
        setPanels((current) => settledKeeping(current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)), keep));
    };
    /** See `UsePanelManagerResult.scrollRow`'s own doc comment. */
    const scrollRow = (direction, keep) => {
        const reveal = direction === 'right' ? firstParkedAfter(panels, rightmostLiveIndex(panels)) : lastParkedBefore(panels, leftmostLiveIndex(panels));
        if (!reveal || effective(reveal).revealOnScroll === 'never')
            return false;
        const kept = keep === undefined ? keptIds() : new Set([...keptIds(), keep]);
        markKeepLive(reveal.id);
        // A resize earlier in this handler is priced at its new tier, or the row committed below could overflow..
        const sized = withPendingSlots(panels);
        const live = sized.filter(isParkLive);
        const farFirst = (direction === 'right' ? live : [...live].reverse()).filter((p) => !kept.has(p.id));
        const toPark = new Set();
        const rowAfter = () => sized.filter((p) => (isParkLive(p) || (p.id === reveal.id && parksForRoom(p))) && !toPark.has(p.id));
        // At least the one panel the gesture swaps out, then more only while the row with `reveal` would not settle.
        for (const p of farFirst) {
            if (toPark.size > 0 && settles(rowAfter()))
                break;
            toPark.add(p.id);
        }
        const flip = (row) => row.map((p) => (toPark.has(p.id) ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p));
        setEnterSide(reveal.id, direction);
        // A leftward gesture parks off the RIGHT edge: mark those BEFORE the setPanels below, in their own commit.
        if (direction === 'left' && toPark.size > 0)
            flushOwn(() => setExitRightIds((prev) => new Set([...prev, ...toPark])));
        recordPark([...toPark], { kind: 'capacity' });
        forgetCollapsed(reveal.id);
        releaseHold(reveal.id);
        setPanels((prev) => flip(prev));
        return true;
    };
    /** See `UsePanelManagerResult.reorderPanel`'s own doc comment. */
    const reorderPanel = (id, by, record = true) => {
        const count = by === 'left' ? -1 : by === 'right' ? 1 : by;
        const changes = movePanelBy(panels, id, count, rootId) !== panels;
        setPanels((prev) => {
            const moved = movePanelBy(prev, id, count, rootId);
            // A drag settles every panel's place for the person, not only the dragged one's.
            return moved === prev || !record ? moved : recordOverride(moved, 'anchor', moved.map((p) => p.id), rootId);
        });
        return changes;
    };
    /** See `UsePanelManagerResult.placeAt`'s own doc comment. */
    const placeAt = (id, value, record = true) => {
        const target = panels.find((p) => p.id === id);
        if (target === undefined || value === 'in-place')
            return false;
        const sameRow = (a, b) => a.length === b.length && a.every((p, k) => p.id === b[k].id && p.anchor?.panel === b[k].anchor?.panel && p.anchor?.position === b[k].anchor?.position && p.anchor?.priority === b[k].anchor?.priority);
        const placed = placePanel(panels, id, value, placing(target));
        reportNotes(options?.onNote, placed.notes);
        const changes = !sameRow(panels, placed.row);
        setPanels((prev) => {
            const next = placePanel(prev, id, value, placing(target)).row;
            if (sameRow(prev, next))
                return prev;
            return record ? recordOverride(next, 'anchor', next.map((p) => p.id), rootId) : next;
        });
        return changes;
    };
    /** See `UsePanelManagerResult.landAt`'s own doc comment. */
    const landAt = (id, value, record = true) => {
        const target = panels.find((p) => p.id === id);
        if (target === undefined || target.live)
            return false;
        handleActivatePanel(id, panels, value);
        // Queued after the lift, in the same batch, so the person's arrangement is read from the row the lift made.
        if (record)
            setPanels((prev) => recordOverride(prev, 'anchor', prev.map((p) => p.id), rootId));
        return true;
    };
    /** See `UsePanelManagerResult.resizePanel`'s own doc comment. */
    const resizePanel = (id, next, record = true) => {
        if (setSlots(panels, id, next) === panels)
            return false;
        const wasLive = panels.find((p) => p.id === id)?.live === true;
        markKeepLive(id);
        const keep = [...keptIds()];
        const pending = pendingSlotsRef.current.seen === panels ? pendingSlotsRef.current.slots : [];
        pendingSlotsRef.current = { seen: panels, slots: new Map(pending).set(id, next) };
        if (wasLive) {
            purgeExitRight(id);
            forgetCollapsed(id);
        }
        setPanels((prev) => {
            const resized = setSlots(prev, id, next);
            // An earlier call in this same handler may have queued a park of it (its exit mark and stack entry are
            // dropped above): a resize never parks its own panel, so that park is cancelled before anything commits.
            const own = wasLive && resized.some((p) => p.id === id && !p.live) ? resized.map((p) => (p.id === id ? { ...p, live: true } : p)) : resized;
            // A width set now replaces the one a panel resting at one phone would go back to.
            const settled = settledKeeping(own, keep).map((p) => (p.id === id && p.savedSlots !== undefined ? { ...p, savedSlots: undefined } : p));
            return record ? recordOverride(settled, 'slots', [id], rootId) : settled;
        });
        return true;
    };
    /**
     * Reconciles the live set against `capacity` whenever either changes -- an effect, since it must act on a
     * measurement that just changed, not one this render was given. Both branches judge a candidate set by `settles`,
     * never `capacity` as a count: `capacity` prices every not-yet-live slot at `phoneWidth`, so WHICH panels park or
     * return decides whether the rest fits, and a set that does not settle re-triggers a branch next render. A DROP
     * parks `fewestParksThatSettle` and exits 'left' (flushSync cannot mark a right exit first from a passive effect), but
     * finds nothing to drop while a cap is set: the render above has settled the row. A RISE reveals from the top of
     * `collapseOrderRef`; one that doesn't settle stays on the stack for an OLDER, narrower one.
     */
    const committedRef = useRef(panels);
    // The value the previous committed render had: a raise is read against it, so a mount, a restore, a resize, an equal or lower value and StrictMode's second effect all read none.
    const prevMaxLiveRef = useRef(maxLive);
    useEffect(() => {
        const raised = prevMaxLiveRef.current !== null && (maxLive === null || maxLive > prevMaxLiveRef.current);
        prevMaxLiveRef.current = maxLive;
        capParkedOrderRef.current = capParkedOrderRef.current.filter((id) => panels.some((p) => p.id === id && p.collapsible && !p.live));
        // `settledKeeping` parks inside a state update, where no call-time code sees which panels it chose: the
        // stack learns of any park not already on it from the commit itself.
        const before = committedRef.current;
        committedRef.current = panels;
        // A panel that is new, or live where it was parked, is touched now; one that left the row is forgotten.
        const touched = touchedRef.current;
        const stamp = performance.now();
        for (const id of [...touched.keys()])
            if (!panels.some((p) => p.id === id))
                touched.delete(id);
        for (const p of panels)
            if (!touched.has(p.id) || (p.live && !before.some((q) => q.id === p.id && q.live)))
                touched.set(p.id, stamp);
        const byCap = capParkedRef.current;
        capParkedRef.current = [];
        // A panel added parked is held per its own setting, unless the cap parked it before its row was shown; a hold whose panel is gone (clearAll wipes without a close) is dropped.
        for (const p of panels)
            if (p.collapsible && !p.live && !before.some((q) => q.id === p.id) && !byCap.includes(p.id))
                markHeld(p.id, effective(p).hideStickiness);
        for (const id of heldRef.current.keys())
            if (!panels.some((p) => p.id === id))
                releaseHold(id);
        const capParked = byCap.filter((id) => panels.some((p) => p.id === id && p.collapsible && !p.live));
        if (capParked.length > 0)
            recordPark(capParked, { kind: 'capacity' });
        const unrecorded = panels.filter((p) => p.collapsible && !p.live && !collapseOrderRef.current.includes(p.id) && !heldRef.current.has(p.id) && before.some((q) => q.id === p.id && q.live));
        if (unrecorded.length > 0)
            recordPark(unrecorded.map((p) => p.id), { kind: 'capacity' });
        const keepIds = [];
        const waiting = new Map();
        // A mark still on the array its action read waits for that action to land. Inside flushOwn every mark
        // outlives this reconcile: the rest of its handler has not landed yet.
        for (const [id, seen] of keepLiveRef.current) {
            if (seen !== panels)
                keepIds.push(id);
            if (seen === panels || flushingRef.current > 0)
                waiting.set(id, seen);
        }
        keepLiveRef.current = waiting;
        if (capacity === Number.POSITIVE_INFINITY)
            return;
        const live = panels.filter(isParkLive);
        // An 'until-room' hold taken before the first measurement took no threshold; it takes the row's as measured now.
        for (const [id, hold] of heldRef.current)
            if (typeof hold === 'object' && hold.freeAfterPark === Number.POSITIVE_INFINITY)
                writeHold(id, { freeAfterPark: capacity - live.length });
        if (live.length > capacity) {
            const toPark = fewestParksThatSettle(live, widthOf, settles, keepIds, dropTieBreak);
            if (toPark.length === 0)
                return;
            recordPark(toPark, { kind: 'capacity' });
            const parkedSet = new Set(toPark);
            setPanels((current) => current.map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)));
        }
        else if (live.length < capacity && (collapseOrderRef.current.length > 0 || (raised && capParkedOrderRef.current.length > 0))) {
            // A raise also walks the manual panels the cap parked; the walk and its bound are the ones a capacity rise uses.
            const stack = raised ? [...collapseOrderRef.current, ...capParkedOrderRef.current] : collapseOrderRef.current;
            const revealed = new Set();
            const stale = new Set();
            for (const id of returnOrder(stack, panels)) {
                const candidate = panels.find((p) => p.id === id);
                if (!candidate || candidate.live) {
                    stale.add(id); // closed, or already live some other way
                    continue;
                }
                if (heldBack(id, panels.filter((p) => parksForRoom(p) && (p.live || revealed.has(p.id)))))
                    continue;
                if (settles(panels.filter((p) => parksForRoom(p) && (p.live || revealed.has(p.id) || p.id === id))))
                    revealed.add(id);
            }
            if (revealed.size === 0)
                return;
            collapseOrderRef.current = collapseOrderRef.current.filter((id) => !revealed.has(id) && !stale.has(id));
            capParkedOrderRef.current = capParkedOrderRef.current.filter((id) => !revealed.has(id) && !stale.has(id));
            // Each returning panel lands by its own `placeOnReturn`, in return order, in the update that makes it live.
            const returnAt = (id) => FIXED.placeOnReturn;
            const landAll = (row) => [...revealed].reduce((acc, id) => landOn(acc, id, returnAt(id)).row, row);
            let landing = panels;
            const moved = new Set();
            for (const id of revealed) {
                const result = landOn(landing, id, returnAt(id));
                reportNotes(options?.onNote, result.notes);
                if (returnAt(id) !== 'in-place')
                    moved.add(id);
                landing = result.row;
            }
            const landed = landing.map((p) => (revealed.has(p.id) ? { ...p, live: true } : p));
            for (const id of revealed) {
                releaseHold(id);
                setEnterSide(id, sideOfLiveRange(moved.has(id) ? landed : panels, id));
            }
            setPanels((current) => landAll(current).map((p) => (revealed.has(p.id) ? { ...p, live: true } : p)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [capacity, panels, maxLive]);
    /**
     * `stack` (park order, most recent last) in the order a return walk tries it: the tie-break first, then a stable
     * sort by `returnPriority`, highest first.
     */
    const returnOrder = (stack, row) => {
        const rowIndex = (id) => row.findIndex((p) => p.id === id);
        const priority = (id) => {
            const p = row.find((q) => q.id === id);
            return p === undefined ? 0 : parkLevers(p).returnPriority;
        };
        const walk = returnTieBreak === 'latest-first' ? [...stack].reverse() : returnTieBreak === 'earliest-first' ? [...stack] : [...stack].sort((a, b) => rowIndex(a) - rowIndex(b));
        return walk.sort((a, b) => priority(b) - priority(a));
    };
    /** See `UsePanelManagerResult.revealMostRecentlyCollapsed`'s own doc comment for the full contract. */
    const revealMostRecentlyCollapsed = (panelsAfterClose) => {
        // Priced like scrollRow: a resize earlier in this handler is not in `panelsAfterClose` yet.
        const sized = withPendingSlots(panelsAfterClose);
        const stack = collapseOrderRef.current;
        const stale = new Set();
        let candidateId = null;
        for (const id of returnOrder(stack, panelsAfterClose)) {
            const candidate = panelsAfterClose.find((p) => p.id === id);
            if (!candidate || candidate.live) {
                stale.add(id); // closed, or already live some other way
                continue;
            }
            if (candidateId === null && !heldBack(id, liveParkable(sized)) && settles(sized.filter((p) => parksForRoom(p) && (p.live || p.id === id))))
                candidateId = id;
        }
        collapseOrderRef.current = stack.filter((id) => id !== candidateId && !stale.has(id));
        if (candidateId === null)
            return;
        const revealId = candidateId;
        releaseHold(revealId);
        // Clear before marking, as `clearEnterSide`'s contract requires: a stale explicit side would win over the anchor.
        clearEnterSide(revealId);
        const returnAt = FIXED.placeOnReturn;
        if (returnAt === 'in-place') {
            // One of the two "reappearance" paths that enter from the anchor's side -- mark it BEFORE the setPanels
            // call below; no flushSync, since the mark only has to be in the commit that mounts the slot.
            markEnteringViaAnchor(revealId);
            setPanels((current) => promoteToLive(current, revealId, Number.POSITIVE_INFINITY, touchedAt) ?? current);
            return;
        }
        const placed = landOn(panelsAfterClose, revealId, returnAt);
        reportNotes(options?.onNote, placed.notes);
        setEnterSide(revealId, sideOfLiveRange(placed.row, revealId));
        setPanels((current) => liftOn(current, revealId, returnAt, Number.POSITIVE_INFINITY) ?? current);
    };
    /** The ids of the parked panels on the collapse stack that `row` has room to bring back, in return order. */
    const plannedReturns = (row) => {
        const priced = pricing(row);
        const back = new Set();
        for (const id of returnOrder(collapseOrderRef.current, row)) {
            const candidate = row.find((p) => p.id === id);
            if (!candidate || candidate.live)
                continue;
            if (heldBack(id, row.filter((p) => parksForRoom(p) && (p.live || back.has(p.id)))))
                continue;
            if (priced.settles(row.filter((p) => parksForRoom(p) && (p.live || back.has(p.id) || p.id === id))))
                back.add(id);
        }
        return [...back];
    };
    /** See `UsePanelManagerResult.resetPanels`'s own doc comment. */
    const resetPanels = (ids) => {
        const none = { changed: false, parked: [], returned: [] };
        if (options?.resolveDefaults === undefined)
            return none;
        const env = { rootId, resolveDefaults: options.resolveDefaults, placing };
        const outcome = resetEntries(panels, ids, env);
        if (outcome.row === panels)
            return none;
        reportNotes(options?.onNote, outcome.notes);
        for (const id of outcome.resized)
            markKeepLive(id);
        const keep = [...keptIds()];
        const settledRow = settledKeeping(outcome.row, keep);
        const parked = settledRow.filter((p) => !p.live && outcome.row.find((q) => q.id === p.id)?.live).map((p) => p.id);
        setPanels((prev) => {
            const again = resetEntries(prev, ids, env);
            return again.row === prev ? prev : settledKeeping(again.row, keep);
        });
        return { changed: outcome.changed, parked, returned: plannedReturns(settledRow).filter((id) => !parked.includes(id)) };
    };
    return {
        revealPanelProactively,
        landPanel: landOn,
        resetPanels,
        handleActivatePanel,
        forgetCollapsed,
        revealMostRecentlyCollapsed,
        enteringViaAnchorIds: enteringViaAnchorRef.current,
        markEnteringViaAnchor,
        markEnterSide: setEnterSide,
        clearEnterSide,
        scrollRow,
        reorderPanel,
        resizePanel,
        placeAt,
        landAt,
        gate,
        enterSideById: enterSideRef.current,
        exitRightIds,
        swapExitIds,
        swapPanels,
        holdPanel,
        releaseHold,
        heldIds: heldRef.current,
        wouldEmptyRow,
        markHeld,
        touchPanel,
    };
}
export { fewestParksThatSettle } from './rowSettle.js';
