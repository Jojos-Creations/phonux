/**
 * Maximize grows a panel from its slot to the window and back as a move and a clip: the root's box is set once, to the window, no
 * frame of the grow or the shrink writes its top, left, width or height, and none scales it, so its content is never stretched. jsdom has no popover and no layout, so both are stubbed.
 */
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MAXIMIZED_ATTRIBUTE, usePanelMaximize, type PanelMaximize } from '../index.js';
import { PANEL_ROOT_ATTRIBUTE } from '../rowDom.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';

const SLOT = { left: 100, top: 50, width: 390, height: 700 };
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const saved = { rect: HTMLElement.prototype.getBoundingClientRect, show: proto.showPopover, hide: proto.hidePopover };

beforeEach(() => {
  proto.showPopover = () => {};
  proto.hidePopover = () => {};
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const { left, top, width, height } = this.hasAttribute('data-test-slot') ? SLOT : { left: 0, top: 0, width: 0, height: 0 };
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = saved.rect;
  proto.showPopover = saved.show;
  proto.hidePopover = saved.hide;
});

let api: PanelMaximize | null = null;
function Grower(): React.ReactElement {
  const anchor = React.useRef<HTMLButtonElement>(null);
  api = usePanelMaximize(anchor);
  return React.createElement('button', { ref: anchor }, 'grow');
}

function mountPanel(): HTMLElement {
  const mounted = mount(React.createElement('div', { 'data-test-slot': '' }, React.createElement('div', { [PANEL_ROOT_ATTRIBUTE]: '', style: { width: '390px' } }, React.createElement(Grower))));
  return mounted.container.querySelector<HTMLElement>(`[${PANEL_ROOT_ATTRIBUTE}]`)!;
}

const box = (el: HTMLElement): string => [el.style.top, el.style.left, el.style.width, el.style.height].join(' ');

/** Every distinct box the root's style attribute carried while `run` ran. */
async function boxesDuring(root: HTMLElement, run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const now = box(root);
    if (seen.at(-1) !== now) seen.push(now);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  try {
    await run();
  } finally {
    observer.disconnect();
  }
  return seen;
}

test('a grow eases the panel\'s real box from its slot to the window, never moved by a transform or clipped, and lands on the stylesheet box', async () => {
  const root = mountPanel();
  let transforms = '';
  const boxes = await boxesDuring(root, async () => {
    act(() => void api!.toggle());
    for (let k = 0; k < 30; k += 1) {
      await advanceFrames(10);
      transforms += root.style.transform + root.style.clipPath;
    }
    assert.equal(api!.phase, 'growing');
  });
  const { clientWidth, clientHeight } = document.documentElement;
  const first = boxes[0]!.split(' ').map(Number.parseFloat);
  assert.ok([50, 100, 390, 700].every((v, k) => Math.abs(first[k]! - v) < 2), `it starts at its slot: ${boxes[0]}`);
  assert.ok(boxes.length > 10, `its box eases on each frame: ${boxes.length} boxes`);
  for (const b of boxes) {
    const [top, left, width, height] = b.split(' ').map(Number.parseFloat) as [number, number, number, number];
    const within = (v: number, a: number, z: number): boolean => v >= Math.min(a, z) - 1e-6 && v <= Math.max(a, z) + 1e-6;
    assert.ok(within(top, 50, 0) && within(left, 100, 0) && within(width, 390, clientWidth) && within(height, 700, clientHeight), `between the slot and the window: ${b}`);
  }
  assert.equal(transforms, '', 'never moved by a transform or clipped');
  await advanceFrames(400);
  assert.equal(api!.phase, 'maximized');
  assert.ok(root.hasAttribute(MAXIMIZED_ATTRIBUTE));
  assert.deepEqual([root.style.top, root.style.left, root.style.right, root.style.bottom, root.style.width, root.style.height], ['0px', '0px', '0px', '0px', 'auto', 'auto']);
});

test('a shrink interrupted by a grow and shrunk again lands back in the slot with the style it had', async () => {
  const root = mountPanel();
  const before = root.getAttribute('style');
  act(() => void api!.toggle());
  await advanceFrames(800);
  assert.equal(api!.phase, 'maximized');
  const boxes = await boxesDuring(root, async () => {
    act(() => void api!.toggle());
    await advanceFrames(200);
    assert.equal(api!.phase, 'shrinking');
    act(() => void api!.toggle());
    await advanceFrames(100);
    assert.equal(api!.phase, 'growing');
    act(() => void api!.toggle());
    await advanceFrames(800);
  });
  assert.equal(api!.phase, 'home');
  assert.equal(root.getAttribute('style'), before, 'the slot style is back exactly');
  assert.ok(boxes.length > 10, `the box eased on the way down and back: ${boxes.length} boxes`);
});
