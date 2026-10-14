/**
 * createFakePanel: a view that takes PanelViewProps renders from the fake with no cast, the panel it holds is the one state it
 * was given, and every operation records a call and answers an accepted result.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act } from 'react';
import ts from 'typescript';
import type { PanelViewProps } from '../index.js';
import { createFakePanel } from '../fakeHost.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(cleanup);

/** A plain function component over the named props; it reads the title and widens its panel on a press. */
function Counter({ panel, handle, manager }: PanelViewProps): React.JSX.Element {
  return React.createElement(
    'button',
    { onClick: () => void handle.setSlots(2) },
    `${handle.getState().title ?? panel.id}:${manager.list().length}`,
  );
}

test('a view rendered from createFakePanel reads its state and records the operation it calls', () => {
  const fake = createFakePanel({ id: 'notes', title: 'Notes' });
  const view = mount(React.createElement(Counter, fake.props));
  const button = view.container.querySelector('button')!;
  assert.equal(button.textContent, 'Notes:1');
  act(() => button.click());
  assert.deepEqual(fake.calls, [{ api: 'handle', method: 'setSlots', args: [2] }]);
});

test('props, handle and manager are the same objects the fake exposes, and the manager knows only its one panel', () => {
  const fake = createFakePanel({ id: 'a', params: { n: 1 } });
  assert.equal(fake.props.handle, fake.handle);
  assert.equal(fake.props.manager, fake.manager);
  assert.deepEqual(fake.props.panel.params, { n: 1 });
  assert.equal(fake.manager.get('a')?.getState(), fake.handle.getState());
  assert.equal(fake.manager.get('other'), undefined);
  assert.equal(fake.manager.getSnapshot(), fake.manager.getSnapshot());
  assert.deepEqual(fake.manager.list({ status: 'closed' }), []);
});

test('every operation records one call with its arguments and answers an accepted result that changed nothing', () => {
  const fake = createFakePanel();
  const { handle } = fake;
  const results = [
    handle.show('person'),
    handle.hide(),
    handle.toggleVisibility(),
    handle.close(),
    handle.open(),
    handle.move(1),
    handle.place('in-place'),
    handle.setSlots(3),
    handle.scrollTo('start'),
    handle.pin(),
    handle.unpin(),
    handle.configure({ title: 'T' }),
  ];
  assert.ok(results.every((r) => r.ok && !r.changed));
  assert.deepEqual(
    fake.calls.map((c) => c.method),
    ['show', 'hide', 'toggleVisibility', 'close', 'open', 'move', 'place', 'setSlots', 'scrollTo', 'pin', 'unpin', 'configure'],
  );
  assert.deepEqual(fake.calls[0], { api: 'handle', method: 'show', args: ['person'] });
  assert.equal(handle.getState().title, undefined, 'the fake keeps the state it was given');
});

/** The diagnostics of `files` under the project's own compiler options. */
function problemsIn(...files: string[]): string[] {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const paths = files.map((f) => `${root}${f}`);
  const program = ts.createProgram(paths, { ...parsed.options, noEmit: true, skipLibCheck: true });
  return paths.flatMap((f) => ts.getPreEmitDiagnostics(program, program.getSourceFile(f)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')));
}

test('createFakePanel compiles with no cast, and its handle names every member of ViewHandle', () => {
  assert.deepEqual(problemsIn('test/create-fake-panel.typecheck.ts', 'fakeHost.ts'), []);
});

test('the level shape table follows PanelViewProps member by member', () => {
  assert.deepEqual(problemsIn('panelApiLevel.ts'), []);
});
