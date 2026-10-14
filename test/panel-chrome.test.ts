/**
 * The panel chrome API: the active and dragging panel, the hover-or-active chrome and its fade, the Workspace's own
 * resize settle, and the names a host styles from. Mounted in a row with Panels that draw a header, a grab bar and a footer.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { MotionConfig, animate, cubicBezier } from 'motion/react';
import * as entry from '../index.js';
import { DragToClose, Panel, PanelFrame, registerView, useActivePanel, useHost, usePanelActive, usePanelDragging, usePanelTuning } from '../index.js';
import { createChromeStore } from '../panelChrome.js';

// Read off the package entry, so a name the entry stops exporting fails a test and does not break the file's load.
const { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, DRAGGING_ATTRIBUTE } = entry;
import { PanelFooterContext } from '../panelFooter.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { headerRig } from './support/header-rig.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const renders: Record<string, number> = {};
let setActive: (id: string | null) => void = () => undefined;
let activeSeen: string | null = null;
let portalHost: HTMLElement | null = null;

function Controls(): React.ReactElement {
  const [current, set] = useActivePanel();
  setActive = set;
  activeSeen = current;
  return React.createElement('span');
}

function ChromeView({ id }: { id: string }): React.ReactElement {
  const active = usePanelActive();
  const dragging = usePanelDragging();
  const tuning = usePanelTuning();
  const { panels } = useHost();
  renders[id] = (renders[id] ?? 0) + 1;
  return React.createElement(DragToClose, {
    onClose: () => void panels.close(id),
    children: (handle) =>
      React.createElement(
        PanelFooterContext.Provider,
        { value: React.createElement('span', { 'data-foot': id }, 'footer') },
        React.createElement(
          Panel,
          { ...({ 'data-panel-root': id } as object), title: id, grabProps: { 'data-grab': id, onPointerDown: handle.onPointerDown }, children: null },
          React.createElement(
            PanelFrame,
            null,
            React.createElement('button', { type: 'button', 'data-body': id }, `${id} ${active ? 'active' : ''} ${dragging ? 'dragging' : ''} ${tuning.chrome.mode}`),
            id === 'c1' ? React.createElement(Controls) : null,
            portalHost === null ? null : createPortal(React.createElement('button', { type: 'button', 'data-portaled': id }, 'portaled'), portalHost),
          ),
        ),
      ),
  });
}
registerView('chrome-view', ({ panel }) => React.createElement(ChromeView, { id: panel.id }));

const entries = (count: number) => row(rootEntry(), ...Array.from({ length: count }, (_, k) => made(`c${k + 1}`, {}, { view: 'chrome-view' })));
const rootOf = (m: MountedRow, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-panel-root="${id}"]`)!;
const activeIds = (m: MountedRow): string[] => ['c1', 'c2', 'c3'].filter((id) => m.container.querySelector(`[data-body="${id}"]`) !== null && rootOf(m, id).hasAttribute(ACTIVE_ATTRIBUTE));
const press = (el: Element): void => void act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
const focusIn = (el: HTMLElement): void => void act(() => el.focus());
const part = (m: MountedRow, id: string, which: 'header' | 'grab-bar' | 'footer'): HTMLElement => rootOf(m, id).querySelector<HTMLElement>(`[${CHROME_ATTRIBUTE}="${which}"]`)!;
const hover = (el: Element, on: boolean): void =>
  void act(() => void el.dispatchEvent(new MouseEvent(on ? 'pointerover' : 'pointerout', { bubbles: true, relatedTarget: on ? document.body : null })));

test('the attribute names a host styles from are pinned', () => {
  assert.equal(ACTIVE_ATTRIBUTE, 'data-panel-active');
  assert.equal(DRAGGING_ATTRIBUTE, 'data-panel-dragging');
  assert.equal(CHROME_ATTRIBUTE, 'data-panel-chrome-part');
});

test('the package entry exports the names a mounted workspace renders: the marks, and one element per chrome part', async () => {
  assert.deepEqual(CHROME_PARTS, { header: 'header', grabBar: 'grab-bar', footer: 'footer', resize: 'resize' });
  const m = mountRow(entries(2), 3000);
  await advanceFrames(2000);
  const panel = rootOf(m, 'c1');
  assert.equal(panel.hasAttribute(ACTIVE_ATTRIBUTE), false);
  press(m.container.querySelector('[data-body="c1"]')!);
  assert.equal(panel.hasAttribute(ACTIVE_ATTRIBUTE), true, 'the active mark is written under the exported name');
  assert.equal(panel.getAttribute(ACTIVE_ATTRIBUTE), '', 'and it is empty-valued');
  press(m.container.querySelector('[data-body="c2"]')!);
  assert.equal(panel.hasAttribute(ACTIVE_ATTRIBUTE), false, 'and removed when another panel is used');
  await drag(m.container.querySelector('[data-grab="c1"]')!, { dx: 0, dy: 24, steps: 6, hold: 8, keepDown: true });
  assert.equal(rootOf(m, 'c1').hasAttribute(DRAGGING_ATTRIBUTE), true, 'the dragging mark is written under the exported name');
  assert.equal(rootOf(m, 'c1').getAttribute(DRAGGING_ATTRIBUTE), '', 'and it is empty-valued');
  await release(0, 24);
  await advanceFrames(3000);
  assert.equal(rootOf(m, 'c1').hasAttribute(DRAGGING_ATTRIBUTE), false);
  // The grips are drawn by PanelResizeGrips alone, which this panel does not put in its overlay (test/panel-resize-grips.test.ts).
  const drawn = Object.values(CHROME_PARTS).filter((value) => value !== CHROME_PARTS.resize);
  for (const value of drawn) {
    assert.equal(panel.querySelectorAll(`[${CHROME_ATTRIBUTE}="${value}"]`).length, 1, `one ${value}`);
  }
  assert.equal(panel.querySelectorAll(`[${CHROME_ATTRIBUTE}]`).length, drawn.length, 'no part carries a value the object lacks');
});

test('a press or a focus inside a panel makes it the one active panel, until another is used', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  assert.deepEqual(activeIds(m), [], 'nothing is active before the person uses a panel');
  press(m.container.querySelector('[data-body="c2"]')!);
  assert.deepEqual(activeIds(m), ['c2']);
  press(m.container.querySelector('[data-body="c3"]')!);
  assert.deepEqual(activeIds(m), ['c3'], 'using another panel moves the mark');
  focusIn(m.container.querySelector<HTMLElement>('[data-body="c1"]')!);
  assert.deepEqual(activeIds(m), ['c1'], 'keyboard focus activates too');
  assert.equal(activeSeen, 'c1', 'useActivePanel reads the same id');
});

test('History counts as a panel: a press inside it makes it the active one', async () => {
  const m = mountRow(entries(2), 3000);
  await advanceFrames(2000);
  press(m.container.querySelector('[data-slot="root"]')!);
  assert.equal(activeSeen, 'root');
});

test('under StrictMode the double effects change nothing: one press, one active panel, and the mark clears when it moves', async () => {
  const strict = (ui: React.ReactElement): React.ReactElement => React.createElement(React.StrictMode, null, ui);
  const m = mountRow(entries(3), 3000, {}, strict);
  await advanceFrames(2000);
  press(m.container.querySelector('[data-body="c1"]')!);
  assert.deepEqual(activeIds(m), ['c1']);
  press(m.container.querySelector('[data-body="c2"]')!);
  assert.deepEqual(activeIds(m), ['c2']);
});

test('the setter sets and clears the active panel, and a panel outside the row can be set too', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  act(() => setActive('c2'));
  assert.deepEqual(activeIds(m), ['c2']);
  act(() => setActive(null));
  assert.deepEqual(activeIds(m), []);
});

test('closing or parking the active panel clears it', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  press(m.container.querySelector('[data-body="c2"]')!);
  assert.equal(activeSeen, 'c2');
  act(() => void m.latest().close('c2'));
  await advanceFrames(2000);
  assert.equal(activeSeen, null, 'a closed panel is not the active one');
});

test('a press inside a portaled descendant keeps its panel active', async () => {
  portalHost = document.createElement('div');
  document.body.appendChild(portalHost);
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  const inPortal = portalHost.querySelector('[data-portaled="c3"]');
  assert.ok(inPortal, 'the portaled child rendered outside the row');
  press(inPortal);
  assert.deepEqual(activeIds(m), ['c3']);
  portalHost.remove();
  portalHost = null;
});

test('two rows share nothing: each has its own active panel', async () => {
  const a = mountRow(entries(2), 3000);
  const b = mountRow(entries(2), 3000);
  await advanceFrames(2000);
  press(a.container.querySelector('[data-body="c1"]')!);
  assert.deepEqual(activeIds(a), ['c1']);
  assert.deepEqual(activeIds(b), []);
});

test('activating a panel renders only the panel that lost the mark and the one that gained it', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  press(m.container.querySelector('[data-body="c1"]')!);
  const before = { ...renders };
  press(m.container.querySelector('[data-body="c2"]')!);
  const delta = (id: string): number => (renders[id] ?? 0) - (before[id] ?? 0);
  assert.ok(delta('c3') === 0, `an uninvolved panel did not render (rendered ${delta('c3')})`);
  assert.ok(delta('c1') > 0 && delta('c2') > 0, 'the two involved panels did');
});

test('the active panel is not part of the workspace snapshot', async () => {
  const m = mountRow(entries(2), 3000);
  await advanceFrames(2000);
  const before = JSON.stringify(m.latest().entries.map((p) => ({ ...p })));
  press(m.container.querySelector('[data-body="c1"]')!);
  assert.equal(JSON.stringify(m.latest().entries.map((p) => ({ ...p }))), before);
});

test('usePanelDragging is true from the moment a drag engages until it settles, for that panel only', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  const grab = (id: string): Element => m.container.querySelector(`[data-grab="${id}"]`)!;
  const dragging = (): string[] => ['c1', 'c2', 'c3'].filter((id) => rootOf(m, id).hasAttribute(DRAGGING_ATTRIBUTE));
  assert.deepEqual(dragging(), []);
  await drag(grab('c2'), { dx: 0, dy: 24, steps: 6, hold: 8, keepDown: true });
  assert.deepEqual(dragging(), ['c2']);
  await release(0, 24);
  await advanceFrames(3000);
  assert.deepEqual(dragging(), [], 'the drag settled');
});

test('a press that never becomes a drag leaves the dragging flag down', async () => {
  const m = mountRow(entries(2), 3000);
  await advanceFrames(2000);
  await drag(m.container.querySelector('[data-grab="c1"]')!, { dx: 1, dy: 1, steps: 1, hold: 1 });
  await advanceFrames(1000);
  assert.equal(rootOf(m, 'c1').hasAttribute(DRAGGING_ATTRIBUTE), false);
});

const hovered = (id: string, m: MountedRow): void => hover(rootOf(m, id), true);
const opacityOf = (el: HTMLElement): string => el.style.opacity;
const reduced = (row: React.ReactElement): React.ReactElement => React.createElement(MotionConfig, { reducedMotion: 'always' }, row);

test("mode 'always' leaves no inline opacity on the header, the grab bar or the footer", async () => {
  const m = mountRow(entries(2), 3000, {}, reduced);
  await advanceFrames(2000);
  for (const which of ['header', 'grab-bar', 'footer'] as const) assert.equal(opacityOf(part(m, 'c1', which)), '', which);
});

const hoverMode = { tuning: { chrome: { mode: 'hover-or-active' as const } } };

test("mode 'hover-or-active' hides the chrome of a panel nobody is using, and keeps it hit-testable and in the tab order", async () => {
  const m = mountRow(entries(3), 3000, hoverMode, reduced);
  await advanceFrames(2000);
  for (const which of ['header', 'grab-bar', 'footer'] as const) {
    const el = part(m, 'c1', which);
    assert.equal(opacityOf(el), '0', `${which} is transparent`);
    assert.equal(el.style.pointerEvents, '', `${which} still takes pointer events`);
    assert.equal(el.hasAttribute('inert'), false, `${which} is not inert`);
    assert.notEqual(el.style.visibility, 'hidden');
    assert.notEqual(el.style.display, 'none');
  }
});

test('hover shows the chrome, leaving hides it, and a pressed panel keeps it', async () => {
  const m = mountRow(entries(3), 3000, hoverMode, reduced);
  await advanceFrames(2000);
  hovered('c1', m);
  for (const which of ['header', 'grab-bar', 'footer'] as const) assert.equal(opacityOf(part(m, 'c1', which)), '1', `${which} shown on hover`);
  assert.equal(opacityOf(part(m, 'c2', 'header')), '0', 'another panel stays hidden');
  press(m.container.querySelector('[data-body="c1"]')!);
  hover(rootOf(m, 'c1'), false);
  assert.equal(opacityOf(part(m, 'c1', 'header')), '1', 'an active panel keeps its chrome with the pointer away');
  press(m.container.querySelector('[data-body="c2"]')!);
  assert.equal(opacityOf(part(m, 'c1', 'header')), '0', 'using a second panel hides the first');
  assert.equal(opacityOf(part(m, 'c2', 'header')), '1');
});

test('focus inside a hidden panel shows its chrome', async () => {
  const m = mountRow(entries(3), 3000, hoverMode, reduced);
  await advanceFrames(2000);
  const body = m.container.querySelector<HTMLElement>('[data-body="c3"]')!;
  act(() => body.focus());
  assert.equal(opacityOf(part(m, 'c3', 'header')), '1');
  act(() => setActive(null));
  assert.equal(opacityOf(part(m, 'c3', 'header')), '1', 'focus alone keeps it with no active panel');
  act(() => body.blur());
  assert.equal(opacityOf(part(m, 'c3', 'header')), '0');
});

test('the fade takes fadeMs on the frame clock, and no time under Reduce Motion', async () => {
  const m = mountRow(entries(2), 3000, { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 400 } } });
  await advanceFrames(2000);
  hovered('c1', m);
  await advanceFrames(100);
  const mid = Number(opacityOf(part(m, 'c1', 'header')));
  assert.ok(mid > 0 && mid < 1, `a quarter of the way through the fade the header is partly drawn (${mid})`);
  await advanceFrames(800);
  assert.equal(opacityOf(part(m, 'c1', 'header')), '1');
  const r = mountRow(entries(2), 3000, { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 400 } } }, reduced);
  await advanceFrames(2000);
  hover(rootOf(r, 'c1'), true);
  assert.equal(opacityOf(part(r, 'c1', 'header')), '1', 'no time under Reduce Motion');
  const quick = mountRow(entries(2), 3000, { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 100 } } });
  await advanceFrames(2000);
  hovered('c1', quick);
  await advanceFrames(250);
  assert.equal(opacityOf(part(quick, 'c1', 'header')), '1', 'a 100 ms fade is over well inside 250 ms');
});

/** The header's opacity a quarter, a half and three quarters of the way through a 1600 ms fade, on the frame clock. */
async function fadeTrace(chrome: Record<string, unknown>): Promise<number[]> {
  const m = mountRow(entries(2), 3000, { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 1600, ...chrome } } });
  await advanceFrames(2000);
  hovered('c1', m);
  const seen: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    await advanceFrames(400);
    seen.push(Number(opacityOf(part(m, 'c1', 'header'))));
  }
  cleanup();
  return seen;
}
const along = (curve: (t: number) => number): number[] => [0.25, 0.5, 0.75].map(curve);
const near = (got: number[], want: number[], what: string): void => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]!) < 0.03, `${what}: ${got.join(', ')} is not ${want.join(', ')}`));

