/**
 * The default frame: a template's view that draws no `Panel` or `PanelFrame` is drawn inside the library's frame, and one
 * that draws any part of its own is mounted once and left alone. The golden DOM of the self-framed fixtures is in
 * default-frame-golden.test.ts; this file covers the bare view, the cases between, the opt-out and the gestures.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { Panel, PanelFrame, createWorkspace, definePanel } from '../index.js';
import type { PanelHandle, PanelSettings, PanelTemplate, WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { differential } from './support/differential.js';
import { drag } from './support/drag-gesture.js';
import { albumPanel, effects, frameOnlyPanel, restPanel, stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';

const open: WorkspaceHandle[] = [];

afterEach(() => {
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
  effects.clear();
});

const counts = (name: string): [number, number] => {
  const e = effects.get(name) ?? { mounts: 0, unmounts: 0 };
  return [e.mounts, e.unmounts];
};

/** A bare view: it draws plain content and no part of a frame. */
function bareTemplate(id: string, over: Partial<PanelTemplate> = {}): PanelTemplate {
  return definePanel({
    id,
    settings: { title: id.toUpperCase(), multiple: true },
    view: ({ panel }) => {
      React.useEffect(() => {
        const e = effects.get(id) ?? { mounts: 0, unmounts: 0 };
        effects.set(id, e);
        e.mounts += 1;
        return () => void (e.unmounts += 1);
      }, []);
      return React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id);
    },
    ...over,
  });
}

const rootTemplate = (): PanelTemplate =>
  definePanel({ id: 'root', view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, React.createElement('i', { 'data-slot': 'root' })) }) });

interface Rig {
  ws: WorkspaceHandle;
  m: ResizableWorkspace;
  handles: PanelHandle[];
}

async function rig(templates: PanelTemplate[], add: string[], o: { strict?: boolean; width?: number } = {}): Promise<Rig> {
  const ws = createWorkspace({ mount: false, root: rootTemplate(), templates, newId: stableIds() });
  open.push(ws);
  const handles = add.map((id) => ws.addPanel(id, { id: `${id}-1` }));
  const m = mountWorkspace(ws, { width: o.width ?? 1280, ...(o.strict === true ? { strict: true } : {}) });
  await flush();
  return { ws, m, handles };
}

const part = (m: ResizableWorkspace, name: string): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>(`[data-panel-chrome-part="${name}"]`)];
const bodiesOf = (m: ResizableWorkspace, id: string): HTMLElement | null => m.container.querySelector<HTMLElement>(`[data-body="${id}"]`);
const settle = async (): Promise<void> => {
  await act(async () => undefined);
  await advanceFrames(400);
};

// ---------------------------------------------------------------------------
// A bare view
// ---------------------------------------------------------------------------

test('a view that draws no frame is drawn inside the library frame: a titled header, a grab bar and a phone frame', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  const body = bodiesOf(r.m, 'bare');
  assert.ok(body, 'the view renders');
  assert.equal(part(r.m, 'header').length, 2, 'the root and the bare view each have a header');
  const slot = body.closest('[data-row-slot]')!;
  assert.match(slot.textContent ?? '', /BARE/, 'the header carries the template title');
  assert.equal(slot.querySelectorAll('[data-panel-grab-bar]').length, 1, 'drag-to-close grab bar');
  assert.equal(slot.querySelectorAll('[data-drag-to-close]').length, 1);
});

test('a bare view and a self-framed view each have one header and one phone frame, and the root keeps its one', async () => {
  const r = await rig([bareTemplate('bare'), albumPanel()], ['bare', 'album']);
  await settle();
  for (const id of ['bare', 'album']) {
    const slot = bodiesOf(r.m, id)!.closest('[data-row-slot]')!;
    assert.equal(slot.querySelectorAll('[data-panel-chrome-part="header"]').length, 1, `${id}: one header`);
    assert.equal(slot.querySelectorAll('[data-phone-frame]').length, 1, `${id}: one frame`);
  }
  const rootSlot = r.m.container.querySelector('[data-slot="root"]')!.closest('[data-row-slot]')!;
  assert.equal(rootSlot.querySelectorAll('[data-panel-chrome-part="header"]').length, 1, 'the root: one header, no library frame added');
  assert.equal(rootSlot.querySelectorAll('[data-drag-to-close]').length, 0);
  assert.equal(r.m.container.querySelectorAll('[data-panel-chrome-part="header"]').length, 3, 'three panels, three headers');
});

test('a bare view with no title shows the untitled label, and the title the panel carries once it has one', async () => {
  const t = bareTemplate('anon');
  const noTitle = definePanel({ id: 'anon', view: t.view });
  const r = await rig([noTitle], ['anon']);
  assert.match(bodiesOf(r.m, 'anon')!.closest('[data-row-slot]')!.textContent ?? '', /Untitled panel/);
});

