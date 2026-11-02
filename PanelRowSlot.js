import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import { animate, PresenceContext, usePresence, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { sharedStartTime } from './rowClock.js';
import { NAMED_EASE, createSlotMover, shortTransform } from './slotMover.js';
import { SLOT_TRANSITION, directionalTransition, slideToTransition } from './directionalTransition.js';
import { CHROME_ATTRIBUTE, ChromeStoreContext, createRectReporter, markPanelPress, usePanelDragging } from './panelChrome.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import { ROW_GAP, ROW_LAYER_Z } from './rowConstants.js';
import { OPEN_Z, SlotRanksContext, slotZ } from './rowSlotZ.js';
import { HostMissingProviderError } from './hostApi.js';
import { useOptionalPhoneSize } from './phoneFit.js';
import { closestRowScroller, rowScrollerFor } from './rowScroller.js';
import { swallowFirstPress, useFramesAsleep } from './firstPress.js';
/**
 * The library's default row gap, 16 px; the gap a workspace draws with is its `tuning.rowGap`, which this does not follow.
 * @public
 * @deprecated Read the gap with `usePanelTuning().rowGap`, and the default with `LIBRARY_TUNING_DEFAULTS.rowGap`.
 */
export const GAP = ROW_GAP;
/** The timing/easing every panel slide uses. The SAME object as SLOT_TRANSITION, not a copy: a host animates
 * its own row "the same as a panel" by this reference (test/row-shell-style.test.ts pins it).
 * @public */
export const PANEL_TRANSITION = SLOT_TRANSITION;
/** Whether `target` is a button or grab bar in a panel's own header, grab bar or footer: using one is not using the panel's content. */
function isChromeControl(target) {
    const control = target instanceof Element ? target.closest('button, [role="button"], [data-panel-grab-bar]') : null;
    return control?.closest(`[${CHROME_ATTRIBUTE}]`) != null || control?.hasAttribute('data-panel-grab-bar') === true;
}
const noSubscribe = () => () => { };
/** The same targets, no time taken: for Reduce Motion, snapping and width tracking. */
const INSTANT_TRANSITION = { duration: 0 };
/** The transform origin each side expand grows about, as a fraction of the slot's width. */
const EXPAND_ORIGIN_X = { 'expand-left': 0, 'expand-right': 1 };
/** The transform origin each shrink scales about, as a fraction of the slot's width. */
const SHRINK_ORIGIN_X = { shrink: 0.5, 'shrink-left': 0, 'shrink-right': 1 };
/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export function panelRowSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection, gap = ROW_GAP, slide = LIBRARY_TUNING_DEFAULTS.slide, rowScroll = false) {
    // This panel's OWN footprint (its width plus one gap) is how far it must travel to clear the row edge,
    // so the distance is per panel: a wider one travels further.
    const ownSpan = width + gap;
    const rest = leftOffset;
    // Positive distance enters from the right (directionalTransition.ts's own sign convention); a negative
    // one enters from the left -- see panelRowOrder.ts for who decides which.
    const enterDistance = enterDirection === 'left' ? -ownSpan : ownSpan;
    const sideways = directionalTransition('x', rest, enterDistance, slideToTransition(slide));
    const { transition } = sideways;
    // A vertical slide travels the row's height, so the slot clears the row's top or bottom edge.
    const { initial, animate } = enterDirection === 'left' || enterDirection === 'right'
        ? sideways
        : enterDirection === 'top' || enterDirection === 'bottom'
            ? { initial: { x: rest, y: enterDirection === 'top' ? -phoneHeight : phoneHeight, opacity: 0 }, animate: { x: rest, y: 0, opacity: 1 } }
            : enterDirection === 'expand'
                ? // Starts half a span left, where its neighbors part from, so the center rides the opening gap.
                    { initial: { x: rest - ownSpan / 2, scale: 0, opacity: 0 }, animate: { x: rest, scale: 1, opacity: 1 } }
                : enterDirection === 'expand-left' || enterDirection === 'expand-right'
                    ? // Stays at its rest: moving the slot would move the edge it grows out of.
                        { initial: { x: rest, scale: 0, opacity: 0 }, animate: { x: rest, scale: 1, opacity: 1 } }
                    : { initial: { x: rest, opacity: 0 }, animate: { x: rest, opacity: 1 } };
    // 'down': a close, timed to DragToClose's exit so trash and drag closes read as one motion (DragToClose calls
    // `onClose` after its own `y` animation, so this ramps in under a box already off-screen). 'left'/'right': a
    // park, off the edge it was hidden past, so a close never looks like a park.
    const exit = exitDirection === 'down'
        ? { x: rest, y: phoneHeight, opacity: 0, transition: { duration: slide.closeExitSeconds, ease: slide.closeExitEase } }
        : exitDirection === 'right'
            ? { x: rest + ownSpan, opacity: 0 }
            : exitDirection === 'left'
                ? { ...parkExitTarget(rest, ownSpan, 'left', rowScroll) }
                : exitDirection === 'top' || exitDirection === 'bottom'
                    ? { x: rest, y: exitDirection === 'top' ? -phoneHeight : phoneHeight, opacity: 0 }
                    : exitDirection === 'shrink'
                        ? // The mirror of 'expand': half a span left keeps the center where the neighbors meet as they close up.
                            { x: rest - ownSpan / 2, scale: 0, opacity: 0 }
                        : exitDirection === 'shrink-left' || exitDirection === 'shrink-right'
                            ? // Stays at its rest: moving the slot would move the edge it shrinks into.
                                { x: rest, scale: 0, opacity: 0 }
                            : { x: rest, opacity: 0 };
    return { initial, animate, exit, transition };
}
/**
 * Where a slot goes when its panel parks: off the edge it was hidden past, faded out. In a scrolling row the strip
 * extends far past the window, so the exit is one span from the slot's own rest on either side; in a row that never
 * scrolls the left edge is the row's own origin.
 * @internal
 */
