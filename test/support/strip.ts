/** The row strip's drawn centering margin: its translate with the row's offset added back. jsdom has no layout, so it is read off the transform. */
import { closestRowScroller, rowScrollerFor } from '../../rowScroller.js';

export function stripMarginOf(within: Element): number {
  const strip = (within.matches('[data-row-strip]') ? within : within.querySelector('[data-row-strip]')) as HTMLElement;
  const x = Number(/translateX\((-?[\d.e+-]+)px\)/.exec(strip.style.transform)?.[1] ?? 0);
  const row = closestRowScroller(strip);
  return x + (row === null ? 0 : rowScrollerFor(row).scrollLeft());
}

/** The row's offset, drawn as the strip's transform: the container itself never scrolls. */
export function rowOffsetOf(container: HTMLElement): number {
  return rowScrollerFor(container).scrollLeft();
}

/** Puts the row at `left` at once, as a person or the browser moving it would. */
export function setRowOffset(container: HTMLElement, left: number): void {
  const scroller = rowScrollerFor(container);
  // The browser's own scroll of the container is how a move the row did not ask for arrives; the row takes it over.
  container.scrollLeft = left - scroller.scrollLeft();
  container.dispatchEvent(new Event('scroll'));
}

const translateXOf = (el: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

/**
 * jsdom has no layout: each slot in `container` is given the box a browser would draw, `originLeft` plus the strip's translate and the
 * slot's own, as wide as its style says. Read live, so it follows every move of the row and of the slot.
 */
export function stubSlotBoxes(container: HTMLElement, originLeft: number, height = 700): void {
  const strip = container.querySelector<HTMLElement>('[data-row-strip]')!;
  for (const el of container.querySelectorAll<HTMLElement>('[data-row-slot]')) {
    el.getBoundingClientRect = () => {
      const width = Number.parseFloat(el.style.width) || 0;
      const left = originLeft + translateXOf(strip) + translateXOf(el);
      return { left, right: left + width, top: 0, bottom: height, width, height, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    };
  }
}
