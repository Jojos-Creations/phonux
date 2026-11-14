/**
 * Installs a jsdom window as this process's DOM globals, and a virtual frame clock in place of real time.
 * Import it before react and before anything that loads motion: motion binds its frame loop to the
 * requestAnimationFrame and performance.now it finds at load, so a later install would leave it on real time.
 * test/harness-control.test.ts reads the importing file's source to check that order.
 * A static-markup test must never import this file: it asserts that no `document` exists.
 * Loaded by the `phonux/testing/row` entry (testingRow.ts) and, through test/support/jsdom-globals.ts, by the library's own tests.
 */
import { JSDOM } from 'jsdom';
/** One virtual frame, in milliseconds. The clock only ever moves by a whole number of these. @public */
export const FRAME_MS = 16;
/** Not 0: a timestamp of 0 reads as "unset" to code that tests it for truthiness. */
const START_MS = 1000;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const win = dom.window;
let virtualNow = START_MS;
let nextHandle = 1;
let pending = new Map();
/** The frame being run, so a callback can still cancel a later one of the same frame. */
let running = new Map();
function requestFrame(callback) {
    const handle = nextHandle++;
    pending.set(handle, callback);
    return handle;
}
function cancelFrame(handle) {
    pending.delete(handle);
    running.delete(handle);
}
/** The one counter behind requestAnimationFrame, cancelAnimationFrame and performance.now: time moves only when a test steps it. @public */
export const frameClock = {
    /** The counter's current value, in milliseconds; what `performance.now()` reads. */
    now: () => virtualNow,
    /**
     * Moves the counter on with no frame run, as a task that blocks the main thread does.
     * @param ms - How far to move it.
     */
    skip(ms) {
        virtualNow += ms;
    },
    /** How many callbacks wait for the next frame; 0 once every animation has finished. */
    pendingCount: () => pending.size,
    /**
     * Runs `frames` frames: each advances the counter by FRAME_MS, then calls the callbacks queued before it began.
     * It never yields, so a caller that needs promise continuations between frames steps one frame per turn.
     * @param frames - How many frames to run.
     */
    step(frames) {
        for (let frame = 0; frame < frames; frame += 1) {
            virtualNow += FRAME_MS;
            running = pending;
            pending = new Map();
            for (const [handle, callback] of [...running]) {
                if (running.has(handle))
                    callback(virtualNow);
            }
            running = new Map();
        }
    },
};
function define(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: false });
}
// Node ships its own Event, CustomEvent and navigator; dispatchEvent on a jsdom node accepts only jsdom's.
const FORCED = ['window', 'self', 'document', 'navigator', 'location', 'Event', 'CustomEvent', 'UIEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'WheelEvent', 'PointerEvent'];
for (const name of FORCED) {
    if (name in win)
        define(name, name === 'window' || name === 'self' ? win : win[name]);
}
// Every other window member, read lazily: some getters (storage, for one) are not safe to call at install.
for (const name of Object.getOwnPropertyNames(win)) {
    if (name in globalThis || FORCED.includes(name))
        continue;
    Object.defineProperty(globalThis, name, { get: () => win[name], set: (value) => define(name, value), configurable: true });
}
win.requestAnimationFrame = requestFrame;
win.cancelAnimationFrame = cancelFrame;
define('requestAnimationFrame', requestFrame);
define('cancelAnimationFrame', cancelFrame);
// What the row (Embla Carousel, the library's only row) reads at init that jsdom lacks: breakpoints through matchMedia, slides in
// view through IntersectionObserver, a resize of the window or a slide through ResizeObserver. None ever fires here.
class NoIntersections {
    observe() { }
    unobserve() { }
    disconnect() { }
    takeRecords() {
        return [];
    }
}
if (typeof win.matchMedia !== 'function') {
    win.matchMedia = ((query) => ({ matches: false, media: query, onchange: null, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { }, dispatchEvent: () => false }));
}
if (typeof win.IntersectionObserver !== 'function')
    win.IntersectionObserver = NoIntersections;
if (typeof win.ResizeObserver !== 'function')
    win.ResizeObserver = NoIntersections;
define('matchMedia', win.matchMedia);
define('IntersectionObserver', win.IntersectionObserver);
define('ResizeObserver', win.ResizeObserver);
// An own property shadows Performance.prototype.now; the Node and the jsdom clocks read the same counter.
Object.defineProperty(globalThis.performance, 'now', { value: () => virtualNow, configurable: true, writable: true });
Object.defineProperty(win.performance, 'now', { value: () => virtualNow, configurable: true, writable: true });
// An event's timeStamp is read from the same virtual clock, so a gesture's speed counts the frames a test waits.
Object.defineProperty(win.Event.prototype, 'timeStamp', { get: () => virtualNow, configurable: true });
// Tells React that act() is in use, so a state update outside it warns instead of passing in silence.
define('IS_REACT_ACT_ENVIRONMENT', true);
