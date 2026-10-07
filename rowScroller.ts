/**
 * The one writer of a row container's `scrollLeft`. Internal and out of the barrel: a later custom scrollbar reads the
 * strip from `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
 */

/** The exclusive writer `claim()` hands one holder. */
export interface ScrollClaim {
  /** Moves `scrollLeft` to `left`, clamped to `[0, the bound from setMaxScroll]`, and returns the delta applied. Applies nothing before the first `setMaxScroll`. */
  write(left: number): number;
  /** The farthest legal `scrollLeft`, from the row numbers; the DOM is never asked. */
  setMaxScroll(max: number): void;
  /** Gives the claim back; `glideTo` and `claim()` work again. */
  release(): void;
}

/** What may move one container's `scrollLeft`. */
export interface RowScroller {
  /** The container's current `scrollLeft`. */
  scrollLeft(): number;
  /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
  glideTo(target: number, o: { durationSec: number; instant: boolean }): boolean;
  /** Where the glide in flight ends; null when none is. */
  glideTarget(): number | null;
  /** Ends the glide in flight where it is. */
  stop(): void;
  /** The exclusive writer, or null while one is held. */
  claim(): ScrollClaim | null;
  /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
  claimHeld(): boolean;
}

// A scroll event this far from the last value written is somebody else's; browsers round a fractional write.
const FOREIGN_SCROLL_PX = 1;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

const scrollers = new WeakMap<HTMLElement, RowScroller>();

/** The one `RowScroller` of `element`: the same object on every call. */
export function rowScrollerFor(element: HTMLElement): RowScroller {
  const existing = scrollers.get(element);
  if (existing !== undefined) return existing;
  const created = createRowScroller(element);
  scrollers.set(element, created);
  return created;
}

/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`; never computed overflow, so a container whose `overflow-x` is hidden is found too. */
export function closestRowScroller(from: Element): HTMLElement | null {
  return from.closest<HTMLElement>('[data-row-scroller]');
}

function createRowScroller(el: HTMLElement): RowScroller {
  let claimed = false;
  let glide: { from: number; to: number; startMs: number; durationMs: number } | null = null;
  let frame: number | null = null;
  // Read back after every own write: the browser rounds and clamps, and the scroll event it fires later reports that value.
  let lastWritten = el.scrollLeft;

  const write = (left: number): void => {
    el.scrollLeft = left;
    lastWritten = el.scrollLeft;
  };
  const onForeignScroll = (): void => {
    if (Math.abs(el.scrollLeft - lastWritten) > FOREIGN_SCROLL_PX) stop();
  };
  const onPointerDown = (): void => stop();

  function stop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (glide !== null) {
      el.removeEventListener('scroll', onForeignScroll);
      el.removeEventListener('pointerdown', onPointerDown);
    }
    glide = null;
  }

  function tick(): void {
    frame = null;
    if (glide === null) return;
    const t = (performance.now() - glide.startMs) / glide.durationMs;
    if (t >= 1) {
      const to = glide.to;
      stop();
      write(to);
      return;
    }
    write(glide.from + (glide.to - glide.from) * easeOut(Math.max(0, t)));
    frame = requestAnimationFrame(tick);
  }

  return {
    scrollLeft: () => el.scrollLeft,
    glideTo(target, o) {
      if (claimed) return false;
      if (o.instant || o.durationSec <= 0) {
        stop();
        write(target);
        return true;
      }
      if (glide === null) {
        el.addEventListener('scroll', onForeignScroll);
        el.addEventListener('pointerdown', onPointerDown);
      }
      lastWritten = el.scrollLeft;
      glide = { from: el.scrollLeft, to: target, startMs: performance.now(), durationMs: o.durationSec * 1000 };
      if (frame === null) frame = requestAnimationFrame(tick);
      return true;
    },
    glideTarget: () => (glide === null ? null : glide.to),
    claimHeld: () => claimed,
    stop,
    claim() {
      if (claimed) return null;
      stop();
      claimed = true;
      let max: number | null = null;
      let released = false;
      return {
        write(left) {
          if (released || max === null) return 0;
          const before = el.scrollLeft;
          write(Math.min(max, Math.max(0, left)));
          return el.scrollLeft - before;
        },
        setMaxScroll(next) {
          max = next;
        },
        release() {
          if (released) return;
          released = true;
          claimed = false;
        },
      };
    },
  };
}