export function parkExitTarget(rest, ownSpan, side, rowScroll) {
    if (side === 'right')
        return { x: rest + ownSpan, opacity: 0 };
    return { x: rowScroll ? rest - ownSpan : -ownSpan, opacity: 0 };
}
/** A Motion target as the pose it names: what it leaves out is the slot at rest. */
const poseOf = (t, rest) => ({
    x: typeof t.x === 'number' ? t.x : rest,
    y: typeof t.y === 'number' ? t.y : 0,
    scale: typeof t.scale === 'number' ? t.scale : 1,
    opacity: typeof t.opacity === 'number' ? t.opacity : 1,
});
/** A Motion transition's timing as a slot move's; a named curve is Motion's bezier for it. */
function timingOf(t, fallback) {
    if (t === undefined)
        return fallback;
    const ease = typeof t.ease === 'string' && t.ease in NAMED_EASE ? NAMED_EASE[t.ease] : Array.isArray(t.ease) && t.ease.length === 4 ? t.ease : fallback.ease;
    return { duration: t.duration ?? fallback.duration, ease };
}
/**
 * The imperative moves a slot makes on its own element. An object so a test can wrap them and read the order of the
 * calls; `set` draws at once, `glide` starts a move on the shared start time.
 * @internal
 */
export const slotDriver = {
    set(el, mover, pose) {
        void el;
        mover.set(pose);
    },
    glide(el, mover, pose, timing, done) {
        void el;
        mover.to(pose, timing, done);
    },
};
/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export function PanelRowSlot({ panelId, label, leftOffset, width, phoneHeight, top, height, enterDirection, exitDirection, zIndex, tracking = false, gap, slide, rowScroll = false, previewing = false, firstPressFocusOnly = false, onActivate, dragged = false, children, }) {
    // The entrance is read once, as the slot mounts: an enter in progress keeps its style whatever the settings say later.
    const [entrance] = React.useState(enterDirection);
    // A slot entering the row is drawn one level under its rank until it has arrived, so it tucks under its inner neighbor;
    // a new open grows from its center while the panel in its slot slides out, so it is drawn under the whole row until it has grown.
    // A slot mounted with the row (AnimatePresence initial={false}) never animates in, so it is never entering.
    const presence = React.useContext(PresenceContext);
    const mountedWithRow = presence?.initial === false;
    const [entering, setEntering] = React.useState(!mountedWithRow);
    const { initial, animate: animateTarget, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, entrance, exitDirection, gap, slide, rowScroll);
    const el = React.useRef(null);
    const mover = React.useRef(null);
    // What a report and the frame loop read: the row's store and this slot's panel id, as of this render.
    const chrome = React.useContext(ChromeStoreContext);
    const live = React.useRef({ chrome, panelId });
    live.current = { chrome, panelId };
    const reporter = React.useRef(null);
    // True from the start of this slot's move until it lands; the store mirrors it for usePanelSliding.
    const sliding = React.useRef(false);
    const kickRect = React.useCallback(() => reporter.current?.kick(), []);
    const setSliding = (on) => {
        sliding.current = on;
        const { chrome: store, panelId: id } = live.current;
        if (store !== undefined && id !== undefined)
            store.setSliding(id, on);
    };
    const framed = useHoldsFrame(el);
    const inUse = React.useSyncExternalStore(chrome?.subscribeActive ?? noSubscribe, () => chrome !== undefined && panelId !== undefined && chrome.active() === panelId, () => false);
    useFramesAsleep(el, framed, firstPressFocusOnly && !inUse);
    const reducedMotion = useReducedMotionConfig();
    // The drag box reads the system preference itself, so the neighbors that make room for it must too, whatever the app's MotionConfig says.
    const systemReduced = useReducedMotion();
    // A press or key inside an iframe never reaches the page's own handlers; the page's window loses focus to the iframe element instead.
    const activate = React.useRef(onActivate);
    activate.current = onActivate;
    React.useEffect(() => {
        const onWindowBlur = () => {
            const focused = document.activeElement;
            if (focused instanceof HTMLIFrameElement && el.current?.contains(focused))
                activate.current?.(false);
        };
        window.addEventListener('blur', onWindowBlur);
        return () => window.removeEventListener('blur', onWindowBlur);
    }, []);
    const snapping = previewing && (reducedMotion || systemReduced || dragged);
    const instant = reducedMotion === true || snapping || tracking;
    // A drag of any axis lifts its slot above the row's others until it has settled; the slot is its own stacking context, so only its z can do it.
    const lifted = usePanelDragging();
    const [present, safeToRemove] = usePresence();
    // The slot's rank from either end of the row follows the row through this context even while the slot leaves, when its props no longer change.
    const { ranks, mounted } = React.useContext(SlotRanksContext);
    const rank = panelId === undefined ? 0 : (ranks.get(panelId) ?? 0);
    React.useEffect(() => (panelId === undefined ? undefined : mounted(panelId)), [panelId, mounted]);
    const shrinkOrigin = present ? undefined : SHRINK_ORIGIN_X[exitDirection];
    const shrinking = shrinkOrigin !== undefined;
    const glide = (pose, timing, done) => {
        const node = el.current;
        const m = mover.current;
        if (node === null || m === null)
            return;
        setSliding(true);
        kickRect();
        slotDriver.glide(node, m, pose, timing, () => {
            setSliding(false);
            done?.();
            reporter.current?.settle();
        });
    };
    // Every move starts in the commit's layout effect on the shared start time, so the slots, the strip and the size boxes a
    // commit moves are sampled together.
    const lastRest = React.useRef(null);
    const exiting = React.useRef(false);
    React.useLayoutEffect(() => {
        const node = el.current;
        if (node === null)
            return;
        const rest = poseOf(animateTarget, leftOffset);
        if (mover.current === null) {
            const enters = !mountedWithRow && !instant;
            mover.current = createSlotMover(node, enters ? poseOf(initial, leftOffset) : rest);
            lastRest.current = leftOffset;
            if (enters)
                glide(rest, timingOf(transition, transition), () => {
                    setEntering(false);
                });
            else
                setEntering(false);
            return;
        }
        const m = mover.current;
        if (!present) {
            if (exiting.current)
                return;
            exiting.current = true;
            const timing = reducedMotion === true ? { duration: 0, ease: transition.ease } : timingOf(exit.transition, transition);
            glide(poseOf(exit, leftOffset), timing, () => safeToRemove?.());
            return;
        }
        const moved = lastRest.current !== leftOffset;
        const returning = exiting.current;
        exiting.current = false;
        lastRest.current = leftOffset;
        if (!moved && !returning)
            return;
        if (instant) {
            slotDriver.set(node, m, rest);
            kickRect();
            return;
        }
        // A slot added back while its exit was running enters again: under its inner neighbor as it scales back up. Any glide to
        // a rest ends the entering level, since a move during the entrance replaces the entrance glide and its own end never comes.
        if (returning)
            setEntering(true);
        glide(rest, transition, () => setEntering(false));
    });
    // A box that moves by its own motion, a drag, a resize or a row scroll is reported until it stops. A slot that mounts
    // reports its rest once; its reporter is recreated under StrictMode's second setup, so nothing here is shared.
    React.useLayoutEffect(() => {
        const node = el.current;
        if (node === null)
            return;
        const row = closestRowScroller(node);
        const rowMoving = () => row !== null && (rowScrollerFor(row).glideTarget() !== null || rowScrollerFor(row).claimHeld());
        const rep = createRectReporter(node, {
            id: () => live.current.panelId,
            stripX: () => (row === null ? 0 : rowScrollerFor(row).stripX()),
            moving: () => {
                const { chrome: store, panelId: id } = live.current;
                const held = store !== undefined && id !== undefined && (store.dragging() === id || store.resizing() === id);
                return sliding.current || held || rowMoving();
            },
        });
        reporter.current = rep;
        const unsubscribeRow = row === null ? () => { } : rowScrollerFor(row).subscribe(kickRect);
        rep.kick();
        return () => {
            unsubscribeRow();
            rep.stop();
            reporter.current = null;
            if (sliding.current)
                setSliding(false);
        };
    }, [kickRect]);
    React.useEffect(() => {
        if (chrome === undefined || panelId === undefined)
            return;
        const offs = [chrome.subscribePanel(panelId, kickRect), chrome.subscribeResizing(kickRect), chrome.subscribeDrawn(kickRect)];
        return () => {
            for (const off of offs)
                off();
        };
    }, [chrome, panelId, kickRect]);
    const origin = shrinking ? shrinkOrigin : EXPAND_ORIGIN_X[entrance];
    // The first pose is in the markup, so a server render or the frame before the layout effect draws the slot in place. It never
    // changes after, so React never writes over the mover's own transform.
    const [firstPose] = React.useState(() => {
        const p = mountedWithRow || instant ? poseOf(animateTarget, leftOffset) : poseOf(initial, leftOffset);
        return { opacity: p.opacity, transform: shortTransform(p) };
    });
    return (_jsxs("div", { ref: el, ...(label === undefined ? {} : { role: 'group', 'aria-label': label }), "data-row-slot": leftOffset, "data-row-id": panelId, onPointerDownCapture: (e) => {
            markPanelPress(e.nativeEvent);
            const control = isChromeControl(e.target);
            const first = firstPressFocusOnly && onActivate !== undefined && chrome !== undefined && panelId !== undefined && chrome.active() !== panelId;
            onActivate?.(control);
            if (first && !control && el.current !== null)
                swallowFirstPress(el.current, e.nativeEvent);
        }, onFocusCapture: (e) => onActivate?.(isChromeControl(e.target)), style: {
            position: 'absolute',
            top: top ?? 0,
            ...(height === undefined ? { bottom: 0 } : { height }),
            left: 0,
            // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
            width,
            zIndex: lifted ? Math.max(zIndex ?? 0, ROW_LAYER_Z.DRAGGED) : entering && present && entrance === 'expand' ? OPEN_Z : slotZ(zIndex ?? 0, rank, !present || entering),
            ...firstPose,
            ...(origin !== undefined ? { transformOrigin: `${origin * 100}% 50%` } : {}),
        }, children: [framed && _jsx(TabSentinel, { end: false }), children, framed && _jsx(TabSentinel, { end: true })] }));
}
// No aria-hidden (a focusable element must not carry it) and no role: presentation is ignored on a focusable element anyway.
// Zero-size, not display:none, so the browser still gives it a tab stop.
// A tab stop on a non-interactive element is the point: it exists only to catch the browser's step out of an iframe.
const SENTINEL_STOP = { tabIndex: 0 };
function TabSentinel({ end }) {
    return _jsx("span", { ...SENTINEL_STOP, "data-row-sentinel": end ? 'end' : 'start', style: { position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', outline: 'none' } });
}
const FRAMES = 'iframe,frame,embed,object';
// Only a cross-document element can swallow a Tab press, so a slot gets sentinels only while it holds one.
function useHoldsFrame(slot) {
    const [holds, setHolds] = React.useState(false);
    React.useLayoutEffect(() => {
        const node = slot.current;
        if (node === null)
            return;
        const sync = () => setHolds(node.querySelector(FRAMES) !== null);
        sync();
        // Only an added or removed frame changes the answer; the sentinels this very state adds must not re-run the query.
        const touchesFrame = (nodes) => [...nodes].some((n) => n instanceof Element && (n.matches(FRAMES) || n.querySelector(FRAMES) !== null));
        const observer = new MutationObserver((records) => {
            if (records.some((r) => touchesFrame(r.addedNodes) || touchesFrame(r.removedNodes)))
                sync();
        });
        observer.observe(node, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [slot]);
    return holds;
}
/**
 * The box a resize animates. It is laid out once at the new size, and its drawn size eases from the size on screen to the new
 * one over the slide, in step with the neighboring slots, by a scale about its top left corner: the content takes its new layout
 * at the start and is drawn stretched in between. A row already draws one around every panel, which follows the panel's `resize`
 * setting; a `PanelSizeBox` inside it is a plain div that fills it. Under Reduce Motion, or while a host holds a width, the resize snaps.
 * @public
 */
export function PanelSizeBox({ width, height, reveal, children, }) {
    return (_jsx(SizeBox, { width: width, height: height, reveal: reveal, children: children }));
}
const SizeGlideContext = React.createContext(null);
/**
 * The size glide of the panel box this is called in, from its start until it lands; null while the box is still, under Reduce
 * Motion, and outside a box. A window that draws no frames does not advance a glide, so a host that waits on its end caps the wait.
 * @public
 */
export function usePanelSizeGlide() {
    return React.useContext(SizeGlideContext);
}
const missingHost = () => {
    throw new HostMissingProviderError();
};
/** True below a `SizeBox`: a box inside another is a plain div filling it, because two glides of one size would fight. */
const SizeBoxContext = React.createContext(false);
/** True below a `SizeBox`: the panel and its frame fill the box, so they glide with it. @internal */
export const useInsideSizeBox = () => React.useContext(SizeBoxContext);
/**
 * `PanelSizeBox` with a height that may be the slot's own (`'100%'`, a panel that fills the row's height), which is the box the
 * default frame draws around its whole panel. A box below another draws a plain div of the same size.
 * @internal
 */
export function SizeBox({ width: given, height: givenHeight, reveal = false, children }) {
    const slot = React.useContext(PanelSlotContext);
    // Read without throwing: a box given both sides needs no host.
    const phone = useOptionalPhoneSize();
    const width = given ?? slot?.drawn?.width ?? phone?.width ?? missingHost();
    const height = givenHeight ?? slot?.drawn?.height ?? phone?.height ?? missingHost();
    const nested = React.useContext(SizeBoxContext);
    const slide = slot?.tuning.slide;
    // The system preference too, because a theme's MotionConfig may not carry it.
    const configReduced = useReducedMotionConfig() === true;
    const systemReduced = useReducedMotion() === true;
    const snaps = configReduced || systemReduced || slot?.tracking === true;
    const box = React.useRef(null);
    const run = React.useRef(undefined);
    const laidOut = React.useRef(undefined);
    const [glide, setGlide] = React.useState(null);
    // Starts in the commit's layout effect, on the shared start time, so a commit that janks opens no gap to a neighbor.
    React.useLayoutEffect(() => {
        const node = box.current;
        if (node === null || nested)
            return;
        const to = { width, height };
        // From the size on screen, so a resize that lands mid-glide carries on from there.
        const from = run.current === undefined ? laidOut.current : shownSize(run.current);
        run.current?.stop();
        run.current = undefined;
        laidOut.current = to;
        const h0 = typeof from?.height === 'number' && typeof height === 'number' ? from.height : height;
        if (from === undefined || snaps || (Math.abs(from.width - width) < 0.5 && (typeof h0 !== 'number' || typeof height !== 'number' || Math.abs(h0 - height) < 0.5))) {
            setGlide(null);
            return;
        }
        const start = { width: from.width, height: h0 };
        setGlide({ from: start, to });
        run.current = runSizeGlide(node, reveal ? 'clip' : 'scale', start, to, slide === undefined ? PANEL_TRANSITION : slideToTransition(slide), sharedStartTime(), () => {
            run.current = undefined;
            setGlide(null);
        });
    }, [width, height, snaps, nested]);
    React.useEffect(() => () => run.current?.stop(), []);
    // It fills the box above, so it eases with that box rather than snapping to its own size.
    if (nested)
        return _jsx("div", { "data-panel-size-plain": "", style: { width: '100%', height: '100%' }, children: children });
    // The larger size, so a grow lays the content out once at its start and a shrink once at its end.
    const content = reveal ? (_jsx("div", { "data-panel-size-reveal": "", style: {
            width: glide === null ? '100%' : Math.max(glide.from.width, glide.to.width),
            height: glide !== null && typeof glide.from.height === 'number' && typeof glide.to.height === 'number' && glide.from.height !== glide.to.height ? Math.max(glide.from.height, glide.to.height) : '100%',
        }, children: children })) : (children);
    // Laid out at the landing size once; the glide is drawn by a transform or a clip, which the browser composites.
    return (_jsx("div", { ref: box, "data-panel-size-box": "", style: { width, height }, children: _jsx(SizeBoxContext.Provider, { value: true, children: _jsx(SizeGlideContext.Provider, { value: glide, children: content }) }) }));
}
function shownSize(run) {
    const p = run.progress();
    const { from, to } = run;
    return {
        width: from.width + (to.width - from.width) * p,
        height: typeof from.height === 'number' && typeof to.height === 'number' ? from.height + (to.height - from.height) * p : to.height,
    };
}
// The box keeps its landing size; a scale (reflow) or a clip (reveal) draws the eased size about its top left corner.
function sizeFrame(kind, size, to, heightEases) {
    const h = heightEases ? size.height / to.height : 1;
    if (kind === 'scale')
        return `scale(${size.width / to.width}, ${h})`;
    // Never clipped above, and below only while the height eases: a frame's header and footer may be drawn outside the box.
    return `inset(-100vh ${to.width - size.width}px ${heightEases ? `${to.height - size.height}px` : '-100vh'} 0px)`;
}
function runSizeGlide(node, kind, from, to, transition, startTime, onLand) {
    const property = kind === 'clip' ? 'clipPath' : 'transform';
    const heightEases = typeof from.height === 'number' && typeof to.height === 'number' && from.height !== to.height;
    const first = sizeFrame(kind, from, to, heightEases);
    const last = sizeFrame(kind, to, to, heightEases);
    if (typeof node.animate === 'function') {
        // A Web Animation, not a style written each frame: it leaves no style behind when it ends or is cancelled.
        const animation = node.animate({ [property]: [first, last], ...(kind === 'scale' ? { transformOrigin: ['0 0', '0 0'] } : {}) }, { duration: transition.duration * 1000, easing: `cubic-bezier(${transition.ease.join(',')})` });
        animation.startTime = startTime;
        animation.onfinish = onLand;
        return {
            from,
            to,
            progress: () => animation.effect?.getComputedTiming().progress ?? 1,
            stop: () => {
                animation.onfinish = null;
                animation.cancel();
            },
        };
    }
    // No Web Animations (a test DOM): the same frames written by Motion's frame loop.
    let shown = 0;
    const draw = (p) => {
        shown = p;
        if (kind === 'scale')
            node.style.transformOrigin = p >= 1 ? '' : '0 0';
        node.style[property] = p >= 1 ? '' : sizeFrame(kind, shownSize({ from, to, progress: () => p, stop: () => undefined }), to, heightEases);
    };
    draw(0);
    const controls = animate(0, 1, { ...transition, startTime, onUpdate: draw, onComplete: () => {
            draw(1);
            onLand();
        } });
    return {
        from,
        to,
        progress: () => shown,
        stop: () => {
            controls.stop();
            node.style[property] = '';
            node.style.transformOrigin = '';
        },
    };
}
