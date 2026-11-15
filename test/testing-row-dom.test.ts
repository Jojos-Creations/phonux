/**
 * A host's own jsdom test, with nothing from the library's test support: its own jsdom window as the globals (as a host's harness
 * makes it), then `stubRowDom` from `phonux/testing`, mounts a Workspace and its Embla row, and an arrow key steps the row one slot.
 * Real time: jsdom's own animation frames (pretendToBeVisual), not the library's virtual clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
// Node has its own Event, CustomEvent and navigator; a jsdom node dispatches only jsdom's.
for (const name of ['window', 'self', 'document', 'navigator', 'Event', 'CustomEvent', 'UIEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'WheelEvent']) {
  if (name in win) Object.defineProperty(globalThis, name, { value: name === 'window' || name === 'self' ? win : win[name], configurable: true, writable: true });
}
for (const name of Object.getOwnPropertyNames(win)) {
  if (name in globalThis) continue;
  Object.defineProperty(globalThis, name, { get: () => win[name], set: (value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }), configurable: true });
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testing = await import('../fakeHost.js');
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { HostProvider, PanelRow, Workspace, createWorkspace, definePanel, useProvidePanels } = await import('../index.js');
const { act } = React;

const marker = (): HTMLElement => {
  const el = win.document.createElement('div');
  el.setAttribute('data-row-embla-slot', '0');
  el.style.left = '406px';
  el.style.width = '390px';
  return el;
};

test('control: a bare jsdom window has none of what the row reads, and stubRowDom fills it in', () => {
  assert.equal(typeof win.IntersectionObserver, 'undefined', 'jsdom has no IntersectionObserver');
  assert.equal(typeof win.matchMedia, 'undefined', 'jsdom has no matchMedia');
  assert.equal(marker().offsetWidth, 0, 'jsdom reads 0 for every offset');
  testing.stubRowDom(win);
  assert.equal(typeof win.IntersectionObserver, 'function');
  assert.equal(typeof IntersectionObserver, 'function', 'and as a global, where Embla reads it');
  assert.equal(win.matchMedia('(prefers-reduced-motion: reduce)').matches, false);
  assert.equal(CSS.escape('a b'), 'a\\20 b');
  const m = marker();
  win.document.body.appendChild(m);
  assert.deepEqual([m.offsetLeft, m.offsetWidth], [406, 390], 'a slot marker reads the px written on it');
  assert.equal(win.getComputedStyle(m).getPropertyValue('margin-right'), '0px');
  const other = win.document.createElement('div');
  other.style.width = '390px';
  assert.equal(other.offsetWidth, 0, 'any other element keeps jsdom\'s answer');
  m.remove();
  testing.stubRowDom(win);
  assert.deepEqual([marker().offsetLeft], [406], 'a second call changes nothing');
});

test('a host using only phonux/testing mounts a Workspace and an arrow key steps its Embla row one slot', async () => {
  testing.stubRowDom(win);
  const PHONE = 390;
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const view = (name: string) => () => React.createElement('div', { 'data-box': name }, name);
  const ws = createWorkspace({ mount: false, root: definePanel({ id: 'root', view: view('root') }), templates: ids.map((id) => definePanel({ id, view: view(id), settings: { title: id } })), tuning: { rowGap: 16 } });
  for (const id of ids) ws.addPanel(id);
  function App(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const p = useProvidePanels({ workspace: ws, rootId: ws.rootId, phoneWidth: PHONE, containerWidth: 1000, overflowContainerRef: ref } as never) as never as Record<string, never>;
    return React.createElement(
      HostProvider,
      { host: testing.createFakeHost({ panels: p as never }) } as never,
      React.createElement(
        Workspace,
        { overflowContainerRef: ref, rowRef, containerWidth: 1000, rowResizeSettled: true, phoneWidth: PHONE, fixedColumnCount: p.fixedViewCount, liveWidths: p.liveWidths, rowScroll: p.rowScroll, rowNumbers: p.rowNumbers, workspace: ws } as never,
        React.createElement(PanelRow, { entries: p.entries, rootId: ws.rootId, closingIds: new Set(), enteringViaAnchorIds: new Set(), rowNumbers: p.rowNumbers, workspace: ws } as never),
      ),
    );
  }
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(App)));
  const box = (): HTMLElement => win.document.querySelector<HTMLElement>('[data-row-embla-window]')!.firstElementChild as HTMLElement;
  const at = (): number => Number(/translate3d\((-?[\d.e+-]+)px/.exec(box().style.transform)?.[1] ?? Number.NaN);
  assert.equal(win.document.querySelectorAll('[data-row-slot]').length, 6, 'the root and five pages have their slots');
  assert.equal(at(), 0, `the row stands at its start: ${box().style.transform}`);
  await act(async () => void win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  for (let ms = 0; ms < 4000 && Math.abs(at() + 406) > 0.5; ms += 50) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  assert.ok(Math.abs(at() + 406) <= 0.5, `ArrowRight stepped the row one slot (406 px): ${box().style.transform}`);
  await act(async () => root.unmount());
});
