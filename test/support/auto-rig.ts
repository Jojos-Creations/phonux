/**
 * A measurable window for the tests of an auto-mounted workspace: jsdom lays nothing out, so the row scroller's size and the
 * ResizeObserver are stubbed, and every workspace a test tracks is disposed and the body emptied after it.
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import type { WorkspaceHandle } from '../../index.js';
import { cleanup } from './mount-harness.js';

/** The window's size as the rig reports it to the row scroller; a test sets it before it mounts. */
export const win = { width: 0, height: 0 };
export const observers = new Set<StubObserver>();
export class StubObserver {
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
const proto = HTMLElement.prototype;
const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
Object.defineProperty(proto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-row-scroller') ? win.width : 0;
  },
});
const originalHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
Object.defineProperty(proto, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-row-scroller') ? win.height : 0;
  },
});
const originalObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubObserver;

/** Sets the window's width and tells every live observer, as the browser does after a layout. */
export const resize = (width: number): Promise<void> =>
  act(async () => {
    win.width = width;
    for (const o of [...observers]) o.callback();
  });

/** Waits (in turns of the event loop) until `check` holds. The mount renders from a promise continuation no act() scope covers, so act is off meanwhile and React flushes on its own. */
export async function until(what: string, check: () => boolean): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    for (let turn = 0; turn < 400; turn += 1) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.fail(`timed out waiting for ${what}`);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = before;
  }
}

export const slots = (root: ParentNode): string[] => [...root.querySelectorAll('[data-slot]')].map((n) => (n as HTMLElement).dataset.slot!);
const workspaces: WorkspaceHandle[] = [];
export const track = (ws: WorkspaceHandle): WorkspaceHandle => {
  workspaces.push(ws);
  return ws;
};

/** The per-test cleanup: each test file passes it to its own `afterEach`, because the scan cannot follow a registration made here. */
export function rigCleanup(): void {
  cleanup();
  for (const ws of workspaces.splice(0)) act(() => ws.dispose());
  win.width = 0;
  win.height = 0;
  observers.clear();
  document.body.replaceChildren();
}

process.on('exit', () => {
  if (original !== undefined) Object.defineProperty(Element.prototype, 'clientWidth', original);
  if (originalHeight !== undefined) Object.defineProperty(Element.prototype, 'clientHeight', originalHeight);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalObserver;
});

