/**
 * The nine verbs of a panel handle: the outcomes table of every operation in every state, the refusals that touch
 * nothing, the busy contract from each trigger, and the settings the handle enforces.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, useProvidePanels } from '../index.js';
import type { PanelHandle, PanelResult, PanelSettings, PanelWindow, ProvidedPanels } from '../index.js';
import { advanceFrames, cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { differential, differentialsCovered } from './support/differential.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { brief, fire, rig, TRIGGERS, type Rig } from './support/ops-rig.js';

afterEach(() => cleanup());

const OPS = ['show', 'hide', 'toggle', 'close', 'open', 'move', 'place', 'setSlots', 'scrollTo'] as const;
type Op = (typeof OPS)[number];
const STATES = ['live', 'parked', 'closed', 'pending'] as const;
type State = (typeof STATES)[number];

const call = (h: PanelHandle, op: Op): PanelResult => {
  switch (op) {
    case 'show': return h.show();
    case 'hide': return h.hide();
    case 'toggle': return h.toggleVisibility();
    case 'close': return h.close();
    case 'open': return h.open();
    case 'move': return h.move(1);
    case 'place': return h.place('row-end');
    case 'setSlots': return h.setSlots(2);
    case 'scrollTo': return h.scrollTo();
  }
};

/** Expected results per variant and state, in OPS order: T accepted and changed, F accepted with nothing to do, else the refusal code. */
const P = 'is-pending';
const C = 'is-closed';
const TABLE: Record<string, { settings: PanelSettings; cells: Record<State, string[]> }> = {
  default: {
    settings: {},
    cells: {
      live: ['F', 'T', 'T', 'T', 'F', 'T', 'T', 'T', 'F'],
      parked: ['T', 'F', 'T', 'T', 'F', 'not-live', 'T', 'T', 'not-live'],
      closed: [C, C, 'F', 'F', 'T', C, C, C, C],
      pending: [P, P, P, P, P, P, P, P, P],
    },
  },
  immobile: {
    settings: { draggable: false, placeable: false, resizable: false },
    cells: {
      live: ['F', 'T', 'T', 'T', 'F', 'not-draggable', 'not-placeable', 'not-resizable', 'F'],
      parked: ['T', 'F', 'T', 'T', 'F', 'not-live', 'not-placeable', 'not-resizable', 'not-live'],
      closed: [C, C, 'F', 'F', 'T', C, C, C, C],
      pending: [P, P, P, P, P, P, P, P, P],
    },
  },
  'one slot at most': {
    settings: { maxSlots: 1 },
    cells: {
      live: ['F', 'T', 'T', 'T', 'F', 'T', 'T', 'F', 'F'],
      parked: ['T', 'F', 'T', 'T', 'F', 'not-live', 'T', 'F', 'not-live'],
      closed: [C, C, 'F', 'F', 'T', C, C, C, C],
      pending: [P, P, P, P, P, P, P, P, P],
    },
  },
  reopening: {
    settings: { showWhenClosed: 'reopen', toggleWhenClosed: 'reopen' },
    cells: {
      live: ['F', 'T', 'T', 'T', 'F', 'T', 'T', 'T', 'F'],
      parked: ['T', 'F', 'T', 'T', 'F', 'not-live', 'T', 'T', 'not-live'],
      closed: ['T', C, 'T', 'F', 'T', C, C, C, C],
      pending: [P, P, P, P, P, P, P, P, P],
    },
  },
};

async function target(state: State, settings: PanelSettings): Promise<{ r: Rig; b: PanelHandle }> {
  const r = await rig({ settings: { b: settings }, extra: [markerTemplate('p', { settings })] });
  if (state === 'parked') r.turn(() => r.h.b!.hide());
  if (state === 'closed') r.turn(() => r.h.b!.close());
  return { r, b: r.h.b! };
}

