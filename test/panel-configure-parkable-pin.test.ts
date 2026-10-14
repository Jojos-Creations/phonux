/**
 * configure(id, { parkable }) on a panel that is not live follows pinningWhenNotLive, as pin() does: refused whole,
 * shown and flipped in one commit, or stored as a deferred pin and listed in `later`, for a parked, a hidden, a closed
 * declared and an undo-window panel alike.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { ConfigureResult, PanelSettings, PinningWhenNotLive, SettingNote } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { rowScrollerFor } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

type Cell = 'K' | 'H' | 'C' | 'U';
type Done = Extract<ConfigureResult, { ok: true }>;
type Refused = Extract<ConfigureResult, { ok: false }>;

const IDS = ['a', 'b', 'c', 'd', 'e'];
const CLOSED_CELLS: readonly Cell[] = ['C', 'U'];
const STATUS_OF: Record<Cell, string> = { K: 'parked', H: 'parked', C: 'closed', U: 'closed' };
const REFUSAL_OF: Record<Cell, string> = { K: 'would-reshape-row', H: 'would-reshape-row', C: 'is-closed', U: 'is-closed' };

/** The flip: a park panel is also asked for scroll, because a fixed column forces overflow scroll and a bare flip there is a settings-conflict. */
const flip = (cell: Cell): PanelSettings => (cell === 'K' ? { parkable: false, overflow: 'scroll' } : { parkable: false });

const done = (out: ConfigureResult): Done => {
  assert.equal(out.ok, true, out.ok ? '' : `${out.code}: ${out.message}`);
  return out as Done;
};
const refusedWith = (out: ConfigureResult, code: string): Refused => {
  assert.equal(out.ok, false, 'expected a refusal');
  assert.equal((out as Refused).code, code, (out as Refused).message);
  return out as Refused;
};
const shape = (out: ConfigureResult): unknown => {
  const d = done(out);
  return { ok: d.ok, changed: d.changed, shown: d.shown, now: [...d.now].sort(), later: [...d.later].sort(), shadowed: [...d.shadowed] };
};
const ANSWER = (changed: boolean, shown: boolean, now: string[], later: string[], shadowed: string[] = []): unknown => ({ ok: true, changed, shown, now: [...now].sort(), later: [...later].sort(), shadowed });

/** Panel a in the status `cell` names, reading `when` (left out for the default). Only K takes a park row: a bare flip on a park panel is a settings-conflict, which is answered before the pin decision. */
async function cellRig(cell: Cell, when?: PinningWhenNotLive): Promise<PinRig> {
  const own: PanelSettings = when === undefined ? {} : { pinningWhenNotLive: when };
  if (cell === 'K') {
    const r = await pinRig({ ids: IDS, width: 1000, settings: Object.fromEntries(IDS.map((id) => [id, { overflow: 'park', ...own } as PanelSettings])) });
    await r.settle();
    assert.deepEqual([r.state('a').status, r.state('a').held], ['parked', false], 'K: engine-parked');
    return r;
  }
  const r = await pinRig({ settings: { a: own } });
  if (cell === 'H') {
    r.turn(() => r.h.a!.hide());
    await r.settle();
    assert.deepEqual([r.state('a').status, r.state('a').held], ['parked', true], 'H: hidden');
  } else {
    r.turn(() => r.h.a!.close());
    if (cell === 'C') await advanceFrames(9000);
    assert.equal(r.state('a').status, 'closed', `${cell}: closed`);
  }
  return r;
}

function untouched(r: PinRig, cell: Cell, label: string): void {
  assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], [STATUS_OF[cell], true, null], label);
}

async function expectRefusedWhole(cell: Cell, when: PinningWhenNotLive | undefined, label: string): Promise<void> {
  const r = await cellRig(cell, when);
  const entries = r.m.latest().entries;
  const version = r.ws.panels.getSnapshot().version;
  refusedWith(
    r.turn(() => r.h.a!.configure(flip(cell))),
    REFUSAL_OF[cell],
  );
  assert.equal(r.m.latest().entries, entries, `${label} ${cell}: the row is the same array`);
  assert.equal(r.ws.panels.getSnapshot().version, version, `${label} ${cell}: the snapshot did not move`);
  untouched(r, cell, `${label} ${cell}`);
  cleanup();
}