test("chrome.fadeEase: the default fades along the curve Motion applies to a fade given only a duration, and each override along its own", async () => {
  const bare = document.createElement('div');
  document.body.appendChild(bare);
  bare.style.opacity = '0';
  const bareSeen: number[] = [];
  animate(bare, { opacity: 1 }, { duration: 1.6 });
  for (let k = 0; k < 3; k += 1) {
    await advanceFrames(400);
    bareSeen.push(Number(bare.style.opacity));
  }
  bare.remove();
  const byDefault = await fadeTrace({});
  near(byDefault, bareSeen, 'the default matches animate() with no ease');
  near(byDefault, along(cubicBezier(0, 0, 0.58, 1)), "the default is Motion's easeOut");
  near(await fadeTrace({ fadeEase: 'linear' }), [0.25, 0.5, 0.75], 'linear');
  near(await fadeTrace({ fadeEase: 'easeIn' }), along(cubicBezier(0.42, 0, 1, 1)), 'easeIn');
  near(await fadeTrace({ fadeEase: [0.25, 0.1, 0.25, 1] }), along(cubicBezier(0.25, 0.1, 0.25, 1)), 'a bezier tuple');
  near(await fadeTrace({ fadeEase: [0.1, 0.25, 1, 0.25] }), along(cubicBezier(0.1, 0.25, 1, 0.25)), 'a tuple with its four numbers in another order');
  assert.ok(byDefault[0]! - 0.25 > 0.08, 'control: the default is well ahead of linear at a quarter');
});