let executed = 0;
for (const [variant, { settings, cells }] of Object.entries(TABLE)) {
  for (const state of STATES) {
    assert.equal(cells[state].length, OPS.length, `${variant}/${state}: one expectation per operation`);
    for (const [i, op] of OPS.entries()) {
      test(`outcomes ${variant} / ${state} / ${op} is ${cells[state][i]}`, async () => {
        const { r, b } = await target(state, settings);
        let result!: PanelResult;
        if (state === 'pending') {
          // A panel added in this turn has no engine entry until the turn commits.
          r.turn(() => {
            result = call(r.ws.addPanel('p'), op);
          });
        } else {
          result = r.turn(() => call(b, op));
        }
        assert.equal(brief(result), cells[state][i]);
        if (!result.ok) assert.ok(result.message.length > 0, 'a refusal carries a message');
        executed += 1;
      });
    }
  }
}

test('the outcomes table ran every cell: executed equals the computed product and is at least 60', () => {
  assert.equal(executed, Object.keys(TABLE).length * STATES.length * OPS.length, 'executed equals the computed product');
  assert.ok(executed >= 60, `scenarios run: ${executed}`);
});

test('a refusal touches nothing: entries reference-equal, no commit, the snapshot unchanged', async () => {
  const cases: Array<{ name: string; settings: Record<string, PanelSettings>; setup?: (r: Rig) => void; run: (r: Rig) => PanelResult; code: string }> = [
    { name: 'not-closable', settings: { b: { closable: false } }, run: (r) => r.h.b!.close(), code: 'not-closable' },
    { name: 'not-parkable', settings: { b: { parkable: false } }, run: (r) => r.h.b!.hide(), code: 'not-parkable' },
    { name: 'not-draggable', settings: { b: { draggable: false } }, run: (r) => r.h.b!.move(-1), code: 'not-draggable' },
    { name: 'not-placeable', settings: { b: { placeable: false } }, run: (r) => r.h.b!.place('row-start'), code: 'not-placeable' },
    { name: 'not-resizable', settings: { b: { resizable: false } }, run: (r) => r.h.b!.setSlots(2), code: 'not-resizable' },
    { name: 'is-closed', settings: {}, setup: (r) => void r.turn(() => r.h.b!.close()), run: (r) => r.h.b!.hide(), code: 'is-closed' },
    { name: 'not-live', settings: {}, setup: (r) => void r.turn(() => r.h.b!.hide()), run: (r) => r.h.b!.move(-1), code: 'not-live' },
  ];
  for (const c of cases) {
    const r = await rig({ settings: c.settings });
    c.setup?.(r);
    const entries = r.m!.latest().entries;
    const snapshot = r.ws.panels.getSnapshot();
    const renders = r.m!.renders();
    const result = r.turn(() => c.run(r));
    assert.equal(brief(result), c.code, c.name);
    assert.equal(r.m!.latest().entries, entries, `${c.name}: entries reference-equal`);
    assert.equal(r.ws.panels.getSnapshot(), snapshot, `${c.name}: the snapshot is the same object`);
    assert.equal(r.m!.renders(), renders, `${c.name}: no extra commit`);
    cleanup();
  }
});

const BUSY_ROWS: Array<{ name: string; calls: Array<(h: Record<string, PanelHandle>) => PanelResult>; results: string[]; row: string }> = [
  { name: 'close A + show B', calls: [(h) => h.a!.close(), (h) => h.b!.show()], results: ['T', 'busy'], row: 'b c ~a' },
  { name: 'close A + hide B', calls: [(h) => h.a!.close(), (h) => h.b!.hide()], results: ['T', 'busy'], row: 'b c ~a' },
  { name: 'close A + open B', calls: [(h) => h.a!.close(), (h) => h.b!.open()], results: ['T', 'busy'], row: 'b c ~a' },
  { name: 'close A + close B', calls: [(h) => h.a!.close(), (h) => h.b!.close()], results: ['T', 'busy'], row: 'b c ~a' },
  { name: 'hide B then close A', calls: [(h) => h.b!.hide(), (h) => h.a!.close()], results: ['T', 'busy'], row: 'a b* c' },
  { name: 'hide A + hide B', calls: [(h) => h.a!.hide(), (h) => h.b!.hide()], results: ['T', 'T'], row: 'a* b* c' },
  { name: 'show B + hide C', calls: [(h) => h.b!.show(), (h) => h.c!.hide()], results: ['F', 'T'], row: 'a b c*' },
  { name: 'setSlots A + hide A', calls: [(h) => h.a!.setSlots(2), (h) => h.a!.hide()], results: ['T', 'busy'], row: 'a b c' },
];

