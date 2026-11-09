/**
 * Touch handling for a template declared with `touch: true` or `touch: 'content'`: while such a panel is active and the pointer is inside it, a mouse
 * drag scrolls the content under it as a finger does and coasts on release. It never moves the row, which stays the wheel's
 * and the keys'. Anywhere else, or with Option (Alt) held at the press, the mouse is a mouse. A press that stays put clicks.
 */
import * as React from 'react';
import { ACTIVE_ATTRIBUTE } from './panelChrome.js';
import { PHONE_FRAME_ATTRIBUTE } from './PanelFrame.js';
import type { PanelTouch } from './panelTemplate.js';

const TOUCH_ATTRIBUTE = 'data-panel-touch';
const TOUCH_PANEL = `[${ACTIVE_ATTRIBUTE}][${TOUCH_ATTRIBUTE}]`;
const FRAME = `[${PHONE_FRAME_ATTRIBUTE}]`;
// The element a touch drag may start in: the whole panel, or under 'content' only its frames, leaving the header and footer to the mouse.
const AREAS = [`${TOUCH_PANEL}[${TOUCH_ATTRIBUTE}=""]`, `${TOUCH_PANEL}[${TOUCH_ATTRIBUTE}="content"] ${FRAME}`];

// A finger's dot instead of the arrow, and no scrollbars, as on a phone; the content still scrolls.
const FINGER = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="rgba(128,128,128,0.35)" stroke="rgba(255,255,255,0.8)" stroke-width="2"/></svg>')}") 14 14, auto`;
const CSS = AREAS.map((a) => `${a}, ${a} * { cursor: ${FINGER} !important; } ${a} * { scrollbar-width: none; } ${a} *::-webkit-scrollbar { display: none; }`).join(' ');

const inArea = (target: Element): boolean => AREAS.some((a) => target.closest(a) !== null);

/** Under the library's 6 px drag activation, so a drag is ours before any panel or tile drag can start. */
const SLOP_PX = 4;
/** Only the last stretch of a drag sets the coast speed, as a flick does. */
const VELOCITY_WINDOW_MS = 80;
/** Speed kept per millisecond of coasting: close to a phone's normal deceleration. */
const FRICTION_PER_MS = 0.997;
const STOP_PX_PER_MS = 0.02;

/** Text fields and sliders keep the mouse, as they keep a finger's press for their own caret or thumb. */
const OWN_POINTER = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"]';

type Axis = 'x' | 'y';

function scrollerFor(from: Element, panel: Element, axis: Axis, delta: number): HTMLElement | null {
  for (let el: Element | null = from; el !== null && panel.contains(el); el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const overflow = getComputedStyle(el)[axis === 'y' ? 'overflowY' : 'overflowX'];
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const [pos, size, view] = axis === 'y' ? [el.scrollTop, el.scrollHeight, el.clientHeight] : [el.scrollLeft, el.scrollWidth, el.clientWidth];
    if (size <= view + 1) continue;
    // A finger moving down (delta > 0) asks for the content above, so only a scroller that is not at its top takes it.
    if (delta > 0 ? pos > 0 : pos + view < size - 1) return el;
  }
  return null;
}

