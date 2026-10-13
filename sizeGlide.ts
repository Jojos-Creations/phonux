/**
 * The chrome the library draws, drawn true while a `SizeBox` eases its scale. The scale is not the same on both axes, so a corner
 * radius, a 1 px edge or a circle drawn the usual way is squashed with it; these strings read the scale the box writes and
 * counter it, per axis. Nothing is set at rest, so every fallback is 1 and the chrome draws as it always did.
 */

/** The box's current scale on x, written only while it eases. */
export const GLIDE_X = '--phonux-size-x';
/** The box's current scale on y, written only while it eases. */
export const GLIDE_Y = '--phonux-size-y';
/** `1` while the box eases, so an edge can swap its ring for per-axis bands. */
export const GLIDE_ON = '--phonux-size-glide';

const X = `var(${GLIDE_X}, 1)`;
const Y = `var(${GLIDE_Y}, 1)`;
const ON = `var(${GLIDE_ON}, 0)`;

/** Writes the scale as custom properties on `node`, or removes all three at rest. */
export function writeGlide(node: HTMLElement, x: number, y: number): void {
  if (x === 1 && y === 1) {
    node.style.removeProperty(GLIDE_X);
    node.style.removeProperty(GLIDE_Y);
    node.style.removeProperty(GLIDE_ON);
    return;
  }
  node.style.setProperty(GLIDE_X, String(x));
  node.style.setProperty(GLIDE_Y, String(y));
  node.style.setProperty(GLIDE_ON, '1');
}

/**
 * A `border-radius` of `px` that is drawn `px` on both axes under the scale. A radius too big for a side is cut by the browser
 * on every corner alike, which turns a pill that shrinks into a smaller true pill.
 */
export const glideCorner = (px: number): string => `calc(${px}px / ${X}) / calc(${px}px / ${Y})`;

/**
 * A 1 px edge in `color` that takes no layout: an inset ring at rest, and while the box eases four bands, each `1px` drawn.
 * (A border cannot do this: the browser rounds its width to whole device pixels and a new width re-lays out the content.)
 */
export const glideEdge = (color: string): string =>
  [
    `inset 0 0 0 calc(1px * (1 - ${ON})) ${color}`,
    `inset calc(1px * ${ON} / ${X}) 0 0 0 ${color}`,
    `inset calc(-1px * ${ON} / ${X}) 0 0 0 ${color}`,
    `inset 0 calc(1px * ${ON} / ${Y}) 0 0 ${color}`,
    `inset 0 calc(-1px * ${ON} / ${Y}) 0 0 ${color}`,
  ].join(', ');