test('the busy contract gives identical literal rows from a handler, a timer, a promise continuation and a passive effect', async () => {
  for (const trigger of TRIGGERS) {
    for (const row of BUSY_ROWS) {
      const r = await rig();
      const results = await fire(trigger, () => row.calls.map((call) => brief(call(r.h))));
      assert.deepEqual(results, row.results, `${trigger}: ${row.name}`);
      await fire('handler', () => undefined);
      assert.equal(r.row(), row.row, `${trigger}: ${row.name}: the row afterwards`);
      cleanup();
    }
  }
});

test('LIMIT:3 is prevented through the manager: the second close in a turn is busy, so undo order holds', async () => {
  const r = await rig({ ids: ['a', 'b', 'c'] });
  const open = (): string => r.row().split(' ').filter((x) => !x.startsWith('~')).join(' ');
  const results = r.turn(() => [brief(r.h.a!.close()), brief(r.h.b!.close())]);
  assert.deepEqual(results, ['T', 'busy']);
  assert.equal(r.row(), 'b c ~a', 'only the first close landed');
  r.turn(() => r.h.b!.close());
  assert.equal(open(), 'c', 'both are closed after separate turns');
  act(() => r.m!.latest().undoClose());
  assert.equal(open(), 'a b c', 'one undo restores both in row order, where the raw pair landed as a c b');
});

/** Engine-drawn instance numbers differ per run; a row compares by shape. */
const shape = (row: string): string => row.replace(/~\d+/g, '~N');

type Observe = (value: never) => Promise<unknown>;
/** The slot count the row holds for panel `id`. */
const slotsOf = (r: Rig, id: string): number | undefined => r.m!.latest().entries.find((p) => p.id === r.h[id]!.getState().engineId)?.slots;

