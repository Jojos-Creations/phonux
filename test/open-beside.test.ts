/**
 * workspace.openBeside: a panel opened, reopened, shown or moved directly right of the panel that asked, in one call and
 * one commit, under React StrictMode. Every panel parks for room. Phone panels are 390 wide at a gap of 16, so a row of
 * 1600 fits three, 1000 fits two and 600 fits one; with no root template the row has no fixed column.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace, PanelManagerError } from '../index.js';
import type { OpenBesideResult, PanelSettings, WorkspaceHandle } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(cleanup);

/** a and b, then np (the panel opened beside), a `multiple` tab capped at two, and a fixed column that cannot be placed. */
async function setup(width: number, o: { settings?: Record<string, PanelSettings>; mounted?: boolean } = {}): Promise<{ ws: WorkspaceHandle; row: () => string; slots: () => string; anchored: (id: string) => boolean }> {
  const t = (id: string, settings: PanelSettings = {}) => markerTemplate(id, { settings: { ...settings, ...o.settings?.[id] } });
  const ws = createWorkspace({ mount: false, defaults: { overflow: 'park' }, templates: [t('a'), t('b'), t('np'), t('tab', { multiple: true, maxInstances: 2 }), t('pinned', { placeable: false })] });
  ws.addPanel('a');
  ws.addPanel('b');
  const m = o.mounted === false ? undefined : mountWorkspace(ws, { width, strict: true });
  if (m !== undefined) await flush();
  const mark = (p: { id: string; status: string }): string => (p.status === 'live' ? p.id : p.status === 'parked' ? `${p.id}*` : p.status === 'closed' ? `~${p.id}` : `?${p.id}`);
  return {
    ws,
    row: () =>
      ws.panels
        .getSnapshot()
        .panels.filter((p) => p.id !== ws.rootId)
        .map(mark)
        .join(' '),
    // A view's slot carries its engine id; the test names panels by their workspace id.
    /** Whether the panel's engine entry carries a person's anchor override. */
    anchored: (id: string) => m?.latest().entries.find((p) => p.id === ws.panels.get(id)?.getState().engineId)?.overrides?.anchor !== undefined,
    slots: () => (m === undefined ? '' : m.slots().map((engineId) => ws.panels.getSnapshot().panels.find((p) => p.engineId === engineId)?.id ?? engineId).join(' ')),
  };
}

/** Runs `fn` as one handler: every call in it shares a turn, and the commit it makes is rendered before the next line. */
function turn<T>(fn: () => T): T {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
}

/** A result as a short literal: 'T' changed, 'F' nothing to do, or the refusal code; '+src' when the source parked. */
const brief = (r: OpenBesideResult): string => (r.ok ? (r.changed ? 'T' : 'F') : r.code) + (r.sourceParked ? '+src' : '');

test('a new panel is added directly right of its source in one call, with no retry', async () => {
  const s = await setup(1600);
  assert.equal(s.row(), 'a b');
  const r = turn(() => s.ws.openBeside('np', 'a'));
  assert.equal(brief(r), 'T');
  assert.equal(r.panel?.id, 'np');
  assert.equal(s.row(), 'a np b');
  assert.equal(s.slots(), 'a np b');
});

test('room for both: the source stays on screen and the row parks another panel instead', async () => {
  const s = await setup(1000);
  assert.equal(s.row(), 'a b');
  // np lands between a and b, equally far from both; the eviction tie would go to a, the source.
  const r = turn(() => s.ws.openBeside('np', 'a'));
  assert.equal(brief(r), 'T');
  assert.equal(s.row(), 'a np b*');
});

test('no room for both: the opened panel wins, the source parks and the result says so', async () => {
  const s = await setup(600);
  const source = s.ws.panels.getSnapshot().panels.find((p) => p.status === 'live' && p.id !== s.ws.rootId)!.id;
  const r = turn(() => s.ws.openBeside('np', source));
  assert.equal(brief(r), 'T+src');
  assert.equal(s.ws.panels.get('np')!.getState().status, 'live');
  assert.equal(s.ws.panels.get(source)!.getState().status, 'parked');
  const order = s.ws.panels.getSnapshot().panels.map((p) => p.id);
  assert.equal(order.indexOf('np'), order.indexOf(source) + 1);
});

test('a parked panel is placed right of the source and shown, in both modes, keeping the source live', async () => {
  for (const mode of ['move', 'stay'] as const) {
    const s = await setup(1000);
    turn(() => s.ws.addPanel('np'));
    turn(() => s.ws.panels.get('np')!.hide());
    assert.equal(s.row(), 'a b np*');
    const r = turn(() => s.ws.openBeside('np', 'a', { mode }));
    assert.equal(brief(r), 'T', mode);
    assert.equal(s.row(), 'a np b*', mode);
    cleanup();
  }
});

test('a closed panel reopens right of the source, in both modes', async () => {
  for (const mode of ['move', 'stay'] as const) {
    const s = await setup(1600);
    turn(() => s.ws.addPanel('np'));
    turn(() => s.ws.panels.get('np')!.close());
    assert.equal(s.row(), 'a b ~np');
    const r = turn(() => s.ws.openBeside('np', 'a', { mode }));
    assert.equal(brief(r), 'T', mode);
    assert.equal(s.row(), 'a np b', mode);
    cleanup();
  }
});

test("a live panel moves beside the source with mode 'move' (the default)", async () => {
  const s = await setup(1600);
  turn(() => s.ws.addPanel('np'));
  assert.equal(s.row(), 'a b np');
  const r = turn(() => s.ws.openBeside('np', 'a'));
  assert.equal(brief(r), 'T');
  assert.equal(s.row(), 'a np b');
  assert.equal(s.slots(), 'a np b');
});

