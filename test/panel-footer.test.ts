/**
 * The footer a template declares: where it is drawn, what it receives, what leaves it out, and that a throwing one
 * hides only itself.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { HostProvider, Panel, PanelFooter, PanelFrame, PanelManagerError, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { cleanup, mount } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const h = React.createElement;
const Footer = ({ panel, handle, manager }: { panel: { id: string }; handle: { id: string }; manager: object }): React.ReactElement =>
  h('b', { 'data-footer': panel.id, 'data-handle-id': handle.id, 'data-manager-keys': Object.keys(manager).length > 0 ? 'yes' : 'no' }, 'F');

const Body = ({ handle }: { handle: { id: string } }): React.ReactElement => h('div', { 'data-body': handle.id }, 'body');

function mountWith(over: Partial<PanelTemplate>, frameProps: { footer?: boolean } = {}) {
  const view = ({ handle }: { handle: { id: string } }): React.ReactElement => h(Panel, { title: 'T', children: h(PanelFrame, { ...frameProps, children: h(Body, { handle }) }) });
  const t = definePanel({ id: 'a', view, ...over });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates: [t] });
  ws.addPanel(t);
  return mountWorkspace(ws);
}

test('a footer is drawn as the next sibling of the frame, floating below it, with the props the view gets', () => {
  const m = mountWith({ footer: Footer });
  const footer = m.container.querySelector('[data-footer]') as HTMLElement | null;
  assert.ok(footer, 'the footer rendered');
  assert.notEqual(footer.dataset.footer, '', 'the footer got a panel id');
  assert.equal(footer.dataset.handleId, (m.container.querySelector('[data-body]') as HTMLElement).dataset.body, 'the footer gets the same handle as the view');
  assert.equal(footer.dataset.managerKeys, 'yes');
  const box = footer.closest('[data-panel-footer]') as HTMLElement;
  const frame = box.previousElementSibling as HTMLElement;
  assert.equal(frame.hasAttribute('data-phone-frame'), true, 'the footer follows the frame as its sibling, not its child');
  assert.equal(frame.contains(box), false, 'the frame cannot clip the footer');
  assert.equal(frame.firstElementChild?.contains(m.container.querySelector('[data-body]')), true, 'the body stays in the frame scroller');
  assert.equal(getComputedStyle(box).position, 'absolute', 'the footer takes no space in the layout');
});

test('a template with no footer draws the frame it always did', () => {
  const none = mountWith({});
  assert.equal(none.container.querySelector('[data-panel-footer]') === null, true);
  const frame = none.container.querySelector('[data-phone-frame]') as HTMLElement;
  assert.equal(frame.children.length, 1, 'the frame holds only its scroll box');
});

test('footer={false} on the frame draws none, and PanelFooter in a view draws it', () => {
  const off = mountWith({ footer: Footer }, { footer: false });
  assert.equal(off.container.querySelector('[data-panel-footer]') === null, true);
  off.unmount();
  const view = (): React.ReactElement => h('section', null, h(PanelFooter));
  const t = definePanel({ id: 'b', view, footer: Footer });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates: [t] });
  ws.addPanel(t);
  const own = mountWorkspace(ws);
  assert.equal(own.container.querySelectorAll('[data-panel-footer]').length, 1);
});

test('outside a template view PanelFooter and PanelFrame draw no footer and do not throw', () => {
  const m = mount(h(HostProvider, { host: createFakeHost(), children: h(PanelFooter) }));
  assert.equal(m.container.innerHTML, '');
  const framed = mount(h(HostProvider, { host: createFakeHost(), children: h(PanelFrame, { children: 'x' }) }));
  assert.equal(framed.container.querySelector('[data-panel-footer]') === null, true);
});

test('a PanelFrame nested in another inside a template view draws the footer in each frame', () => {
  const view = (): React.ReactElement => h(PanelFrame, { children: h(PanelFrame, { children: 'x' }) });
  const t = definePanel({ id: 'n', view, footer: Footer });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates: [t] });
  ws.addPanel(t);
  assert.equal(mountWorkspace(ws).container.querySelectorAll('[data-panel-footer]').length, 2);
});

test('definePanel accepts any component kind for footer and refuses anything else', () => {
  const view = (): null => null;
  for (const footer of [() => null, React.memo(() => null), React.forwardRef(() => null), React.lazy(async () => ({ default: () => null }))]) {
    assert.doesNotThrow(() => definePanel({ id: 'ok', view, footer: footer as never }));
  }
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, footer: undefined }));
  for (const footer of ['text', 7, null, {}]) {
    assert.throws(
      () => definePanel({ id: 'bad', view, footer: footer as never }),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-template' && e.message.includes('footer must be a React component'),
    );
  }
});

test('a footer that throws while rendering is hidden, the panel stays, and the console is told by us once', () => {
  const calls: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void calls.push(args.map(String).join(' '));
  try {
    const Boom = (): never => {
      throw new Error('boom');
    };
    const m = mountWith({ footer: Boom });
    assert.equal(m.container.querySelector('[data-panel-footer]') === null, true);
    assert.equal(m.container.querySelector('[data-body]') !== null, true);
    assert.equal(calls.filter((c) => c.startsWith('PanelFooter:') && c.includes('boom')).length, 1);
  } finally {
    console.error = original;
  }
});

test('the footer is bare like the header: no shadow, border or fill, the header height, 4 px below the frame', () => {
  const m = mountWith({ footer: Footer });
  const box = m.container.querySelector('[data-panel-footer]') as HTMLElement;
  const style = getComputedStyle(box);
  assert.ok(['', 'none'].includes(style.boxShadow), `no shadow: ${style.boxShadow}`);
  const header = m.container.querySelector('[data-panel-chrome-part="header"]') as HTMLElement | null;
  assert.ok(header !== null, 'control: the panel draws a header');
  assert.equal(style.height, getComputedStyle(header).height, 'the footer is as tall as the header');
  assert.match(style.top, /calc\(100% \+ 4px\)/, 'the footer sits one header gap below the frame');
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) assert.ok(['', '0px'].includes(style[`border${side}Width`]), `no ${side.toLowerCase()} border`);
  assert.ok(['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor), `no fill: ${style.backgroundColor}`);
});

test('PanelFooter sx is layered last, so a developer can restyle the padding the library sets', () => {
  const view = (): React.ReactElement => h('section', null, h(PanelFooter, { sx: { px: '3px', borderRadius: '2px' } }));
  const t = definePanel({ id: 'a', view, footer: Footer });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates: [t] });
  ws.addPanel(t);
  const m = mountWorkspace(ws);
  const style = getComputedStyle(m.container.querySelector('[data-panel-footer]') as HTMLElement);
  assert.equal(style.paddingLeft, '3px');
  assert.equal(style.borderRadius, '2px');
});

test('the header floats 4 px above the frame and the grab handle stays a 24 px target', () => {
  const view = ({ handle }: { handle: { id: string } }): React.ReactElement => h(Panel, { title: 'T', grabProps: {}, children: h(PanelFrame, null, h(Body, { handle })) });
  const t = definePanel({ id: 'a', view });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates: [t] });
  ws.addPanel(t);
  const m = mountWorkspace(ws);
  const header = m.container.querySelector('[data-panel-chrome-part="header"]') as HTMLElement | null;
  assert.ok(header, 'the header rendered');
  assert.match(getComputedStyle(header).bottom, /calc\(100% \+ 4px\)/);
  const grab = m.container.querySelector('[data-panel-grab-bar]') as HTMLElement | null;
  assert.ok(grab, 'the grab handle rendered');
  assert.deepEqual([getComputedStyle(grab).width, getComputedStyle(grab).height], ['24px', '24px']);
});
