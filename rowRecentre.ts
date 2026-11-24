/**
 * The row's own place on screen, glided. A row whose strip fits is centered by its container, so a panel coming, going or
 * changing width moves every other panel by half the change at once; this keeps each one where it was drawn and glides the row
 * to its new place on the slide's curve and the commit's shared start, the clock every slot in the same change counts from.
 */
import type { SlideTuning } from './panelSettings.js';
import { sharedStartTime } from './rowClock.js';

/** What a commit drew: the row root's left with no glide applied, the Embla window's width, and the room the row had. @internal */
export interface RowPlace {
  left: number;
  windowWidth: number;
  room: number;
}

/** The x part of a computed `translate` ('none', '12px', '12px 3px'). @internal */
export function translateXOf(value: string): number {
  const x = Number.parseFloat(value);
  return Number.isFinite(x) ? x : 0;
}

/** The right edge, px, of a clip path the row writes (`polygon(L -Y, R -Y, R Y, L Y)`); null for any other shape. @internal */
export function clipRightOf(value: string): number | null {
  const m = /^polygon\(\s*[-\d.]+px\s+[-\d.]+px,\s*([-\d.]+)px/.exec(value);
  return m === null ? null : Number.parseFloat(m[1]!);
}

/** The row's clip: one gap past each window edge, tall enough for anything a slot draws above or below. @internal */
export function rowClip(windowWidth: number, gap: number): string {
  return `polygon(${-gap}px -100000px, ${windowWidth + gap}px -100000px, ${windowWidth + gap}px 100000px, ${-gap}px 100000px)`;
}

/**
 * Where `root` is laid out now and, when it moved from `last` with the room unchanged, glides it there from where it was drawn.
 * A clip that narrows glides too, from where it is drawn, so a slot still sliding into place is never cut on the way. A change of
 * room (a window step, which lands at once) and Reduce Motion move nothing.
 * @internal
 */
export function recentreRow(root: HTMLElement, win: HTMLElement | null, last: RowPlace | null, now: { windowWidth: number; room: number }, gap: number, slide: SlideTuning, still: boolean): RowPlace {
  const view = root.ownerDocument.defaultView;
  const drawnShift = view === null ? 0 : translateXOf(view.getComputedStyle(root).translate);
  const left = root.getBoundingClientRect().left - drawnShift;
  const place = { left, windowWidth: now.windowWidth, room: now.room };
  if (last === null || still || Math.abs(last.room - now.room) > 0.5 || typeof root.animate !== 'function') return place;
  const durationMs = slide.durationSec * 1000;
  if (durationMs <= 0) return place;
  const easing = `cubic-bezier(${slide.ease.join(',')})`;
  const start = sharedStartTime();
  const moved = last.left - left;
  if (Math.abs(moved) > 0.5) {
    // Added to any glide still running, so a second change mid-glide goes on from where the row is drawn.
    const anim = root.animate([{ translate: `${moved}px 0px` }, { translate: '0px 0px' }], { duration: durationMs, easing, composite: 'add', fill: 'backwards' });
    anim.startTime = start;
  }
  if (win !== null && view !== null) {
    // The commit has already written the new clip; only a glide still running draws another.
    const clipGliding = win.getAnimations().some((a) => a.playState === 'running' && (a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => 'clipPath' in k));
    const drawnRight = (clipGliding ? clipRightOf(view.getComputedStyle(win).clipPath) : null) ?? last.windowWidth + gap;
    const right = now.windowWidth + gap;
    if (drawnRight > right + 0.5) {
      const anim = win.animate([{ clipPath: rowClip(drawnRight - gap, gap) }, { clipPath: rowClip(now.windowWidth, gap) }], { duration: durationMs, easing, fill: 'backwards' });
      anim.startTime = start;
    }
  }
  return place;
}
