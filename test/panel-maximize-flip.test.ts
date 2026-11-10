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

test('a grow sets the window box once and moves only the transform until it lands on the stylesheet box', async () => {
  const root = mountPanel();
  let mid = '';
  let start = '';
  let startClip = '';
  const boxes = await boxesDuring(root, async () => {
    act(() => void api!.toggle());
    start = root.style.transform;
    startClip = root.style.clipPath;
    await advanceFrames(300);
    mid = root.style.transform;
    assert.equal(api!.phase, 'growing');
  });
  const { clientWidth, clientHeight } = document.documentElement;
  assert.deepEqual(boxes, [`0px 0px ${document.documentElement.clientWidth}px ${document.documentElement.clientHeight}px`], 'one box: the window');
  assert.equal(start, 'translate(100px, 50px)', 'it starts at its slot, moved and never scaled');
  assert.equal(startClip, `inset(0px ${clientWidth - 390}px ${clientHeight - 700}px 0px round 0px)`, "and clipped to the slot's size");
  assert.notEqual(mid, start, 'the transform moves');
  assert.doesNotMatch(mid, /scale/, 'no frame scales the content');
  await advanceFrames(400);
  assert.equal(api!.phase, 'maximized');
  assert.ok(root.hasAttribute(MAXIMIZED_ATTRIBUTE));
  assert.equal(root.style.transform, '');
  assert.equal(root.style.clipPath, '');
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
  assert.equal(boxes.length, 2, `the window box once on the way down, then the slot's own style: ${boxes.join(' | ')}`);
});
