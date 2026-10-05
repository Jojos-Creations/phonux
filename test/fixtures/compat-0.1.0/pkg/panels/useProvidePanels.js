/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */
import { useEffect, useRef, useState } from 'react';
import { GAP } from '../PanelRowSlot.js';
import { computeMaxLiveWidth } from '../panelRowLayout.js';
import { summarisePanel } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger } from '../snapshots.js';
import { appendPanel, reanchorPanel } from '../panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';
import { useWorkspacePersistence } from './useWorkspacePersistence.js';
/** Ids for panels this app creates itself. A module counter, bumped only from event handlers and the restore callback (never from a state initialiser or updater), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;
const freshId = () => String(nextWindowId++);
/**
 * Duck-typed (a `preventDefault` function): a bare `onClick={panels.create}` reference passes the click
 * event positionally, so this discards it rather than spreading `view` into the new panel (see DESIGN.md).
 */
function isEventLike(value) {
    return typeof value === 'object' && value !== null && typeof value.preventDefault === 'function';
}
/**
 * Builds the `PanelsAPI` an app hands its views. The provider owns the panel list, seeded once from `initialEntries`.
 * Call it with this render's inputs and never memoise the result: its handlers close over this render's list.
 * @public
 */
export function useProvidePanels(i) {
    const capture = i.capture ?? noopCaptureTrigger;
    const [panels, setPanels] = useState(() => [...(i.initialEntries ?? [])]);
    const fixedViewCount = i.fixedViewCount ?? panels.filter((p) => !p.collapsible).length;
    // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
    const maxLiveWidth = computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: GAP, fixedItemCount: fixedViewCount });
    const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth));
    const { revealPanelProactively, handleActivatePanel, forgetCollapsed, revealMostRecentlyCollapsed, enteringViaAnchorIds, markEnteringViaAnchor, clearEnterSide, scrollRow, reorderPanel, resizePanel, enterSideById, exitRightIds, } = usePanelManager(panels, setPanels, i.storedMaxPanels, i.phoneWidth, i.containerWidth, fixedViewCount, i.rootId);
    // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
    useRowScrollGesture(i.overflowContainerRef, scrollRow);
    useWorkspacePersistence({ storage: i.storage, panels, setPanels, rootId: i.rootId, freshId, defaultHostData: i.defaultHostData });
    // Diffs the one list instead of capturing per call site: usePanelManager parks from several sites with no single
    // "on park" hook, and a per-site call would silently miss any site not touched.
    const prevLiveRef = useRef(new Map());
    useEffect(() => {
        const prev = prevLiveRef.current;
        for (const p of panels) {
            if (prev.get(p.id) === true && !p.live)
                capture.capture(p.id);
        }
        prevLiveRef.current = new Map(panels.map((p) => [p.id, p.live]));
    }, [panels, capture]);
    // clearAll only records ids here: React may run its updater during render, where evict would notify other components.
    const clearedIds = useRef(new Set());
    useEffect(() => {
        for (const id of clearedIds.current)
            capture.evict(id);
        clearedIds.current.clear();
    }, [panels, capture]);
    // After usePanelManager: undo makes room for a live view through its revealPanelProactively. `onAfterClose`
    // forgets the closed id (it may have been parked), then offers the freed room to the most recently parked panel.
    const closing = usePanelClosing(panels, setPanels, revealPanelProactively, i.rootId, (id, remaining) => {
        forgetCollapsed(id);
        revealMostRecentlyCollapsed(remaining);
    }, 
    // A restored LIVE panel can carry a stale gesture-enter-side/exit-right mark from an earlier park of
    // the same id; clear it before marking entering-via-anchor (usePanelManager's own clear-then-mark order).
    (id) => {
        clearEnterSide(id);
        markEnteringViaAnchor(id);
    }, 
    // A closed-and-not-restored panel's picture must not outlive its undo window; usePanelClosing.ts alone
    // knows which ids the window's NATURAL elapse (never Undo) just finalized.
    (ids) => {
        for (const id of ids)
            capture.evict(id);
    }, i.onPanelsClosed, i.onPanelsRestored, i.resetHostDataOnRestore);
    const api = {
        // `listed` excludes History: it must not list itself (a host's history column renders every entry here as a
        // clickable row).
        panelList: panels.filter((p) => p.listed).map(summarisePanel),
        create: (options) => {
            // `options` is explicitly optional here (not left to infer from `create`'s own overloaded interface
            // member) -- an implementation inferred as requiring it would no longer satisfy the zero-arg overload.
            const safeOptions = isEventLike(options) ? undefined : options;
            const id = freshId();
            // Built here, outside the updater below: React may run an updater twice, and the host's builder is not required to be pure.
            const hostData = i.defaultHostData?.();
            // "Panel N", not "about:blank": every panel needs a distinguishable title, for testing. options?.title
            // overrides it; the explicit `title:` below (after the spread) is what makes that override win either way.
            revealPanelProactively(panels, (prev) => appendPanel(prev, { url: 'about:blank', hostData, ...safeOptions, title: safeOptions?.title ?? `Panel ${id}` }, id, i.rootId));
        },
        activate: handleActivatePanel,
        move: reorderPanel,
        setFormFactor: (id, next) => {
            if (resizePanel(id, next))
                i.onPanelResize?.();
        },
        // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
        // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
        reanchor: (id, anchor) => setPanels((prev) => reanchorPanel(prev, id, anchor, i.rootId)),
        close: (id) => {
            // Fires on every close() call, even an unknown or locked id's no-op below: a harmless extra attempt,
            // and gating it exactly would need a second callback into usePanelClosing.ts.
            capture.capture(id);
            closing.close(id);
        },
        recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
        undoClose: closing.undoClose,
        // Drops every collapsible panel, never History (the always-shown column). Its picture goes now, not at an undo
        // window: a dropped panel can never be shown again. The ids come from the updater's own list, because this
        // render's `panels` misses a panel created earlier in the same batch.
        clearAll: () => setPanels((prev) => {
            for (const p of prev)
                if (p.collapsible)
                    clearedIds.current.add(p.id);
            return prev.filter((p) => !p.collapsible);
        }),
        entries: panels,
        fixedViewCount,
        liveWidths,
        maxLiveWidth,
        closingIds: closing.closingIds,
        enteringViaAnchorIds,
        exitRightIds,
        enterSideById,
    };
    // Test-only hook: a host's end-to-end tests reach the API here, since no production UI calls create({ permanent })
    // or reanchor(). Gated on MODE 'test', which only a host's test build sets. An effect with no deps array, not a
    // render-body assignment: StrictMode double-invokes render bodies, and a test must always reach the LATEST closure.
    useEffect(() => {
        // Structural cast: the package builds without Vite's ambient types, so `import.meta.env` is untyped here.
        const mode = import.meta.env?.MODE;
        if (typeof window === 'undefined' || mode !== 'test')
            return;
        window.__panelsApiForTests = api;
    });
    return api;
}
