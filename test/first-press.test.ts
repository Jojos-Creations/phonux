/** A press on a panel not in use only puts it in use; the control it lands on sees nothing until the panel is in use. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { matrixRig, type MatrixRig } from './support/configure-matrix.js';

afterEach(() => cleanup());

const rig = async (): Promise<MatrixRig> => {
  const r = await matrixRig({});
  await r.settle();
  return r;
};
const down = (r: MatrixRig, el: Element): void => r.turn(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })));
const tap = (r: MatrixRig, el: Element): void => {
  down(r, el);
  r.turn(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};
const button = (r: MatrixRig, id: string, clicks: string[]): HTMLButtonElement => {
  const b = r.slot(id)!.appendChild(document.createElement('button'));
  b.addEventListener('click', () => clicks.push(id));
  return b;
};
const covers = (r: MatrixRig, id: string): number => r.slot(id)!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-press-cover]').length;

test('the press that puts a panel in use never clicks what it lands on; the next press does', async () => {
  const r = await rig();
  const clicks: string[] = [];
  const b = button(r, 'b', clicks);
  tap(r, r.slot('a')!);
  tap(r, b);
  assert.deepEqual(clicks, [], 'first press only puts b in use');
  assert.equal(covers(r, 'b'), 0, 'the click takes the cover away');
  tap(r, b);
  assert.deepEqual(clicks, ['b'], 'b in use: the press clicks');
});

test("the first press still reaches the window, and a mousedown's default is stopped", async () => {
  const r = await rig();
  tap(r, r.slot('a')!);
  const b = button(r, 'b', []);
  const seen: string[] = [];
  const onDown = (): number => seen.push('pointerdown');
  window.addEventListener('pointerdown', onDown);
  down(r, b);
  window.removeEventListener('pointerdown', onDown);
  assert.deepEqual(seen, ['pointerdown']);
  assert.equal(covers(r, 'b'), 1, 'the cover waits for the release');
  const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  r.turn(() => void b.dispatchEvent(md));
  assert.equal(md.defaultPrevented, true, 'no focus or caret for the control');
});

test("a panel's own header buttons work on the first press", async () => {
  const r = await rig();
  tap(r, r.slot('a')!);
  const clicks: string[] = [];
  const header = r.slot('b')!.appendChild(document.createElement('div'));
  header.setAttribute('data-panel-chrome-part', 'header');
  const close = header.appendChild(document.createElement('button'));
  close.addEventListener('click', () => clicks.push('close'));
  tap(r, close);
  assert.deepEqual(clicks, ['close']);
});

test('frames in a panel not in use take no pointer, and get it back with the panel', async () => {
  const r = await rig();
  tap(r, r.slot('a')!);
  const frame = r.slot('b')!.appendChild(document.createElement('iframe'));
  await r.settle();
  assert.equal(frame.style.pointerEvents, 'none', 'b not in use');
  tap(r, r.slot('b')!);
  await r.settle();
  assert.equal(frame.style.pointerEvents, '', 'b in use');
});