test('the store wakes only the listeners of the panels whose mark changed', () => {
  const store = createChromeStore();
  const woke: string[] = [];
  store.subscribePanel('a', () => woke.push('a'));
  store.subscribePanel('b', () => woke.push('b'));
  store.subscribePanel('c', () => woke.push('c'));
  store.setActive('a');
  assert.deepEqual(woke.splice(0), ['a']);
  store.setActive('b');
  assert.deepEqual(woke.splice(0).sort(), ['a', 'b']);
  store.setDragging('c', true);
  assert.deepEqual(woke.splice(0), ['c']);
  store.setActive('b');
  assert.deepEqual(woke, [], 'an unchanged mark wakes nobody');
});

test('fadeMs 0 and an unanimated panel also show at once', async () => {
  const m = mountRow(entries(2), 3000, { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 0 } } });
  await advanceFrames(2000);
  hovered('c1', m);
  assert.equal(opacityOf(part(m, 'c1', 'header')), '1');
  const u = mountRow(row(rootEntry(), made('c1', { animated: false }, { view: 'chrome-view' })), 3000, hoverMode);
  await advanceFrames(2000);
  hover(rootOf(u, 'c1'), true);
  assert.equal(opacityOf(part(u, 'c1', 'header')), '1');
});

test('flipping the mode at run time keeps the header node and its focus', async () => {
  const rig = await headerRig({ slots: { pin: { icon: React.createElement('i'), label: 'Pin', onClick: () => undefined } }, workspace: { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 0 } } } });
  const header = rig.m.container.querySelector<HTMLElement>(`[${CHROME_ATTRIBUTE}="header"]`)!;
  assert.equal(header.style.opacity, '0');
  const button = rig.buttons('a')[0]!;
  act(() => button.focus());
  assert.equal(document.activeElement, button);
  const result = rig.turn(() => rig.ws.panels.configureTuning({ chrome: { mode: 'always' } }));
  assert.equal(result.ok, true);
  assert.equal(rig.m.container.querySelector(`[data-header-buttons-row="a"]`), rig.row('a'), 'the row is the same node');
  assert.equal(rig.m.container.querySelector<HTMLElement>(`[${CHROME_ATTRIBUTE}="header"]`), header, 'the same header node');
  assert.equal(document.activeElement, button, 'focus stayed');
  assert.equal(header.style.opacity, '', 'always leaves no inline opacity');
});

