import * as React from 'react';
import { animate, PresenceContext, usePresence, useReducedMotion, useReducedMotionConfig, type TargetAndTransition } from 'motion/react';
import { sharedStartTime } from './rowClock.js';
import { NAMED_EASE, createSlotMover, shortTransform, type SlotMover, type SlotPose, type SlotTiming } from './slotMover.js';
import { SLOT_TRANSITION, directionalTransition, slideToTransition } from './directionalTransition.js';
import { CHROME_ATTRIBUTE, ChromeStoreContext, createRectReporter, markPanelPress, usePanelDragging, type PanelRectReporter } from './panelChrome.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import type { SlideTuning } from './panelSettings.js';
import { ROW_GAP, ROW_LAYER_Z } from './rowConstants.js';
import { OPEN_Z, SlotRanksContext, slotZ } from './rowSlotZ.js';
import { HostMissingProviderError } from './hostApi.js';
import { LandingContext, useOptionalPhoneSize } from './phoneFit.js';
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

/**
 * One live panel's animated slot, absolutely positioned at its own `leftOffset` so adding,
 * removing or resizing a panel never disturbs the ones to its left; `x`, not `left`, so the
 * browser composites it. Motion drives enter/exit (AnimatePresence keeps an outgoing node
 * mounted through its own unmount commit, unlike a plain CSS transition), and its Web Animations
 * API is immune to a theme's transition/animation:none reset, which must stay scoped there and never reach
 * transform/opacity, or it would kill this silently.
 */
export interface PanelRowSlotMotion {
  /** Where the slot starts when it mounts: one span beyond its resting place, faded out. */
  readonly initial: TargetAndTransition;
  /** The slot's resting position. */
  readonly animate: TargetAndTransition;
  /** Where the slot goes when it leaves: off the edge it was hidden past, or down for a close. */
  readonly exit: TargetAndTransition;
  /** The timing the slot moves with. */
  readonly transition: typeof PANEL_TRANSITION;
}

/** Whether `target` is a button or grab bar in a panel's own header, grab bar or footer: using one is not using the panel's content. */
function isChromeControl(target: EventTarget): boolean {
  const control = target instanceof Element ? target.closest('button, [role="button"], [data-panel-grab-bar]') : null;
  return control?.closest(`[${CHROME_ATTRIBUTE}]`) != null || control?.hasAttribute('data-panel-grab-bar') === true;
}

const noSubscribe = (): (() => void) => () => {};

/** The same targets, no time taken: for Reduce Motion, snapping and width tracking. */
const INSTANT_TRANSITION = { duration: 0 } as const;

/**
 * How a slot enters: a slide from one side, a fade where it rests, or a scale up from 0: about its center for 'expand'
 * (an open), and about the edge on the side it comes in from for 'expand-left' / 'expand-right' (a reveal).
 * @internal
 */
export type SlotEntrance = 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'expand' | 'expand-left' | 'expand-right';

/** The transform origin each side expand grows about, as a fraction of the slot's width. */
const EXPAND_ORIGIN_X: Readonly<Partial<Record<SlotEntrance, number>>> = { 'expand-left': 0, 'expand-right': 1 };

/**
 * How a slot leaves: 'down' is the close exit on the close timing; the others take the slide timing. 'shrink' (a close)
 * scales it to 0 about its center, and 'shrink-left' / 'shrink-right' (a park) about the edge on the side it leaves by.
 * @internal
 */
export type SlotExit = 'down' | 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'shrink' | 'shrink-left' | 'shrink-right';

/** The transform origin each shrink scales about, as a fraction of the slot's width. */
const SHRINK_ORIGIN_X: Readonly<Partial<Record<SlotExit, number>>> = { shrink: 0.5, 'shrink-left': 0, 'shrink-right': 1 };

