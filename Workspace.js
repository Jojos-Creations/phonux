import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */
import * as React from 'react';
import { motion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import { LandingContext, PhoneSizeContext, useRowHeightBudget } from './phoneFit.js';
import { RowHeightContext } from './panelTuning.js';
import { bindingOf } from './workspaceCore.js';
import { ChromeStoreContext, createChromeStore, isPanelPress } from './panelChrome.js';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { focusEdgePanel, registerRowKeys } from './rowStep.js';
import { AwayContext, createAwayStore } from './panelAway.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { ROW_GAP } from './rowConstants.js';
import { maxScrollOf, nearestStop, scrollHoldingEdge, snapToStop } from './rowNumbers.js';
import { isQuietly } from './quietMove.js';
import { rowScrollerFor } from './rowScroller.js';
import { OverlaySlot } from './windowOverlay.js';
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
// Browsers round layout to fractions of a pixel, so a slot flush with the window edge can read a hair over it.
const EDGE_TOLERANCE_PX = 1;
/** True when `next` places or sizes a drawn entry differently from `prev`. */
function slotsMoved(prev, next) {
    if (prev.rowMarginLeft !== next.rowMarginLeft || prev.ids.length !== next.ids.length)
        return true;
    return next.ids.some((id, k) => id !== prev.ids[k] || next.leftOffsets[k] !== prev.leftOffsets[k] || next.widths[k] !== prev.widths[k]);
}
/** A subscription that never fires, for a shell given no workspace. */
const NO_SUBSCRIPTION = () => () => { };
/** Clipped, not display: none, which would hide the live region from a screen reader. Pixel strings, because in `sx` a bare 1 is 100% and a bare -1 is a spacing unit, which would give a host's scroller a box to scroll. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props) {
    const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, phoneHeight, heightBudget, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, workspace, beforeRow, children, ...rest } = props;
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
    const [landing, setLanding] = React.useState(containerWidth === 0);
    React.useLayoutEffect(() => {
        if (landing && containerWidth > 0)
            setLanding(false);
    }, [landing, containerWidth]);
    // A settled budget means the width is settled too: past the first measurement every change glides.
    const rowResizeSettled = given ?? (heightBudget === undefined ? derived : !landing);
    // A panel being resized by hand holds the row where it is: its strip changes under the pointer, and a settle onto the
    // nearest stop would scroll the row while the person drags. The release settles once.
    const resizingId = React.useSyncExternalStore(chromeStore.subscribeResizing, chromeStore.resizing, () => null);
    const numbersRef = React.useRef(rowNumbers);
    numbersRef.current = rowNumbers;
    // The release settles after the numbers carry the new slot count: it waits for them, or one frame, while the claim is held.
    const settle = React.useRef(null);
    const settleTimer = React.useRef(undefined);
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        if (resizingId === null || container === null)
            return undefined;
        const scroller = rowScrollerFor(container);
        const claim = scroller.claim({ replayScroll: true });
        // Where the panel's edges are in the window now, read from the element once the claim has stopped any glide: the numbers
        // can be ahead of what is drawn (a margin or a slide still gliding, a panel drawn shrunk).
        const slot = container.querySelector(`[data-row-id="${resizingId}"]`);
        const rect = slot?.getBoundingClientRect();
        const pad = Number.parseFloat(getComputedStyle(container).paddingLeft) || 0;
        const left = rect === undefined || rect.width === 0 ? null : rect.left - container.getBoundingClientRect().left - pad;
        const edges = rect === undefined || left === null ? null : { start: left, end: left + rect.width };
        const began = numbersRef.current;
        const width = (n) => n?.widths[n.ids.indexOf(resizingId)];
        // The pin is latched while it is drawn: the host clears the width before it ends the mark.
        let pin = null;
        const unsubscribe = chromeStore.subscribeDrawn(() => {
            const drawn = chromeStore.drawn();
            if (drawn !== null)
                pin = drawn.pin;
        });
        return () => {
            unsubscribe();
            const run = () => {
                settle.current = null;
                claim?.release();
                scroller.setSettling(false);
                const n = numbersRef.current;
                if (claim === null || n === undefined || n.stops.length === 0) {
                    scroller.replayDeferred();
                    return;
                }
                const held = pin === null || edges === null ? scroller.scrollLeft() : scrollHoldingEdge(n, n.ids.indexOf(resizingId), pin, edges[pin], scroller.scrollLeft());
                // The settle lands first; a scroll the claim kept is replayed after it, so it overrides the settle.
                const glide = (from) => {
                    const to = nearestStop(from, held);
                    if (Math.abs(to - scroller.scrollLeft()) >= 0.5)
                        scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
                    scroller.replayDeferred();
                };
                clearTimeout(settleTimer.current);
                if (reduced || n.rowMarginLeft === began?.rowMarginLeft) {
                    glide(n);
                    return;
                }
                // The margin glides to the release's numbers first: a scroll glide beside it moves every panel by both, and the scrollable width is
                // short of the target until the margin lands. Whoever moves the row during that wait has chosen where it rests, so the settle only
                // runs for a row nobody asked to move or moved, onto the stops the row has by then. A step the row refuses (at either end)
                // moves nothing, so it is counted as an ask of its own.
                const releasedAt = scroller.scrollLeft();
                const asked = scroller.inputs();
                scroller.setSettling(true);
                settleTimer.current = setTimeout(() => {
                    scroller.setSettling(false);
                    const now = numbersRef.current;
                    if (now === undefined || now.stops.length === 0 || scroller.inputs() !== asked)
                        return scroller.replayDeferred();
                    if (Math.abs((scroller.glideTarget() ?? scroller.scrollLeft()) - releasedAt) >= 0.5)
                        return scroller.replayDeferred();
                    glide(now);
                }, resolved.slide.durationSec * 1000);
            };
            if (width(numbersRef.current) !== width(began) || pin === null)
                return run();
            const pending = { run, grown: () => width(numbersRef.current) !== width(began) };
            settle.current = pending;
            requestAnimationFrame(() => settle.current === pending && run());
        };
    }, [resizingId, overflowContainerRef]);
    React.useLayoutEffect(() => {
        if (resizingId === null && settle.current?.grown() === true)
            settle.current.run();
    }, [rowNumbers, resizingId]);
    React.useLayoutEffect(() => () => {
        settle.current?.run();
        clearTimeout(settleTimer.current);
    }, []);
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
    // A press on the row is a person choosing where it rests, even if it moves nothing.
    React.useEffect(() => {
        const container = overflowContainerRef.current;
        if (container === null)
            return undefined;
        const note = () => rowScrollerFor(container).noteInput();
        container.addEventListener('pointerdown', note, { passive: true });
        return () => container.removeEventListener('pointerdown', note);
    }, [overflowContainerRef]);
    // What the last commit drew. A panel whose width differs from it under the same container width was resized on purpose; a window
    // resize moves the container width too and keeps its snap.
    const drawn = React.useRef({ numbers: rowNumbers, containerWidth });
    const panelResizing = resizingId !== null || (drawn.current.containerWidth === containerWidth && panelWidthChanged(drawn.current.numbers, rowNumbers));
    React.useLayoutEffect(() => {
        drawn.current = { numbers: rowNumbers, containerWidth };
    });
    const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
    const phoneSize = React.useMemo(() => (phoneHeight === undefined ? undefined : { width: phoneWidth, height: phoneHeight }), [phoneWidth, phoneHeight]);
    const style = workspaceShellStyle({ containerWidth, rowResizeSettled, panelResizing, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
    // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) applies no height limit.
    const topPad = rowTopReservePx(topPadding, resolved.rowTop, gap);
    const bottomPad = rowBottomReservePx(gap);
    // A settled budget stands in for the measured one, so a panel that fills the row's height grows in the same glide.
    const measuredHeight = useRowHeightBudget(overflowContainerRef, topPad, bottomPad, heightBudget === undefined);
    const availableHeight = heightBudget ?? measuredHeight;
    // Where auto margins would centre the row in its room, written out so it can glide: a flex item's auto margins are 0 once it overflows.
    const marginTop = heightBudget === undefined || phoneHeight === undefined || heightBudget === 0 ? undefined : Math.max(0, (heightBudget - phoneHeight) / 2);
    // A row that stops scrolling must not keep the offset it had: the margin that centres it assumes the strip starts at 0.
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        if (scrolls || container === null || container.scrollLeft === 0)
            return;
        const scroller = rowScrollerFor(container);
        scroller.stop();
        scroller.glideTo(0, { durationSec: 0, instant: true, ease: resolved.slide.glideEase });
    }, [scrolls, overflowContainerRef]);
    // While the window has resized and the row has not yet taken the new width, the row holds still where it was drawn.
    const settledWidthRef = React.useRef(containerWidth);
    settledWidthRef.current = containerWidth;
    const holding = (container) => heightBudget !== undefined && Math.abs(container.clientWidth - settledWidthRef.current) > EDGE_TOLERANCE_PX;
    // A close, reopen or move slides slots without moving scrollLeft, so the row counts as moving until that slide has landed.
    const slideRef = React.useRef({ numbers: rowNumbers, endsAt: 0 });
    if (rowNumbers !== undefined && slideRef.current.numbers !== undefined && slotsMoved(slideRef.current.numbers, rowNumbers)) {
        slideRef.current = { numbers: rowNumbers, endsAt: performance.now() + resolved.slide.durationSec * 1000 + 100 };
    }
    else if (slideRef.current.numbers !== rowNumbers)
        slideRef.current = { numbers: rowNumbers, endsAt: slideRef.current.endsAt };
    // A new settled size grows every slot over one slide, which can outlast the scroll's glide: no slot is hidden mid-growth.
    const sizedRef = React.useRef(`${containerWidth}x${phoneWidth}`);
    if (sizedRef.current !== `${containerWidth}x${phoneWidth}`) {
        sizedRef.current = `${containerWidth}x${phoneWidth}`;
        slideRef.current = { numbers: slideRef.current.numbers, endsAt: performance.now() + resolved.slide.durationSec * 1000 + 100 };
    }
    // Reach is written straight to the slots on every scroll event, since a state update per frame of a glide would re-render the whole row.
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        const strip = rowRef.current;
        if (container === null || strip === null || rowNumbers === undefined)
            return;
        const apply = () => {
            const scroller = rowScrollerFor(container);
            const held = scroller.claimHeld();
            const view = container.getBoundingClientRect();
            // While the row holds for the new width, each slot keeps what it drew, so nothing appears or vanishes before the row moves.
            const still = holding(container);
            const atRest = !held && scroller.glideTarget() === null && performance.now() >= slideRef.current.endsAt && rowNumbers.stops.some((stop) => Math.abs(stop - container.scrollLeft) <= EDGE_TOLERANCE_PX);
            const seen = new Set();
            for (const slot of strip.querySelectorAll('[data-row-slot]')) {
                // A stepping row cuts the neighbour of a stop at the window edge, so only a panel the window does not reach at all is out of reach of Tab.
                const rect = slot.getBoundingClientRect();
                const away = rowNumbers.stops.length > 0 && (rect.right <= view.left || rect.left >= view.right);
                // Published here, not in PanelRow: this loop is the only place that measures a slot against the window.
                const id = slot.dataset.rowId;
                if (id !== undefined) {
                    seen.add(id);
                    awayStore.set(id, away);
                }
                // A peek narrower than the gap shows only the frame's edge, a hairline that reads as a stray bar rather than a panel.
                // Judged during a drag too, since the drag's preview slides panels into view while the claim holds reach still.
                const shown = Math.min(rect.right, view.right) - Math.max(rect.left, view.left);
                // At rest only whole slots draw; a panel wider than a phone may show partly. In motion a slot crossing an edge keeps drawing,
                // or a panel leaving the window would vanish at its first pixel instead of sliding out.
                const cut = rect.left < view.left - EDGE_TOLERANCE_PX || rect.right > view.right + EDGE_TOLERANCE_PX;
                const wholeOnly = atRest && cut && rect.width <= phoneWidth + EDGE_TOLERANCE_PX;
                if (!still)
                    slot.style.visibility = !away && rowNumbers.stops.length > 0 && (shown < gap || wholeOnly) ? 'hidden' : '';
                if (held)
                    continue;
                slot.style.pointerEvents = away ? 'none' : '';
                // Inert too: Tab or find-in-page would otherwise scroll the row off its stop to reveal a panel the window does not reach.
                slot.toggleAttribute('inert', away);
            }
            awayStore.retain(seen);
        };
        apply();
        // A close, a move or a drag's preview slides the slots without a scroll event, so the hide is judged again on every frame of
        // that slide, and for as long as a drag holds the row. A drag's preview renders only the row, so its pointer or key restarts this.
        let frame = 0;
        let until = 0;
        const follow = () => {
            until = performance.now() + resolved.slide.durationSec * 1000 + 100;
            if (frame !== 0)
                return;
            frame = requestAnimationFrame(function tick() {
                apply();
                frame = performance.now() < Math.max(until, slideRef.current.endsAt) || rowScrollerFor(container).claimHeld() ? requestAnimationFrame(tick) : 0;
            });
        };
        follow();
        container.addEventListener('scroll', apply, { passive: true });
        container.addEventListener('pointermove', follow, { passive: true });
        container.addEventListener('keydown', follow);
        // A click or focus in the cut-off neighbour makes the browser scroll it into view off a stop; the row settles back onto one.
        const onFocus = (event) => {
            const n = rowNumbers;
            // A held panel is in view at every scroll, so focusing it moves nothing.
            if (event.target?.closest('[data-row-edge]') != null)
                return;
            if (n.stops.length === 0 || isQuietly())
                return;
            const id = event.target?.closest('[data-row-slot]')?.dataset.rowId;
            const k = n.ids.indexOf(id ?? '');
            requestAnimationFrame(() => {
                const scroller = rowScrollerFor(container);
                if (scroller.claimHeld() || n.stops.length === 0)
                    return;
                const to = k < 0 ? nearestStop(n, container.scrollLeft) : snapToStop(n, k, container.scrollLeft);
                if (Math.abs(to - container.scrollLeft) >= 0.5)
                    scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
            });
        };
        container.addEventListener('focusin', onFocus);
        return () => {
            container.removeEventListener('focusin', onFocus);
            cancelAnimationFrame(frame);
            container.removeEventListener('pointermove', follow);
            container.removeEventListener('keydown', follow);
            container.removeEventListener('scroll', apply);
        };
    });
    // A close or a narrower window can end the row left of where it is scrolled. The browser would clamp the scroll in the same frame,
    // a jump, so the end element keeps the old range in that commit and gives it back frame by frame as the row's glide carries it home.
    const scrolledRef = React.useRef(0);
    const endPadRef = React.useRef(null);
    // The scroll before the window moved: the clamp's own scroll event arrives before the observer that undoes it.
    const heldScrollRef = React.useRef(0);
    const before = drawn.current.numbers;
    // Measured from where the row's end is drawn, which for a row that fits is left of 0 (`maxScrollOf` would floor it there), and
    // the strip's margin glides, so until it lands the row ends short of the numbers by the margin still to come.
    const drawnEnd = rowNumbers === undefined ? 0 : rowNumbers.stripStart + rowNumbers.stripWidth + rowNumbers.rightInset + rowNumbers.endPad - rowNumbers.windowWidth - Math.max(0, rowNumbers.rowMarginLeft - (before?.rowMarginLeft ?? rowNumbers.rowMarginLeft));
    const endHold = scrolls && rowNumbers !== undefined && resolved.rowGesture === 'step' && scrolledRef.current > maxScrollOf(rowNumbers) ? scrolledRef.current - drawnEnd : 0;
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        if (container === null)
            return undefined;
        const scroller = rowScrollerFor(container);
        const follow = () => {
            scrolledRef.current = container.scrollLeft;
            if (!holding(container))
                heldScrollRef.current = container.scrollLeft;
            const pad = endPadRef.current;
            if (pad === null || pad.style.minWidth === '')
                return;
            const need = container.scrollLeft + container.clientWidth - pad.offsetLeft;
            pad.style.minWidth = (scroller.glideTarget() !== null || holding(container)) && need > 0 ? `${need}px` : '';
        };
        scrolledRef.current = container.scrollLeft;
        heldScrollRef.current = container.scrollLeft;
        return scroller.subscribe(follow);
    }, [overflowContainerRef]);
    // A wider window shortens the scroll range at once, and the browser would clamp the scroll before the row has moved: the end element keeps
    // the range while the row holds. An observer runs after layout and before paint, so the clamp is undone before it is ever drawn.
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        if (container === null || heightBudget === undefined || typeof ResizeObserver === 'undefined')
            return undefined;
        const keep = () => {
            const pad = endPadRef.current;
            const strip = rowRef.current;
            if (pad === null || strip === null || !holding(container))
                return;
            // Measured from the strip's end, not the pad's: once the row fits, the strip's auto right margin pushes the pad out.
            const need = heldScrollRef.current + container.clientWidth - (pad.offsetLeft - Number.parseFloat(getComputedStyle(strip).marginRight));
            if (need <= pad.offsetWidth)
                return;
            pad.style.minWidth = `${need}px`;
            container.scrollLeft = heldScrollRef.current;
        };
        // The scroller notifies on its own glides; a scroll by the person or the browser is read here.
        const read = () => {
            if (!holding(container))
                heldScrollRef.current = container.scrollLeft;
        };
        const observer = new ResizeObserver(keep);
        observer.observe(container);
        container.addEventListener('scroll', read, { passive: true });
        return () => {
            observer.disconnect();
            container.removeEventListener('scroll', read);
        };
    }, [overflowContainerRef, heightBudget === undefined]);
    // The row has taken the window's width: a range the hold kept is given back once nothing glides through it.
    React.useLayoutEffect(() => {
        const container = overflowContainerRef.current;
        const pad = endPadRef.current;
        if (container === null || pad === null || pad.style.minWidth === '' || holding(container) || rowScrollerFor(container).glideTarget() !== null || endHold > 0)
            return;
        pad.style.minWidth = '';
    }, [containerWidth]);
    // Nothing glided the row home (a drag holds it, or motion is off): the range is given back at once.
    React.useEffect(() => {
        const container = overflowContainerRef.current;
        const pad = endPadRef.current;
        if (endHold > 0 && container !== null && pad !== null && rowScrollerFor(container).glideTarget() === null)
            pad.style.minWidth = '';
    });
    // Each edge element is a plain spacer as wide as its group, so the strip starts after the left one and ends before the right one.
    // The held panels themselves sit in the strip and are positioned from here (see PanelRow's PanelHold), so these hold no content.
    // An edge element exists only while a panel is held there, so a row that holds nothing renders exactly as it did.
    const holdsLeft = rowNumbers?.held.some((h) => h.side === 'left') === true;
    const holdsRight = rowNumbers?.held.some((h) => h.side === 'right') === true;
    const leftEdgeStyle = { width: `${rowNumbers?.leftInset ?? 0}px`, flexShrink: 0 };
    const rightEdgeStyle = { width: `${rowNumbers?.rightInset ?? 0}px`, flexShrink: 0 };
    return (_jsx(AnnounceContext.Provider, { value: announce, children: _jsx(PhoneSizeContext.Provider, { value: phoneSize, children: _jsx(LandingContext.Provider, { value: landing, children: _jsx(ChromeStoreContext.Provider, { value: chromeStore, children: _jsxs(AwayContext.Provider, { value: awayStore, children: [_jsx(RowHeightContext.Provider, { value: availableHeight, children: _jsxs(Box, { ref: overflowContainerRef, role: "region", "aria-label": labels.row, ...rest, "data-row-scroller": "", sx: {
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
                                        // A scrolling row's end space is the end element's (below); a row that does not scroll centres in this padding.
                                        pr: scrolls ? 0 : `${gap}px`,
                                        overflowX: style.overflowX,
                                        // The row never scrolls vertically: a panel scrolls its own content, and a wheel over the row must not move it off its workspace.
                                        overflowY: 'hidden',
                                        ...(style.hideScrollbar ? { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } } : {}),
                                        // A sideways swipe at the row's end must not chain to the page, where a browser reads it as back or forward.
                                        ...(scrolls ? { overscrollBehaviorX: 'none' } : {}),
                                    }, children: [beforeRow, holdsLeft ? _jsx("div", { "data-row-edge": "left", style: leftEdgeStyle }) : null, _jsxs(motion.div, { ref: rowRef, "data-row-strip": "", style: { display: 'flex', gap: `${gap}px`, ...(marginTop === undefined ? { marginTop: 'auto' } : {}), marginBottom: 'auto', marginRight: 'auto', ...(scrolls ? { flexShrink: 0 } : {}) }, animate: { marginLeft: style.marginLeft, ...(marginTop === undefined ? {} : { marginTop }) }, transition: reduced ? { duration: 0 } : marginTop === undefined ? style.transition : { ...style.transition, marginTop: rowResizeSettled ? slideToTransition(resolved.slide) : { duration: 0 } }, children: [_jsx(OverlaySlot, { name: "dialog" }), children] }), holdsRight ? _jsx("div", { "data-row-edge": "right", style: rightEdgeStyle }) : null, scrolls ? _jsx("div", { ref: endPadRef, "aria-hidden": true, "data-row-end-pad": "", style: { flex: `0 0 ${(rowNumbers?.endPad ?? 0) + gap}px`, ...(endHold > 0 ? { minWidth: `${(rowNumbers?.endPad ?? 0) + gap + endHold}px` } : {}) } }) : null] }) }), _jsx(Box, { role: "status", "aria-live": "polite", "aria-atomic": "true", "data-workspace-announcer": "", sx: VISUALLY_HIDDEN, children: _jsx("span", { children: said.text }, said.n) }), _jsx(OverlaySlot, { name: "toast" })] }) }) }) }) }));
}
