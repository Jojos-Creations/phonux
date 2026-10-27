/**
 * Maximize: a panel grows from its slot to fill the window and shrinks back, on the glide a panel resize uses. The browser's
 * own fullscreen is not used: its transition is the operating system's (a swipe to a new space on macOS), which no page can change.
 */
import * as React from 'react';
import { animate } from 'motion';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { slideToTransition } from './directionalTransition.js';
import { ACTIVE_ATTRIBUTE } from './panelChrome.js';
import { PHONE_FRAME_ATTRIBUTE } from './PanelFrame.js';
import { usePanelTuning } from './PanelRow.js';
import { panelRootOf } from './rowDom.js';
import { maximizablePanels, maximizedPanel, reportMaximized } from './maximizedStore.js';
/**
 * On a panel's root while it fills the window. Style the maximized panel through it, for example a square frame.
 * @public
 */
export const MAXIMIZED_ATTRIBUTE = 'data-panel-maximized';
/** The browser's popover defaults (centered, bordered, padded, opaque) would all show on the root, so each is undone. */
const FLOATING = { position: 'fixed', inset: 'auto', margin: '0', border: '0', padding: '0', overflow: 'visible', background: 'transparent', color: 'inherit' };
const lerp = (from, to, p) => from + (to - from) * p;
const boxOf = ({ top, left, width, height }) => ({ top, left, width, height });
/** The layout viewport, which a fixed element with every inset 0 fills, less `topInset`. */
const windowBox = (topInset) => ({
    top: topInset,
    left: 0,
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight - topInset,
});
function restoreStyle(el, style) {
    if (style === null)
        el.removeAttribute('style');
    else
        el.setAttribute('style', style);
}
/**
 * Grows `root`'s box in width and height until it fills the window, and back. The root goes to the top layer through the
 * popover attribute, so no ancestor's transform, clip or stacking order can hold it and it never leaves its place in the DOM,
 * which a web view inside it would answer by reloading.
 */
function createMaximizer(root, timing, onPhase, topInset) {
    let phase = 'home';
    // 0 is the panel in its slot, 1 the panel filling the window.
    let progress = 0;
    let run;
    let frame = null;
    let frameRadius = 0;
    let saved = { root: null, frame: null };
    // The slot keeps its own size while the root is out of it, so its box is where the root belongs, wherever the row has moved to.
    const slotBox = () => boxOf((root.parentElement ?? root).getBoundingClientRect());
    const paint = (p) => {
        progress = p;
        const from = slotBox();
        const to = windowBox(topInset());
        root.style.top = `${lerp(from.top, to.top, p)}px`;
        root.style.left = `${lerp(from.left, to.left, p)}px`;
        root.style.width = `${lerp(from.width, to.width, p)}px`;
        root.style.height = `${lerp(from.height, to.height, p)}px`;
        if (frame !== null)
            frame.style.borderRadius = `${lerp(frameRadius, 0, p)}px`;
    };
    const setPhase = (next) => {
        phase = next;
        onPhase(next);
    };
    const lift = () => {
        // Checked first: a root left with a popover attribute that never opened would not draw at all.
        if (typeof root.showPopover !== 'function')
            throw new Error('popover is not supported');
        saved = { root: root.getAttribute('style'), frame: null };
        root.setAttribute('popover', 'manual');
        try {
            root.showPopover();
        }
        catch (error) {
            root.removeAttribute('popover');
            throw error;
        }
        Object.assign(root.style, FLOATING);
        frame = root.querySelector(`:scope > [${PHONE_FRAME_ATTRIBUTE}]`);
        if (frame !== null) {
            saved.frame = frame.getAttribute('style');
            frameRadius = Number.parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
            // The frame's own pixel size would hold it at the slot's size while the root grows.
            frame.style.width = '100%';
            frame.style.height = '100%';
        }
        paint(0);
    };
    // Once full, the stylesheet takes over from the animated pixels, so a resized window is followed.
    const settle = () => {
        root.setAttribute(MAXIMIZED_ATTRIBUTE, '');
        // Longhands: the animation's last frame left `top` behind, and a shorthand a test cannot read would hide a wrong inset.
        Object.assign(root.style, { top: `${topInset()}px`, left: '0', right: '0', bottom: '0' });
        root.style.width = 'auto';
        root.style.height = 'auto';
        root.style.background = '';
        if (frame !== null)
            frame.style.borderRadius = '';
        progress = 1;
    };
    const unsettle = () => {
        root.removeAttribute(MAXIMIZED_ATTRIBUTE);
        root.style.background = 'transparent';
        if (frame !== null)
            frame.style.borderRadius = '0px';
        paint(1);
    };
    const land = () => {
        if (root.matches(':popover-open'))
            root.hidePopover();
        root.removeAttribute('popover');
        restoreStyle(root, saved.root);
        if (frame !== null)
            restoreStyle(frame, saved.frame);
        frame = null;
        progress = 0;
    };
    const drive = (to, done) => {
        run?.stop();
        const from = progress;
        const glide = timing();
        if (glide === null || from === to) {
            paint(to);
            done();
            return;
        }
        run = animate(0, 1, { duration: glide.duration, ease: [...glide.ease], onUpdate: (eased) => paint(lerp(from, to, eased)), onComplete: done });
    };
    return {
        grow() {
            if (phase === 'growing' || phase === 'maximized')
                return;
            if (phase === 'home')
                lift();
            setPhase('growing');
            drive(1, () => {
                settle();
                setPhase('maximized');
            });
        },
        shrink() {
            if (phase === 'home' || phase === 'shrinking')
                return;
            if (phase === 'maximized')
                unsettle();
            setPhase('shrinking');
            drive(0, () => {
                land();
                setPhase('home');
            });
        },
        dispose() {
            run?.stop();
            if (phase === 'home')
                return;
            root.removeAttribute(MAXIMIZED_ATTRIBUTE);
            land();
            phase = 'home';
        },
    };
}
/** The active panel's root in view: a column keeps every workspace mounted, and those out of view are inert. */
function activeRoot() {
    for (const el of document.querySelectorAll(`[${ACTIVE_ATTRIBUTE}]`))
        if (el.closest('[inert]') === null)
            return el;
    return null;
}
/**
 * Grows or shrinks one panel, for a host's keyboard shortcut: the panel that fills the window if one does, else the maximizable
 * panel holding `target`, else the active panel (the one last pressed or focused). True when it found such a panel, so the key is
 * the host's to claim, even if the browser then refused (that panel's `onRefused` hears of it); false when there was none.
 * @public
 */
