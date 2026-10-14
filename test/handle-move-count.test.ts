/**
 * handle.move(by): a signed slot count as one gated call, and the default frame's drag and `usePanelPinned` built on the handle.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { definePanel, usePanelDragProps, usePanelPinned } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig } from './support/pin-rig.js';

afterEach(cleanup);

const letter = (a: { ok: boolean; changed?: boolean; code?: string }): string => (a.ok ? (a.changed ? 'T' : 'F') : (a.code as string));

test('move(-3) crosses three slots in one call and move(3) crosses them back', async () => {
  const r = await pinRig({ ids: ['a', 'b', 'c', 'd'] });
  assert.equal(r.order().join(' '), 'root a b c d');
  assert.equal(letter(r.turn(() => r.h.d!.move(-3, 'person'))), 'T');
  assert.equal(r.order().join(' '), 'root d a b c');
  assert.equal(letter(r.turn(() => r.h.d!.move(3, 'person'))), 'T');
  assert.equal(r.order().join(' '), 'root a b c d');
});

test('a count past the end clamps there; at the end, or for 0, nothing moves and it is accepted unchanged', async () => {
  const r = await pinRig();
  assert.equal(letter(r.turn(() => r.h.a!.move(9))), 'T');
  assert.equal(r.order().join(' '), 'root b c a');
  assert.equal(letter(r.turn(() => r.h.a!.move(1))), 'F');
  assert.equal(letter(r.turn(() => r.h.a!.move(0))), 'F');
  assert.equal(letter(r.turn(() => r.h.a!.move(2.5))), 'F');
  assert.equal(r.order().join(' '), 'root b c a');
});

test('one move is one gate token: a second move on the panel in the same turn answers busy, another panel is free', async () => {
  const r = await pinRig({ ids: ['a', 'b', 'c', 'd'] });
  const out = r.turn(() => [r.h.d!.move(-2), r.h.d!.move(1), r.h.a!.move(1)].map(letter));
  assert.deepEqual(out, ['T', 'busy', 'T']);
});

test('a panel that cannot be dragged refuses a count with not-draggable', async () => {
  const r = await pinRig({ settings: { b: { draggable: false } } });
  assert.equal(letter(r.turn(() => r.h.b!.move(-1))), 'not-draggable');
});

test('usePanelPinned reads PanelState.pinned, before and after a pin and a drag across the root', async () => {
  const seen = definePanel({ id: 'seen', view: ({ panel }) => React.createElement('u', { 'data-seen': panel.id, 'data-pinned': String(usePanelPinned()) }), settings: { frame: 'none' } });
  const r = await pinRig({ ids: ['a'], extra: [seen] });
  const s = r.ws.addPanel('seen');
  await r.settle();
  const read = (): string => r.m.container.querySelector('[data-seen]')!.getAttribute('data-pinned')!;
  const agree = (): void => assert.equal(read(), String(s.getState().pinned));
  agree();
  r.turn(() => s.pin());
  await r.settle();
  assert.equal(s.getState().pinned, true);
  agree();
  r.turn(() => s.unpin());
  await r.settle();
  assert.equal(s.getState().pinned, false);
  agree();
  r.turn(() => s.configure({ pinning: { pinned: { parkable: true }, unpinned: { parkable: false } } }));
  await r.settle();
  assert.equal(s.getState().pinned, true, 'the swapped definition reads pinned while the panel sits right of the root');
  agree();
});

test('usePanelDragProps offers a close to a closable panel only, and a reorder to a draggable one only', async () => {
  const probe = definePanel({
    id: 'probe',
    view: () => {
      const props = usePanelDragProps();
      return React.createElement('u', { 'data-probe': '', 'data-close': String(props.onClose !== undefined), 'data-reorder': String(props.reorder !== undefined) });
    },
    settings: { frame: 'none', multiple: true },
  });
  const r = await pinRig({ ids: ['a'], extra: [probe] });
  const read = (): string[][] => [...r.m.container.querySelectorAll<HTMLElement>('[data-probe]')].map((n) => [n.dataset.close!, n.dataset.reorder!]);
  r.ws.addPanel('probe');
  r.ws.addPanel('probe', { settings: { closable: false } });
  r.ws.addPanel('probe', { settings: { draggable: false } });
  await r.settle();
  assert.deepEqual(read(), [['true', 'true'], ['false', 'true'], ['true', 'false']]);
});