function attach(win: Window): () => void {
  let drag: { id: number; target: Element; panel: Element; x: number; y: number; axis: Axis | null; el: HTMLElement | null; samples: { t: number; v: number }[] } | null = null;
  let coast = 0;
  let swallowClick = false;

  const stopCoast = (): boolean => {
    if (coast === 0) return false;
    cancelAnimationFrame(coast);
    coast = 0;
    return true;
  };

  const startCoast = (el: HTMLElement, axis: Axis, velocity: number): void => {
    let v = velocity;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = now - last;
      last = now;
      v *= FRICTION_PER_MS ** dt;
      if (Math.abs(v) < STOP_PX_PER_MS) { coast = 0; return; }
      if (axis === 'y') el.scrollTop -= v * dt;
      else el.scrollLeft -= v * dt;
      coast = requestAnimationFrame(step);
    };
    coast = requestAnimationFrame(step);
  };

  const onDown = (e: PointerEvent): void => {
    // A press on coasting content only stops it, as a tap does on a phone.
    const stopped = stopCoast();
    swallowClick = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.altKey || !(e.target instanceof Element)) return;
    // A press on a panel not yet active only activates it: the library marks it after this capture listener runs.
    const panel = e.target.closest(TOUCH_PANEL);
    if (panel === null || !inArea(e.target) || e.target.closest(OWN_POINTER) !== null) return;
    swallowClick = stopped;
    drag = { id: e.pointerId, target: e.target, panel, x: e.clientX, y: e.clientY, axis: null, el: null, samples: [] };
  };

  const onMove = (e: PointerEvent | MouseEvent): void => {
    if (drag === null) return;
    if ('pointerId' in e && e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.axis === null) {
      if (Math.hypot(dx, dy) < SLOP_PX) return;
      drag.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      drag.el = scrollerFor(drag.target, drag.panel, drag.axis, drag.axis === 'y' ? dy : dx);
    }
    // Every move after the slop is ours: a panel, tile or grab-bar drag never sees enough travel to start.
    e.stopPropagation();
    e.preventDefault();
    if (e.type !== 'pointermove') return;
    const delta = drag.axis === 'y' ? e.clientY - drag.y : e.clientX - drag.x;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.el !== null) {
      if (drag.axis === 'y') drag.el.scrollTop -= delta;
      else drag.el.scrollLeft -= delta;
      const now = e.timeStamp;
      drag.samples.push({ t: now, v: delta });
      while (now - (drag.samples[0]?.t ?? now) > VELOCITY_WINDOW_MS) drag.samples.shift();
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (drag === null || e.pointerId !== drag.id) return;
    const done = drag;
    drag = null;
    if (done.axis === null) return;
    swallowClick = true;
    const first = done.samples[0];
    const span = first === undefined ? 0 : e.timeStamp - first.t;
    if (done.el !== null && span > 0) {
      const velocity = done.samples.reduce((sum, s) => sum + s.v, 0) / span;
      if (Math.abs(velocity) >= STOP_PX_PER_MS) startCoast(done.el, done.axis, velocity);
    }
  };

  const onClick = (e: MouseEvent): void => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  };
  // An image or link would otherwise start the browser's own drag on the first move.
  const onDragStart = (e: DragEvent): void => {
    if (e.target instanceof Element && inArea(e.target)) e.preventDefault();
  };

  const cancel = (): void => { drag = null; };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('pointermove', onMove, true);
  win.addEventListener('mousemove', onMove, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', cancel, true);
  win.addEventListener('click', onClick, true);
  win.addEventListener('dragstart', onDragStart, true);
  return () => {
    stopCoast();
    win.removeEventListener('pointerdown', onDown, true);
    win.removeEventListener('pointermove', onMove, true);
    win.removeEventListener('mousemove', onMove, true);
    win.removeEventListener('pointerup', onUp, true);
    win.removeEventListener('pointercancel', cancel, true);
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('dragstart', onDragStart, true);
  };
}

// One set of window listeners and one stylesheet for every touch panel in the document, however many are mounted.
let users = 0;
let detach: (() => void) | null = null;

function use(doc: Document): () => void {
  if (users++ === 0) {
    const style = doc.createElement('style');
    style.setAttribute('data-phonux-touch', '');
    style.textContent = CSS;
    doc.head.appendChild(style);
    const off = doc.defaultView === null ? () => {} : attach(doc.defaultView);
    detach = () => { off(); style.remove(); };
  }
  return () => {
    if (--users > 0) return;
    detach?.();
    detach = null;
  };
}

/** The `touch` of the template the panel is made from. @internal */
export const PanelTouchContext = React.createContext<PanelTouch>(false);

/** The attributes and listeners a panel root needs for touch: `rootRef` is the root, `touch` the context value. @internal */
export function usePanelTouch(rootRef: React.RefObject<HTMLElement | null>, touch: PanelTouch): Record<string, string> {
  React.useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    return touch !== false && doc !== undefined ? use(doc) : undefined;
  }, [rootRef, touch]);
  return touch === false ? {} : { [TOUCH_ATTRIBUTE]: touch === 'content' ? 'content' : '' };
}
