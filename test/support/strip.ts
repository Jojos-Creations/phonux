/** The row strip's drawn centering margin: its translate with the row's offset added back. jsdom has no layout, so it is read off the transform. */
import { act } from 'react';
import { emblaDrawnOf, emblaOf, emblaTargetOf, moveEmbla, writeEmbla } from '../../emblaRow.js';
import { EMBLA_WINDOW_ATTRIBUTE } from '../../rowDom.js';
import { advanceFrames } from './mount-harness.js';
import { closestRowScroller, rowScrollerFor } from '../../rowScroller.js';

/** The Embla row's window inside (or around) `within`: the element Embla runs on, whose first child is the box it translates. */
export function emblaWindowIn(within: Element): HTMLElement | null {
  return within.closest<HTMLElement>(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? within.querySelector<HTMLElement>(`[${EMBLA_WINDOW_ATTRIBUTE}]`);
}

/** The box the Embla row draws its slots in (Embla's container), the strip of the old row. */
export function rowBoxOf(within: Element): HTMLElement | null {
  return (emblaWindowIn(within)?.firstElementChild as HTMLElement | null | undefined) ?? null;
}

export function stripMarginOf(within: Element): number {
  const strip = (within.matches('[data-row-strip]') ? within : within.querySelector('[data-row-strip]')) as HTMLElement;
  const x = Number(/translateX\((-?[\d.e+-]+)px\)/.exec(strip.style.transform)?.[1] ?? 0);
  const row = closestRowScroller(strip);
  return x + (row === null ? 0 : rowScrollerFor(row).scrollLeft());
}

/** The Embla row in `container` once `stubSlotBoxes` has laid it out; without a layout Embla's position means nothing (0, or NaN with no stops). */
function laidOutEmblaIn(container: HTMLElement) {
  const win = emblaWindowIn(container);
  return win === null || !stubbed.has(win) ? undefined : emblaOf(win);
}

/**
 * The row's offset: where Embla draws the row (its box's translate) once `stubSlotBoxes` has laid it out. Otherwise the old row's
 * scroller, which tests that drive `m.scroller` directly still read: that scroller no longer draws the Embla row.
 */
export function rowOffsetOf(container: HTMLElement): number {
  const embla = laidOutEmblaIn(container);
  if (embla === undefined) return rowScrollerFor(container).scrollLeft();
  // To 0.01 px: Embla calls a glide at rest within 0.001 px of its stop and never snaps the last fraction (811.999 for 812).
  return Math.round(emblaDrawnOf(embla) * 100) / 100 + 0;
}

/** Where a glide in flight takes the row: Embla's target while it differs from where the row is drawn, else null; the old row's glide target. */
export function rowGlideTargetOf(container: HTMLElement): number | null {
  const embla = laidOutEmblaIn(container);
  if (embla === undefined) return rowScrollerFor(container).glideTarget();
  const target = emblaTargetOf(embla);
  return Math.abs(target - emblaDrawnOf(embla)) > 0.5 ? target + 0 : null;
}

/**
 * Advances frames until the Embla row in `container` rests (Embla's own test: drawn within 0.001 px of its target), at most `capMs`.
 * Embla's glide is a spring whose length depends on the distance, where the old row's glide took a fixed time. Throws at the cap, so
 * a row that never rests cannot pass as one that did.
 */
export async function advanceUntilRowRests(container: HTMLElement, capMs = 5000): Promise<void> {
  const win = emblaWindowIn(container);
  const embla = win === null ? undefined : emblaOf(win);
  if (embla === undefined) throw new Error('advanceUntilRowRests: no Embla row in the container');
  for (let ms = 0; ms < capMs; ms += 16) {
    await advanceFrames(16);
    if (Math.abs(emblaTargetOf(embla) - emblaDrawnOf(embla)) < 0.001) return;
  }
  throw new Error(`advanceUntilRowRests: the row was still moving after ${capMs} ms`);
}

/** Puts the row at `left` at once, as a person or the browser moving it would. */
export function setRowOffset(container: HTMLElement, left: number): void {
  const embla = laidOutEmblaIn(container);
  if (embla !== undefined) {
    act(() => writeEmbla(embla, left));
    return;
  }
  const scroller = rowScrollerFor(container);
  // The browser's own scroll of the container is how a move the row did not ask for arrives; the row takes it over.
  container.scrollLeft = left - scroller.scrollLeft();
  container.dispatchEvent(new Event('scroll'));
}

const translateXOf = (el: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

/** The transform a slot is drawn with, its rest included: the drawing pass writes the rest as `translate` and the mover's transform is measured from it. */
export function slotTransform(el: HTMLElement): string {
  const x = (Number.parseFloat(el.style.translate) || 0) + translateXOf(el);
  const others = el.style.transform.replace(/translateX\([^)]*\)\s*/, '').replace('none', '').trim();
  return [x === 0 ? '' : `translateX(${x}px)`, others].filter(Boolean).join(' ') || 'none';
}

/** A stubbed Embla row's window: where it is drawn on screen and how tall its slots are. */
const stubbed = new WeakMap<HTMLElement, { originLeft: number; height: number }>();
const translate3dXOf = (el: HTMLElement): number => Number(/translate3d\((-?[\d.e+-]+)px/.exec(el.style.transform)?.[1] ?? 0);
const px = (v: string): number => Number.parseFloat(v) || 0;

/** The box a browser would give `el` if it is part of a stubbed Embla row, in the frame Embla's offset reads use; null for any other element. */
function emblaLayoutOf(el: HTMLElement): { win: HTMLElement; left: number; width: number; top: number; height: number } | null {
  const win = el.closest<HTMLElement>(`[${EMBLA_WINDOW_ATTRIBUTE}]`);
  const stub = win === null ? undefined : stubbed.get(win);
  if (win === null || stub === undefined) return null;
  const height = stub.height;
  // The window, relative to its parent: Embla measures the box and the markers inside it.
  if (el === win) return { win, left: stub.originLeft, width: px(win.style.width), top: 0, height };
  // Embla's container: as wide as the window, at its left edge.
  if (el.parentElement === win) return { win, left: 0, width: px(win.style.width), top: 0, height };
  // A slot marker (one of Embla's slides): absolutely placed at its left, a phone wide.
  if (el.hasAttribute('data-row-embla-slot')) return { win, left: px(el.style.left), width: px(el.style.width), top: 0, height: 0 };
  // A panel's slot: at its rest (the drawing pass writes it as `translate`), as wide as its style says.
  if (el.hasAttribute('data-row-slot')) return { win, left: px(el.style.translate), width: px(el.style.width), top: 0, height };
  return null;
}

let installed = false;
/** Puts the stub's reads on every element once; an element outside a stubbed row reads what jsdom gives it. */
function installEmblaLayout(): void {
  if (installed) return;
  installed = true;
  const proto = HTMLElement.prototype;
  const read = (name: 'offsetLeft' | 'offsetWidth' | 'offsetTop' | 'offsetHeight', pick: (b: NonNullable<ReturnType<typeof emblaLayoutOf>>) => number): void => {
    const original = Object.getOwnPropertyDescriptor(proto, name)!;
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        const box = emblaLayoutOf(this);
        return box === null ? original.get!.call(this) : pick(box);
      },
    });
  };
  read('offsetLeft', (b) => b.left);
  read('offsetWidth', (b) => b.width);
  read('offsetTop', (b) => b.top);
  read('offsetHeight', (b) => b.height);
  const rectOf = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const box = this instanceof HTMLElement ? emblaLayoutOf(this) : null;
    if (box === null) return rectOf.call(this);
    const el = this as HTMLElement;
    const origin = stubbed.get(box.win)!.originLeft;
    // On screen: the window's left, plus Embla's translate of its box, plus the slot's rest and its mover's offset from it.
    const left =
      el === box.win ? origin : el.parentElement === box.win ? origin + translate3dXOf(el) : origin + translate3dXOf(box.win.firstElementChild as HTMLElement) + box.left + translateXOf(el);
    return { left, right: left + box.width, top: 0, bottom: box.height, width: box.width, height: box.height, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  };
}

