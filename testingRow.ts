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
const observers = new Set<{ callback: () => void }>();

class StubObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: () => void) {
    observers.add(this);
  }
  observe(el: Element): void {
    this.targets.add(el);
  }
  unobserve(el: Element): void {
    this.targets.delete(el);
  }
  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }
}

for (const [property, key] of [['clientWidth', 'width'], ['clientHeight', 'height']] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-row-scroller') ? windowSize[key] : 0;
    },
  });
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubObserver;

/**
 * What `renderWorkspace` needs of a workspace: any `WorkspaceHandle` is one. Named here, not borrowed, so this entry's
 * declaration reaches no type the entry does not export.
 * @public
 */
export interface RenderableWorkspace {
  /** Where the workspace is in its life; the driver waits for 'ready'. */
  readonly status: string;
  /** Read access to the workspace's panels. */
  readonly panels: {
    /** The handle of the panel with this id (its key), or undefined when the workspace knows none. */
    get(id: string): { getState(): { readonly engineId: string | null } } | undefined;
    /** A handle for every panel. */
    list(): ReadonlyArray<{ getState(): { readonly engineId: string | null } }>;
  };
  /** Takes the workspace away. */
  dispose(): void;
}

/** The drawn parts of one panel; a part the panel does not draw is null. @public */
export interface RenderedPanel {
  /** The row slot holding the panel. */
  readonly root: HTMLElement;
  /** The panel's header row. */
  readonly header: HTMLElement | null;
  /** The strip a person grabs to drag the panel. */
  readonly grabBar: HTMLElement | null;
  /** The panel's footer. */
  readonly footer: HTMLElement | null;
}

/** How a pointer drag is played: the pointer moves in equal steps, one frame apart, then rests before it lets go. @public */
export interface DragOptions {
  /** How far the pointer moves right, in px. */
  dx: number;
  /** How far the pointer moves down, in px. */
  dy: number;
  /** How many equal moves make the drag; 5 when left out. */
  steps?: number;
  /** How many frames the pointer rests before the release; 8 when left out. 0 releases at full speed, a flick. */
  hold?: number;
  /** Leave the pointer down; `release` lets go. */
  keepDown?: boolean;
}

/** What `renderWorkspace` hands a test. @public */
export interface RenderedWorkspace {
  /** The scroll container the workspace's row scrolls in. */
  readonly scroller: HTMLElement;
  /** The drawn parts of the panel with this id (its key); undefined while the panel is not in the row. */
  panel(id: string): RenderedPanel | undefined;
  /**
   * Runs `count` virtual frames, one at a time, with the renders and promise continuations each one causes.
   * @param count - How many frames to run.
   */
  frames(count: number): Promise<void>;
  /**
   * Gives the window a new size and runs frames until every animation has finished.
   * @param width - The window's width in px.
   * @param height - The window's height in px; left as it is when left out.
   */
  setWidth(width: number, height?: number): Promise<void>;
  /**
   * Plays a pointer drag on `target` (a part of a panel) and, unless `keepDown`, runs frames until every animation has finished.
   * @param target - The element the pointer goes down on.
   * @param options - The drag to play.
   */
  drag(target: Element, options: DragOptions): Promise<void>;
  /**
   * Lets go of a pointer a `keepDown` drag left down, then runs frames until every animation has finished.
   * @param dx - The pointer's total move right, in px, as the drag gave it.
   * @param dy - The pointer's total move down, in px, as the drag gave it.
   */
  release(dx: number, dy: number): Promise<void>;
  /**
   * Presses `target` as a person does (pointer down, pointer up, click), then runs frames until every animation has finished.
   * A press inside a panel not in use only puts it in use, so its target gets no click; press again to click it.
   * @param target - The element to press.
   */
  press(target: Element): Promise<void>;
  /** Takes the workspace away: disposes it and empties the document. */
  dispose(): Promise<void>;
}

