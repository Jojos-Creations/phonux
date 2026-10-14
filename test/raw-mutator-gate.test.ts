/**
 * The raw mutators (close, undoClose, activate, move, reanchor, setFormFactor) take a token on the ids they touch, so a
 * handle call on the same panel in the same turn answers busy; clearAll and create take none; a raw call never refuses.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ProvidedPanels } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { markerTemplate } from './support/workspace-row.js';
import { brief, rig, type Rig } from './support/ops-rig.js';

afterEach(() => cleanup());

const engineId = (r: Rig, id: string): string => r.h[id]!.getState().engineId!;

const RAW: Array<[name: string, prepare: (r: Rig) => void, call: (p: ProvidedPanels, r: Rig) => void]> = [
  ['close', () => undefined, (p, r) => p.close(engineId(r, 'b'))],
  ['setFormFactor', () => undefined, (p, r) => p.setFormFactor(engineId(r, 'b'), 'tablet')],
  ['move', () => undefined, (p, r) => p.move(engineId(r, 'b'), 'right')],
  ['reanchor', () => undefined, (p, r) => p.reanchor(engineId(r, 'b'), { position: 'left', priority: 0 })],
  ['activate', (r) => void r.turn(() => r.h.b!.hide()), (p, r) => p.activate(engineId(r, 'b'))],
  ['undoClose', (r) => void r.turn(() => r.h.b!.close()), (p) => p.undoClose()],
];

test('each raw mutator makes a handle call on the panel it touched busy in the same turn', async () => {
  for (const [name, prepare, call] of RAW) {
    const r = await rig();
    prepare(r);
    const raw = r.m!.latest();
    const answers = r.turn(() => {
      call(raw, r);
      return [brief(r.h.b!.hide()), brief(r.h.b!.show()), brief(r.h.b!.close()), brief(r.h.b!.open())];
    });
    // undoClose restores a panel this turn's handle still sees as closed: only open() could add its key a second time.
    assert.deepEqual(answers, name === 'undoClose' ? ['is-closed', 'is-closed', 'F', 'busy'] : ['busy', 'busy', 'busy', 'busy'], name);
    cleanup();
  }
});

test('a panel the raw call did not touch is free for the handle in the same turn', async () => {
  const r = await rig();
  const raw = r.m!.latest();
  const answers = r.turn(() => {
    raw.setFormFactor(engineId(r, 'b'), 'tablet');
    return [brief(r.h.a!.hide()), brief(r.h.c!.move(-1))];
  });
  assert.deepEqual(answers, ['T', 'T']);
});

test('the turn ends the gate: the same call in the next turn is not busy', async () => {
  const r = await rig();
  r.turn(() => r.m!.latest().setFormFactor(engineId(r, 'b'), 'tablet'));
  assert.equal(brief(r.turn(() => r.h.b!.hide())), 'T');
});

test('a raw call on a panel a handle call holds does nothing and does not throw', async () => {
  const r = await rig();
  const raw = r.m!.latest();
  const answer = r.turn(() => {
    const hidden = brief(r.h.b!.hide());
    raw.close(engineId(r, 'b'));
    raw.setFormFactor(engineId(r, 'b'), 'tablet');
    raw.move(engineId(r, 'b'), 'right');
    return hidden;
  });
  assert.equal(answer, 'T');
  assert.equal(r.row(), 'a b* c', 'b is parked, not closed, not moved');
  assert.equal(r.h.b!.getState().formFactor, 'phone', 'and was not resized');
});

test('two raw calls on one id behave as they did before the gate: both apply in call order, and a close wins over a later resize', async () => {
  const r = await rig();
  const raw = r.m!.latest();
  r.turn(() => {
    raw.setFormFactor(engineId(r, 'a'), 'tablet');
    raw.setFormFactor(engineId(r, 'a'), 'desktop');
  });
  assert.equal(r.h.a!.getState().formFactor, 'desktop');
  const id = engineId(r, 'b');
  r.turn(() => {
    raw.close(id);
    raw.setFormFactor(id, 'tablet');
  });
  assert.equal(r.row(), 'a c ~b');
});

test('clearAll and create take no token and are never no-ops, even in a turn that already holds one', async () => {
  const r = await rig({ extra: [markerTemplate('x')] });
  const raw = r.m!.latest();
  const created = r.turn(() => {
    const held = brief(r.h.b!.hide());
    raw.create({ url: 'https://new.example', title: 'new', view: 'marker' } as never);
    return held;
  });
  assert.equal(created, 'T');
  const after = r.m!.latest().entries.filter((p) => p.marker !== true);
  assert.equal(after.length, 4, 'create added a panel beside the held one');
  assert.equal(brief(r.turn(() => {
    raw.create({ url: 'https://newer.example', title: 'newer', view: 'marker' } as never);
    return r.h.a!.hide();
  })), 'T', 'create takes no token, so a handle call is not busy after it');
  r.turn(() => {
    r.h.c!.hide();
    raw.clearAll();
  });
  assert.equal(r.m!.latest().entries.filter((p) => p.marker !== true && p.collapsible).length, 0, 'clearAll cleared every closable panel despite the held one');
});