/**
 * jsdom has no layout: gives the Embla row in `container` the boxes a browser draws, its window at `originLeft` on screen. Embla's
 * box is as wide as the window and moved by Embla's translate; each slot marker sits at its `left`; each panel's slot is drawn at the
 * window's left plus that translate, its rest and its mover's offset, as wide as its style says. Read live, so it follows every move
 * of the row and of each slot, and slots mounted later. Embla rebuilds its stops from the markers at once, keeping where it is drawn.
 * The old row (a `[data-row-strip]`) keeps its own stub below.
 */
export function stubSlotBoxes(container: HTMLElement, originLeft: number, height = 700): void {
  const win = emblaWindowIn(container);
  if (win === null) {
    stubStripSlotBoxes(container, originLeft, height);
    return;
  }
  installEmblaLayout();
  stubbed.set(win, { originLeft, height });
  const embla = emblaOf(win);
  if (embla !== undefined) act(() => moveEmbla(embla, 0, true));
}

/**
 * jsdom has no layout: each slot in `container` is given the box a browser would draw, `originLeft` plus the strip's translate and the
 * slot's own, as wide as its style says. Read live, so it follows every move of the row and of the slot.
 */
function stubStripSlotBoxes(container: HTMLElement, originLeft: number, height = 700): void {
  const strip = container.querySelector<HTMLElement>('[data-row-strip]')!;
  for (const el of container.querySelectorAll<HTMLElement>('[data-row-slot]')) {
    el.getBoundingClientRect = () => {
      const width = Number.parseFloat(el.style.width) || 0;
      const left = originLeft + translateXOf(strip) + (Number.parseFloat(el.style.translate) || 0) + translateXOf(el);
      return { left, right: left + width, top: 0, bottom: height, width, height, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    };
  }
}