const droppedNotes = (r: PinRig): SettingNote[] => r.m.notes.filter((n) => n.code === 'deferred-pin-dropped');

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('configure parkable false under the default and place-only is refused whole on a parked, hidden, closed declared and undo-window panel', async () => {
  for (const cell of ['K', 'H', 'C', 'U'] as const) {
    await expectRefusedWhole(cell, undefined, 'default');
    await expectRefusedWhole(cell, 'place-only', 'place-only');
  }
});

test('configure parkable false under refuse is refused whole on a parked, hidden, closed declared and undo-window panel', async () => {
  for (const cell of ['K', 'H', 'C', 'U'] as const) await expectRefusedWhole(cell, 'refuse', 'refuse');
});

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

test('configure parkable false under show shows a parked or hidden panel and flips it in one commit, shown true, no dropped-pin note', async () => {
  for (const cell of ['K', 'H'] as const) {
    const r = await cellRig(cell, 'show');
    const renders = r.m.renders();
    const out = r.turn(() => r.h.a!.configure(flip(cell)));
    assert.deepEqual(shape(out), ANSWER(true, true, ['parkable'], cell === 'K' ? ['overflow'] : []), cell);
    assert.ok(r.m.renders() - renders <= 3, `${cell}: the show and the flip share a commit, bar the effects that follow it`);
    await r.settle();
    assert.deepEqual([r.state('a').status, r.state('a').held, r.state('a').settings.parkable, r.state('a').deferredPin], ['live', false, false, null], cell);
    assert.deepEqual([r.entry('a').live, r.entry('a').collapsible], [true, false], `${cell}: a live fixed column`);
    assert.deepEqual(droppedNotes(r), [], `${cell}: nothing waiting was dropped`);
    cleanup();
  }
});

/** Ten scroll panels at 1000 px that show on a flip, with a spy on the row scroller's glideTo. */
async function scrollRig(scrollOnOpen: 'into-view' | 'none'): Promise<{ r: PinRig; glides: () => number }> {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'scroll', pinningWhenNotLive: 'show', scrollOnOpen } as PanelSettings])) });
  await r.settle();
  const scroller = rowScrollerFor(r.m.container);
  const original = scroller.glideTo.bind(scroller);
  let count = 0;
  scroller.glideTo = (to, o) => {
    count += 1;
    return original(to, o);
  };
  return { r, glides: () => count };
}

test('a configure that shows a hidden panel asks the row for one scroll when it lands out of view', async () => {
  const { r, glides } = await scrollRig('into-view');
  r.m.container.scrollLeft = 0;
  r.turn(() => r.h.j!.hide());
  const before = glides();
  done(r.turn(() => r.h.j!.configure({ parkable: false })));
  await r.settle();
  assert.equal(glides() - before, 1, 'one request for the whole show');
  assert.equal(r.state('j').settings.parkable, false);
});

test('a configure that shows a hidden panel under scrollOnOpen none asks the row for no scroll', async () => {
  const { r, glides } = await scrollRig('none');
  r.m.container.scrollLeft = 0;
  r.turn(() => r.h.j!.hide());
  const before = glides();
  done(r.turn(() => r.h.j!.configure({ parkable: false })));
  await r.settle();
  assert.equal(glides() - before, 0);
});

// ---------------------------------------------------------------------------
// Deferral
// ---------------------------------------------------------------------------

test('configure parkable false under apply-on-next-show stores a deferred pin on a parked or hidden panel, reports parkable as later, and show() then lands it fixed and live', async () => {
  for (const cell of ['K', 'H'] as const) {
    const r = await cellRig(cell, 'apply-on-next-show');
    const out = r.turn(() => r.h.a!.configure(flip(cell)));
    assert.deepEqual(shape(out), ANSWER(true, false, [], cell === 'K' ? ['overflow', 'parkable'] : ['parkable']), cell);
    assert.deepEqual([r.state('a').status, r.state('a').held, r.state('a').settings.parkable, r.state('a').deferredPin], ['parked', cell === 'H', true, { parkable: false }], cell);
    assert.deepEqual([r.entry('a').live, r.entry('a').collapsible], [false, true], `${cell}: still a parked, collapsible panel`);
    r.turn(() => r.h.a!.show());
    await r.settle();
    assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], ['live', false, null], cell);
    assert.deepEqual([r.entry('a').live, r.entry('a').collapsible], [true, false], `${cell}: shown fixed and live`);
    assert.deepEqual(droppedNotes(r), [], `${cell}: the deferral still applied when it came to`);
    cleanup();
  }
});

