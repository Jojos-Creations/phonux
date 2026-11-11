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
import { maximizablePanels, maximizedPanel, reportMaximized, type MaximizablePanel, type MaximizePhase } from './maximizedStore.js';

/**
 * On a panel's root while it fills the window. Style the maximized panel through it, for example a square frame.
 * @public
 */
export const MAXIMIZED_ATTRIBUTE = 'data-panel-maximized';


type Timing = { readonly duration: number; readonly ease: readonly [number, number, number, number] } | null;

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface Maximizer {
  grow(): void;
  shrink(): void;
  dispose(): void;
}

/** The browser's popover defaults (centered, bordered, padded, opaque) would all show on the root, so each is undone. */
const FLOATING = { position: 'fixed', inset: 'auto', margin: '0', border: '0', padding: '0', overflow: 'visible', background: 'transparent', color: 'inherit' } as const;

const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

const boxOf = ({ top, left, width, height }: DOMRect): Box => ({ top, left, width, height });

/** The layout viewport, which a fixed element with every inset 0 fills, less `topInset`. */
const windowBox = (topInset: number): Box => ({
  top: topInset,
  left: 0,
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight - topInset,
});

function restoreStyle(el: HTMLElement, style: string | null): void {
  if (style === null) el.removeAttribute('style');
  else el.setAttribute('style', style);
}

// The eased curve is written as linear steps this far apart.
const SAMPLE_MS = 1000 / 60;

/**
 * Grows `root` from its slot until it fills the window, and back. The root goes to the top layer through the popover attribute, so
 * no ancestor's transform, clip or stacking order can hold it and it never leaves its place in the DOM, which a web view inside it
 * would answer by reloading. The grow and the shrink ease its real box between the slot's and the window's, so its content is laid
 * out at the size it is drawn at: never stretched, with the frame's border, corners and edge controls on its moving edges.
 */
