import * as React from 'react';
import { focusPanelIn } from './rowDom.js';

/** Marks the cover a first press puts over its panel until the press is over. */
export const PRESS_COVER_ATTRIBUTE = 'data-panel-press-cover';

// A touch's mouse events and click come after touchend, hit-tested afresh; the cover must still be there for them.
const COVER_LINGER_MS = 500;

/**
 * Makes a press on a panel not in use only put it in use: what the press lands on never sees its mousedown or click, and the
 * pointerdown itself still reaches the row and the window, which judge where a press lands. The release lands on a cover,
 * so the click goes to the slot or the cover, never to a control inside the panel.
 */
export function swallowFirstPress(slot: HTMLElement, event: PointerEvent): void {
  if (event.button !== 0) return;
  const doc = slot.ownerDocument;
  const view = doc.defaultView ?? window;
  const cover = doc.createElement('div');
  cover.setAttribute(PRESS_COVER_ATTRIBUTE, '');
  cover.style.cssText = 'position:absolute;inset:0;z-index:2147483647;background:transparent;';
  slot.appendChild(cover);
  let timer = 0;
  const inside = (target: EventTarget | null): boolean => target instanceof Node && target !== slot && target !== cover && slot.contains(target);
  const onMouseDown = (e: MouseEvent): void => {
    // No caret, selection or focus for what was pressed, and no menu that opens on mousedown.
    e.preventDefault();
    if (inside(e.target)) e.stopPropagation();
  };
  const onClick = (e: MouseEvent): void => {
    // Only a control that captured the pointer still gets the click; one on the slot or the cover goes on to the page's own listeners.
    if (inside(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
    done();
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return;
    view.clearTimeout(timer);
    timer = view.setTimeout(done, COVER_LINGER_MS);
  };
  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId === event.pointerId) done();
  };
  function done(): void {
    view.clearTimeout(timer);
    cover.remove();
    slot.removeEventListener('mousedown', onMouseDown, true);
    slot.removeEventListener('click', onClick, true);
    view.removeEventListener('pointerup', onUp, true);
    view.removeEventListener('pointercancel', onCancel, true);
  }
  slot.addEventListener('mousedown', onMouseDown, true);
  slot.addEventListener('click', onClick, true);
  view.addEventListener('pointerup', onUp, true);
  view.addEventListener('pointercancel', onCancel, true);
  // Keystrokes follow the panel now in use, as they would had the press focused something inside it.
  focusPanelIn(slot);
}

const FRAMES = 'iframe,frame,embed,object';
const asleepFrames = new WeakMap<HTMLElement, string>();

/**
 * While `asleep`, the frames in `slot` take no pointer, so a first press on one lands in this document and only puts the
 * panel in use. A wheel over such a frame scrolls nothing until the panel is in use.
 */
export function useFramesAsleep(slot: React.RefObject<HTMLElement | null>, holdsFrame: boolean, asleep: boolean): void {
  React.useLayoutEffect(() => {
    const node = slot.current;
    if (node === null || !holdsFrame) return undefined;
    const frames = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(FRAMES)];
    const wake = (): void => {
      for (const f of frames()) {
        const before = asleepFrames.get(f);
        if (before === undefined) continue;
        f.style.pointerEvents = before;
        asleepFrames.delete(f);
      }
    };
    if (!asleep) {
      wake();
      return undefined;
    }
    const sleep = (): void => {
      for (const f of frames()) {
        if (asleepFrames.has(f)) continue;
        asleepFrames.set(f, f.style.pointerEvents);
        f.style.pointerEvents = 'none';
      }
    };
    sleep();
    const observer = new MutationObserver(sleep);
    observer.observe(node, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      wake();
    };
  }, [slot, holdsFrame, asleep]);
}
