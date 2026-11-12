import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The workspace shell: the scroll container that holds the centered, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centering math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */
import * as React from 'react';
import { motion, useReducedMotionConfig, visualElementStore } from 'motion/react';
import Box from '@mui/material/Box';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import { LandingContext, PhoneSizeContext, useRowHeightBudget, useWindowJump } from './phoneFit.js';
import { RowHeightContext } from './panelTuning.js';
import { bindingOf } from './workspaceCore.js';
import { ChromeStoreContext, createChromeStore, isPanelPress } from './panelChrome.js';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { focusEdgePanel, registerRowKeys } from './rowStep.js';
import { AwayContext, createAwayStore } from './panelAway.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { ROW_GAP, ROW_LAYER_Z } from './rowConstants.js';
import { OverlaySlot } from './windowOverlay.js';
import { ROW_ENGINE_ATTRIBUTE, ROW_NEAR_SLOTS, RowNearContext } from './emblaRow.js';
/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export function workspaceShellStyle(i) {
    // Calculated from known widths, never measured off the DOM. `fixedColumnCount` and `liveWidths` must come
    // from the same array the row's JSX renders (see computeRowLayout's own doc comment for why).
    const marginLeft = i.rowNumbers !== undefined
        ? i.rowNumbers.rowMarginLeft
        : computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap ?? ROW_GAP, fixedItemCount: i.fixedColumnCount, liveWidths: i.liveWidths }).computedRowMarginLeft;
    const scrolls = i.rowNumbers?.rowScroll ?? i.rowScroll ?? false;
    // The margin snaps while stops exist, or the scrollable width would be short of where a stop sits. A panel resize glides anyway,
    // even inside the settle window: a grow that overflows the window adds its stops in the render that moves the margin, and a
    // snap there jumps every panel.
    const hasStops = i.rowNumbers !== undefined && i.rowNumbers.stops.length > 0;
    const glides = i.panelResizing === true || (i.rowResizeSettled && !hasStops);
    return {
        marginLeft,
        transition: glides ? (i.slide === undefined ? PANEL_TRANSITION : slideToTransition(i.slide)) : { duration: 0 },
        overflowX: 'hidden',
        hideScrollbar: scrolls,
    };
}
/** Whether a panel present in both has a different width in `after`: a resize, not a panel coming or going. */
function panelWidthChanged(before, after) {
    if (before === undefined || after === undefined)
        return false;
    return after.ids.some((id, k) => {
        const was = before.ids.indexOf(id);
        return was >= 0 && before.widths[was] !== after.widths[k];
    });
}
/** How long the container width must hold still before the row's margin glides again: `slides` slide durations. @internal */
export function resizeSettleDelayMs(slide, slides) {
    return Math.round(slide.durationSec * slides * 1000);
}
/**
 * Whether `width` has held still for `delayMs`; true at once when `instant`. The mount counts as a change, so a width change
 * inside the settle period snaps; one that comes after a full settle period of stillness glides from its first render.
 * @internal
 */