const ORIGIN = 100;

/** jsdom has no PointerEvent, so each is a MouseEvent of the pointer type carrying the fields the drag code reads. */
function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await act(async () => {
      frameClock.step(1);
    });
  }
}

async function settle(): Promise<void> {
  for (let frame = 0; frame < SETTLE_LIMIT_FRAMES; frame += 1) {
    await frames(1);
    if (frameClock.pendingCount() === 0) return;
  }
  throw new Error(`the row was still animating after ${SETTLE_LIMIT_FRAMES} frames`);
}

/** Runs `step` with act's environment flag off: the mount renders from a promise continuation no act() scope covers. */
async function outsideAct<T>(step: () => Promise<T>): Promise<T> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await step();
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = before;
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The scroller of the row `workspace` renders in: the one holding any of its panels, else the only one in the document. */
function scrollerOf(workspace: RenderableWorkspace): HTMLElement | null {
  for (const handle of workspace.panels.list()) {
    const engineId = handle.getState().engineId;
    if (engineId === null) continue;
    const found = document.querySelector<HTMLElement>(`[data-row-id="${engineId}"]`)?.closest<HTMLElement>('[data-row-scroller]');
    if (found !== null && found !== undefined) return found;
  }
  const all = document.querySelectorAll<HTMLElement>('[data-row-scroller]');
  return all.length === 1 ? all[0]! : null;
}

function partOf(slot: HTMLElement, part: 'header' | 'grab-bar' | 'footer'): HTMLElement | null {
  return slot.querySelector<HTMLElement>(`[data-panel-chrome-part="${part}"]`);
}

/**
 * Renders `workspace` as the default start does, in a window of `size`, and resolves once the workspace is ready, its row is
 * drawn and every animation has finished. The workspace must render itself: one made with `mount: false` has nothing to drive.
 * Create the workspace after importing this entry, so there is a `document` for it to render into.
 * @param workspace - The workspace to render.
 * @param size - The window's size in px; 1000 wide and 800 tall when left out.
 * @public
 */
export async function renderWorkspace(workspace: RenderableWorkspace, size: { width: number; height?: number } = { width: 1000 }): Promise<RenderedWorkspace> {
  windowSize.width = size.width;
  windowSize.height = size.height ?? 800;
  let scroller: HTMLElement | null = null;
  await outsideAct(async () => {
    await import('./autoMount.js');
    for (let turn = 0; turn < MOUNT_LIMIT_TURNS; turn += 1) {
      for (const observer of [...observers]) observer.callback();
      scroller = workspace.status === 'ready' ? scrollerOf(workspace) : null;
      if (scroller !== null) return;
      await tick();
    }
    throw new Error('the workspace never drew its row: is it made with mount: false, or made before this entry was imported?');
  });
  await settle();
  const drawn = scroller as HTMLElement | null;
  if (drawn === null) throw new Error('unreachable: the mount wait returns only with a scroller');

  const slotOf = (id: string): HTMLElement | null => {
    const engineId = workspace.panels.get(id)?.getState().engineId;
    return engineId === null || engineId === undefined ? null : drawn.querySelector<HTMLElement>(`[data-row-id="${engineId}"]`);
  };
  const release = async (dx: number, dy: number): Promise<void> => {
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
      if (height !== undefined) windowSize.height = height;
      await act(async () => {
        for (const observer of [...observers]) observer.callback();
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
      if (keepDown) return;
      await release(dx, dy);
    },
    release,
    async press(target) {
      await act(async () => {
        target.dispatchEvent(pointerEvent('pointerdown', ORIGIN, ORIGIN));
        target.dispatchEvent(pointerEvent('pointerup', ORIGIN, ORIGIN));
        (target as HTMLElement).click();
      });
      await settle();
    },
    async dispose() {
      await act(async () => workspace.dispose());
      document.body.replaceChildren();
    },
  };
}
