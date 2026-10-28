/**
 * Maximize: a panel grows from its slot to fill the window and shrinks back, on the slide timing. The browser's
 * own fullscreen is not used: its transition is the operating system's (a swipe to a new space on macOS), which no page can change.
 */
import * as React from 'react';
import { cubicBezier, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { animateShared, sharedStartTime } from './rowClock.js';
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
/** The transform that draws a box laid out at `to` where `from` is. */
const inverseOf = (from, to) => ({
    x: from.left - to.left,
    y: from.top - to.top,
    sx: to.width === 0 ? 1 : from.width / to.width,
    sy: to.height === 0 ? 1 : from.height / to.height,
});
// The compositor runs the eased curve as linear steps this far apart: sampled, the corner radius can be corrected for the scale.
const SAMPLE_MS = 1000 / 60;
/**
 * Grows `root` from its slot until it fills the window, and back. The root goes to the top layer through the popover attribute, so
 * no ancestor's transform, clip or stacking order can hold it and it never leaves its place in the DOM, which a web view inside it
 * would answer by reloading. Its box is set to the window once; the grow and the shrink are a transform from the slot's box, so no
 * frame of either lays the panel out again.
 */
function createMaximizer(root, timing, onPhase, topInset) {
    let phase = 'home';
    // 0 is the panel in its slot, 1 the panel filling the window.
    let progress = 0;
    let run;
    let tick = null;
    let frame = null;
    let frameRadius = 0;
    let saved = { root: null, frame: null };
    // Read once per grow or shrink: the slot keeps its own size while the root is out of it, so its box is where the root belongs.
    let slot = { top: 0, left: 0, width: 0, height: 0 };
    let full = slot;
    const slotBox = () => boxOf((root.parentElement ?? root).getBoundingClientRect());
    const styleAt = (p) => {
        const inv = inverseOf(slot, full);
        const sx = lerp(inv.sx, 1, p);
        const sy = lerp(inv.sy, 1, p);
        // The radius is drawn scaled with the box, so it is set larger by the scale for the corner to read as `r` on screen.
        const r = lerp(frameRadius, 0, p);
        return { transform: `translate(${lerp(inv.x, 0, p)}px, ${lerp(inv.y, 0, p)}px) scale(${sx}, ${sy})`, radius: `${r / sx}px / ${r / sy}px` };
    };
    const paint = (p) => {
        progress = p;
        const { transform, radius } = styleAt(p);
        root.style.transform = transform;
        if (frame !== null)
            frame.style.borderRadius = radius;
    };
    const place = (box) => {
        Object.assign(root.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, transformOrigin: '0 0' });
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
        slot = slotBox();
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
            // The frame's own pixel size would hold it at the slot's size inside the window's box.
            frame.style.width = '100%';
            frame.style.height = '100%';
        }
        full = windowBox(topInset());
        place(full);
        paint(0);
    };
    // Once full, the stylesheet takes over from the set box, so a resized window is followed.
    const settle = () => {
        root.setAttribute(MAXIMIZED_ATTRIBUTE, '');
        // Longhands: a shorthand a test cannot read would hide a wrong inset.
        Object.assign(root.style, { top: `${topInset()}px`, left: '0', right: '0', bottom: '0', transform: '', transformOrigin: '' });
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
        Object.assign(root.style, { right: 'auto', bottom: 'auto' });
        full = windowBox(topInset());
        place(full);
        slot = slotBox();
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
    const progressAt = (nowMs) => {
        if (run === undefined)
            return progress;
        const t = Math.min(1, Math.max(0, (nowMs - run.startMs) / run.durationMs));
        return lerp(run.from, run.to, run.curve(t));
    };
    const halt = () => {
        if (tick !== null)
            cancelAnimationFrame(tick);
        tick = null;
        if (run === undefined)
            return;
        const at = progressAt(performance.now());
        for (const anim of run.anims)
            anim.cancel();
        run = undefined;
        paint(at);
    };
    const drive = (to, done) => {
        halt();
        const from = progress;
        const glide = timing();
        if (glide === null || from === to) {
            paint(to);
            done();
            return;
        }
        const durationMs = glide.duration * 1000;
        const curve = cubicBezier(glide.ease[0], glide.ease[1], glide.ease[2], glide.ease[3]);
        const steps = Math.max(1, Math.ceil(durationMs / SAMPLE_MS));
        const rootFrames = [];
        const radiusFrames = [];
        for (let k = 0; k <= steps; k += 1) {
            const { transform, radius } = styleAt(lerp(from, to, curve(k / steps)));
            rootFrames.push({ transform, offset: k / steps });
            radiusFrames.push({ borderRadius: radius, offset: k / steps });
        }
        const anims = [animateShared(root, rootFrames, durationMs), frame === null ? null : animateShared(frame, radiusFrames, durationMs)].filter((a) => a !== null);
        // Under the animation, the box it lands on, so its end hands over without a frame of the old one.
        if (anims.length > 0)
            paint(to);
        run = { from, to, startMs: sharedStartTime(), durationMs, curve, anims, done };
        progress = from;
        const step = () => {
            tick = null;
            if (run === undefined)
                return;
            const now = performance.now();
            const p = progressAt(now);
            if (now - run.startMs >= run.durationMs) {
                const finished = run;
                run = undefined;
                paint(finished.to);
                for (const anim of finished.anims)
                    anim.cancel();
                finished.done();
                return;
            }
            // Without the Web Animations API the frame loop draws each frame itself.
            if (run.anims.length === 0)
                paint(p);
            else
                progress = p;
            tick = requestAnimationFrame(step);
        };
        tick = requestAnimationFrame(step);
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
            halt();
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
