/**
 * Synthesized pointer gestures for DragToClose, stepped on the virtual frame clock. jsdom has no PointerEvent, so each
 * event is a MouseEvent of the pointer type carrying the pointer fields motion reads. The pointer moves in `steps`
 * equal moves one frame apart, then rests `hold` frames before the release, so the release velocity is near zero
 * and only the distance rule can act (hold 0 releases at full speed, a flick).
 */
import { act } from 'react';
import { advanceFrames } from './mount-harness.js';
import { FRAME_MS } from './jsdom-globals.js';

const ORIGIN = 100;

function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, at: number = performance.now()): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, timeStamp: at })) Object.defineProperty(event, key, { value });
  return event;
}

interface Drag {
  dx: number;
  dy: number;
  steps?: number;
  hold?: number;
  /** Leave the pointer down: the caller releases with `release`. */
  keepDown?: boolean;
}

async function press(handle: Element): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(pointerEvent('pointerdown', ORIGIN, ORIGIN));
  });
}

export async function release(dx: number, dy: number): Promise<void> {
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointerup', ORIGIN + dx, ORIGIN + dy));
  });
}

export async function drag(handle: Element, { dx, dy, steps = 5, hold = 8, keepDown = false }: Drag): Promise<void> {
  await press(handle);
  for (let step = 1; step <= steps; step += 1) {
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', ORIGIN + (dx * step) / steps, ORIGIN + (dy * step) / steps));
    });
    await advanceFrames(FRAME_MS);
  }
  await advanceFrames(hold * FRAME_MS);
  if (!keepDown) await release(dx, dy);
}

/**
 * A flick: `moves` pointer moves `gapMs` apart by their browser timestamps, all dispatched before a frame runs, then the release in its own commit (dnd-kit ignores an end the context has not rendered the start of).
 * A loop that sampled once per frame would see one point; the close rule must still read the speed.
 */
export async function flick(handle: Element, { dy, moves, gapMs }: { dy: number; moves: number; gapMs: number }): Promise<void> {
  await press(handle);
  await new Promise((resolve) => setTimeout(resolve, 5)); // dnd-kit starts listening for moves a tick after the press
  await advanceFrames(13 * FRAME_MS); // the press is older than the velocity window, so only the moves can supply the speed
  const start = performance.now();
  await act(async () => {
    for (let step = 1; step <= moves; step += 1) document.dispatchEvent(pointerEvent('pointermove', ORIGIN, ORIGIN + (dy * step) / moves, start + step * gapMs));
  });
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointerup', ORIGIN, ORIGIN + dy, start + moves * gapMs));
  });
}
