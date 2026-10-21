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
import { computeRowNumbers } from '../rowNumbers.js';
import { placePanel, reportNotes } from '../panelPlacement.js';
import { applyPinChange, landPanel, pinHalf, pinnedIds, withoutDeferral } from '../panelPin.js';
import { resetEntries } from '../panelReset.js';
import { isPresent } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import { FIXED, effective, holdUnlistedNote } from '../panelSettings.js';
import { DROP_TIE_BREAK, RETURN_TIE_BREAK, ROW_GAP } from '../rowConstants.js';
import { firstParkedAfter, lastParkedBefore, leastRecentlyTouchedId, leftmostLiveIndex, movePanelBy, parkLevers, parksForRoom, promoteToLive, recordOverride, rightmostLiveIndex, setSlots, sideOfLiveRange, } from '../panelWindow.js';
/** Live and parkable for room: the panels whose count and widths the capacity governs. */
const isParkLive = (p) => p.live && parksForRoom(p);
const NO_IDS = new Set();
export function usePanelManager(panels, setPanels, phoneWidth, containerWidth, 
/** How many always-rendered columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
fixedColumnCount, rootId, options) {
    const returnTieBreak = options?.tuning?.returnTieBreak ?? RETURN_TIE_BREAK;
    const dropTieBreak = options?.tuning?.dropTieBreak ?? DROP_TIE_BREAK;
    const gap = options?.tuning?.rowGap ?? ROW_GAP;
    const maxLive = options?.tuning?.maxLivePanels ?? null;
    /**
     * What prices `row`: panel widths, how many parkable panels may be live, whether a live set settles, and which panels
     * the cap leaves alone. A scroll panel never parks, so its width comes off the budget instead of counting.
     */
    const pricing = (row) => {
        const numbers = computeRowNumbers({ entries: row, phoneWidth, containerWidth, gap, fixedItemCount: fixedColumnCount });
        // Only a row with a scroll panel, or a fixed column wider than a phone, prices its reserved widths one by one; any other keeps the fixed column count the host passed.
        const widerThanPhone = row.some((p) => isPresent(p) && !p.collapsible && panelWidthOf(p, phoneWidth, numbers.maxLiveWidth, gap) !== phoneWidth);
        const reservedWidths = widerThanPhone || row.some((p) => isPresent(p) && !parksForRoom(p) && p.collapsible) ? numbers.reservedWidths : undefined;
        // Parked ones included, so a pinned panel that returns is still exempt. Empty without a cap: nothing then reads a pin.
        const pinned = maxLive === null ? NO_IDS : pinnedIds(row, rootId);
        const widthOf = (p) => panelWidthOf(p, phoneWidth, numbers.maxLiveWidth, gap);
        const fitCapacityFor = (liveWidths) => {
            // `containerWidth === 0` means unmeasured (the first commit, and every jsdom test that never calls
            // measure()): null means no cap and no reconcile, never "zero panels fit".
            const fitCount = rowFitCount({ containerWidth, phoneWidth, gap, fixedColumnCount, liveWidths, reservedWidths });
            const effectiveMax = effectiveMaxPanels(fitCount, fixedColumnCount);
            // Floor of 1 keeps the panel just opened on screen even at the narrowest legal width (effectiveMaxPanels
            // already floors at fixedColumnCount + 1, so this bites only when the fixed columns alone reach effectiveMax).
            return effectiveMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, effectiveMax - fixedColumnCount);
        };
        /**
         * How many panels `set` (live parkable, row order) may number: the window's fit (priced from `fitWidths`, else `set`'s
         * own), held under a cap to at most N plus the pinned panels of `set`. A scrolling row under a cap ignores the fit.
         */
        const capacityFor = (set, fitWidths = set.map(widthOf)) => {
            if (maxLive === null)
                return fitCapacityFor(fitWidths);
            const fit = numbers.rowScroll ? Number.POSITIVE_INFINITY : fitCapacityFor(fitWidths);
            return Math.min(fit, maxLive + set.filter((p) => pinned.has(p.id)).length);
        };
        /** Whether `set` (live parkable panels, row order) can stay live as it is: the one test both reconcile branches settle against. */
        const settles = (set) => set.length <= capacityFor(set);
        return { widthOf, capacityFor, settles, pinned };
    };
    const { widthOf, capacityFor, settles, pinned } = pricing(panels);
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
    const keepLiveRef = useRef(new Map());
    const markKeepLive = (id) => {
        keepLiveRef.current = new Map(keepLiveRef.current).set(id, panels);
    };
    /** Every id a park must leave alone: those just acted on, and under a cap the pinned ones. */
    const keptIds = () => new Set([...keepLiveRef.current.keys(), ...pinned]);
    /** Slot counts resizePanel queued on `seen` that have not reached `panels` yet, so a later action in the same handler can price them. */
    const pendingSlotsRef = useRef({ seen: null, slots: new Map() });
    /** `row` (read in this render) with those slot counts applied. */
    const withPendingSlots = (row) => {
        const { seen, slots } = pendingSlotsRef.current;
        return seen === panels ? [...slots].reduce((acc, [id, count]) => setSlots(acc, id, count), row) : row;
    };
    /** `next`, plus in the same update whatever the reconcile's DROP would park, so no committed row overflows. */
    const settledKeeping = (next, keep) => {
        const live = next.filter(isParkLive);
        const priced = pricing(next);
        if (priced.settles(live))
            return next;
        const parked = new Set(fewestParksThatSettle(live, priced.widthOf, priced.settles, [...keep, ...priced.pinned], dropTieBreak));
        return parked.size === 0 ? next : next.map((p) => (parked.has(p.id) ? { ...p, live: false } : p));
    };
    /** Ids a render parked for the cap before its row was shown, in row order; the effect below records them once that row has committed. */
    const capParkedRef = useRef([]);
    // A cap holds in every row that reaches the document: a row that lands over it (a restore, a seeded list, a lower N) is settled here and rendered again.
    if (maxLive !== null) {
        // The panels an action marked that have landed in this row, as the reconcile effect reads them: a settle keeps them.
        const acted = [...keepLiveRef.current].filter(([, seen]) => seen !== panels).map(([id]) => id);
        const settled = settledKeeping(panels, acted);
        if (settled !== panels) {
            const parked = panels.filter((p, k) => p.live && !settled[k].live).map((p) => p.id);
            capParkedRef.current = [...capParkedRef.current.filter((id) => !parked.includes(id)), ...parked];
            setPanels((current) => settledKeeping(current, acted));
        }
    }
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
    /** Every path that makes an id live must forget any stale exit-right mark from a PREVIOUS park of the same id -- ids cycle live/parked repeatedly over a session. Put here, once, so no reveal path can skip it. */
    const purgeExitRight = (id) => {
        setExitRightIds((prev) => {
            if (!prev.has(id))
                return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
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
    /** Tokens live in refs: every closure of every render reads the same turn, however many commits a flushSync makes inside it. */
    const seqRef = useRef(0);
    const tokensRef = useRef(new Map());
    const closeTokenRef = useRef(0);
    const [published, release] = useReducer((a, b) => Math.max(a, b), 0);
    // No dependency list: every commit deletes the tokens whose call finished before it was rendered.
    useLayoutEffect(() => {
        for (const [id, t] of tokensRef.current)
            if (t.token <= published)
                tokensRef.current.delete(id);
        if (closeTokenRef.current <= published)
            closeTokenRef.current = 0;
    });
    const gate = {
        busy: (ids, kind) => {
            if (ids.some((id) => tokensRef.current.has(id)))
                return true;
            if (kind === 'close')
                return [...tokensRef.current.values()].some((t) => t.source === 'manager');
            return closeTokenRef.current !== 0;
        },
        take: (ids, kind) => {
            if (gate.busy(ids, kind))
                return undefined;
            const token = ++seqRef.current;
            for (const id of ids)
                tokensRef.current.set(id, { token, source: 'manager', kind });
            if (kind === 'close')
                closeTokenRef.current = token;
            return token;
        },
        takeRaw: (ids, kind) => {
            if (ids.some((id) => tokensRef.current.get(id)?.source === 'manager'))
                return undefined;
            const token = ++seqRef.current;
            for (const id of ids)
                tokensRef.current.set(id, { token, source: 'raw', kind });
            return token;
        },
        takeFree: (ids, kind) => {
            const free = ids.filter((id) => !tokensRef.current.has(id));
            return free.length === 0 ? undefined : gate.takeRaw(free, kind);
        },
        release,
        leaving: () => new Set([...tokensRef.current].filter(([, t]) => t.kind !== 'other').map(([id]) => id)),
    };
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
    const pinEnv = options?.resolveWith === undefined ? undefined : { rootId, resolveWith: options.resolveWith, placing };
    /** `row` with `id` landed by `placeAs`, or by its pending pin change, which a path that makes a panel live applies in its own update. */
    const landOn = (row, id, placeAs, pin) => {
        const target = row.find((p) => p.id === id);
        if (target === undefined)
            return { row: [...row], notes: [], pinned: false };
        if (pinEnv !== undefined)
            return landPanel(row, id, pin, placeAs, pinEnv);
        const placed = placePanel(row, id, placeAs, placing(target));
        return { ...placed, pinned: false };
    };
    /** `row` with `id` landed and live, or null when `id` is unknown or already live: the one lift every path that shows a panel runs inside its update. */
    const liftOn = (row, id, placeAs, cap, keep, pin) => {
        if (!row.some((p) => p.id === id && !p.live))
            return null;
        const landed = landOn(row, id, placeAs, pin);
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
    /**
     * Clicking ANY row -- live or parked alike -- activates it (promoteToLive's own doc
     * comment has the full "make/keep it live, preserve array order" spec).
     */
    const handleActivatePanel = (id, pin, from = panels, placeAs) => {
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
        const landed = landOn(from, id, showAt, pin);
        const before = showAt === 'in-place' && !landed.pinned ? from : landed.row;
        const result = before.some((p) => p.id === id && p.live) ? before : promoteToLive(before, id, capacityShowing(before, target), touchedAt, keptIds());
        if (!result)
            return;
        reportNotes(options?.onNote, landed.notes);
        if (showAt !== 'in-place' || landed.pinned)
            setEnterSide(id, sideOfLiveRange(result, id));
        forgetCollapsed(id);
        releaseHold(id);
        const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
        if (!demoted) {
            // An updater, not `result`: `result` is built from this render's array and would drop an update queued
            // earlier in the same handler.
            setPanels((prev) => settledKeeping(liftOn(prev, id, showAt, Number.POSITIVE_INFINITY, undefined, pin) ?? prev, keep));
            return;
        }
        if (sideOfLiveRange(before, demoted.id) === 'right')
            markExitRight(demoted.id);
        recordPark([demoted.id], { kind: 'capacity' });
        // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
        // Infinity guarantees that for this call only), then the panel it displaces is parked.
        setPanels((prev) => liftOn(prev, id, showAt, Number.POSITIVE_INFINITY, undefined, pin) ?? prev);
        setPanels((current) => settledKeeping(current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)), keep));
    };
    /** See `UsePanelManagerResult.scrollRow`'s own doc comment. */
    const scrollRow = (direction) => {
        const reveal = direction === 'right' ? firstParkedAfter(panels, rightmostLiveIndex(panels)) : lastParkedBefore(panels, leftmostLiveIndex(panels));
        if (!reveal || effective(reveal).revealOnScroll === 'never')
            return;
        const kept = keptIds();
        markKeepLive(reveal.id);
        // A resize earlier in this handler is priced at its new tier, or the row committed below could overflow. A pin change the panel waits with lands first, so the gesture parks against the row it makes.
        const waiting = reveal.deferredPin !== undefined;
        const landed = waiting ? landOn(withPendingSlots(panels), reveal.id, 'in-place') : undefined;
        const sized = landed?.row ?? withPendingSlots(panels);
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
        // The side a panel enters from is its landing slot's when a pin change moved it, the gesture's direction when nothing did.
        setEnterSide(reveal.id, landed === undefined ? direction : sideOfLiveRange(flip(sized), reveal.id));
        reportNotes(options?.onNote, landed?.notes ?? []);
        // A leftward gesture parks off the RIGHT edge: mark those BEFORE the setPanels below, in their own commit.
        if (direction === 'left' && toPark.size > 0)
            flushOwn(() => setExitRightIds((prev) => new Set([...prev, ...toPark])));
        recordPark([...toPark], { kind: 'capacity' });
        forgetCollapsed(reveal.id);
        releaseHold(reveal.id);
        setPanels((prev) => (waiting ? landOn(flip(prev), reveal.id, 'in-place').row : flip(prev)));
    };
    /** Pinned follows position, so under a cap a move that changes the row can change whether `id` counts: the park it causes leaves `id` live, as a pin does. */
    const keepMoved = (id, changes) => {
        if (changes && maxLive !== null)
            markKeepLive(id);
    };
    /** See `UsePanelManagerResult.reorderPanel`'s own doc comment. */
    const reorderPanel = (id, by, record = true) => {
        const count = by === 'left' ? -1 : by === 'right' ? 1 : by;
        const changes = movePanelBy(panels, id, count, rootId) !== panels;
        keepMoved(id, changes);
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
        keepMoved(id, changes);
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
        handleActivatePanel(id, undefined, panels, value);
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
            const settled = settledKeeping(own, keep);
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
            // Each returning panel lands by its own `placeOnReturn`, or by the pin change it waits with, in return order, in the update that makes it live.
            const returnAt = (id) => FIXED.placeOnReturn;
            const landAll = (row) => [...revealed].reduce((acc, id) => landOn(acc, id, returnAt(id)).row, row);
            let landing = panels;
            const moved = new Set();
            for (const id of revealed) {
                const result = landOn(landing, id, returnAt(id));
                reportNotes(options?.onNote, result.notes);
                if (returnAt(id) !== 'in-place' || result.pinned)
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
        const returning = panelsAfterClose.find((p) => p.id === revealId);
        const returnAt = FIXED.placeOnReturn;
        if (returnAt === 'in-place' && returning.deferredPin === undefined) {
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
    /** See `UsePanelManagerResult.previewPin`'s own doc comment. */
    const previewPin = (id, change) => pinEnv === undefined || !panels.some((p) => p.id === id) ? { ok: false, code: 'unknown-panel', message: `no panel '${id}' is in the row` } : applyPinChange(panels, id, change, pinEnv);
    /** `row` with what a person's pin of `id` by `change` records: the anchor when the half names a place, `parkable` when it names that. */
    const recordPinned = (row, id, change) => {
        const half = pinHalf(row.find((p) => p.id === id) ?? { settings: undefined }, change);
        const anchored = half.placement === undefined ? row : recordOverride(row, 'anchor', row.map((p) => p.id), rootId);
        return half.parkable === undefined ? anchored : recordOverride(anchored, 'parkable', [id], rootId);
    };
    /** See `UsePanelManagerResult.pinPanel`'s own doc comment. */
    const pinPanel = (id, change, record) => {
        const outcome = previewPin(id, change);
        if (!outcome.ok)
            return outcome;
        reportNotes(options?.onNote, outcome.notes);
        if (outcome.row === panels)
            return outcome;
        markKeepLive(id);
        const keep = [...keptIds()];
        setPanels((prev) => {
            const applied = applyPinChange(prev, id, change, pinEnv);
            if (!applied.ok || applied.row === prev)
                return prev;
            const settled = settledKeeping(applied.row, keep);
            return record ? recordPinned(settled, id, change) : settled;
        });
        return outcome;
    };
    /** See `UsePanelManagerResult.recordPin`'s own doc comment. */
    const recordPin = (id, change) => setPanels((prev) => recordPinned(prev, id, change));
    /** See `UsePanelManagerResult.deferPin`'s own doc comment. */
    const deferPin = (id, change) => {
        setPanels((prev) => prev.map((p) => (p.id === id ? (change === null ? withoutDeferral(p) : { ...p, deferredPin: change }) : p)));
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
        previewPin,
        pinPanel,
        recordPin,
        deferPin,
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
        holdPanel,
        releaseHold,
        heldIds: heldRef.current,
        wouldEmptyRow,
        markHeld,
        touchPanel,
    };
}
/**
 * The ids (row order) to park so the live panels left settle: as FEW as possible, and among equally few the lowest
 * `evictionRank` first, then the `tieBreak` end: the LEFTMOST by default, so a row of equal widths parks exactly its
 * leftmost excess, and a wide panel parks alone when that is what leaves the most panels live. Each of `keepIds`
 * (in the order they were acted on) is never parked, whatever that costs the others, unless the ones before it
 * already fill the row.
 * @internal
 */
export function fewestParksThatSettle(live, widthOf, settles, keepIds = [], tieBreak = 'leftmost') {
    const narrowestFirst = (set) => [...set].sort((a, b) => widthOf(a) - widthOf(b));
    const inRowOrder = (set) => live.filter((p) => set.includes(p));
    // The first kept panel alone always settles (capacity is >= 1).
    const mustKeep = [];
    for (const id of keepIds) {
        const p = live.find((q) => q.id === id);
        if (p && !mustKeep.includes(p) && settles(inRowOrder([...mustKeep, p])))
            mustKeep.push(p);
    }
    const candidates = live.filter((p) => !mustKeep.includes(p));
    // Parked first to last; the sort is stable, so equal ranks keep the tie-break's end first.
    const parkOrder = (tieBreak === 'rightmost' ? [...candidates].reverse() : [...candidates]).sort((a, b) => parkLevers(a).evictionRank - parkLevers(b).evictionRank);
    // Whether a set settles depends only on its size and its width sum, so the k narrowest candidates are the
    // cheapest k to keep: if they do not settle, no k do.
    let keep = candidates.length;
    while (keep > 0 && mustKeep.length + keep > 1 && !settles(inRowOrder([...mustKeep, ...narrowestFirst(candidates).slice(0, keep)])))
        keep--;
    const kept = [...mustKeep];
    const toPark = [];
    parkOrder.forEach((p, i) => {
        const stillToKeep = keep - (kept.length - mustKeep.length);
        const rest = parkOrder.slice(i + 1);
        // Park `p` only if what is left after it can still complete a set that settles.
        const canPark = toPark.length < candidates.length - keep && rest.length >= stillToKeep && settles(inRowOrder([...kept, ...narrowestFirst(rest).slice(0, stillToKeep)]));
        if (canPark)
            toPark.push(p.id);
        else
            kept.push(p);
    });
    return inRowOrder(toPark.map((id) => live.find((p) => p.id === id))).map((p) => p.id);
}
