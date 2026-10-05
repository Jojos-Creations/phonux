/**
 * The panel capacity machinery: how many live collapsible panels the row shows at once (`capacity`),
 * parking/revealing to stay at it, revive-with-demotion (`handleActivatePanel`), and the row gesture
 * (`scrollRow`) that brings a hidden panel back from either side. Every hide is a park (`live: false`,
 * never a removal) pushed onto `collapseOrderRef`, so `revealMostRecentlyCollapsed` keeps working
 * regardless of which path did the parking.
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GAP } from '../PanelRowSlot.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { panelWidthOf } from '../panelTiers.js';
import { effectiveMaxPanels, firstParkedAfter, lastParkedBefore, leftmostLiveIndex, farthestLiveCollapsibleId, movePanel, promoteToLive, rightmostLiveIndex, setFormFactor, sideOfLiveRange, } from '../panelWindow.js';
export function usePanelManager(panels, setPanels, storedMaxPanels, phoneWidth, containerWidth, 
/** How many always-rendered, non-webview columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
fixedColumnCount, rootId) {
    /** The live-collapsible ceiling for a row whose live set has these widths (row order). */
    const capacityFor = (liveWidths) => {
        // `containerWidth === 0` means unmeasured (the first commit, and every jsdom test that never calls
        // measure()): null means no cap and no reconcile, never "zero panels fit".
        const fitCount = containerWidth === 0
            ? null
            : fixedColumnCount + computeRowLayout({ containerWidth, phoneWidth, gap: GAP, fixedItemCount: fixedColumnCount, liveWidths }).maxLiveThatFit;
        const effectiveMax = effectiveMaxPanels(storedMaxPanels, fitCount, fixedColumnCount);
        // Floor of 1 keeps the panel just opened on screen even at the narrowest legal width (effectiveMaxPanels
        // already floors at fixedColumnCount + 1, so this bites only when the fixed columns alone reach effectiveMax).
        return effectiveMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, effectiveMax - fixedColumnCount);
    };
    // The same cap every other width reader passes, from the same row inputs.
    const maxLiveWidth = computeMaxLiveWidth({ containerWidth, phoneWidth, gap: GAP, fixedItemCount: fixedColumnCount });
    const widthOf = (p) => panelWidthOf(p, phoneWidth, maxLiveWidth);
    /** Whether `set` (live collapsible panels, row order) can stay live as it is: the one test both reconcile branches settle against. */
    const settles = (set) => set.length <= capacityFor(set.map(widthOf));
    const capacity = capacityFor(panels.filter((p) => p.collapsible && p.live).map(widthOf));
    /**
     * Parked ids in park order, most recent last. A ref, not state: only handlers and the reconcile effect below
     * read it, so a push or pop need not re-render.
     */
    const collapseOrderRef = useRef([]);
    /**
     * The panels the next capacity-reconcile DROP must keep live, in the order they were acted on: each one just
     * resized, opened or activated, so acting on a panel never parks it, and each of several actions in one
     * update keeps its own. The value is the array the action read: a reconcile still on it ran before the action.
     */
    const keepLiveRef = useRef(new Map());
    const markKeepLive = (id) => {
        keepLiveRef.current = new Map(keepLiveRef.current).set(id, panels);
    };
    const keptIds = () => new Set(keepLiveRef.current.keys());
    /** Tiers resizePanel queued on `seen` that have not reached `panels` yet, so a later action in the same handler can price them. */
    const pendingTiersRef = useRef({ seen: null, tiers: new Map() });
    /** `row` (read in this render) with those tiers applied. */
    const withPendingTiers = (row) => {
        const { seen, tiers } = pendingTiersRef.current;
        return seen === panels ? [...tiers].reduce((acc, [id, tier]) => setFormFactor(acc, id, tier), row) : row;
    };
    /** `next`, plus in the same update whatever the reconcile's DROP would park, so no committed row overflows. */
    const settledKeeping = (next, keep) => {
        const live = next.filter((p) => p.collapsible && p.live);
        if (settles(live))
            return next;
        const parked = new Set(fewestParksThatSettle(live, widthOf, settles, keep));
        return parked.size === 0 ? next : next.map((p) => (parked.has(p.id) ? { ...p, live: false } : p));
    };
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
        if (targetId === undefined || capacity === Number.POSITIVE_INFINITY) {
            setPanels(settledApply);
            return;
        }
        const targetIndex = afterInsert.findIndex((p) => p.id === targetId);
        const liveCollapsibleCountAfter = afterInsert.filter((p) => p.collapsible && p.live).length;
        const overCapacity = Math.max(0, liveCollapsibleCountAfter - capacity);
        if (overCapacity === 0) {
            setPanels(settledApply);
            return;
        }
        const toPark = [];
        const exempt = keptIds();
        let scratch = afterInsert;
        for (let i = 0; i < overCapacity; i++) {
            const id = farthestLiveCollapsibleId(scratch, targetIndex, exempt);
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
        pushCollapsed(toPark);
        const parkedSet = new Set(toPark);
        setPanels((current) => settledKeeping(apply(current).map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)), keep));
    };
    /**
     * Clicking ANY row -- live or parked alike -- activates it (promoteToLive's own doc
     * comment has the full "make/keep it live, preserve array order" spec).
     */
    const handleActivatePanel = (id) => {
        const target = panels.find((p) => p.id === id);
        if (!target || target.live)
            return;
        markKeepLive(id);
        const keep = [...keptIds()];
        // A manual History-row activation enters from the right (or by its own `anchoredEnter`), so it drops any
        // anchor-entry or gesture-side mark left from an earlier reveal of this id.
        forgetEnteringViaAnchor(id);
        clearEnterSide(id);
        const before = panels;
        const result = promoteToLive(panels, id, capacity, keptIds());
        if (!result)
            return;
        forgetCollapsed(id);
        const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
        if (!demoted) {
            // An updater, not `result`: `result` is built from this render's array and would drop an update queued
            // earlier in the same handler.
            setPanels((prev) => settledKeeping(promoteToLive(prev, id, Number.POSITIVE_INFINITY) ?? prev, keep));
            return;
        }
        if (sideOfLiveRange(before, demoted.id) === 'right')
            markExitRight(demoted.id);
        pushCollapsed([demoted.id]);
        // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
        // Infinity guarantees that for this call only), then the panel it displaces is parked.
        setPanels((prev) => promoteToLive(prev, id, Number.POSITIVE_INFINITY) ?? prev);
        setPanels((current) => settledKeeping(current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)), keep));
    };
    /** See `UsePanelManagerResult.scrollRow`'s own doc comment. */
    const scrollRow = (direction) => {
        const reveal = direction === 'right' ? firstParkedAfter(panels, rightmostLiveIndex(panels)) : lastParkedBefore(panels, leftmostLiveIndex(panels));
        if (!reveal)
            return;
        const kept = keptIds();
        markKeepLive(reveal.id);
        // A resize earlier in this handler is priced at its new tier, or the row committed below could overflow.
        const sized = withPendingTiers(panels);
        const live = sized.filter((p) => p.collapsible && p.live);
        const farFirst = (direction === 'right' ? live : [...live].reverse()).filter((p) => !kept.has(p.id));
        const toPark = new Set();
        const rowAfter = () => sized.filter((p) => p.collapsible && (p.live || p.id === reveal.id) && !toPark.has(p.id));
        // At least the one panel the gesture swaps out, then more only while the row with `reveal` would not settle.
        for (const p of farFirst) {
            if (toPark.size > 0 && settles(rowAfter()))
                break;
            toPark.add(p.id);
        }
        setEnterSide(reveal.id, direction);
        // A leftward gesture parks off the RIGHT edge: mark those BEFORE the setPanels below, in their own commit.
        if (direction === 'left' && toPark.size > 0)
            flushOwn(() => setExitRightIds((prev) => new Set([...prev, ...toPark])));
        pushCollapsed([...toPark]);
        forgetCollapsed(reveal.id);
        setPanels((prev) => prev.map((p) => (toPark.has(p.id) ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p)));
    };
    /** See `UsePanelManagerResult.reorderPanel`'s own doc comment. */
    const reorderPanel = (id, direction) => {
        setPanels((prev) => movePanel(prev, id, direction, rootId));
    };
    /** See `UsePanelManagerResult.resizePanel`'s own doc comment. */
    const resizePanel = (id, next) => {
        if (setFormFactor(panels, id, next) === panels)
            return false;
        const wasLive = panels.find((p) => p.id === id)?.live === true;
        markKeepLive(id);
        const keep = [...keptIds()];
        const pending = pendingTiersRef.current.seen === panels ? pendingTiersRef.current.tiers : [];
        pendingTiersRef.current = { seen: panels, tiers: new Map(pending).set(id, next) };
        if (wasLive) {
            purgeExitRight(id);
            forgetCollapsed(id);
        }
        setPanels((prev) => {
            const resized = setFormFactor(prev, id, next);
            // An earlier call in this same handler may have queued a park of it (its exit mark and stack entry are
            // dropped above): a resize never parks its own panel, so that park is cancelled before anything commits.
            const own = wasLive && resized.some((p) => p.id === id && !p.live) ? resized.map((p) => (p.id === id ? { ...p, live: true } : p)) : resized;
            return settledKeeping(own, keep);
        });
        return true;
    };
    /**
     * Reconciles the live set against `capacity` whenever either changes -- an effect, since it must act on a
     * measurement that just changed, not one this render was given. Both branches judge a candidate set by `settles`,
     * never `capacity` as a count: `capacity` prices every not-yet-live slot at `phoneWidth`, so WHICH panels park or
     * return decides whether the rest fits, and a set that does not settle re-triggers a branch next render. A DROP
     * parks `fewestParksThatSettle` and exits 'left' (flushSync cannot mark a right exit first from a passive effect).
     * A RISE reveals from the top of `collapseOrderRef`; one that doesn't settle stays on the stack for an OLDER, narrower one.
     */
    const committedRef = useRef(panels);
    useEffect(() => {
        // `settledKeeping` parks inside a state update, where no call-time code sees which panels it chose: the
        // stack learns of any park not already on it from the commit itself.
        const before = committedRef.current;
        committedRef.current = panels;
        const unrecorded = panels.filter((p) => p.collapsible && !p.live && !collapseOrderRef.current.includes(p.id) && before.some((q) => q.id === p.id && q.live));
        if (unrecorded.length > 0)
            pushCollapsed(unrecorded.map((p) => p.id));
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
        const live = panels.filter((p) => p.collapsible && p.live);
        if (live.length > capacity) {
            const toPark = fewestParksThatSettle(live, widthOf, settles, keepIds);
            if (toPark.length === 0)
                return;
            pushCollapsed(toPark);
            const parkedSet = new Set(toPark);
            setPanels((current) => current.map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)));
        }
        else if (live.length < capacity && collapseOrderRef.current.length > 0) {
            const stack = collapseOrderRef.current;
            const revealed = new Set();
            const remaining = [];
            for (let i = stack.length - 1; i >= 0; i--) {
                const id = stack[i];
                const candidate = panels.find((p) => p.id === id);
                if (!candidate || candidate.live)
                    continue; // stale entry (closed, or already live some other way) -- drop it
                if (settles(panels.filter((p) => p.collapsible && (p.live || revealed.has(p.id) || p.id === id))))
                    revealed.add(id);
                else
                    remaining.unshift(id);
            }
            if (revealed.size === 0)
                return;
            collapseOrderRef.current = remaining;
            for (const id of revealed)
                setEnterSide(id, sideOfLiveRange(panels, id));
            setPanels((current) => current.map((p) => (revealed.has(p.id) ? { ...p, live: true } : p)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [capacity, panels]);
    /** See `UsePanelManagerResult.revealMostRecentlyCollapsed`'s own doc comment for the full contract. */
    const revealMostRecentlyCollapsed = (panelsAfterClose) => {
        // Priced like scrollRow: a resize earlier in this handler is not in `panelsAfterClose` yet.
        const sized = withPendingTiers(panelsAfterClose);
        const stack = collapseOrderRef.current;
        const remaining = [];
        let candidateId = null;
        for (let i = stack.length - 1; i >= 0; i--) {
            const id = stack[i];
            const candidate = panelsAfterClose.find((p) => p.id === id);
            if (!candidate || candidate.live)
                continue; // stale entry (closed, or already live some other way) -- drop it
            if (candidateId === null && settles(sized.filter((p) => p.collapsible && (p.live || p.id === id))))
                candidateId = id;
            else
                remaining.unshift(id);
        }
        collapseOrderRef.current = remaining;
        if (candidateId === null)
            return;
        const revealId = candidateId;
        // Clear before marking, as `clearEnterSide`'s contract requires: a stale explicit side would win over the anchor.
        clearEnterSide(revealId);
        // One of the two "reappearance" paths that enter from the anchor's side -- mark it BEFORE the setPanels
        // call below; no flushSync, since the mark only has to be in the commit that mounts the slot.
        markEnteringViaAnchor(revealId);
        setPanels((current) => promoteToLive(current, revealId, Number.POSITIVE_INFINITY) ?? current);
    };
    return {
        revealPanelProactively,
        handleActivatePanel,
        forgetCollapsed,
        revealMostRecentlyCollapsed,
        enteringViaAnchorIds: enteringViaAnchorRef.current,
        markEnteringViaAnchor,
        clearEnterSide,
        scrollRow,
        reorderPanel,
        resizePanel,
        enterSideById: enterSideRef.current,
        exitRightIds,
    };
}
/**
 * The ids (row order) to park so the live panels left settle: as FEW as possible, and among equally few the
 * LEFTMOST -- so a row of equal widths parks exactly its leftmost excess, and a wide panel parks alone when
 * that is what leaves the most panels live. Each of `keepIds` (in the order they were acted on) is never
 * parked, whatever that costs the others, unless the ones before it already fill the row.
 */
function fewestParksThatSettle(live, widthOf, settles, keepIds = []) {
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
    // Whether a set settles depends only on its size and its width sum, so the k narrowest candidates are the
    // cheapest k to keep: if they do not settle, no k do.
    let keep = candidates.length;
    while (keep > 0 && mustKeep.length + keep > 1 && !settles(inRowOrder([...mustKeep, ...narrowestFirst(candidates).slice(0, keep)])))
        keep--;
    const kept = [...mustKeep];
    const toPark = [];
    candidates.forEach((p, i) => {
        const stillToKeep = keep - (kept.length - mustKeep.length);
        const rest = candidates.slice(i + 1);
        // Park `p` only if what is left to its right can still complete a set that settles.
        const canPark = toPark.length < candidates.length - keep && rest.length >= stillToKeep && settles(inRowOrder([...kept, ...narrowestFirst(rest).slice(0, stillToKeep)]));
        if (canPark)
            toPark.push(p.id);
        else
            kept.push(p);
    });
    return toPark;
}
