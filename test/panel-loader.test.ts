/** A panel is never empty while it loads: the placeholder is up at once, the host has a short window, and every load ends somewhere. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import { cleanup, mount } from './support/mount-harness.js';
import { PanelLoader, type PanelLoaderProps } from '../PanelLoader.js';

afterEach(() => cleanup());

const later = (ms: number): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const never = (): Promise<never> => new Promise(() => undefined);
const content = createElement('p', { 'data-content': '' }, 'Loaded');
const show = async (props: Omit<PanelLoaderProps, 'children'>): Promise<HTMLElement> => {
  const { container } = mount(createElement(PanelLoader, { ...props, children: content }));
  await later(0);
  return container;
};
const state = (c: HTMLElement): string | null | undefined => c.querySelector('[data-panel-loader]')?.getAttribute('data-panel-loader');

test('the generic placeholder is up at once, before anything resolves, and the content is not', async () => {
  const c = await show({ load: never });
  assert.ok(c.querySelector('[data-panel-placeholder="generic"]'));
  assert.equal(c.querySelector('[data-content]'), null);
  assert.equal(state(c), 'waiting');
});

test('when load resolves the content comes in and the placeholder goes', async () => {
  const c = await show({ load: () => Promise.resolve() });
  await later(10);
  assert.ok(c.querySelector('[data-content]'));
  await later(200);
  assert.equal(c.querySelector('[data-panel-placeholder]'), null, 'the placeholder faded off');
});

test('a host placeholder answered inside the window shows; synchronous and promised alike', async () => {
  const sync = await show({ load: never, placeholder: () => createElement('i', { 'data-mine': '' }) });
  await later(0);
  assert.ok(sync.querySelector('[data-panel-placeholder="host"] [data-mine]'));
  cleanup();
  const promised = await show({ load: never, windowMs: 60, placeholder: async () => { await new Promise((done) => setTimeout(done, 20)); return createElement('i', { 'data-mine': '' }); } });
  await later(40);
  assert.ok(promised.querySelector('[data-mine]'));
});

test('a host placeholder answered after the window is dropped, so the placeholder never swaps late', async () => {
  const c = await show({ load: never, windowMs: 20, placeholder: async () => { await new Promise((done) => setTimeout(done, 50)); return createElement('i', { 'data-mine': '' }); } });
  await later(90);
  assert.equal(c.querySelector('[data-mine]'), null);
  assert.ok(c.querySelector('[data-panel-placeholder="generic"]'));
});

test('a host placeholder that rejects leaves the generic one up', async () => {
  const c = await show({ load: never, placeholder: () => Promise.reject(new Error('no')) });
  await later(10);
  assert.ok(c.querySelector('[data-panel-placeholder="generic"]'));
  assert.equal(c.querySelector('[data-panel-placeholder="host"]'), null);
});

test('a failed load ends in the failed view, and Try again loads again', async () => {
  let calls = 0;
  const c = await show({ load: () => (++calls === 1 ? Promise.reject(new Error('no')) : Promise.resolve()) });
  await later(10);
  assert.equal(state(c), 'failed');
  assert.equal(c.querySelector('[data-panel-load-failed]')?.getAttribute('data-panel-load-failed'), 'error');
  assert.equal(c.querySelector('[data-panel-placeholder]'), null);
  await act(async () => void c.querySelector<HTMLButtonElement>('[data-panel-load-retry]')!.click());
  await later(10);
  assert.equal(calls, 2);
  assert.ok(c.querySelector('[data-content]'));
});

test('a load that never answers times out into the failed view', async () => {
  const c = await show({ load: never, timeoutMs: 20 });
  await later(50);
  assert.equal(c.querySelector('[data-panel-load-failed]')?.getAttribute('data-panel-load-failed'), 'timeout');
});

test('content that arrives after the timeout still comes in', async () => {
  const c = await show({ load: () => new Promise((done) => setTimeout(done, 50)), timeoutMs: 15 });
  await later(30);
  assert.equal(state(c), 'failed');
  await later(40);
  assert.ok(c.querySelector('[data-content]'));
});

test('a load that resolves after the panel unmounts changes nothing', async () => {
  let finish: () => void = () => undefined;
  await show({ load: () => new Promise<void>((done) => { finish = done; }) });
  cleanup();
  finish();
  await later(10);
});