const MATRIX: Array<[name: string, a: unknown, b: unknown, observe: Observe, expectA: unknown, expectB: unknown]> = [
  ['closable', true, false, async (v) => { const r = await rig({ settings: { b: { closable: v } } }); return [brief(r.turn(() => r.h.b!.close())), r.row()]; }, ['T', 'a c ~b'], ['not-closable', 'a b c']],
  ['parkable', true, false, async (v) => { const r = await rig({ settings: { b: { parkable: v } } }); return [brief(r.turn(() => r.h.b!.hide())), r.row()]; }, ['T', 'a b* c'], ['not-parkable', 'a b c']],
  ['draggable', true, false, async (v) => { const r = await rig({ settings: { b: { draggable: v } } }); return [brief(r.turn(() => r.h.b!.move(1))), r.row()]; }, ['T', 'a c b'], ['not-draggable', 'a b c']],
  ['crossable', true, false, async (v) => { const r = await rig({ settings: { c: { crossable: v } } }); return [brief(r.turn(() => r.h.b!.move(1))), r.row()]; }, ['T', 'a c b'], ['F', 'a b c']],
  ['placeable', true, false, async (v) => { const r = await rig({ settings: { b: { placeable: v } } }); return [brief(r.turn(() => r.h.b!.place('row-start'))), r.row()]; }, ['T', 'b a c'], ['not-placeable', 'a b c']],
  ['resizable', true, false, async (v) => { const r = await rig({ settings: { b: { resizable: v } } }); return [brief(r.turn(() => r.h.b!.setSlots(2))), slotsOf(r, 'b')]; }, ['T', 2], ['not-resizable', 1]],
  ['maxSlots', 3, 1, async (v) => { const r = await rig({ settings: { b: { maxSlots: v } } }); return [brief(r.turn(() => r.h.b!.setSlots(3))), slotsOf(r, 'b')]; }, ['T', 3], ['F', 1]],
  ['hideStickiness', 'sticky', 'until-room', async (v) => { const r = await rig({ settings: { b: { hideStickiness: v } } }); r.turn(() => r.h.b!.hide()); return [r.row(), r.h.b!.getState().held]; }, ['a b* c', true], ['a b c', false]],
  ['toggleWhenClosed', 'ignore', 'reopen', async (v) => { const r = await rig({ settings: { b: { toggleWhenClosed: v } } }); r.turn(() => r.h.b!.close()); return [brief(r.turn(() => r.h.b!.toggleVisibility())), r.row()]; }, ['F', 'a c ~b'], ['T', 'a c b']],
  ['showWhenClosed', 'refuse', 'reopen', async (v) => { const r = await rig({ settings: { b: { showWhenClosed: v } } }); r.turn(() => r.h.b!.close()); return [brief(r.turn(() => r.h.b!.show())), r.row()]; }, ['is-closed', 'a c ~b'], ['T', 'a c b']],
  ['startVisibility', 'live', 'parked', async (v) => { const r = await rig({ ids: ['a'], extra: [markerTemplate('s', { settings: { startVisibility: v } })] }); let s!: PanelHandle; r.turn(() => { s = r.ws.addPanel('s'); }); return [s.getState().status, shape(r.row())]; }, ['live', 'a s'], ['parked', 'a s*']],
  ['multiple', false, true, async (v) => { const r = await rig({ ids: ['a'], extra: [markerTemplate('s', { settings: { multiple: v } })] }); let s!: PanelHandle, t!: PanelHandle; r.turn(() => { s = r.ws.addPanel('s'); t = r.ws.addPanel('s'); }); return [s.id === t.id, shape(r.row())]; }, [true, 'a s'], [false, 'a s~N s~N']],
  ['maxInstances', 1, 2, async (v) => { const r = await rig({ ids: ['a'], extra: [markerTemplate('s', { settings: { multiple: true, maxInstances: v } })] }); let t!: PanelHandle; r.turn(() => { r.ws.addPanel('s'); t = r.ws.addPanel('s'); }); return [t.getState().status, shape(r.row())]; }, ['closed', 'a s~N ~s~N'], ['live', 'a s~N s~N']],
  ['placeOnAdd', 'row-end', 'row-start', async (v) => { const r = await rig({ extra: [markerTemplate('s', { settings: { placeOnAdd: v } })] }); r.turn(() => void r.ws.addPanel('s')); return r.row(); }, 'a b c s', 's a b c'],
  ['placeOnShow', 'in-place', 'row-end', async (v) => { const r = await rig({ settings: { a: { placeOnShow: v } } }); r.turn(() => r.h.a!.hide()); r.turn(() => r.h.a!.show()); return r.row(); }, 'a b c', 'b c a'],
];

test('the settings matrix: each setting the handle enforces gives its documented result under two values', async () => {
  for (const [name, a, b, observe, expectA, expectB] of MATRIX) {
    const outA = await observe(a as never);
    cleanup();
    const outB = await observe(b as never);
    cleanup();
    assert.deepEqual(outA, expectA, `${name} = ${JSON.stringify(a)}`);
    assert.deepEqual(outB, expectB, `${name} = ${JSON.stringify(b)}`);
    differential(name as never, (run) => {
      run(a, () => outA);
      run(b, () => outB);
    });
  }
  assert.deepEqual(
    differentialsCovered().filter((n) => MATRIX.some((row) => row[0] === n)),
    MATRIX.map((row) => row[0]).sort(),
    'every matrix setting completed its differential',
  );
});