async function reopen(r: PinRig, cell: Cell): Promise<void> {
  if (cell === 'C') r.turn(() => r.h.a!.open());
  else r.turn(() => r.provided().undoClose());
  await r.settle();
}

test('configure parkable false under apply-on-next-show on a closed declared or undo-window panel stores it on the record, and open() or an undo then makes the panel a live fixed column', async () => {
  for (const cell of CLOSED_CELLS) {
    const r = await cellRig(cell, 'apply-on-next-show');
    const out = r.turn(() => r.h.a!.configure(flip(cell)));
    assert.deepEqual(shape(out), ANSWER(true, false, [], ['parkable']), cell);
    assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], ['closed', true, { parkable: false }], `${cell}: the record holds it`);
    await reopen(r, cell);
    assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], ['live', false, null], cell);
    assert.deepEqual([r.entry('a').live, r.entry('a').collapsible], [true, false], `${cell}: a live fixed column`);
    cleanup();
  }
});

test('the closed key of a per-status object decides a closed declared and an undo-window panel, and a missing closed key refuses', async () => {
  const refusing: PinningWhenNotLive[] = [{ closed: 'refuse' }, { parked: 'show', hidden: 'show' }, 'show'];
  for (const cell of CLOSED_CELLS) {
    for (const when of refusing) {
      const r = await cellRig(cell, when);
      refusedWith(r.turn(() => r.h.a!.configure(flip(cell))), 'is-closed');
      untouched(r, cell, `${cell} ${JSON.stringify(when)}`);
      cleanup();
    }
    const r = await cellRig(cell, { closed: 'apply-on-next-show' });
    assert.deepEqual(shape(r.turn(() => r.h.a!.configure(flip(cell)))), ANSWER(true, false, [], ['parkable']), cell);
    assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], ['closed', true, { parkable: false }], cell);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// One row, and the rest of the patch
// ---------------------------------------------------------------------------

test('a per-status object answers differently for a parked and a hidden panel in one row', async () => {
  const both = async (when: PinningWhenNotLive): Promise<{ r: PinRig; a: ConfigureResult; e: ConfigureResult }> => {
    const r = await cellRig('K', when);
    r.turn(() => r.h.e!.hide());
    await r.settle();
    assert.deepEqual([r.state('a').status, r.state('a').held, r.state('e').status, r.state('e').held], ['parked', false, 'parked', true], 'a is engine-parked and e is hidden');
    const a = r.turn(() => r.h.a!.configure(flip('K')));
    await r.settle();
    const e = r.turn(() => r.h.e!.configure(flip('K')));
    await r.settle();
    return { r, a, e };
  };
  const first = await both({ parked: 'show', hidden: 'refuse' });
  assert.deepEqual(shape(first.a), ANSWER(true, true, ['parkable'], ['overflow']));
  assert.deepEqual([first.r.state('a').status, first.r.state('a').settings.parkable], ['live', false]);
  refusedWith(first.e, 'would-reshape-row');
  assert.deepEqual([first.r.state('e').status, first.r.state('e').settings.parkable], ['parked', true]);
  cleanup();
  const second = await both({ parked: 'apply-on-next-show', hidden: 'show' });
  assert.deepEqual(shape(second.a), ANSWER(true, false, [], ['overflow', 'parkable']));
  assert.deepEqual([second.r.state('a').status, second.r.state('a').deferredPin], ['parked', { parkable: false }]);
  assert.deepEqual(shape(second.e), ANSWER(true, true, ['parkable'], ['overflow']));
  assert.deepEqual([second.r.state('e').status, second.r.state('e').settings.parkable], ['live', false]);
});

test('a deferred flip does not hold back the rest of the patch: closable applies now, parkable is later', async () => {
  const r = await cellRig('H', 'apply-on-next-show');
  const out = r.turn(() => r.h.a!.configure({ parkable: false, closable: false }));
  assert.deepEqual(shape(out), ANSWER(true, false, ['closable'], ['parkable']));
  assert.equal(r.state('a').settings.closable, false);
  assert.equal(r.entry('a').locked, true, 'the entry carries the change, not only the record');
  assert.deepEqual([r.state('a').settings.parkable, r.state('a').deferredPin], [true, { parkable: false }]);
});

test('a refused flip is all or nothing: closable beside it is not applied either', async () => {
  const r = await cellRig('H', 'place-only');
  const entries = r.m.latest().entries;
  refusedWith(
    r.turn(() => r.h.a!.configure({ parkable: false, closable: false })),
    'would-reshape-row',
  );
  assert.equal(r.m.latest().entries, entries);
  assert.deepEqual([r.state('a').settings.closable, r.state('a').settings.parkable, r.state('a').deferredPin], [true, true, null]);
});

test('a repeated deferred flip is changed false, and configure parkable true cancels it on a hidden, a closed declared and an undo-window panel', async () => {
  for (const cell of ['H', 'C', 'U'] as const) {
    for (const primed of [false, true]) {
      const label = `${cell}${primed ? ' primed' : ''}`;
      const r = await cellRig(cell, 'apply-on-next-show');
      if (primed) done(r.turn(() => r.h.a!.configure({ parkable: true })));
      const first = r.turn(() => r.h.a!.configure({ parkable: false }));
      assert.deepEqual(shape(first), ANSWER(true, false, [], ['parkable']), `${label}: the flip is stored`);
      assert.deepEqual(r.state('a').deferredPin, { parkable: false }, label);
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ parkable: false }))), ANSWER(false, false, [], []), `${label}: the same call again`);
      assert.deepEqual(r.state('a').deferredPin, { parkable: false }, `${label}: kept`);
      const cancel = r.turn(() => r.h.a!.configure({ parkable: true }));
      const now = !primed && cell === 'H' ? ['parkable'] : [];
      const later = !primed && cell !== 'H' ? ['parkable'] : [];
      assert.deepEqual(shape(cancel), ANSWER(true, false, now, later), `${label}: the cancel`);
      assert.deepEqual([r.state('a').deferredPin, r.state('a').settings.parkable, r.state('a').status], [null, true, STATUS_OF[cell]], label);
      if (cell === 'H') {
        r.turn(() => r.h.a!.show());
        await r.settle();
      } else {
        await reopen(r, cell);
      }
      assert.deepEqual([r.state('a').status, r.state('a').settings.parkable, r.state('a').deferredPin], ['live', true, null], `${label}: the cancelled flip is not applied`);
      assert.equal(r.entry('a').collapsible, true, label);
      cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// What must not change
