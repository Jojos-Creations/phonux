/**
 * usePanelState listens to one panel: a change to another panel does not render the caller, a panel added later is picked
 * up when it appears, and one that is retired reads as undefined.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, usePanelState } from '../index.js';
import type { PanelState } from '../index.js';
import { PanelViewContextValue } from '../panelViewContext.js';
import { resize, rigCleanup, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

const renders: Record<string, number> = {};
const seen: Record<string, PanelState | undefined> = {};

const reads: Record<string, number> = {};

/** Draws the title of the panel `target` through usePanelState; memoised, so only the hook can render it again. */
const Probe = React.memo(function Probe({ owner, target }: { owner: string; target: string }) {
  const state = usePanelState(target);
  renders[owner] = (renders[owner] ?? 0) + 1;
  seen[owner] = state;
  return React.createElement('i', { 'data-slot': owner, 'data-title': state?.title ?? 'none' });
});

/** Counts the snapshot reads the probe's hook makes, which React makes once for each notification it gets. */
function Counted({ owner, target }: { owner: string; target: string }): React.JSX.Element {
  const context = React.useContext(PanelViewContextValue)!;
  const value = React.useMemo(() => {
    const manager = context.manager!;
    return {
      ...context,
      manager: {
        ...manager,
        getSnapshot: () => {
          reads[owner] = (reads[owner] ?? 0) + 1;
          return manager.getSnapshot();
        },
      },
    };
  }, [context, owner]);
  return React.createElement(PanelViewContextValue.Provider, { value }, React.createElement(Probe, { owner, target }));
}
const watcher = definePanel({
  id: 'watch',
  view: ({ handle, panel }) => React.createElement(Counted, { owner: handle.id, target: typeof panel.params === 'string' ? panel.params : handle.id }),
  settings: { multiple: true },
});
const plain = definePanel({ id: 'plain', view: () => React.createElement('b'), settings: { multiple: true } });

const reset = (): void => {
  for (const k of Object.keys(renders)) delete renders[k];
  for (const k of Object.keys(reads)) delete reads[k];
  for (const k of Object.keys(seen)) delete seen[k];
};

const title = (id: string): string | undefined => document.querySelector<HTMLElement>(`[data-slot="${id}"]`)?.dataset.title;

test('a change to panel b leaves the render count of a watcher of a unchanged, and a change to a renders it once', async () => {
  reset();
  win.height = 800;
  const ws = track(createWorkspace({ root: plain, tuning: { maxLivePanels: 8 }, templates: [watcher, plain] }));
  const a = ws.addPanel('watch', { id: 'wa' });
  const b = ws.addPanel('watch', { id: 'wb' });
  await resize(4000);
  await until('both watchers', () => title('wa') !== undefined && title('wb') !== undefined);
  const before = { ...renders };
  const readsBefore = { ...reads };
  await act(async () => void b.configure({ title: 'B1' }));
  await until('b watcher', () => title('wb') === 'B1');
  assert.equal(renders.wa, before.wa, 'the watcher of a did not render for a change to b');
  assert.equal(reads.wa, readsBefore.wa, 'the watcher of a was not even notified of a change to b');
  assert.ok(renders.wb! > before.wb!, 'the watcher of b rendered');
  const afterB = { ...renders };
  await act(async () => void a.configure({ title: 'A1' }));
  await until('a watcher', () => title('wa') === 'A1');
  assert.equal(renders.wa, afterB.wa! + 1, 'the watcher of a rendered once');
  assert.equal(renders.wb, afterB.wb, 'the watcher of b did not render for a change to a');
});

test('a watcher mounted before the panel exists renders it when it is added', async () => {
  reset();
  win.height = 800;
  const ws = track(createWorkspace({ root: plain, tuning: { maxLivePanels: 8 }, templates: [watcher, plain] }));
  ws.addPanel('watch', { id: 'wl', params: 'late' });
  await resize(4000);
  await until('the watcher', () => title('wl') === 'none');
  ws.addPanel('plain', { id: 'late', settings: { title: 'Late' } });
  await until('the late panel', () => title('wl') === 'Late');
});

test('a watcher of a panel that is retired reads undefined', async () => {
  reset();
  win.height = 800;
  const ws = track(createWorkspace({ root: plain, tuning: { maxLivePanels: 8 }, templates: [watcher, plain] }));
  ws.addPanel('watch', { id: 'ready', params: 'ready' });
  await resize(4000);
  await until('the workspace', () => title('ready') !== undefined && title('ready') !== 'none');
  const anonymous = ws.addPanel('plain', { settings: { title: 'Gone' } });
  ws.addPanel('watch', { id: 'wr', params: anonymous.id });
  await until('the watcher', () => title('wr') === 'Gone');
  await act(async () => void anonymous.close());
  await until('the retired panel', () => seen.wr === undefined);
});

test('under StrictMode there is no getSnapshot caching error', async () => {
  reset();
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    win.height = 800;
    const ws = track(createWorkspace({ root: plain, tuning: { maxLivePanels: 8 }, templates: [watcher, plain], wrap: ({ children }: { children?: React.ReactNode }) => React.createElement(React.StrictMode, null, children) }));
    ws.addPanel('plain', { id: 'a' });
    ws.addPanel('watch', { id: 'wa', params: 'a' });
    await resize(4000);
    await until('the watcher', () => title('wa') !== undefined);
    await act(async () => void ws.addPanel('plain', { id: 'c' }));
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors.filter((e) => String(e[0]).includes('getSnapshot')), []);
});