test('toggleWhenClosed and showWhenClosed over the closed, live and parked states', async () => {
  const observe = async (name: 'toggleWhenClosed' | 'showWhenClosed', value: string): Promise<string[]> => {
    const out: string[] = [];
    for (const state of ['closed', 'live', 'parked'] as const) {
      const r = await rig({ settings: { b: { [name]: value } } });
      if (state === 'closed') r.turn(() => r.h.b!.close());
      if (state === 'parked') r.turn(() => r.h.b!.hide());
      out.push(`${state}:${brief(r.turn(() => (name === 'toggleWhenClosed' ? r.h.b!.toggleVisibility() : r.h.b!.show())))}:${r.row()}`);
      cleanup();
    }
    return out;
  };
  const toggle = [await observe('toggleWhenClosed', 'ignore'), await observe('toggleWhenClosed', 'reopen')];
  assert.deepEqual(toggle[0], ['closed:F:a c ~b', 'live:T:a b* c', 'parked:T:a b c']);
  assert.deepEqual(toggle[1], ['closed:T:a c b', 'live:T:a b* c', 'parked:T:a b c']);
  const show = [await observe('showWhenClosed', 'refuse'), await observe('showWhenClosed', 'reopen')];
  assert.deepEqual(show[0], ['closed:is-closed:a c ~b', 'live:F:a b c', 'parked:T:a b c']);
  assert.deepEqual(show[1], ['closed:T:a c b', 'live:F:a b c', 'parked:T:a b c']);
  differential('toggleWhenClosed', (run) => {
    run('ignore', () => toggle[0]);
    run('reopen', () => toggle[1]);
  });
  differential('showWhenClosed', (run) => {
    run('refuse', () => show[0]);
    run('reopen', () => show[1]);
  });
});

test('a closed anonymous instance answers is-closed to show, toggle and open under both values', async () => {
  for (const value of ['ignore', 'reopen'] as const) {
    const refuse = value === 'ignore' ? 'refuse' : 'reopen';
    const r = await rig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, toggleWhenClosed: value, showWhenClosed: refuse } })] });
    let m!: PanelHandle;
    r.turn(() => { m = r.ws.addPanel('m'); });
    r.turn(() => m.close());
    assert.deepEqual([brief(r.turn(() => m.show())), brief(r.turn(() => m.toggleVisibility())), brief(r.turn(() => m.open()))], ['is-closed', 'is-closed', 'is-closed'], value);
    assert.equal(m.getState().status, 'closed');
    cleanup();
  }
});

test('show() on a closed declared panel: reopen re-adds it at placeOnAdd, and instance-limit answers when the template is full', async () => {
  const r = await rig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, maxInstances: 2, showWhenClosed: 'reopen', placeOnAdd: 'row-start' } })] });
  let x!: PanelHandle, y!: PanelHandle;
  r.turn(() => { x = r.ws.addPanel('m', { id: 'x' }); });
  r.turn(() => x.close());
  r.turn(() => { y = r.ws.addPanel('m'); });
  r.turn(() => { r.ws.addPanel('m'); });
  assert.equal(shape(r.row()), 'm~N m~N a ~x', 'two anonymous instances fill the template, each placed at row-start');
  assert.equal(brief(r.turn(() => x.show())), 'instance-limit', 'two instances already fill the template');
  assert.equal(brief(r.turn(() => x.open())), 'instance-limit');
  assert.equal(x.getState().status, 'closed', 'a refusal leaves the record closed');
  r.turn(() => y.close());
  assert.equal(brief(r.turn(() => x.show())), 'T', 'room again');
  assert.equal(shape(r.row()), 'x m~N a', 'x came back at row-start, in front of the surviving instance');
});

const ids = (r: Rig): string[] => r.m!.latest().entries.filter((p) => p.marker !== true).map((p) => p.id);

test('open() inside the undo window drops the record, so undoClose neither skips nor reports the key and the key stays unique', async () => {
  const r = await rig();
  r.turn(() => r.h.a!.close());
  await advanceFrames(5);
  r.turn(() => r.h.b!.close());
  assert.equal(r.row(), 'c ~a ~b');
  assert.equal(r.m!.latest().recentlyClosed?.length, 2, 'both closes are in the undo window');
  assert.equal(brief(r.turn(() => r.h.a!.open())), 'T');
  assert.equal(r.row(), 'c a ~b', 'open() re-added a at placeOnAdd (row-end)');
  assert.equal(r.m!.latest().recentlyClosed?.length, 1, 'the window record for a is gone');
  act(() => r.m!.latest().undoClose());
  assert.equal(r.row(), 'b c a', 'undoClose restored only b');
  assert.equal(new Set(ids(r)).size, ids(r).length, 'ids are unique after both');
  const keys = r.ws.panels.getSnapshot().panels.map((p) => p.id);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique after both');
  assert.equal(r.m!.latest().recentlyClosed, null, 'nothing is left to undo');
});