export function toggleMaximize(target) {
    const root = panelRootOf(target ?? null) ?? panelRootOf(activeRoot());
    const panel = maximizedPanel() ?? (root === null ? undefined : maximizablePanels().find((candidate) => candidate.root() === root));
    panel?.toggle();
    return panel !== undefined;
}
/**
 * Lets the panel that draws `anchor` fill the window. The panel grows from its slot on the workspace's `slide` timing and shrinks
 * back the same way (Reduce Motion jumps). While it fills the window, Escape shrinks it unless something inside already used the key,
 * and focus goes back to `anchor` on the way out. A panel unmounted while maximized goes back to its slot at once.
 *
 * `topInset` is the height of a bar the page keeps drawn along the window's top edge, which the panel stops below. `onRefused` is
 * called when the browser refuses to lift the panel (no popover support), however the grow was asked for.
 * @public
 */
export function usePanelMaximize(anchor, options) {
    const systemReduced = useReducedMotion();
    const configReduced = useReducedMotionConfig();
    const tuning = usePanelTuning();
    // Read as a grow or shrink starts, so a setting changed meanwhile is honored.
    const timing = React.useRef(null);
    timing.current = systemReduced === true || configReduced === true ? null : slideToTransition(tuning.slide);
    const topInset = React.useRef(options?.topInset);
    topInset.current = options?.topInset;
    const onRefused = React.useRef(options?.onRefused);
    onRefused.current = options?.onRefused;
    const [phase, setPhase] = React.useState('home');
    const maximizer = React.useRef(null);
    const maximized = phase === 'growing' || phase === 'maximized';
    const exit = () => {
        maximizer.current?.shrink();
        // The panel's own controls are off screen until it is back, so focus returns without a scroll.
        anchor.current?.focus({ preventScroll: true });
    };
    const toggleRef = React.useRef(() => false);
    const self = React.useRef(null);
    self.current ??= { root: () => panelRootOf(anchor.current), toggle: () => toggleRef.current() };
    React.useEffect(() => {
        const panel = self.current;
        const unregister = reportMaximized(panel, 'home', true);
        return () => {
            unregister();
            maximizer.current?.dispose();
        };
    }, []);
    React.useEffect(() => {
        if (!maximized)
            return undefined;
        // An Escape something inside the panel already used is not also a request to leave, and neither is one the browser spends leaving its own fullscreen.
        const onKey = (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented && !document.fullscreenElement)
                exit();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [maximized]);
    const toggle = () => {
        const root = panelRootOf(anchor.current);
        try {
            if (root === null)
                throw new Error('no panel root');
            maximizer.current ??= createMaximizer(root, () => timing.current, (next) => {
                setPhase(next);
                reportMaximized(self.current, next);
            }, () => topInset.current?.() ?? 0);
            if (maximized)
                exit();
            else
                maximizer.current.grow();
            return true;
        }
        catch {
            onRefused.current?.();
            return false;
        }
    };
    toggleRef.current = toggle;
    return { phase, maximized, toggle };
}
