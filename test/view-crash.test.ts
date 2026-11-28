/**
 * A view that throws while rendering takes only its own panel down: the panel draws a failed state inside its frame, with a
 * Close and a Try again, the error goes to `onError`, and every other panel and workspace stays drawn.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, createWorkspaceColumn, definePanel, Panel, PanelFrame } from '../index.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(() => rigCleanup());

const good = definePanel({ id: 'good', view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });
const fuse = { blown: false };
const bad = definePanel({
  id: 'bad',
  view: ({ handle }) => {
    if (fuse.blown) throw new Error('the view hit a bug');
    return React.createElement('i', { 'data-slot': handle.id });
  },
});
// A view that draws its own frame: the frame goes with the view when it throws.
const framed = definePanel({
  id: 'framed',
  view: ({ handle }) => {
    if (fuse.blown) throw new Error('the framed view hit a bug');
    return React.createElement(Panel, { title: 'Framed', children: React.createElement(PanelFrame, null, React.createElement('i', { 'data-slot': handle.id })) });
  },
});
const failedViews = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-panel-view-failed]')];
const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const was = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = was;
  }
};

for (const template of ['bad', 'framed'] as const) {
  test(`a ${template} view that throws shows a failed state in its panel, reports it once, and leaves the other panel drawn`, async () => {
    fuse.blown = false;
    await quiet(async () => {
      const errors: unknown[] = [];
      const ws = track(createWorkspace({ templates: [good, bad, framed], onError: (e) => void errors.push(e) }));
      ws.addPanel('good');
      await until('the good panel', () => slots(document.body).length === 1);
      fuse.blown = true;
      ws.addPanel(template);
      await until('the failed state', () => failedViews().length === 1);
      assert.deepEqual(slots(document.body), ['good'], 'the other panel is still drawn');
      assert.equal(errors.length, 1, 'the error is reported once');
      assert.match((errors[0] as Error).message, /bug/);
      assert.ok(failedViews()[0]!.querySelector('[data-panel-view-retry]'), 'a Try again is offered');
      assert.ok(document.querySelector('[data-panel-chrome-part="header"]'), 'the failed panel keeps a header, so it can be closed');
    });
  });
}

test('Try again draws the view again, and a view that still throws stays failed', async () => {
  fuse.blown = false;
  await quiet(async () => {
    const ws = track(createWorkspace({ templates: [good, bad], onError: () => undefined }));
    ws.addPanel('good');
    await until('the good panel', () => slots(document.body).length === 1);
    fuse.blown = true;
    ws.addPanel('bad');
    await until('the failed state', () => failedViews().length === 1);
    act(() => void document.querySelector<HTMLElement>('[data-panel-view-retry]')!.click());
    assert.equal(failedViews().length, 1, 'still throwing: still failed');
    fuse.blown = false;
    act(() => void document.querySelector<HTMLElement>('[data-panel-view-retry]')!.click());
    await until('the view back', () => slots(document.body).length === 2);
    assert.equal(failedViews().length, 0);
  });
});

test('the failed panel can be closed, and what is left of the workspace is untouched', async () => {
  fuse.blown = false;
  await quiet(async () => {
    const ws = track(createWorkspace({ templates: [good, bad], onError: () => undefined }));
    ws.addPanel('good');
    await until('the good panel', () => slots(document.body).length === 1);
    fuse.blown = true;
    const handle = ws.addPanel('bad');
    await until('the failed state', () => failedViews().length === 1);
    act(() => void handle.close());
    await until('the failed panel gone', () => failedViews().length === 0);
    assert.deepEqual(slots(document.body), ['good']);
  });
});

test('in a column, a view that throws in one workspace leaves the other workspace drawn', async () => {
  fuse.blown = false;
  await quiet(async () => {
    const errors: unknown[] = [];
    const col = createWorkspaceColumn({ templates: [good, bad], onError: (e) => void errors.push(e) });
    const one = col.addWorkspace({ id: 'one', name: 'One' });
    const two = col.addWorkspace({ id: 'two', name: 'Two' });
    one.addPanel('good');
    await until('the good panel', () => slots(document.body).length >= 1);
    fuse.blown = true;
    two.addPanel('bad');
    col.scrollTo(two);
    await until('the failed state', () => failedViews().length === 1);
    col.scrollTo(one);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(slots(document.body).includes('good'), 'workspace One still draws its panel');
    assert.equal(errors.length, 1);
    act(() => col.dispose());
  });
});