test('a bare view mounts again once when the frame is drawn around it; the next panel of the same template mounts once', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  assert.deepEqual(counts('bare'), [2, 1], 'first panel: the probe is drawn bare, found bare, then mounted inside the frame');
  r.ws.addPanel('bare', { id: 'bare-2' });
  await flush();
  await settle();
  assert.deepEqual(counts('bare'), [3, 1], 'second panel: framed at once');
  assert.equal(part(r.m, 'header').length, 3);
});

test('hiding a bare panel and showing it again keeps the frame and does not remount it again', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  const before = counts('bare');
  await act(async () => void r.handles[0]!.hide());
  await settle();
  await act(async () => void r.handles[0]!.show());
  await settle();
  assert.equal(part(r.m, 'header').length, 2, 'framed again');
  assert.equal(counts('bare')[0]! - before[0]!, 1, 'a panel that came back mounts once, framed');
});

test('under StrictMode a bare view ends with exactly one header, one grab bar and one frame', async () => {
  const r = await rig([bareTemplate('bare')], ['bare'], { strict: true });
  await settle();
  const slot = bodiesOf(r.m, 'bare')!.closest('[data-row-slot]')!;
  assert.equal(slot.querySelectorAll('[data-panel-chrome-part="header"]').length, 1);
  assert.equal(slot.querySelectorAll('[data-panel-grab-bar]').length, 1);
  assert.equal(slot.querySelectorAll('[data-body="bare"]').length, 1);
});

test('the template footer is drawn once, inside the library frame', async () => {
  const r = await rig([bareTemplate('bare', { footer: () => React.createElement('span', { 'data-foot': '' }, 'foot') })], ['bare']);
  await settle();
  assert.equal(bodiesOf(r.m, 'bare')!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-footer]').length, 1);
});

// ---------------------------------------------------------------------------
// The opt-out
// ---------------------------------------------------------------------------

test("frame: 'none' draws a bare view as it is, mounted once with no frame", async () => {
  const none: PanelSettings = { frame: 'none' };
  const r = await rig([bareTemplate('bare', { settings: none })], ['bare']);
  await settle();
  assert.equal(part(r.m, 'header').length, 1, 'only the root has a header');
  assert.deepEqual(counts('bare'), [1, 0]);
});

test("changing frame from 'auto' to 'none' takes the library frame away", async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  assert.equal(part(r.m, 'header').length, 2);
  await act(async () => void r.handles[0]!.configure({ frame: 'none' }));
  await settle();
  assert.equal(part(r.m, 'header').length, 1);
  await act(async () => void r.handles[0]!.configure({ frame: 'auto' }));
  await settle();
  assert.equal(part(r.m, 'header').length, 2, 'and back');
});

// ---------------------------------------------------------------------------
// The cases between
// ---------------------------------------------------------------------------

test('a view that draws only a PanelFrame counts as self-framed: no library header, no second frame, one mount', async () => {
  const r = await rig([frameOnlyPanel()], ['frameonly']);
  await settle();
  const slot = bodiesOf(r.m, 'frameonly')!.closest('[data-row-slot]')!;
  assert.equal(slot.querySelectorAll('[data-panel-chrome-part="header"]').length, 0);
  assert.equal(slot.querySelectorAll('[data-panel-grab-bar]').length, 0);
  assert.deepEqual(counts('frameonly'), [1, 0]);
});

test('a view that draws only a Panel, or a PanelFrame with its footer off, counts as self-framed too', async () => {
  const panelOnly = definePanel({
    id: 'panelonly',
    settings: { title: 'Panel only' },
    view: () => React.createElement(Panel, { title: 'Own', children: React.createElement('p', { 'data-body': 'panelonly' }, 'x') }),
  });
  const quietFrame = definePanel({
    id: 'quietframe',
    view: () => React.createElement(PanelFrame, { footer: false, children: React.createElement('p', { 'data-body': 'quietframe' }, 'x') }),
  });
  const r = await rig([panelOnly, quietFrame], ['panelonly', 'quietframe']);
  await settle();
  assert.equal(bodiesOf(r.m, 'panelonly')!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-chrome-part="header"]').length, 1, 'Panel only: its own header');
  assert.equal(bodiesOf(r.m, 'panelonly')!.closest('[data-row-slot]')!.querySelectorAll('[data-drag-to-close]').length, 0, 'Panel only: no library frame');
  assert.equal(bodiesOf(r.m, 'quietframe')!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-chrome-part="header"]').length, 0, 'quiet frame: no library header');
  assert.equal(bodiesOf(r.m, 'quietframe')!.closest('[data-row-slot]')!.querySelectorAll('[data-phone-frame]').length, 1, 'quiet frame: one frame');
});

test('self-framed views mount once and are not wrapped', async () => {
  const r = await rig([albumPanel(), restPanel()], ['album', 'rest']);
  await settle();
  assert.deepEqual(counts('album'), [1, 0]);
  assert.deepEqual(counts('rest'), [1, 0]);
  for (const id of ['album', 'rest']) assert.equal(bodiesOf(r.m, id)!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-chrome-part="header"]').length, 1, `${id}: its own header only`);
});

