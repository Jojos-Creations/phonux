/**
 * `tuning.firstPressFocusOnly`: a press on a panel not in use only puts it in use, and the control it lands on sees nothing
 * until the panel is in use. Off by default, when the first press reaches the content.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { matrixRig, matrixTemplate, type MatrixRig, type MatrixRigOptions } from './support/configure-matrix.js';
import { differential, differentialsCovered } from './support/differential.js';

afterEach(() => cleanup());

const rig = async (on = true, extra?: MatrixRigOptions): Promise<MatrixRig> => {
  const r = await matrixRig({ ...extra, workspace: { tuning: { firstPressFocusOnly: on } } });
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

test('off by default: the first press puts the panel in use and clicks, and frames keep the pointer', async () => {
  const r = await rig(false);
  const clicks: string[] = [];
  const b = button(r, 'b', clicks);
  const frame = r.slot('c')!.appendChild(document.createElement('iframe'));
  tap(r, r.slot('a')!);
  await r.settle();
  tap(r, b);
  assert.deepEqual(clicks, ['b'], 'the first press clicks');
  assert.equal(covers(r, 'b'), 0, 'no cover');
  assert.equal(frame.style.pointerEvents, '', 'a frame in a panel not in use still takes the pointer');
});

test('tuning.firstPressFocusOnly decides whether the first press clicks', async () => {
  const clicksWith = async (on: boolean): Promise<string[]> => {
    const r = await rig(on);
    const clicks: string[] = [];
    const b = button(r, 'b', clicks);
    tap(r, r.slot('a')!);
    tap(r, b);
    r.m.unmount();
    return clicks;
  };
  const seen = { off: await clicksWith(false), on: await clicksWith(true) };
  differential('tuning.firstPressFocusOnly', (run) => {
    for (const value of [false, true]) run(value, () => seen[value ? 'on' : 'off']);
  });
});

test("a template's own firstPressFocusOnly wins over the workspace's, either way", async () => {
  const clicksWith = async (workspace: boolean, template: boolean): Promise<{ clicks: string[]; frame: string }> => {
    const r = await rig(workspace, { ids: ['a', 'c'], extra: [matrixTemplate('b', { firstPressFocusOnly: template })] });
    r.turn(() => r.ws.addPanel('b'));
    await r.settle();
    const clicks: string[] = [];
    const b = button(r, 'b', clicks);
    const frame = r.slot('b')!.appendChild(document.createElement('iframe'));
    tap(r, r.slot('a')!);
    await r.settle();
    const asleep = frame.style.pointerEvents;
    tap(r, b);
    r.m.unmount();
    return { clicks, frame: asleep };
  };
  assert.deepEqual(await clicksWith(true, false), { clicks: ['b'], frame: '' }, 'on for the row, off for b: b clicks at once');
  assert.deepEqual(await clicksWith(false, true), { clicks: [], frame: 'none' }, 'off for the row, on for b: b only goes in use');
});

test('a template whose firstPressFocusOnly is not a boolean is refused', () => {
  assert.throws(() => matrixTemplate('b', { firstPressFocusOnly: 'yes' as unknown as boolean }), /firstPressFocusOnly must be a boolean/);
});

test('every name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), ['tuning.firstPressFocusOnly']);
});