export function useResizeSettled(width, delayMs, instant) {
    const [confirmed, setConfirmed] = React.useState(width);
    const [seen, setSeen] = React.useState(width);
    const [settling, setSettling] = React.useState(true);
    if (width !== seen) {
        setSeen(width);
        if (!settling)
            setConfirmed(width);
        setSettling(true);
    }
    React.useEffect(() => {
        if (instant)
            return setConfirmed(width);
        const timer = setTimeout(() => {
            setSettling(false);
            setConfirmed(width);
        }, delayMs);
        return () => clearTimeout(timer);
    }, [width, delayMs, instant]);
    return instant || confirmed === width;
}
/** A subscription that never fires, for a shell given no workspace. */
const NO_SUBSCRIPTION = () => () => { };
/** Clipped, not display: none, which would hide the live region from a screen reader. Pixel strings, because in `sx` a bare 1 is 100% and a bare -1 is a spacing unit, which would give a host's scroller a box to scroll. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
/**
 * The workspace shell: a scroll container holding the centered, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props) {
    const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, phoneHeight, heightBudget, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, bottomPadding, workspace, beforeRow, children, rowNearSlots = ROW_NEAR_SLOTS, ...rest } = props;
    const binding = workspace === undefined ? undefined : bindingOf(workspace);
    const resolved = React.useSyncExternalStore(binding?.subscribe ?? NO_SUBSCRIPTION, () => binding?.tuning ?? LIBRARY_TUNING_DEFAULTS, () => binding?.tuning ?? LIBRARY_TUNING_DEFAULTS);
    const gap = resolved.rowGap;
    const [chromeStore] = React.useState(createChromeStore);
    const [awayStore] = React.useState(createAwayStore);
    const reduced = useReducedMotionConfig() === true;
    const labels = resolveLabels(useOptionalHost()?.labels);
    // A new element per message, so the same words said twice are announced twice.
    const [said, setSaid] = React.useState({ n: 0, text: '' });
    const announce = React.useCallback((text) => setSaid((prev) => ({ n: prev.n + 1, text })), []);
    const derived = useResizeSettled(containerWidth, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides), reduced);
    // Unmeasured until the container has a width: the first measurement is the commit that lands the fitted size.
    const [firstLanding, setLanding] = React.useState(containerWidth === 0);
    React.useLayoutEffect(() => {
        if (firstLanding && containerWidth > 0)
            setLanding(false);
    }, [firstLanding, containerWidth]);
    // What the last commit drew. A window step moves the row with no animation; any other change past the first measurement glides.
    const drawn = React.useRef({ numbers: rowNumbers, containerWidth, heightBudget });
    const windowStep = drawn.current.containerWidth !== containerWidth || drawn.current.heightBudget !== heightBudget;
    // The window moved the root aside or back: only that flips a measured row between scrolling and not. A slide there would cut the wide panel.
    const windowMovedRoot = windowStep && drawn.current.containerWidth !== 0 && drawn.current.numbers !== undefined && rowNumbers !== undefined && drawn.current.numbers.rowScroll !== rowNumbers.rowScroll;
    // A window jump lands the same way: the new size and panel count in one commit, nothing sliding or growing to reach them.
    const landing = useWindowJump(containerWidth, heightBudget ?? 0, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides)) || firstLanding || windowMovedRoot;
    // A margin glide from where the row stands would draw the strip past the narrower window's edge for as long as it ran.
    const marginWouldCut = windowStep && rowNumbers !== undefined && drawn.current.numbers !== undefined && drawn.current.numbers.rowMarginLeft + rowNumbers.stripWidth > rowNumbers.windowWidth + 0.5;
    const rowResizeSettled = (given ?? (heightBudget === undefined ? derived : !landing && !windowStep)) && !marginWouldCut;
    // A panel being resized by hand: its width change glides the margin.
    const resizingId = React.useSyncExternalStore(chromeStore.subscribeResizing, chromeStore.resizing, () => null);
    // A press outside every panel leaves none in use: keystrokes stop going to the panel that had focus. Read in the bubble
    // phase on the window, after every slot has marked its own presses.
    React.useEffect(() => {
        const container = overflowContainerRef.current;
        if (container === null)
            return undefined;
        const onPress = (event) => {
            if (isPanelPress(event))
                return;
            chromeStore.setActive(null);
            const focused = container.ownerDocument.activeElement;
            if (focused instanceof HTMLElement && container.contains(focused) && focused.closest('[data-row-slot]') !== null)
                focused.blur();
            // The dot bar moves the row, and a move rests no panel: a wide one slides past at its width.
            if (!(event.target instanceof Element && event.target.closest('[data-dot-bar],[data-row-nav]') !== null))
                binding?.blur();
        };
        const view = container.ownerDocument.defaultView ?? window;
        view.addEventListener('pointerdown', onPress);
        return () => view.removeEventListener('pointerdown', onPress);
    }, [overflowContainerRef, chromeStore, binding]);
    // A bare arrow while the panel in use is out of view focuses the panel at the view's far edge instead of stepping. Capture, so
    // the row's own listener sees the key taken.
    React.useEffect(() => {
        const container = overflowContainerRef.current;
        if (container === null)
            return undefined;
        const edge = (direction, target) => focusEdgePanel(container, chromeStore.active(), direction, target);
        const onKey = (event) => {
            if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || arrowKeyBelongsElsewhere(event, container.ownerDocument))
                return;
            if (container.closest('[inert]') !== null)
                return;
            if (edge(event.key === 'ArrowLeft' ? 'left' : 'right', event.target))
                event.preventDefault();
        };
        const view = container.ownerDocument.defaultView ?? window;
        view.addEventListener('keydown', onKey, true);
        const unregister = registerRowKeys(container, { edge });
        return () => {
            view.removeEventListener('keydown', onKey, true);
            unregister();
        };
    }, [overflowContainerRef, chromeStore]);
    // A panel whose width differs from the last commit's under the same container width was resized on purpose; a window resize moves
    // the container width too and keeps its snap.
    const panelResizing = resizingId !== null || (drawn.current.containerWidth === containerWidth && panelWidthChanged(drawn.current.numbers, rowNumbers));
    React.useLayoutEffect(() => {
        drawn.current = { numbers: rowNumbers, containerWidth, heightBudget };
    });
    const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
    const phoneSize = React.useMemo(() => (phoneHeight === undefined ? undefined : { width: phoneWidth, height: phoneHeight }), [phoneWidth, phoneHeight]);
    const style = workspaceShellStyle({ containerWidth, rowResizeSettled, panelResizing, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
    // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) applies no height limit.
    const topPad = rowTopReservePx(topPadding, resolved.rowTop, gap);
    const bottomPad = rowBottomReservePx(gap, bottomPadding, resolved.chrome.where);
    // A settled budget stands in for the measured one, so a panel that fills the row's height grows in the same glide.
    const measuredHeight = useRowHeightBudget(overflowContainerRef, topPad, bottomPad, heightBudget === undefined);
    const availableHeight = heightBudget ?? measuredHeight;
    // Where auto margins would center the row in its room, written out so it can glide: a flex item's auto margins are 0 once it overflows.
    const marginTop = heightBudget === undefined || phoneHeight === undefined || heightBudget === 0 ? undefined : Math.max(0, (heightBudget - phoneHeight) / 2);
    // Motion writes even an instant change on a later frame: a window step's top margin is set on Motion's own value and written
    // here, so the paint after the step has it. The left margin is the row scroller's, which draws an instant change at once.
    React.useLayoutEffect(() => {
        const strip = rowRef.current;
        if (!windowStep || strip === null || marginTop === undefined)
            return;
        const values = visualElementStore.get(strip);
        values?.getValue('marginTop')?.jump(marginTop);
        strip.style.marginTop = `${marginTop}px`;
    });
    // Each edge element is a plain spacer as wide as its group, so the strip starts after the left one and ends before the right one.
    // The held panels themselves sit in the strip and are positioned by the row's drawing pass (rowDraw.ts), so these hold no content.
    // An edge element exists only while a panel is held there, so a row that holds nothing renders exactly as it did.
    const holdsLeft = rowNumbers?.held.some((h) => h.side === 'left') === true;
    const holdsRight = rowNumbers?.held.some((h) => h.side === 'right') === true;
    const leftEdgeStyle = { width: `${rowNumbers?.leftInset ?? 0}px`, flexShrink: 0 };
    const rightEdgeStyle = { width: `${rowNumbers?.rightInset ?? 0}px`, flexShrink: 0 };
    return (_jsx(AnnounceContext.Provider, { value: announce, children: _jsx(PhoneSizeContext.Provider, { value: phoneSize, children: _jsx(LandingContext.Provider, { value: landing, children: _jsx(ChromeStoreContext.Provider, { value: chromeStore, children: _jsxs(AwayContext.Provider, { value: awayStore, children: [_jsx(RowHeightContext.Provider, { value: availableHeight, children: _jsxs(Box, { ref: overflowContainerRef, role: "region", "aria-label": labels.row, ...rest, "data-row-scroller": "", [ROW_ENGINE_ATTRIBUTE]: 'embla', sx: {
                                        position: 'relative',
                                        display: 'flex',
                                        // The row sits inside the device's top and bottom safe areas. The inset is a margin, not padding, so the box the row
                                        // measures for its height shrinks by it. env() is 0 unless the page's viewport meta sets viewport-fit=cover.
                                        marginTop: 'env(safe-area-inset-top, 0px)',
                                        height: 'calc(100% - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
                                        minHeight: 0,
                                        pt: `${topPad}px`,
                                        pb: `${bottomPad}px`,
                                        pl: `${gap}px`,
                                        pr: `${gap}px`,
                                        overflowX: style.overflowX,
                                        // The row never scrolls vertically: a panel scrolls its own content, and a wheel over the row must not move it off its workspace.
                                        overflowY: 'hidden',
                                        ...(style.hideScrollbar ? { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } } : {}),
                                        // A sideways swipe at the row's end must not chain to the page, where a browser reads it as back or forward.
                                        ...(scrolls ? { overscrollBehaviorX: 'none' } : {}),
                                    }, children: [beforeRow, _jsx(OverlaySlot, { name: "dialog" }), holdsLeft ? _jsx("div", { "data-row-edge": "left", style: leftEdgeStyle }) : null, _jsx("div", { style: { display: 'flex', flex: '1 1 auto', minWidth: 0, justifyContent: 'center', zIndex: ROW_LAYER_Z.BASE }, children: _jsx(motion.div, { ref: rowRef, "data-row-embla-strip": "", style: { display: 'flex', gap: `${gap}px`, position: 'relative', zIndex: ROW_LAYER_Z.BASE, ...(marginTop === undefined ? { marginTop: 'auto' } : {}), marginBottom: 'auto', ...(scrolls ? { flexShrink: 0 } : {}) }, animate: marginTop === undefined ? {} : { marginTop }, transition: reduced || !rowResizeSettled ? { duration: 0 } : slideToTransition(resolved.slide), children: _jsx(RowNearContext.Provider, { value: rowNearSlots, children: children }) }) }), holdsRight ? _jsx("div", { "data-row-edge": "right", style: rightEdgeStyle }) : null] }) }), _jsx(Box, { role: "status", "aria-live": "polite", "aria-atomic": "true", "data-workspace-announcer": "", sx: VISUALLY_HIDDEN, children: _jsx("span", { children: said.text }, said.n) }), _jsx(OverlaySlot, { name: "toast" })] }) }) }) }) }));
}