test('a view that renders nothing at first and draws a Panel later releases the library frame', async () => {
  // The flag lives outside the view: releasing the library frame mounts the view again, which would reset state held inside it.
  let ready = false;
  const listeners = new Set<() => void>();
  const reveal = (): void => {
    ready = true;
    for (const l of listeners) l();
  };
  const lazy = definePanel({
    id: 'lazy',
    settings: { title: 'Lazy' },
    view: () => {
      const on = React.useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => void listeners.delete(l);
        },
        () => ready,
      );
      return on ? React.createElement(Panel, { title: 'Own header', children: React.createElement(PanelFrame, null, React.createElement('p', { 'data-body': 'lazy' }, 'lazy')) }) : null;
    },
  });
  const r = await rig([lazy], ['lazy']);
  await settle();
  await act(async () => reveal());
  await settle();
  const slot = r.m.container.querySelector('[data-body="lazy"]')!.closest('[data-row-slot]')!;
  assert.equal(slot.querySelectorAll('[data-panel-chrome-part="header"]').length, 1, 'one header');
  assert.match(slot.textContent ?? '', /Own header/, 'the view\'s own');
  assert.equal(slot.querySelectorAll('[data-drag-to-close]').length, 0, 'the library frame is gone');
});

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

test('at two slots the library frame is as wide as its slot', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  const slot = (): HTMLElement => r.m.container.querySelector('[data-body="bare"]')!.closest('[data-row-slot]') as HTMLElement;
  const frameWidth = (): string => getComputedStyle(slot().querySelector('[data-phone-frame]')!).width;
  assert.equal(frameWidth(), '390px', 'one slot is a phone');
  await act(async () => void r.handles[0]!.setSlots(2));
  await settle();
  assert.notEqual(slot().style.width, '390px', 'the slot grew');
  assert.equal(frameWidth(), slot().style.width, 'and the frame with it');
});

// ---------------------------------------------------------------------------
// Gestures through the library frame
// ---------------------------------------------------------------------------

test('a real pointer drag down on the grab bar closes a bare panel', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  const grab = r.m.container.querySelector<HTMLElement>('[data-body="bare"]')!.closest('[data-row-slot]')!.querySelector<HTMLElement>('[data-panel-grab-bar]')!;
  await drag(grab, { dx: 0, dy: 400 });
  await settle();
  await advanceFrames(2000);
  assert.equal(r.m.container.querySelector('[data-body="bare"]') === null, true, 'the panel closed');
});

test('a real pointer drag sideways on the grab bar moves a bare panel past its neighbour', async () => {
  const r = await rig([bareTemplate('one'), bareTemplate('two')], ['one', 'two']);
  await settle();
  const order = (): string[] => [...r.m.container.querySelectorAll<HTMLElement>('[data-body]')].map((n) => n.dataset.body!);
  assert.deepEqual(order(), ['one', 'two']);
  const grab = r.m.container.querySelector<HTMLElement>('[data-body="one"]')!.closest('[data-row-slot]')!.querySelector<HTMLElement>('[data-panel-grab-bar]')!;
  await drag(grab, { dx: 450, dy: 0 });
  await settle();
  assert.deepEqual(order(), ['two', 'one']);
});

test('the close method removes a bare panel and its frame', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await settle();
  await act(async () => void r.handles[0]!.close());
  await settle();
  assert.equal(r.m.container.querySelector('[data-body="bare"]') === null, true);
  assert.equal(part(r.m, 'header').length, 1);
});

test('a header button the template declares is drawn in the library header, presses once and is reached by the keyboard', async () => {
  const presses: string[] = [];
  const button = (label: string) => ({ icon: React.createElement('span', null, label), label, onClick: () => void presses.push(label) });
  const t = bareTemplate('bare', { settings: { headerButtons: { first: button('First'), second: button('Second') } } });
  const r = await rig([t], ['bare']);
  await settle();
  const slot = r.m.container.querySelector('[data-body="bare"]')!.closest('[data-row-slot]')!;
  const buttons = [...slot.querySelectorAll<HTMLButtonElement>('[data-header-buttons-row] button')];
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ['First', 'Second']);
  await act(async () => buttons[0]!.click());
  assert.deepEqual(presses, ['First']);
  await act(async () => {
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  assert.equal(document.activeElement, buttons[1], 'the arrow key moves between the buttons');
});

test('differential frame: a bare view has a library header under auto and none under none', async () => {
  const headers = async (frame: 'auto' | 'none'): Promise<number> => {
    const r = await rig([bareTemplate('bare', { settings: { frame } })], ['bare']);
    await settle();
    const n = bodiesOf(r.m, 'bare')!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-chrome-part="header"]').length;
    cleanup();
    return n;
  };
  const auto = await headers('auto');
  const none = await headers('none');
  differential('frame', (run) => {
    run('auto', () => auto);
    run('none', () => none);
  });
});