// ---------------------------------------------------------------------------

test('a conflict or a tier the flip cannot take is answered before the pin decision, under show and apply-on-next-show alike', async () => {
  for (const when of ['show', 'apply-on-next-show'] as const) {
    const park = await cellRig('K', when);
    const conflict = refusedWith(park.turn(() => park.h.a!.configure({ parkable: false })), 'settings-conflict');
    assert.equal(conflict.setting, 'overflow');
    assert.deepEqual([park.state('a').status, park.state('a').deferredPin], ['parked', null], `${when}: the park panel`);
    cleanup();
    const tablet = await pinRig({ settings: { a: { pinningWhenNotLive: when } } });
    tablet.turn(() => tablet.h.a!.setFormFactor('tablet', 'person'));
    tablet.turn(() => tablet.h.a!.hide());
    await tablet.settle();
    refusedWith(tablet.turn(() => tablet.h.a!.configure({ parkable: false })), 'tier-not-allowed');
    assert.deepEqual([tablet.state('a').status, tablet.state('a').deferredPin], ['parked', null], `${when}: the tablet panel`);
    cleanup();
  }
});

test('a flip that changes nothing the panel reads is not a pin change: parkable true on a hidden parkable panel is accepted under refuse', async () => {
  const r = await cellRig('H', 'refuse');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ parkable: true }))), ANSWER(true, false, ['parkable'], []));
  assert.deepEqual([r.state('a').status, r.state('a').held, r.state('a').deferredPin], ['parked', true, null]);
});