test("a live panel stays where it stands with mode 'stay'", async () => {
  const s = await setup(1600);
  turn(() => s.ws.addPanel('np'));
  const r = turn(() => s.ws.openBeside('np', 'a', { mode: 'stay' }));
  assert.equal(r.ok, true);
  assert.equal(r.sourceParked, false);
  assert.equal(s.row(), 'a b np');
});

test('a parked source: the panel lands right of it and shows, and the source stays parked', async () => {
  const s = await setup(1600);
  turn(() => s.ws.panels.get('a')!.hide());
  assert.equal(s.row(), 'a* b');
  const r = turn(() => s.ws.openBeside('np', 'a'));
  assert.equal(brief(r), 'T');
  assert.equal(s.row(), 'a* np b');
});

test('the source itself is accepted with nothing to do', async () => {
  const s = await setup(1600);
  turn(() => s.ws.addPanel('np'));
  const r = turn(() => s.ws.openBeside('np', 'np'));
  assert.equal(brief(r), 'F');
  assert.equal(s.row(), 'a b np');
});

test('an unknown source is refused and adds nothing; an unknown template throws', async () => {
  const s = await setup(1600);
  const r = turn(() => s.ws.openBeside('np', 'nope'));
  assert.equal(brief(r), 'unknown-panel');
  assert.equal(r.panel, undefined);
  assert.equal(s.ws.panels.get('np'), undefined);
  assert.equal(s.row(), 'a b');
  assert.throws(
    () => s.ws.openBeside('nope', 'a'),
    (e: unknown) => e instanceof PanelManagerError && e.code === 'unknown-template',
  );
});

test('a closed or pending source is refused', async () => {
  const s = await setup(1600);
  turn(() => s.ws.panels.get('b')!.close());
  assert.equal(brief(turn(() => s.ws.openBeside('np', 'b'))), 'is-closed');
  const pending = turn(() => {
    s.ws.addPanel('tab', { id: 'tab-1' });
    return s.ws.openBeside('np', 'tab-1');
  });
  assert.equal(brief(pending), 'is-pending');
  assert.equal(s.ws.panels.get('np'), undefined);
});

test('a singleton under a second id, and a template at its instance limit, are refused and add nothing', async () => {
  const s = await setup(1600);
  turn(() => s.ws.openBeside('np', 'a'));
  const second = turn(() => s.ws.openBeside('np', 'a', { id: 'np-2' }));
  assert.equal(brief(second), 'instance-limit');
  assert.equal(s.ws.panels.get('np-2'), undefined);
  assert.equal(brief(turn(() => s.ws.openBeside('tab', 'a'))), 'T');
  assert.equal(brief(turn(() => s.ws.openBeside('tab', 'a'))), 'T');
  const third = turn(() => s.ws.openBeside('tab', 'a'));
  assert.equal(brief(third), 'instance-limit');
  assert.equal(s.ws.panels.getSnapshot().panels.filter((p) => p.templateId === 'tab').length, 2);
});

test('a multiple template without an id adds a new instance right of the source each time', async () => {
  const s = await setup(1600);
  const first = turn(() => s.ws.openBeside('tab', 'a'));
  const second = turn(() => s.ws.openBeside('tab', 'a'));
  assert.notEqual(first.panel?.id, second.panel?.id);
  const order = s.ws.panels.getSnapshot().panels.map((p) => p.id);
  assert.equal(order.indexOf(second.panel!.id), order.indexOf('a') + 1);
});

test('a panel that cannot be placed is refused', async () => {
  const s = await setup(1600);
  assert.equal(brief(turn(() => s.ws.openBeside('pinned', 'a'))), 'not-placeable');
  assert.equal(s.ws.panels.get('pinned'), undefined);
});

test('a source with an operation in this turn answers busy, and the panel is not added', async () => {
  const s = await setup(1600);
  const r = turn(() => {
    s.ws.panels.get('a')!.move('right');
    return s.ws.openBeside('np', 'a');
  });
  assert.equal(brief(r), 'busy');
  assert.equal(s.ws.panels.get('np'), undefined);
});

test('a panel still being added answers is-pending', async () => {
  const s = await setup(1600);
  const r = turn(() => {
    s.ws.addPanel('np');
    return s.ws.openBeside('np', 'a');
  });
  assert.equal(brief(r), 'is-pending');
});

test('before the workspace is attached the call is refused', async () => {
  const s = await setup(1600, { mounted: false });
  assert.equal(brief(s.ws.openBeside('np', 'a')), 'not-attached');
  assert.equal(s.ws.panels.get('np'), undefined);
});

test("a person's call records the placement as the person's arrangement on every path; code leaves it alone", async () => {
  for (const by of ['person', 'code'] as const) {
    const added = await setup(1600);
    turn(() => added.ws.openBeside('np', 'a', {}, by));
    assert.equal(added.anchored('np'), by === 'person', `added, ${by}`);
    cleanup();
    const parked = await setup(1600);
    turn(() => parked.ws.addPanel('np'));
    turn(() => parked.ws.panels.get('np')!.hide());
    turn(() => parked.ws.openBeside('np', 'a', {}, by));
    assert.equal(parked.row(), 'a np b');
    assert.equal(parked.anchored('np'), by === 'person', `parked, ${by}`);
    cleanup();
    const moved = await setup(1600);
    turn(() => moved.ws.addPanel('np'));
    turn(() => moved.ws.openBeside('np', 'a', {}, by));
    assert.equal(moved.row(), 'a np b');
    assert.equal(moved.anchored('np'), by === 'person', `moved, ${by}`);
    cleanup();
  }
});