test('a manager verb other than close and open leaves the undo window as it was', async () => {
  const r = await rig();
  r.turn(() => r.h.a!.close());
  const window = (): string => JSON.stringify(r.m!.latest().recentlyClosed?.map((p) => p.id));
  const before = window();
  for (const run of [
    () => r.h.b!.hide(),
    () => r.h.b!.show(),
    () => r.h.b!.toggleVisibility(),
    () => r.h.b!.move(1),
    () => r.h.b!.place('row-end'),
    () => r.h.b!.setSlots(2),
    () => r.h.b!.scrollTo(),
    () => r.h.b!.open(),
    () => r.h.a!.show(),
    () => r.h.a!.hide(),
  ]) {
    r.turn(run);
    assert.equal(window(), before);
  }
});

test('1000 add and close cycles leave the snapshot at most declared plus live', async () => {
  // The frames let each exit finish; without them the exits would pile up with the loop.
  const r = await rig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true } })] });
  for (let i = 0; i < 1000; i += 1) {
    let h!: PanelHandle;
    r.turn(() => {
      h = r.ws.addPanel('m');
    });
    r.turn(() => void h.close());
    if (i % 20 === 19) await advanceFrames(400);
  }
  const snapshot = r.ws.panels.getSnapshot().panels;
  const live = snapshot.filter((p) => p.status !== 'closed').length;
  assert.ok(snapshot.length <= 1 + live, `${snapshot.length} snapshot panels for 1 declared and ${live} live`);
  assert.equal(snapshot.length, 1, 'every anonymous instance was retired');
});

test('reapply: undo puts the panel back at its old slot, and a parked panel comes back parked', async () => {
  const closed = await rig();
  closed.turn(() => closed.h.b!.close());
  act(() => closed.m!.latest().undoClose());
  assert.equal(closed.row(), 'a b c');
  cleanup();
  const r = await rig();
  r.turn(() => r.h.b!.hide());
  r.turn(() => r.h.b!.close());
  act(() => r.m!.latest().undoClose());
  assert.equal(r.row(), 'a b* c', 'the live flag is kept: b was parked when it closed');
});

test('without a workspace undoClose restores the closed entry at its old slot, unchanged', () => {
  let latest!: ProvidedPanels;
  const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id, live: true, locked: false, view: 'web', collapsible: true, listed: true, ...over });
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [entry('root', { url: '', locked: true, collapsible: false, listed: false }), entry('a'), entry('b'), entry('c')] }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  act(() => latest.close('b'));
  act(() => latest.undoClose());
  assert.deepEqual(latest.entries.map((p) => p.id), ['root', 'a', 'b', 'c']);
});

test('source: a code call leaves every entry without overrides, a person call records the anchor or the slot count', async () => {
  const overrides = (r: Rig): string => JSON.stringify(r.m!.latest().entries.filter((p) => p.marker !== true).map((p) => p.overrides ?? {}));
  const r = await rig();
  const untouched = overrides(r);
  r.turn(() => {
    r.h.b!.move(1);
    r.h.a!.setSlots(2);
    r.h.c!.place('row-start');
  });
  assert.equal(overrides(r), untouched, 'code leaves the person\'s arrangement alone');
  const person = await rig();
  person.turn(() => person.h.b!.move(-1, 'person'));
  assert.match(JSON.stringify(person.m!.latest().entries.find((p) => p.title === undefined || true && p.id === person.h.b!.getState().engineId)?.overrides), /"anchor"/, 'move records an anchor');
  person.turn(() => person.h.a!.setSlots(2, 'person'));
  const a = person.m!.latest().entries.find((p) => p.id === person.h.a!.getState().engineId);
  assert.equal(a?.overrides?.slots, 2, 'setSlots records the slot count');
  person.turn(() => person.h.c!.place('row-start', 'person'));
  const c = person.m!.latest().entries.find((p) => p.id === person.h.c!.getState().engineId);
  assert.equal(c?.overrides?.anchor?.position, 'left', 'place records the anchor');
});

