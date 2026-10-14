/**
 * An omitted size follows the slot: inside a row `Panel`, `PanelFrame` and `PanelSizeBox` take the size the row draws the
 * slot at, so a tuned gap cannot leave a size box a few px off the slot; outside a row they keep the phone size.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { Panel, PanelFrame, PanelSizeBox, createWorkspace, definePanel, usePhoneSize } from '../index.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { useFrameClaim } from '../panelFrameClaim.js';
import { flush, mountWorkspace } from './support/workspace-row.js';

afterEach(cleanup);

/** The phone width the mounted workspace draws at. */
const PHONE = 390;

const BARE = (): React.ReactElement => React.createElement(PanelSizeBox, null, React.createElement(Panel, { title: 'P', children: React.createElement(PanelFrame, null, 'x') }));

/** The same view claiming the frame, so the row's default frame does not wrap it a second time. */
const CLAIMING = (): React.ReactElement => {
  useFrameClaim('frame');
  return BARE();
};

async function rowWith(gap: number, slots: number) {
  const view = definePanel({ id: 'sized', view: CLAIMING, settings: { slots } });
  const root = definePanel({ id: 'root', view: () => {
      useFrameClaim('frame');
      return null;
    },
    settings: {} });
  const ws = createWorkspace({ mount: false, root, templates: [view], tuning: { rowGap: gap } });
  ws.addPanel('sized');
  const m = mountWorkspace(ws, { width: 4000 });
  await flush();
  const box = m.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  const frame = m.container.querySelector<HTMLElement>('[data-phone-frame]')!;
  const slot = box.closest<HTMLElement>('[data-row-slot]')!;
  return { box, frame, slot };
}

test('in a row with a 24 px gap a two-slot panel size box, Panel and PanelFrame equal the drawn width', async () => {
  const r = await rowWith(24, 2);
  const drawn = 2 * PHONE + 24;
  assert.equal(r.box.style.width, `${drawn}px`, 'the size box is the slot width, not 2 phones and the default gap');
  assert.equal(getComputedStyle(r.frame).width, `${drawn}px`, 'PanelFrame');
  assert.equal(getComputedStyle(r.box.firstElementChild!).width, `${drawn}px`, 'Panel');
  assert.notEqual(r.box.style.width, `${2 * PHONE + 16}px`, 'control: the default 16 px gap would price it differently');
});

test('a one-slot panel in the same row is the phone width', async () => {
  const r = await rowWith(24, 1);
  assert.equal(r.box.style.width, `${PHONE}px`);
});

test('outside a row an omitted size is the phone size', () => {
  let phone = { width: 0, height: 0 };
  const Probe = (): null => {
    phone = usePhoneSize();
    return null;
  };
  const m = mount(withHost(React.createElement(React.Fragment, null, React.createElement(Probe), BARE())));
  const box = m.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  assert.equal(box.style.width, `${phone.width}px`);
  assert.equal(box.style.height, `${phone.height}px`);
});

test('the layout helpers and GAP carry @deprecated in the API report, PANEL_TRANSITION does not', () => {
  const report = readFileSync(new URL('../etc/phonux.api.md', import.meta.url), 'utf8');
  const lines = report.split('\n');
  const tagOf = (declaration: RegExp): string => lines[lines.findIndex((l) => declaration.test(l)) - 1] ?? 'not found';
  for (const declaration of [/^export const GAP\b/, /^export function panelWidthOf\b/, /^export function reorderStepsForOffset\b/, /^export function computeRowLayout\b/, /^export function computeRowNumbers\b/, /^export const DRAG_CLOSE\b/]) {
    assert.equal(tagOf(declaration), '// @public @deprecated', String(declaration));
  }
  assert.equal(tagOf(/^export const PANEL_TRANSITION\b/), '// @public');
});