function createMaximizer(root: HTMLElement, timing: () => Timing, onPhase: (phase: MaximizePhase) => void, topInset: () => number): Maximizer {
  let phase: MaximizePhase = 'home';
  // 0 is the panel in its slot, 1 the panel filling the window.
  let progress = 0;
  let run: { from: number; to: number; startMs: number; durationMs: number; curve: (t: number) => number; anims: Animation[]; done: () => void } | undefined;
  let tick: number | null = null;
  let frame: HTMLElement | null = null;
  let frameRadius = 0;
  let saved: { root: string | null; frame: string | null } = { root: null, frame: null };
  // Read once per grow or shrink: the slot keeps its own size while the root is out of it, so its box is where the root belongs.
  let slot: Box = { top: 0, left: 0, width: 0, height: 0 };
  let full: Box = slot;

  const slotBox = (): Box => boxOf((root.parentElement ?? root).getBoundingClientRect());

  // The eased box, and the frame's corner easing to the window's square one.
  const boxAt = (p: number): Keyframe => ({
    top: `${lerp(slot.top, full.top, p)}px`,
    left: `${lerp(slot.left, full.left, p)}px`,
    width: `${lerp(slot.width, full.width, p)}px`,
    height: `${lerp(slot.height, full.height, p)}px`,
  });
  const cornerAt = (p: number): Keyframe => ({ borderRadius: `${lerp(frameRadius, 0, p)}px` });

  const paint = (p: number): void => {
    progress = p;
    Object.assign(root.style, boxAt(p));
    if (frame !== null) Object.assign(frame.style, cornerAt(p));
  };

  const setPhase = (next: MaximizePhase): void => {
    phase = next;
    onPhase(next);
  };

  const lift = (): void => {
    // Checked first: a root left with a popover attribute that never opened would not draw at all.
    if (typeof root.showPopover !== 'function') throw new Error('popover is not supported');
    saved = { root: root.getAttribute('style'), frame: null };
    slot = slotBox();
    root.setAttribute('popover', 'manual');
    try {
      root.showPopover();
    } catch (error) {
      root.removeAttribute('popover');
      throw error;
    }
    Object.assign(root.style, FLOATING);
    frame = root.querySelector<HTMLElement>(`:scope > [${PHONE_FRAME_ATTRIBUTE}]`);
    if (frame !== null) {
      saved.frame = frame.getAttribute('style');
      frameRadius = Number.parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
      // The frame's own pixel size would hold it at the slot's size inside the window's box.
      frame.style.width = '100%';
      frame.style.height = '100%';
    }
    full = windowBox(topInset());
    paint(0);
  };

  // Once full, the stylesheet takes over from the set box, so a resized window is followed.
  const settle = (): void => {
    root.setAttribute(MAXIMIZED_ATTRIBUTE, '');
    // Longhands: a shorthand a test cannot read would hide a wrong inset.
    Object.assign(root.style, { top: `${topInset()}px`, left: '0', right: '0', bottom: '0' });
    root.style.width = 'auto';
    root.style.height = 'auto';
    root.style.background = '';
    if (frame !== null) frame.style.borderRadius = '';
    progress = 1;
  };

  const unsettle = (): void => {
    root.removeAttribute(MAXIMIZED_ATTRIBUTE);
    root.style.background = 'transparent';
    Object.assign(root.style, { right: 'auto', bottom: 'auto' });
    full = windowBox(topInset());
    slot = slotBox();
    paint(1);
  };

  const land = (): void => {
    if (root.matches(':popover-open')) root.hidePopover();
    root.removeAttribute('popover');
    restoreStyle(root, saved.root);
    if (frame !== null) restoreStyle(frame, saved.frame);
    frame = null;
    progress = 0;
  };

  const progressAt = (nowMs: number): number => {
    if (run === undefined) return progress;
    const t = Math.min(1, Math.max(0, (nowMs - run.startMs) / run.durationMs));
    return lerp(run.from, run.to, run.curve(t));
  };

  const halt = (): void => {
    if (tick !== null) cancelAnimationFrame(tick);
    tick = null;
    if (run === undefined) return;
    const at = progressAt(performance.now());
    for (const anim of run.anims) anim.cancel();
    run = undefined;
    paint(at);
  };

  const drive = (to: 0 | 1, done: () => void): void => {
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
    const at = (k: number): number => lerp(from, to, curve(k / steps));
    const frames = (style: (p: number) => Keyframe): Keyframe[] => Array.from({ length: steps + 1 }, (_, k) => ({ ...style(at(k)), offset: k / steps }));
    const anims = [animateShared(root, frames(boxAt), durationMs), frame === null ? null : animateShared(frame, frames(cornerAt), durationMs)].filter((a): a is Animation => a !== null);
    // Under the animation, the box it lands on, so its end hands over without a frame of the old one.
    if (anims.length > 0) paint(to);
    run = { from, to, startMs: sharedStartTime(), durationMs, curve, anims, done };
    progress = from;
    const step = (): void => {
      tick = null;
      if (run === undefined) return;
      const now = performance.now();
      const p = progressAt(now);
      if (now - run.startMs >= run.durationMs) {
        const finished = run;
        run = undefined;
        paint(finished.to);
        for (const anim of finished.anims) anim.cancel();
        finished.done();
        return;
      }
      // Without the Web Animations API the frame loop draws each frame itself.
      if (run.anims.length === 0) paint(p);
      else progress = p;
      tick = requestAnimationFrame(step);
    };
    tick = requestAnimationFrame(step);
  };

  return {
    grow() {
      if (phase === 'growing' || phase === 'maximized') return;
      if (phase === 'home') lift();
      setPhase('growing');
      drive(1, () => {
        settle();
        setPhase('maximized');
      });
    },
    shrink() {
      if (phase === 'home' || phase === 'shrinking') return;
      if (phase === 'maximized') unsettle();
      setPhase('shrinking');
      drive(0, () => {
        land();
        setPhase('home');
      });
    },
    dispose() {
      halt();
      if (phase === 'home') return;
      root.removeAttribute(MAXIMIZED_ATTRIBUTE);
      land();
      phase = 'home';
    },
  };
}