type FreeRig = Pick<Rig, 'ws' | 'h' | 'm' | 'turn'>;

/** A mounted row in the free gesture: these tests pin literal panel-start targets, which the default step gesture would snap to whole-panel stops. */
async function freeRig(o: { ids: readonly string[]; width: number; settings?: Record<string, PanelSettings> }): Promise<FreeRig> {
  const ws = createWorkspace({ mount: false, tuning: { rowGesture: 'free' }, templates: o.ids.map((id) => markerTemplate(id, o.settings?.[id] === undefined ? {} : { settings: o.settings[id] })) });
  const h: Record<string, PanelHandle> = {};
  for (const id of o.ids) h[id] = ws.addPanel(id);
  const m = mountWorkspace(ws, { width: o.width });
  await flush();
  return {
    ws,
    h,
    m,
    turn: <T,>(fn: () => T): T => {
      let out!: T;
      act(() => {
        out = fn();
      });
      return out;
    },
  };
}

/** The scroll position after `run`, with the row's glide run to its end. */
async function scrolled(settings: Record<string, PanelSettings>, from: number, prepare: (r: FreeRig) => void, run: (r: FreeRig) => PanelResult): Promise<{ result: string; left: number }> {
  const r = await freeRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f'], width: 1000, settings });
  prepare(r);
  await advanceFrames(900);
  r.m!.container.scrollLeft = from;
  const result = r.turn(() => run(r));
  await advanceFrames(900);
  const out = { result: brief(result), left: r.m!.container.scrollLeft };
  cleanup();
  return out;
}

test('scrollTo scrolls to the literal target of each align, reads scrollOnOpen when no align is given, and is never busy', async () => {
  const at = (align: 'into-view' | 'start' | 'center') => scrolled({}, 0, () => undefined, (r) => r.h.d!.scrollTo(align));
  assert.deepEqual(await at('into-view'), { result: 'T', left: 640 });
  assert.deepEqual(await at('start'), { result: 'T', left: 1218 });
  assert.deepEqual(await at('center'), { result: 'T', left: 929 });
  const byDefault = async (scrollOnOpen: string) => scrolled({ d: { scrollOnOpen } as unknown as PanelSettings }, 0, () => undefined, (r) => r.h.d!.scrollTo());
  assert.deepEqual(await byDefault('start'), { result: 'T', left: 1218 });
  assert.deepEqual(await byDefault('center'), { result: 'T', left: 929 });
  assert.deepEqual(await byDefault('none'), { result: 'T', left: 640 }, 'none reads as into-view for an explicit scrollTo');
  assert.deepEqual(await scrolled({}, 640, () => undefined, (r) => r.h.d!.scrollTo('into-view')), { result: 'F', left: 640 }, 'already there');
  const r = await freeRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f'], width: 1000 });
  const mixed = r.turn(() => [brief(r.h.a!.close()), brief(r.h.d!.scrollTo()), brief(r.h.a!.scrollTo())]);
  assert.deepEqual(mixed, ['T', 'T', 'F'], 'a close in the same turn does not make scrollTo busy, on another panel or on the closing one');
});

test('scrollOnMove: an accepted move, place or setSlots on an in-view panel follows it; out of view and none record nothing', async () => {
  const all = (scrollOnMove: string): Record<string, PanelSettings> => Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, { scrollOnMove } as PanelSettings]));
  const none = () => undefined;
  assert.deepEqual(await scrolled(all('follow'), 0, none, (r) => r.h.b!.move(1)), { result: 'T', left: 234 }, 'b moves right past c and ends inside the window');
  assert.deepEqual(await scrolled(all('none'), 0, none, (r) => r.h.b!.move(1)), { result: 'T', left: 0 });
  assert.deepEqual(await scrolled(all('follow'), 0, none, (r) => r.h.b!.place('row-end')), { result: 'T', left: 1452 });
  assert.deepEqual(await scrolled(all('none'), 0, none, (r) => r.h.b!.place('row-end')), { result: 'T', left: 0 });
  assert.deepEqual(await scrolled(all('follow'), 0, none, (r) => r.h.c!.setSlots(2)), { result: 'T', left: 640 });
  assert.deepEqual(await scrolled(all('none'), 0, none, (r) => r.h.c!.setSlots(2)), { result: 'T', left: 0 });
  assert.deepEqual(await scrolled(all('follow'), 0, none, (r) => r.h.e!.setSlots(2)), { result: 'T', left: 0 }, 'e is out of view: no request');
});