/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export function panelRowSlotMotion(
  leftOffset: number,
  width: number,
  phoneHeight: number,
  enterDirection: SlotEntrance,
  exitDirection: SlotExit,
  gap: number = ROW_GAP,
  slide: SlideTuning = LIBRARY_TUNING_DEFAULTS.slide,
  rowScroll = false,
): PanelRowSlotMotion {
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
  const { initial, animate } =
    enterDirection === 'left' || enterDirection === 'right'
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
  const exit: TargetAndTransition =
    exitDirection === 'down'
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

/** The `x` and `opacity` a slot moves between. */
interface SlotValues {
  readonly x: number;
  readonly opacity: number;
}

/**
 * Where a slot goes when its panel parks: off the edge it was hidden past, faded out. In a scrolling row the strip
 * extends far past the window, so the exit is one span from the slot's own rest on either side; in a row that never
 * scrolls the left edge is the row's own origin.
 * @internal
 */
export function parkExitTarget(rest: number, ownSpan: number, side: 'left' | 'right', rowScroll: boolean): SlotValues {
  if (side === 'right') return { x: rest + ownSpan, opacity: 0 };
  return { x: rowScroll ? rest - ownSpan : -ownSpan, opacity: 0 };
}

/** A Motion target as the pose it names: what it leaves out is the slot at rest. */
const poseOf = (t: TargetAndTransition, rest: number): SlotPose => ({
  x: typeof t.x === 'number' ? t.x : rest,
  y: typeof t.y === 'number' ? t.y : 0,
  scale: typeof t.scale === 'number' ? t.scale : 1,
  opacity: typeof t.opacity === 'number' ? t.opacity : 1,
});

/** A Motion transition's timing as a slot move's; a named curve is Motion's bezier for it. */
function timingOf(t: { duration?: number; ease?: unknown } | undefined, fallback: SlotTiming): SlotTiming {
  if (t === undefined) return fallback;
  const ease = typeof t.ease === 'string' && t.ease in NAMED_EASE ? NAMED_EASE[t.ease as keyof typeof NAMED_EASE] : Array.isArray(t.ease) && t.ease.length === 4 ? (t.ease as unknown as SlotTiming['ease']) : fallback.ease;
  return { duration: t.duration ?? fallback.duration, ease };
}

/**
 * The imperative moves a slot makes on its own element. An object so a test can wrap them and read the order of the
 * calls; `set` draws at once, `glide` starts a move on the shared start time.
 * @internal
 */
export const slotDriver = {
  set(el: HTMLElement, mover: SlotMover, pose: SlotPose): void {
    void el;
    mover.set(pose);
  },
  glide(el: HTMLElement, mover: SlotMover, pose: SlotPose, timing: SlotTiming, done?: () => void): void {
    void el;
    mover.to(pose, timing, done);
  },
};

/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export function PanelRowSlot({
  panelId,
  label,
  leftOffset,
  width,
  phoneHeight,
  top,
  height,
  enterDirection,
  exitDirection,
  zIndex,
  tracking = false,
  gap,
  slide,
  rowScroll = false,
  previewing = false,
  firstPressFocusOnly = false,
  onActivate,
  dragged = false,
  frame,
  children,
}: {
  /** The panel this slot draws; the row's edge fade finds the slot by it. */
  panelId?: string;
  /** The slot's accessible name, set on its group: the panel's title and its place among the panels drawn. */
  label?: string;
  /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
  leftOffset: number;
  /** This panel's own width (`panelWidthOf`), also this slot's enter/exit travel distance (`panelRowSlotMotion`'s `ownSpan`). */
  width: number;
  /** The height in px a closing slot drops by. */
  phoneHeight: number;
  /** Where the slot's top edge sits in the row box, and its own height: a panel shorter than the row is aligned inside it. Omitted: the slot fills the row's height. */
  top?: number;
  height?: number;
  /** Computed by the caller (panelRowOrder.ts's `resolveEnterDirection`, or an explicit gesture side).
   * Must be correct on this component's FIRST render after the item (re)appears -- AnimatePresence
   * has no later render of a fresh mount to fix a wrong guess. */
  enterDirection: SlotEntrance;
  /** Must be correct on this component's LAST render before it leaves the `live`-filtered array --
   * AnimatePresence has no later render of a removed child to fix a wrong guess. */
  exitDirection: SlotExit;
  /**
   * The slot's tier (`ROW_LAYER_Z.BASE` or `RAISED`). Each slot carries a `transform`, so it is its OWN stacking context and a child's `zIndex`
   * cannot compare against a SIBLING slot: stacking between slots (e.g. a raised column above a panel sliding
   * left behind it) must be set HERE, on the slot, not on what renders inside it. Defaults to 0.
   */
  zIndex?: number;
  /** True while a host holds a width on a panel of the row: the slot's moves take no time, so a width that follows a pointer moves it the same frame. Default false. */
  tracking?: boolean;
  /** The row's gap and this panel's slide; the library defaults when omitted. */
  gap?: number;
  slide?: SlideTuning;
  /** Whether the row scrolls: a park then exits relative to this slot's rest. Default false. */
  rowScroll?: boolean;
  /** True while a sideways drag previews the reorder: under Reduce Motion the slot's own moves then snap, since a preview-time slide carries no information. */
  previewing?: boolean;
  /** True when a press on this panel while it is not in use only puts it in use (the template's `firstPressFocusOnly`, else `tuning.firstPressFocusOnly`). Default false. */
  firstPressFocusOnly?: boolean;
  /** Called when a press or focus lands anywhere inside the slot, a portaled descendant included (React capture handlers follow the React tree); `control` is true when it lands on a control of the panel's own chrome. */
  onActivate?: (control: boolean) => void;
  /** True for the slot whose box is being dragged: its rest moving during the preview is the drop, which lands at once whatever the motion setting. */
  dragged?: boolean;
  /** Where the strip's coordinates start in the row, in px: the left group's width. When it changes the slot is carried by the opposite amount at once, so only its own rest moves it. Omitted for a held slot, which the strip does not carry. */
  frame?: number;
  /** The panel rendered inside the slot. */
  children: React.ReactNode;
}) {
  // The entrance is read once, as the slot mounts: an enter in progress keeps its style whatever the settings say later.
  const [entrance] = React.useState(enterDirection);
  // A slot entering the row is drawn one level under its rank until it has arrived, so it tucks under its inner neighbor;
  // a new open grows from its center while the panel in its slot slides out, so it is drawn under the whole row until it has grown.
  // A slot mounted with the row (AnimatePresence initial={false}) never animates in, so it is never entering.
  const presence = React.useContext(PresenceContext);
  const mountedWithRow = presence?.initial === false;
  const [entering, setEntering] = React.useState(!mountedWithRow);
  const { initial, animate: animateTarget, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, entrance, exitDirection, gap, slide, rowScroll);
  const el = React.useRef<HTMLDivElement>(null);
  const mover = React.useRef<SlotMover | null>(null);
  // What a report and the frame loop read: the row's store and this slot's panel id, as of this render.
  const chrome = React.useContext(ChromeStoreContext);
  const live = React.useRef({ chrome, panelId });
  live.current = { chrome, panelId };
  const reporter = React.useRef<PanelRectReporter | null>(null);
  // True from the start of this slot's move until it lands; the store mirrors it for usePanelSliding.
  const sliding = React.useRef(false);
  const kickRect = React.useCallback((): void => reporter.current?.kick(), []);
  const setSliding = (on: boolean): void => {
    sliding.current = on;
    const { chrome: store, panelId: id } = live.current;
    if (store !== undefined && id !== undefined) store.setSliding(id, on);
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
    const onWindowBlur = (): void => {
      const focused = document.activeElement;
      if (focused instanceof HTMLIFrameElement && el.current?.contains(focused)) activate.current?.(false);
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, []);
  const snapping = previewing && (reducedMotion || systemReduced || dragged);
  const instant = reducedMotion === true || snapping || tracking;
  // A drag of any axis lifts its slot above the row's others until it has settled; the slot is its own stacking context, so only its z can do it.
  const lifted = usePanelDragging();
  const [present, safeToRemove] = usePresence();
  // A leaving slot's props no longer change, but context still reaches it: a panel the window's jump left no room for goes in that commit.
  const landing = React.useContext(LandingContext);
  // The slot's rank from either end of the row follows the row through this context even while the slot leaves, when its props no longer change.
  const { ranks, mounted } = React.useContext(SlotRanksContext);
  const rank = panelId === undefined ? 0 : (ranks.get(panelId) ?? 0);
  React.useEffect(() => (panelId === undefined ? undefined : mounted(panelId)), [panelId, mounted]);
  const shrinkOrigin = present ? undefined : SHRINK_ORIGIN_X[exitDirection];
  const shrinking = shrinkOrigin !== undefined;
  const glide = (pose: SlotPose, timing: SlotTiming, done?: () => void): void => {
    const node = el.current;
    const m = mover.current;
    if (node === null || m === null) return;
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
  const lastRest = React.useRef<number | null>(null);
  const lastFrame = React.useRef<number | undefined>(undefined);
  const exiting = React.useRef(false);
  React.useLayoutEffect(() => {
    const node = el.current;
    if (node === null) return;
    const carried = frame === undefined || lastFrame.current === undefined ? 0 : frame - lastFrame.current;
    lastFrame.current = frame;
    const rest = poseOf(animateTarget, leftOffset);
    if (mover.current === null) {
      const enters = !mountedWithRow && !instant;
      mover.current = createSlotMover(node, enters ? poseOf(initial, leftOffset) : rest);
      lastRest.current = leftOffset;
      if (enters)
        glide(rest, timingOf(transition, transition), () => {
          setEntering(false);
        });
      else setEntering(false);
      return;
    }
    const m = mover.current;
    if (!present) {
      if (exiting.current) return;
      exiting.current = true;
      if (landing) {
        // Hidden in this commit; AnimatePresence only takes the removal after its own layout effect, which runs after this one.
        node.style.visibility = 'hidden';
        queueMicrotask(() => safeToRemove?.());
        return;
      }
      const timing = reducedMotion === true ? { duration: 0, ease: transition.ease } : timingOf(exit.transition as { duration?: number; ease?: unknown } | undefined, transition);
      glide(poseOf(exit, leftOffset), timing, () => safeToRemove?.());
      return;
    }
    // The strip's start moved under the slot in this commit: put the slot back where it was drawn before its own move runs from there.
    if (carried !== 0) {
      const at = m.pose();
      slotDriver.set(node, m, { ...at, x: at.x - carried });
    }
    const moved = lastRest.current !== leftOffset || carried !== 0;
    const returning = exiting.current;
    exiting.current = false;
    lastRest.current = leftOffset;
    if (!moved && !returning) return;
    if (instant) {
      slotDriver.set(node, m, rest);
      kickRect();
      return;
    }
    // A slot added back while its exit was running enters again: under its inner neighbor as it scales back up. Any glide to
    // a rest ends the entering level, since a move during the entrance replaces the entrance glide and its own end never comes.
    if (returning) setEntering(true);
    glide(rest, transition, () => setEntering(false));
  });
  // A box that moves by its own motion, a drag, a resize or a row scroll is reported until it stops. A slot that mounts
  // reports its rest once; its reporter is recreated under StrictMode's second setup, so nothing here is shared.
  React.useLayoutEffect(() => {
    const node = el.current;
    if (node === null) return;
    const row = closestRowScroller(node);
    const rowMoving = (): boolean => row !== null && (rowScrollerFor(row).glideTarget() !== null || rowScrollerFor(row).claimHeld());
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
    const unsubscribeRow = row === null ? () => {} : rowScrollerFor(row).subscribe(kickRect);
    rep.kick();
    return () => {
      unsubscribeRow();
      rep.stop();
      reporter.current = null;
      if (sliding.current) setSliding(false);
    };
  }, [kickRect]);
  React.useEffect(() => {
    if (chrome === undefined || panelId === undefined) return;
    const offs = [chrome.subscribePanel(panelId, kickRect), chrome.subscribeResizing(kickRect), chrome.subscribeDrawn(kickRect)];
    return () => {
      for (const off of offs) off();
    };
  }, [chrome, panelId, kickRect]);
  const origin = shrinking ? shrinkOrigin : EXPAND_ORIGIN_X[entrance];
  // The first pose is in the markup, so a server render or the frame before the layout effect draws the slot in place. It never
  // changes after, so React never writes over the mover's own transform.
  const [firstPose] = React.useState(() => {
    const p = mountedWithRow || instant ? poseOf(animateTarget, leftOffset) : poseOf(initial, leftOffset);
    return { opacity: p.opacity, transform: shortTransform(p) };
  });
  return (
    <div
      ref={el}
      {...(label === undefined ? {} : { role: 'group', 'aria-label': label })}
      data-row-slot={leftOffset}
      data-row-id={panelId}
      onPointerDownCapture={(e) => {
        markPanelPress(e.nativeEvent);
        const control = isChromeControl(e.target);
        const first = firstPressFocusOnly && onActivate !== undefined && chrome !== undefined && panelId !== undefined && chrome.active() !== panelId;
        onActivate?.(control);
        if (first && !control && el.current !== null) swallowFirstPress(el.current, e.nativeEvent);
      }}
      onFocusCapture={(e) => onActivate?.(isChromeControl(e.target))}
      style={{
        position: 'absolute',
        top: top ?? 0,
        ...(height === undefined ? { bottom: 0 } : { height }),
        left: 0,
        // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
        width,
        zIndex: lifted ? Math.max(zIndex ?? 0, ROW_LAYER_Z.DRAGGED) : entering && present && entrance === 'expand' ? OPEN_Z : slotZ(zIndex ?? 0, rank, !present || entering),
        ...firstPose,
        ...(origin !== undefined ? { transformOrigin: `${origin * 100}% 50%` } : {}),
      }}
    >
      {framed && <TabSentinel end={false} />}
      {children}
      {framed && <TabSentinel end />}
    </div>
  );
}

// No aria-hidden (a focusable element must not carry it) and no role: presentation is ignored on a focusable element anyway.
// Zero-size, not display:none, so the browser still gives it a tab stop.
// A tab stop on a non-interactive element is the point: it exists only to catch the browser's step out of an iframe.
const SENTINEL_STOP = { tabIndex: 0 };

function TabSentinel({ end }: { end: boolean }): React.ReactElement {
  return <span {...SENTINEL_STOP} data-row-sentinel={end ? 'end' : 'start'} style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', outline: 'none' }} />;
}

const FRAMES = 'iframe,frame,embed,object';

// Only a cross-document element can swallow a Tab press, so a slot gets sentinels only while it holds one.
function useHoldsFrame(slot: React.RefObject<HTMLElement | null>): boolean {
  const [holds, setHolds] = React.useState(false);
  React.useLayoutEffect(() => {
    const node = slot.current;
    if (node === null) return;
    const sync = () => setHolds(node.querySelector(FRAMES) !== null);
    sync();
    // Only an added or removed frame changes the answer; the sentinels this very state adds must not re-run the query.
    const touchesFrame = (nodes: NodeList): boolean => [...nodes].some((n) => n instanceof Element && (n.matches(FRAMES) || n.querySelector(FRAMES) !== null));
    const observer = new MutationObserver((records) => {
      if (records.some((r) => touchesFrame(r.addedNodes) || touchesFrame(r.removedNodes))) sync();
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
export function PanelSizeBox({
  width,
  height,
  reveal,
  children,
}: {
  /** The box's width in px; a change animates. Omitted: the slot's drawn width inside a row, else the phone width. */
  width?: number;
  /** The box's height in px; a change animates. Omitted: the slot's drawn height inside a row, else the phone height. */
  height?: number;
  /**
   * True: while the box glides, its content is laid out once at the larger of the start and end sizes and is clipped, not
   * scaled, to the eased size, so the content is resized when a grow starts and when a shrink ends and is never stretched.
   * Nothing is clipped above the box, nor below it while the height holds, so a frame's header and footer still show. Default false.
   */
  reveal?: boolean;
  /** The content, laid out at the box's new size, or under `reveal` at the glide's larger size. */
  children: React.ReactNode;
}) {
  return (
    <SizeBox width={width} height={height} reveal={reveal}>
      {children}
    </SizeBox>
  );
}

/** A size glide of a panel's box: where it started and where it lands. A height of `'100%'` is the slot's own. @public */
export interface PanelSizeGlide {
  /** The box's size when the glide started. */
  from: { width: number; height: number | '100%' };
  /** The size the glide lands on. */
  to: { width: number; height: number | '100%' };
}

const SizeGlideContext = React.createContext<PanelSizeGlide | null>(null);

/**
 * The size glide of the panel box this is called in, from its start until it lands; null while the box is still, under Reduce
 * Motion, and outside a box. A window that draws no frames does not advance a glide, so a host that waits on its end caps the wait.
 * @public
 */
export function usePanelSizeGlide(): PanelSizeGlide | null {
  return React.useContext(SizeGlideContext);
}

const missingHost = (): never => {
  throw new HostMissingProviderError();
};

/** True below a `SizeBox`: a box inside another is a plain div filling it, because two glides of one size would fight. */
const SizeBoxContext = React.createContext(false);

/** True below a `SizeBox`: the panel and its frame fill the box, so they glide with it. @internal */
export const useInsideSizeBox = (): boolean => React.useContext(SizeBoxContext);

/**
 * `PanelSizeBox` with a height that may be the slot's own (`'100%'`, a panel that fills the row's height), which is the box the
 * default frame draws around its whole panel. A box below another draws a plain div of the same size.
 * @internal
 */
export function SizeBox({ width: given, height: givenHeight, reveal = false, children }: { width?: number; height?: number | '100%'; reveal?: boolean; children: React.ReactNode }) {
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
  const box = React.useRef<HTMLDivElement>(null);
  const run = React.useRef<SizeRun | undefined>(undefined);
  const laidOut = React.useRef<BoxSize | undefined>(undefined);
  const [glide, setGlide] = React.useState<PanelSizeGlide | null>(null);
  // Starts in the commit's layout effect, on the shared start time, so a commit that janks opens no gap to a neighbor.
  React.useLayoutEffect(() => {
    const node = box.current;
    if (node === null || nested) return;
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
    const transition = slide === undefined ? PANEL_TRANSITION : slideToTransition(slide);
    const startMs = sharedStartTime();
    run.current = runSizeGlide(node, reveal ? 'clip' : 'scale', start, to, transition, startMs, () => {
      run.current = undefined;
      setGlide(null);
    });
    const row = closestRowScroller(node);
    if (row !== null) rowScrollerFor(row).followSize({ startMs, durationSec: transition.duration, ease: transition.ease });
  }, [width, height, snaps, nested]);
  React.useEffect(() => () => run.current?.stop(), []);
  // It fills the box above, so it eases with that box rather than snapping to its own size.
  if (nested) return <div data-panel-size-plain="" style={{ width: '100%', height: '100%' }}>{children}</div>;
  // The larger size, so a grow lays the content out once at its start and a shrink once at its end.
  const content = reveal ? (
    <div
      data-panel-size-reveal=""
      style={{
        width: glide === null ? '100%' : Math.max(glide.from.width, glide.to.width),
        height: glide !== null && typeof glide.from.height === 'number' && typeof glide.to.height === 'number' && glide.from.height !== glide.to.height ? Math.max(glide.from.height, glide.to.height) : '100%',
      }}
    >
      {children}
    </div>
  ) : (
    children
  );
  // Laid out at the landing size once; the glide is drawn by a transform or a clip, which the browser composites.
  return (
    <div ref={box} data-panel-size-box="" style={{ width, height }}>
      <SizeBoxContext.Provider value>
        <SizeGlideContext.Provider value={glide}>{content}</SizeGlideContext.Provider>
      </SizeBoxContext.Provider>
    </div>
  );
}

type BoxSize = { width: number; height: number | '100%' };

interface SizeRun {
  readonly from: BoxSize;
  readonly to: BoxSize;
  /** The eased progress drawn now, 0 to 1. */
  progress(): number;
  stop(): void;
}

function shownSize(run: SizeRun): BoxSize {
  const p = run.progress();
  const { from, to } = run;
  return {
    width: from.width + (to.width - from.width) * p,
    height: typeof from.height === 'number' && typeof to.height === 'number' ? from.height + (to.height - from.height) * p : to.height,
  };
}

// The box keeps its landing size; a scale (reflow) or a clip (reveal) draws the eased size about its top left corner.
function sizeFrame(kind: 'clip' | 'scale', size: BoxSize, to: BoxSize, heightEases: boolean): string {
  const h = heightEases ? (size.height as number) / (to.height as number) : 1;
  if (kind === 'scale') return `scale(${size.width / to.width}, ${h})`;
  // Never clipped above, and below only while the height eases: a frame's header and footer may be drawn outside the box.
  return `inset(-100vh ${to.width - size.width}px ${heightEases ? `${(to.height as number) - (size.height as number)}px` : '-100vh'} 0px)`;
}

function runSizeGlide(
  node: HTMLElement,
  kind: 'clip' | 'scale',
  from: BoxSize,
  to: BoxSize,
  transition: { duration: number; ease: [number, number, number, number] },
  startTime: number,
  onLand: () => void,
): SizeRun {
  const property = kind === 'clip' ? 'clipPath' : 'transform';
  const heightEases = typeof from.height === 'number' && typeof to.height === 'number' && from.height !== to.height;
  const first = sizeFrame(kind, from, to, heightEases);
  const last = sizeFrame(kind, to, to, heightEases);
  if (typeof node.animate === 'function') {
    // A Web Animation, not a style written each frame: it leaves no style behind when it ends or is cancelled.
    // `startTime` can be ahead of the timeline, whose clock only moves per frame; without the backwards fill that frame shows the landing size.
    const animation = node.animate({ [property]: [first, last], ...(kind === 'scale' ? { transformOrigin: ['0 0', '0 0'] } : {}) }, { duration: transition.duration * 1000, easing: `cubic-bezier(${transition.ease.join(',')})`, fill: 'backwards' });
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
  const draw = (p: number): void => {
    shown = p;
    if (kind === 'scale') node.style.transformOrigin = p >= 1 ? '' : '0 0';
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