test('a dragged panel keeps its chrome even when it is not the active one', async () => {
  const m = mountRow(entries(3), 3000, hoverMode, reduced);
  await advanceFrames(2000);
  await drag(m.container.querySelector('[data-grab="c2"]')!, { dx: 0, dy: 24, steps: 6, hold: 8, keepDown: true });
  act(() => setActive(null));
  assert.equal(opacityOf(part(m, 'c2', 'header')), '1', 'the chrome stays while the drag holds');
  assert.equal(opacityOf(part(m, 'c1', 'header')), '0');
  await release(0, 24);
  await advanceFrames(3000);
  assert.equal(opacityOf(part(m, 'c2', 'header')), '0', 'and goes when the drag settles');
});

test('on a device that cannot hover (hover: none) the chrome is always shown', async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ media: query, matches: query === '(hover: none)', addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  try {
    const m = mountRow(entries(2), 3000, hoverMode, reduced);
    await advanceFrames(2000);
    for (const which of ['header', 'grab-bar', 'footer'] as const) assert.equal(opacityOf(part(m, 'c1', which)), '1', which);
  } finally {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
  }
});

test('focus moving into an iframe inside a panel makes that panel active (the page sees only its window blur)', async () => {
  const m = mountRow(entries(3), 3000);
  await advanceFrames(2000);
  const frame = document.createElement('iframe');
  m.container.querySelector('[data-body="c2"]')!.parentElement!.appendChild(frame);
  // A browser fires no focus event on the iframe element in the page, so the test reports only what the page can see.
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => frame });
  try {
    assert.equal(activeSeen, null, 'positive control: nothing is active yet');
    act(() => void window.dispatchEvent(new Event('blur')));
    assert.equal(activeSeen, 'c2');
    assert.equal(rootOf(m, 'c2').hasAttribute(ACTIVE_ATTRIBUTE), true);
    assert.equal(rootOf(m, 'c1').hasAttribute(ACTIVE_ATTRIBUTE), false);
  } finally {
    delete (document as unknown as Record<string, unknown>).activeElement;
  }
});