test('scrollOnOpen: open() and show() record one request and the row scrolls to the literal target', async () => {
  const layer = (scrollOnOpen?: string): Record<string, PanelSettings> => ({ d: scrollOnOpen === undefined ? {} : ({ scrollOnOpen } as unknown as PanelSettings) });
  const park = (r: FreeRig): void => void r.turn(() => r.h.d!.hide());
  for (const [align, left] of [['into-view', 640], ['start', 1218], ['center', 929], [undefined, 640]] as const) {
    assert.deepEqual(await scrolled(layer(align), 0, park, (r) => r.h.d!.show()), { result: 'T', left }, `show of a parked panel: ${align ?? 'default'}`);
    assert.deepEqual(await scrolled(layer(align), 0, () => undefined, (r) => r.h.d!.show()), { result: 'T', left }, `show of a live panel out of view: ${align ?? 'default'}`);
  }
  assert.deepEqual(await scrolled(layer('none'), 0, park, (r) => r.h.d!.show()), { result: 'T', left: 0 }, 'none scrolls nothing');
  assert.deepEqual(await scrolled(layer('none'), 0, () => undefined, (r) => r.h.d!.show()), { result: 'F', left: 0 });
  assert.deepEqual(await scrolled({}, 0, () => undefined, (r) => r.h.a!.show()), { result: 'F', left: 0 }, 'a live panel in view: nothing recorded');
  assert.deepEqual(await scrolled({}, 0, () => undefined, (r) => r.h.a!.hide()), { result: 'T', left: 0 }, 'hide records none');
  const closed = (r: FreeRig): void => void r.turn(() => r.h.d!.close());
  assert.deepEqual(await scrolled(layer('start'), 0, closed, (r) => r.h.d!.open()), { result: 'T', left: 1452 }, 'a reopened panel lands at row-end, which clamps to the strip end');
  assert.deepEqual(await scrolled(layer('none'), 0, closed, (r) => r.h.d!.open()), { result: 'T', left: 0 });
});

test('the owner example: a button in panel two toggles panel one through a closure over the full handle', async () => {
  const two = definePanel({
    id: 'two',
    view: ({ handle }) => React.createElement('button', { 'data-testid': 'toggle', 'data-own-id': handle.id, onClick: () => toggle() }, 'toggle'),
  });
  const r = await rig({ ids: ['one'], extra: [two] });
  const one = r.h.one!;
  const toggle = (): PanelResult => one.toggleVisibility();
  r.turn(() => void r.ws.addPanel('two'));
  await flush();
  const button = (): HTMLElement => r.m!.container.querySelector('[data-testid="toggle"]') as HTMLElement;
  assert.ok(button(), 'panel two rendered its button');
  assert.equal(one.getState().status, 'live');
  act(() => button().click());
  assert.equal(one.getState().status, 'parked', 'the first click hides panel one');
  act(() => button().click());
  assert.equal(one.getState().status, 'live', 'the second click shows it again');
});

test('a ViewHandle has exactly the seventeen sorted keys, pin, unpin and configure among them', async () => {
  const { createWorkspace } = await import('../index.js');
  const { mountWorkspace } = await import('./support/workspace-row.js');
  const w = createWorkspace({ mount: false, templates: [markerTemplate('probe')] });
  w.addPanel('probe');
  const m = mountWorkspace(w);
  const node = m.container.querySelector('[data-template="probe"]') as HTMLElement;
  assert.deepEqual(node.dataset.handleKeys!.split(',').sort(), ['close', 'configure', 'getSettings', 'getState', 'hide', 'id', 'move', 'open', 'pin', 'place', 'scrollTo', 'setSlots', 'show', 'subscribe', 'templateId', 'toggleVisibility', 'unpin']);
});