test('a flip the person\'s override outvotes is not a pin change: a hidden panel the person unpinned answers shadowed under refuse', async () => {
  const r = await pinRig({ settings: { a: { pinning: { pinned: { parkable: false }, unpinned: { parkable: true } }, pinningWhenNotLive: 'refuse' } } });
  r.turn(() => r.h.a!.pin('person'));
  r.turn(() => r.h.a!.unpin('person'));
  r.turn(() => r.h.a!.hide());
  await r.settle();
  assert.deepEqual([r.state('a').status, r.state('a').held, r.state('a').settings.parkable], ['parked', true, true], 'control: hidden and parkable by the person\'s word');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ parkable: false }))), ANSWER(true, false, ['parkable'], [], ['parkable']));
  assert.deepEqual([r.state('a').settings.parkable, r.state('a').status, r.state('a').deferredPin], [true, 'parked', null]);
});

test('the pinningWhenNotLive in force before the patch decides a flip made beside a change to it', async () => {
  const refused = await cellRig('H', 'place-only');
  refusedWith(refused.turn(() => refused.h.a!.configure({ parkable: false, pinningWhenNotLive: 'show' })), 'would-reshape-row');
  assert.deepEqual([refused.state('a').settings.pinningWhenNotLive, refused.state('a').status], ['place-only', 'parked']);
  cleanup();
  const shown = await cellRig('H', 'show');
  const out = shown.turn(() => shown.h.a!.configure({ parkable: false, pinningWhenNotLive: 'refuse' }));
  assert.equal(done(out).shown, true);
  await shown.settle();
  assert.deepEqual([shown.state('a').status, shown.state('a').settings.parkable, shown.state('a').settings.pinningWhenNotLive], ['live', false, 'refuse']);
});

test('a live panel flips at once under every pinningWhenNotLive value', async () => {
  const values: PinningWhenNotLive[] = ['place-only', 'refuse', 'show', 'apply-on-next-show', { parked: 'show', hidden: 'refuse', closed: 'apply-on-next-show' }, { parked: 'apply-on-next-show', hidden: 'show', closed: 'refuse' }];
  for (const when of values) {
    const r = await pinRig({ settings: { b: { pinningWhenNotLive: when } } });
    assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: false }))), ANSWER(true, false, ['parkable'], []), JSON.stringify(when));
    assert.deepEqual([r.state('b').status, r.state('b').settings.parkable, r.state('b').deferredPin], ['live', false, null], JSON.stringify(when));
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Never saved
// ---------------------------------------------------------------------------

const wait = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 80))));

test('a deferral configure stores is session only: the saved file holds none and a second launch starts without one', async () => {
  const store = memoryWorkspaceStorage();
  const S: PanelSettings = { pinningWhenNotLive: 'apply-on-next-show' };
  const launch = (): Promise<PinRig> => pinRig({ settings: { a: S, b: S }, workspace: { storage: store, tuning: { saveQuietMs: 5 } } });
  const r = await launch();
  r.turn(() => r.h.a!.hide());
  r.turn(() => r.h.b!.close());
  await advanceFrames(9000);
  assert.deepEqual([r.state('a').status, r.state('b').status], ['parked', 'closed']);
  done(r.turn(() => r.h.a!.configure({ parkable: false })));
  done(r.turn(() => r.h.b!.configure({ parkable: false })));
  assert.deepEqual([r.state('a').deferredPin, r.state('b').deferredPin], [{ parkable: false }, { parkable: false }], 'control: both wait');
  await wait();
  const saved = await store.load();
  assert.ok(saved !== null, 'positive control: something was saved');
  assert.equal(JSON.stringify(saved).includes('deferredPin'), false);
  r.m.unmount();
  cleanup();
  const second = await launch();
  await wait();
  assert.deepEqual([second.state('a').deferredPin, second.state('b').deferredPin], [null, null]);
  assert.deepEqual([second.state('a').settings.parkable, second.state('b').settings.parkable], [true, true]);
});
