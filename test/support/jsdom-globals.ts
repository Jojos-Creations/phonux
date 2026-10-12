/**
 * Installs a jsdom window as this process's DOM globals, and a virtual frame clock in place of real time.
 * Import it before react and before anything that loads motion: motion binds its frame loop to the
 * requestAnimationFrame and performance.now it finds at load, so a later install would leave it on real time.
 * test/harness-control.test.ts reads the importing file's source to check that order.
 * A static-markup test must never import this file: it asserts that no `document` exists.
 */
import { JSDOM } from 'jsdom';

/** One virtual frame, in ms. A step is always a whole number of these. */
export const FRAME_MS = 16;
/** Not 0: a timestamp of 0 reads as "unset" to code that tests it for truthiness. */
const START_MS = 1000;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;

let virtualNow = START_MS;
let nextHandle = 1;
let pending = new Map<number, FrameRequestCallback>();
/** The frame being run, so a callback can still cancel a later one of the same frame. */
let running = new Map<number, FrameRequestCallback>();

function requestFrame(callback: FrameRequestCallback): number {
  const handle = nextHandle++;
  pending.set(handle, callback);
  return handle;
}

function cancelFrame(handle: number): void {
  pending.delete(handle);
  running.delete(handle);
}

/** The one counter behind requestAnimationFrame, cancelAnimationFrame and performance.now. */
export const frameClock = {
  now: (): number => virtualNow,
  /** Callbacks waiting for the next frame. */
  pendingCount: (): number => pending.size,
  /**
   * Runs `frames` frames: each advances the counter by FRAME_MS, then calls the callbacks queued before it began.
   * It never yields, so a caller that needs promise continuations between frames steps one frame per turn.
   */
  step(frames: number): void {
    for (let frame = 0; frame < frames; frame += 1) {
      virtualNow += FRAME_MS;
      running = pending;
      pending = new Map();
      for (const [handle, callback] of [...running]) {
        if (running.has(handle)) callback(virtualNow);
      }
      running = new Map();
    }
  },
};

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: false });
}

// Node ships its own Event, CustomEvent and navigator; dispatchEvent on a jsdom node accepts only jsdom's.
const FORCED = ['window', 'self', 'document', 'navigator', 'location', 'Event', 'CustomEvent', 'UIEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'WheelEvent', 'PointerEvent'];
for (const name of FORCED) {
  if (name in win) define(name, name === 'window' || name === 'self' ? win : win[name]);
}

// Every other window member, read lazily: some getters (storage, for one) are not safe to call at install.
for (const name of Object.getOwnPropertyNames(win)) {
  if (name in globalThis || FORCED.includes(name)) continue;
  Object.defineProperty(globalThis, name, { get: () => win[name], set: (value: unknown) => define(name, value), configurable: true });
}

win.requestAnimationFrame = requestFrame;
win.cancelAnimationFrame = cancelFrame;
define('requestAnimationFrame', requestFrame);
define('cancelAnimationFrame', cancelFrame);
// An own property shadows Performance.prototype.now; the Node and the jsdom clocks read the same counter.
Object.defineProperty(globalThis.performance, 'now', { value: () => virtualNow, configurable: true, writable: true });
Object.defineProperty(win.performance, 'now', { value: () => virtualNow, configurable: true, writable: true });

// An event's timeStamp is read from the same virtual clock, so a gesture's speed counts the frames a test waits.
Object.defineProperty(win.Event.prototype, 'timeStamp', { get: () => virtualNow, configurable: true });

// Tells React that act() is in use, so a state update outside it warns instead of passing in silence.
define('IS_REACT_ACT_ENVIRONMENT', true);
