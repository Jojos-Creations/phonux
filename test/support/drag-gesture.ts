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

function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
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
    window.dispatchEvent(pointerEvent('pointerup', ORIGIN + dx, ORIGIN + dy));
  });
}

export async function drag(handle: Element, { dx, dy, steps = 5, hold = 8, keepDown = false }: Drag): Promise<void> {
  await press(handle);
  for (let step = 1; step <= steps; step += 1) {
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', ORIGIN + (dx * step) / steps, ORIGIN + (dy * step) / steps));
    });
    await advanceFrames(FRAME_MS);
  }
  await advanceFrames(hold * FRAME_MS);
  if (!keepDown) await release(dx, dy);
}
