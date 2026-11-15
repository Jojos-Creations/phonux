/**
 * What the row reads from a browser and a jsdom window lacks, filled in on a window the caller owns. Exported from
 * `phonux/testing` for a host's own jsdom tests, and used by the `phonux/testing/row` entry and the library's own tests.
 */
import { EMBLA_SLOT_ATTRIBUTE, EMBLA_WINDOW_ATTRIBUTE } from './rowDom.js';

type GapWindow = Window & typeof globalThis & Record<string, unknown>;

class NoObservations {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const MARGINS = new Set(['margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
const filled = new WeakSet<object>();
const laidOut = new WeakSet<object>();

/** Sets `name` on the window and, when the process has none, as a global, where the row and Embla read it. */
function provide(win: GapWindow, name: string, value: unknown): void {
  if (typeof win[name] !== 'function' && typeof win[name] !== 'object') win[name] = value;
  const g = globalThis as Record<string, unknown>;
  if (g[name] === undefined) Object.defineProperty(globalThis, name, { value: win[name], configurable: true, writable: true, enumerable: false });
}

/**
 * Fills in `matchMedia`, `IntersectionObserver`, `ResizeObserver`, `CSS.escape` and a computed margin of `0px` where jsdom answers
 * ''. Once per window. @internal
 */
export function fillRowDomGaps(win: Window): void {
  const w = win as GapWindow;
  if (filled.has(w)) return;
  filled.add(w);
  provide(w, 'matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  provide(w, 'IntersectionObserver', NoObservations);
  provide(w, 'ResizeObserver', NoObservations);
  // A CSS identifier escape: every character outside [A-Za-z0-9_-] (and a leading digit) is written as a code point escape.
  const escapeIdent = (value: string): string => String(value).replace(/^-?\d|[^A-Za-z0-9_-]/g, (c) => `\\${c.codePointAt(0)!.toString(16)} `);
  const css = (w.CSS ?? {}) as { escape?: (value: string) => string };
  if (typeof css.escape !== 'function') w.CSS = { ...css, escape: escapeIdent } as unknown as typeof CSS;
  provide(w, 'CSS', w.CSS);
  // Embla adds the last marker's computed right margin to the strip's length; jsdom answers '' for an unset one (a browser, 0px),
  // which Embla reads as NaN: the row then has no stops.
  const computedStyle = w.getComputedStyle.bind(w);
  const patched = ((element: Element, pseudo?: string | null) => {
    const style = computedStyle(element, pseudo);
    const read = style.getPropertyValue.bind(style);
    style.getPropertyValue = (name: string) => {
      const value = read(name);
      return value === '' && MARGINS.has(name) ? '0px' : value;
    };
    return style;
  }) as typeof w.getComputedStyle;
  const globalWasWindows = (globalThis as { getComputedStyle?: unknown }).getComputedStyle === w.getComputedStyle;
  w.getComputedStyle = patched;
  if (globalWasWindows || (globalThis as { getComputedStyle?: unknown }).getComputedStyle === undefined) Object.defineProperty(globalThis, 'getComputedStyle', { value: patched, configurable: true, writable: true, enumerable: false });
}

const inlinePx = (el: HTMLElement, property: 'left' | 'width'): number => {
  const n = Number.parseFloat(el.style[property]);
  return Number.isFinite(n) ? n : 0;
};
/** The box the row wrote on `el` inline, for the row's window, its box and its slot markers; null for any other element. */
function rowBoxOf(el: HTMLElement): { left: number; width: number } | null {
  if (el.hasAttribute(EMBLA_WINDOW_ATTRIBUTE)) return { left: 0, width: inlinePx(el, 'width') };
  if (el.hasAttribute(EMBLA_SLOT_ATTRIBUTE)) return { left: inlinePx(el, 'left'), width: inlinePx(el, 'width') };
  const parent = el.parentElement;
  if (parent?.hasAttribute(EMBLA_WINDOW_ATTRIBUTE) === true && el === parent.firstElementChild) return { left: 0, width: inlinePx(parent, 'width') };
  return null;
}

/**
 * Fills in what the row reads from a browser and a jsdom window lacks, so a host's own jsdom test can mount a `Workspace` and
 * scroll its row: `matchMedia` (matches nothing), `IntersectionObserver` and `ResizeObserver` (never report), `CSS.escape`, a
 * computed margin of `0px` where jsdom answers '', and `offsetLeft` and `offsetWidth` for the row's window, its box and its slot
 * markers, read back from the px the row writes on them inline (jsdom answers 0 for every element, with which the row has no stops
 * and stands at NaN). Every other element keeps jsdom's answers. What the window already has is kept, so a stub the test
 * installed first stays; each is set as a global too when the process has none. A second call on the same window does nothing.
 *
 * jsdom draws nothing: the row then has its stops and steps between them (an arrow key, a scroll request), but no element's
 * `getBoundingClientRect` follows it, and the row's `initialScroll` waits for a measured box that never comes.
 * @param win - The jsdom window the test renders into. Default: the global `window`.
 * @public
 */
export function stubRowDom(win: Window = globalThis.window): void {
  fillRowDomGaps(win);
  const proto = (win as GapWindow & { HTMLElement: typeof HTMLElement }).HTMLElement.prototype;
  if (laidOut.has(proto)) return;
  laidOut.add(proto);
  for (const [property, pick] of [['offsetLeft', 'left'], ['offsetWidth', 'width']] as const) {
    const jsdomGetter = Object.getOwnPropertyDescriptor(proto, property)?.get;
    Object.defineProperty(proto, property, {
      configurable: true,
      get(this: HTMLElement): number {
        const box = rowBoxOf(this);
        return box !== null ? box[pick] : ((jsdomGetter?.call(this) as number | undefined) ?? 0);
      },
    });
  }
}
