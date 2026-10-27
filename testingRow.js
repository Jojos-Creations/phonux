/**
 * The `phonux/testing/row` entry: a driver that renders a workspace with the real engine in a jsdom window, on a virtual frame
 * clock, so a test steps frames instead of waiting on real time. Import it before `react` and before anything that loads
 * `motion`: it installs the jsdom window and the clock, and motion binds its frame loop to the clock it finds at load.
 * The fake host stays record-only; this is a separate tool for the tests that need the row itself. Why: DESIGN.md, "Testing without a host".
 */
import { FRAME_MS, frameClock } from './testingClock.js';
import { act } from 'react';
export { FRAME_MS, frameClock };
/** How long a settle runs at most, in frames, before it gives up: a row still animating after this many is stuck. */
const SETTLE_LIMIT_FRAMES = 600;
/** How many turns of the event loop a mount may take before `renderWorkspace` gives up on it. */
const MOUNT_LIMIT_TURNS = 2000;
/** The window as the row scroller reports it; jsdom lays nothing out. One window per process, whatever the number of workspaces. */
const windowSize = { width: 0, height: 0 };
const observers = new Set();
class StubObserver {
    callback;
    targets = new Set();
    constructor(callback) {
        this.callback = callback;
        observers.add(this);
    }
    observe(el) {
        this.targets.add(el);
    }
    unobserve(el) {
        this.targets.delete(el);
    }
    disconnect() {
        this.targets.clear();
        observers.delete(this);
    }
}
for (const [property, key] of [['clientWidth', 'width'], ['clientHeight', 'height']]) {
    Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get() {
            return this.hasAttribute('data-row-scroller') ? windowSize[key] : 0;
        },
    });
}
globalThis.ResizeObserver = StubObserver;
const ORIGIN = 100;
/** jsdom has no PointerEvent, so each is a MouseEvent of the pointer type carrying the fields the drag code reads. */
function pointerEvent(type, x, y) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true }))
        Object.defineProperty(event, key, { value });
    return event;
}
async function frames(count) {
    for (let frame = 0; frame < count; frame += 1) {
        await act(async () => {
            frameClock.step(1);
        });
    }
}
async function settle() {
    for (let frame = 0; frame < SETTLE_LIMIT_FRAMES; frame += 1) {
        await frames(1);
        if (frameClock.pendingCount() === 0)
            return;
    }
    throw new Error(`the row was still animating after ${SETTLE_LIMIT_FRAMES} frames`);
}
/** Runs `step` with act's environment flag off: the mount renders from a promise continuation no act() scope covers. */
async function outsideAct(step) {
    const env = globalThis;
    const before = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
        return await step();
    }
    finally {
        env.IS_REACT_ACT_ENVIRONMENT = before;
    }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** The scroller of the row `workspace` renders in: the one holding any of its panels, else the only one in the document. */
function scrollerOf(workspace) {
    for (const handle of workspace.panels.list()) {
        const engineId = handle.getState().engineId;
        if (engineId === null)
            continue;
        const found = document.querySelector(`[data-row-id="${engineId}"]`)?.closest('[data-row-scroller]');
        if (found !== null && found !== undefined)
            return found;
    }
    const all = document.querySelectorAll('[data-row-scroller]');
    return all.length === 1 ? all[0] : null;
}
function partOf(slot, part) {
    return slot.querySelector(`[data-panel-chrome-part="${part}"]`);
}
/**
 * Renders `workspace` as the default start does, in a window of `size`, and resolves once the workspace is ready, its row is
 * drawn and every animation has finished. The workspace must render itself: one made with `mount: false` has nothing to drive.
 * Create the workspace after importing this entry, so there is a `document` for it to render into.
 * @param workspace - The workspace to render.
 * @param size - The window's size in px; 1000 wide and 800 tall when left out.
 * @public
 */
export async function renderWorkspace(workspace, size = { width: 1000 }) {
    windowSize.width = size.width;
    windowSize.height = size.height ?? 800;
    let scroller = null;
    await outsideAct(async () => {
        await import('./autoMount.js');
        for (let turn = 0; turn < MOUNT_LIMIT_TURNS; turn += 1) {
            for (const observer of [...observers])
                observer.callback();
            scroller = workspace.status === 'ready' ? scrollerOf(workspace) : null;
            if (scroller !== null)
                return;
            await tick();
        }
        throw new Error('the workspace never drew its row: is it made with mount: false, or made before this entry was imported?');
    });
    await settle();
    const drawn = scroller;
    if (drawn === null)
        throw new Error('unreachable: the mount wait returns only with a scroller');
    const slotOf = (id) => {
        const engineId = workspace.panels.get(id)?.getState().engineId;
        return engineId === null || engineId === undefined ? null : drawn.querySelector(`[data-row-id="${engineId}"]`);
    };
    const release = async (dx, dy) => {
        await act(async () => {
            document.dispatchEvent(pointerEvent('pointerup', ORIGIN + dx, ORIGIN + dy));
        });
        await settle();
    };
    return {
        scroller: drawn,
        panel(id) {
            const root = slotOf(id);
            return root === null ? undefined : { root, header: partOf(root, 'header'), grabBar: partOf(root, 'grab-bar'), footer: partOf(root, 'footer') };
        },
        frames,
        async setWidth(width, height) {
            windowSize.width = width;
            if (height !== undefined)
                windowSize.height = height;
            await act(async () => {
                for (const observer of [...observers])
                    observer.callback();
            });
            await settle();
        },
        async drag(target, { dx, dy, steps = 5, hold = 8, keepDown = false }) {
            await act(async () => {
                target.dispatchEvent(pointerEvent('pointerdown', ORIGIN, ORIGIN));
            });
            for (let step = 1; step <= steps; step += 1) {
                await act(async () => {
                    document.dispatchEvent(pointerEvent('pointermove', ORIGIN + (dx * step) / steps, ORIGIN + (dy * step) / steps));
                });
                await frames(1);
            }
            await frames(hold);
            if (keepDown)
                return;
            await release(dx, dy);
        },
        release,
        async press(target) {
            await act(async () => {
                target.dispatchEvent(pointerEvent('pointerdown', ORIGIN, ORIGIN));
                target.dispatchEvent(pointerEvent('pointerup', ORIGIN, ORIGIN));
                target.click();
            });
            await settle();
        },
        async dispose() {
            await act(async () => workspace.dispose());
            document.body.replaceChildren();
        },
    };
}