/** The active panel's root in view: a column keeps every workspace mounted, and those out of view are inert. */
function activeRoot(): Element | null {
  for (const el of document.querySelectorAll(`[${ACTIVE_ATTRIBUTE}]`)) if (el.closest('[inert]') === null) return el;
  return null;
}

/**
 * Grows or shrinks one panel, for a host's keyboard shortcut: the panel that fills the window if one does, else the maximizable
 * panel holding `target`, else the active panel (the one last pressed or focused). True when it found such a panel, so the key is
 * the host's to claim, even if the browser then refused (that panel's `onRefused` hears of it); false when there was none.
 * @public
 */
export function toggleMaximize(target?: EventTarget | null): boolean {
  const root = panelRootOf(target ?? null) ?? panelRootOf(activeRoot());
  const panel = maximizedPanel() ?? (root === null ? undefined : maximizablePanels().find((candidate) => candidate.root() === root));
  panel?.toggle();
  return panel !== undefined;
}

/**
 * What `usePanelMaximize` answers.
 * @public
 */
export interface PanelMaximize {
  /** Where the panel is between its slot and the window. */
  readonly phase: MaximizePhase;
  /** True while the panel is growing or fills the window. */
  readonly maximized: boolean;
  /** Grows the panel, or shrinks it if it is growing or grown. False when the browser refused to lift it (no popover support). */
  toggle(): boolean;
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
export function usePanelMaximize(anchor: React.RefObject<HTMLElement | null>, options?: { readonly topInset?: () => number; readonly onRefused?: () => void }): PanelMaximize {
  const systemReduced = useReducedMotion();
  const configReduced = useReducedMotionConfig();
  const tuning = usePanelTuning();
  // Read as a grow or shrink starts, so a setting changed meanwhile is honored.
  const timing = React.useRef<Timing>(null);
  timing.current = systemReduced === true || configReduced === true ? null : slideToTransition(tuning.slide);
  const topInset = React.useRef(options?.topInset);
  topInset.current = options?.topInset;
  const onRefused = React.useRef(options?.onRefused);
  onRefused.current = options?.onRefused;
  const [phase, setPhase] = React.useState<MaximizePhase>('home');
  const maximizer = React.useRef<Maximizer | null>(null);
  const maximized = phase === 'growing' || phase === 'maximized';
  const exit = (): void => {
    maximizer.current?.shrink();
    // The panel's own controls are off screen until it is back, so focus returns without a scroll.
    anchor.current?.focus({ preventScroll: true });
  };
  const toggleRef = React.useRef<() => boolean>(() => false);
  const self = React.useRef<MaximizablePanel | null>(null);
  self.current ??= { root: () => panelRootOf(anchor.current), toggle: () => toggleRef.current() };
  React.useEffect(() => {
    const panel = self.current!;
    const unregister = reportMaximized(panel, 'home', true);
    return () => {
      unregister();
      maximizer.current?.dispose();
    };
  }, []);
  React.useEffect(() => {
    if (!maximized) return undefined;
    // An Escape something inside the panel already used is not also a request to leave, and neither is one the browser spends leaving its own fullscreen.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.fullscreenElement) exit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [maximized]);
  const toggle = (): boolean => {
    const root = panelRootOf(anchor.current);
    try {
      if (root === null) throw new Error('no panel root');
      maximizer.current ??= createMaximizer(
        root,
        () => timing.current,
        (next) => {
          setPhase(next);
          reportMaximized(self.current!, next);
        },
        () => topInset.current?.() ?? 0,
      );
      if (maximized) exit();
      else maximizer.current.grow();
      return true;
    } catch {
      onRefused.current?.();
      return false;
    }
  };
  toggleRef.current = toggle;
  return { phase, maximized, toggle };
}
