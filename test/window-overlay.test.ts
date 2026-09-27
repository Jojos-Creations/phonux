/**
 * shared/phone/windowOverlay.tsx, STATIC side: no `document` may exist here, so never import dom-harness.ts or
 * jsdom-globals.ts. Effects do not run, so where an overlay LANDS is window-overlay-mount.test.ts's question.
 * NEVER hand a DOM node or a React element to assert.equal: a failing assertion walks React's fiber graph and can
 * spin a CPU for a minute. Compare inside the test and assert a boolean.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, StrictMode, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverlayProvider, OverlaySlot, OverlayStore, WindowOverlay } from 'phonux';

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const marker = (name: string) => createElement('i', { 'data-ov': name });

/** root > row (dialog slot, column) + toast slot, all inside the provider: the shape of the real host. */
const scene = (inColumn: ReactNode): ReactNode =>
  createElement(
    OverlayProvider,
    null,
    createElement(
      'div',
      { 'data-root': '' },
      createElement('div', { 'data-row': '' }, createElement(OverlaySlot, { name: 'dialog' }), createElement('section', { 'data-column': '' }, inColumn)),
      createElement(OverlaySlot, { name: 'toast' }),
    ),
  );

test('W-S0 positive control: this process has no document, so every static test below really ran without one', () => {
  assert.ok(typeof document === 'undefined');
  assert.ok(typeof window === 'undefined');
});

test('W-S1 an OPEN overlay under renderToStaticMarkup renders its content once, in place (effects do not run, so nothing is hoisted)', () => {
  const open = renderToStaticMarkup(scene(createElement(WindowOverlay, { children: marker('A') })));
  assert.ok(count(open, 'data-ov="A"') === 1, 'exactly one copy of the content');
  const closed = renderToStaticMarkup(scene(createElement(WindowOverlay, { open: false, children: marker('A') })));
  assert.ok(count(closed, 'data-ov="A"') === 0, 'control: the same assertion sees an absent overlay');
});

test('W-S2 closed overlays and idle slots add ZERO markup', () => {
  const bare = renderToStaticMarkup(createElement('div', { 'data-root': '' }, createElement('div', { 'data-row': '' }, createElement('section', { 'data-column': '' }))));
  const withLayer = renderToStaticMarkup(scene(createElement(WindowOverlay, { open: false, children: marker('A') })));
  assert.ok(withLayer === bare, 'provider + two slots + a closed WindowOverlay render exactly what the bare tree renders');
  const withToast = renderToStaticMarkup(scene(createElement(WindowOverlay, { slot: 'toast', open: false, children: marker('T') })));
  assert.ok(withToast === bare, 'a closed toast adds nothing either');
  assert.ok(renderToStaticMarkup(scene(createElement(WindowOverlay, { children: marker('A') }))) !== bare, 'control: an open overlay does change the markup');
});

test('W-S3 with NO provider a WindowOverlay renders in place, and a slot outside a provider renders nothing (no throw)', () => {
  const noProvider = renderToStaticMarkup(createElement('div', null, createElement(WindowOverlay, { children: marker('A') }), createElement(OverlaySlot, { name: 'dialog' })));
  assert.ok(count(noProvider, 'data-ov="A"') === 1);
  assert.ok(noProvider === '<div><i data-ov="A"></i></div>', 'the slot contributed nothing');
});

test('W-S4 StrictMode + provider on the server: still exactly one copy', () => {
  const html = renderToStaticMarkup(createElement(StrictMode, null, scene(createElement(WindowOverlay, { children: marker('A') }))));
  assert.ok(count(html, 'data-ov="A"') === 1);
});

test('W-S5 no console.error / console.warn during static renders (React 19 has no useLayoutEffect-on-server warning); the capture works (control)', () => {
  const errors = mock.method(console, 'error', () => {});
  const warns = mock.method(console, 'warn', () => {});
  try {
    renderToStaticMarkup(scene(createElement(WindowOverlay, { children: marker('A') })));
    renderToStaticMarkup(scene(createElement(WindowOverlay, { slot: 'toast', children: marker('T') })));
    renderToStaticMarkup(createElement('div', null, createElement(WindowOverlay, { children: marker('A') })));
    assert.ok(errors.mock.callCount() === 0 && warns.mock.callCount() === 0, 'silent');
    console.error('control');
    assert.ok(errors.mock.callCount() === 1, 'control: the capture sees a deliberate error');
  } finally {
    mock.restoreAll();
  }
});

test('W-S6 store: an identical node is a no-op, a new node notifies once, removing an unknown id is a no-op', () => {
  const s = new OverlayStore();
  const emitted = (): number => s.notifications; // a call, so TypeScript does not narrow the count to its last asserted value
  const node = createElement('b');
  s.set('a', { slot: 'dialog', node });
  assert.ok(emitted() === 1);
  s.set('a', { slot: 'dialog', node });
  assert.ok(emitted() === 1, 'same node: nothing emitted (the churn short-circuit)');
  s.set('a', { slot: 'dialog', node: createElement('b') });
  assert.ok(emitted() === 2);
  s.remove('nope');
  assert.ok(emitted() === 2, 'unknown id: nothing emitted');
  s.remove('a');
  assert.ok(emitted() === 3);
});

test('W-S7 store: registration order is stacking order; re-set keeps the place; remove + set moves to the end; slots do not disturb each other', () => {
  const s = new OverlayStore();
  const ids = (slot: 'dialog' | 'toast') => s.read(slot).map((i) => i.id).join(',');
  s.set('a', { slot: 'dialog', node: createElement('b') });
  s.set('b', { slot: 'dialog', node: createElement('b') });
  s.set('c', { slot: 'dialog', node: createElement('b') });
  assert.ok(ids('dialog') === 'a,b,c');
  s.set('a', { slot: 'dialog', node: createElement('i') });
  assert.ok(ids('dialog') === 'a,b,c', 're-registering keeps the place');
  s.remove('b');
  s.set('b', { slot: 'dialog', node: createElement('b') });
  assert.ok(ids('dialog') === 'a,c,b', 'hide then show goes on top');
  const before = s.read('dialog');
  s.set('t', { slot: 'toast', node: createElement('b') });
  assert.ok(s.read('dialog') === before, 'a toast registration leaves the dialog snapshot referentially identical (no re-render of that slot)');
  assert.ok(ids('toast') === 't');
  s.set('a', { slot: 'toast', node: createElement('b') });
  assert.ok(ids('dialog') === 'c,b' && ids('toast').split(',').sort().join() === 'a,t', 'changing slot moves the entry (WindowOverlay removes before it re-sets, so through the component it also goes on top)');
  assert.ok(s.read('dialog') !== s.read('toast'));
  assert.ok(new OverlayStore().read('dialog') === new OverlayStore().read('toast'), 'empty snapshots share one frozen array');
});
