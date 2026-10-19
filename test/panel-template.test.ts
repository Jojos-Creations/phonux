/**
 * definePanel checks a template when it is written: its id, its view and its settings layer. PanelManagerError is the
 * one error a programmer mistake throws.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { PanelManagerError, definePanel } from '../index.js';
import type { PanelTemplate } from '../index.js';

const View = (): null => null;

function invalidTemplate(t: unknown): PanelManagerError {
  try {
    definePanel(t as PanelTemplate);
  } catch (error) {
    assert.ok(error instanceof PanelManagerError, `expected a PanelManagerError, got ${String(error)}`);
    return error;
  }
  return assert.fail('definePanel accepted a template it should have refused');
}

test('definePanel: returns the very template it was given, with its params and settings', () => {
  const template: PanelTemplate<{ page: number }> = { id: 'notes', view: View, params: { page: 1 }, settings: { overflow: 'park', headerButtons: { size: { icon: 'i', label: 'Size', onClick: () => undefined } } } };
  assert.equal(definePanel(template), template);
  const bare = { id: 'bare', view: View };
  assert.equal(definePanel(bare), bare);
});

type IdRow = readonly [id: unknown, valid: boolean];
const ID_TABLE: readonly IdRow[] = [
  ['notes', true],
  ['a', true],
  ['x'.repeat(48), true],
  ['1a', true],
  ['a1', true],
  ['has-dash.and_underscore', true],
  ['All', true],
  ['x'.repeat(49), false],
  ['', false],
  ['has space', false],
  ['tab\there', false],
  ['new\nline', false],
  ['a~b', false],
  ['~', false],
  ['_engine', false],
  ['_', false],
  ['123', false],
  ['0', false],
  ['all', false],
  [42, false],
  [undefined, false],
  [null, false],
];

test('definePanel: the template id is 1-48 characters, no whitespace, no tilde, no leading underscore, not all digits and not all; executed equals rows', () => {
  let executed = 0;
  for (const [id, valid] of ID_TABLE) {
    const template = { id, view: View };
    if (valid) {
      assert.equal(definePanel(template as PanelTemplate), template, JSON.stringify(id));
    } else {
      const error = invalidTemplate(template);
      assert.equal(error.code, 'invalid-template', JSON.stringify(id));
      assert.equal(error.layer, undefined);
    }
    executed += 1;
  }
  assert.equal(executed, ID_TABLE.length);
  assert.equal(ID_TABLE.filter((row) => row[1]).length, 7);
});

test('definePanel: the view must be a component: a function, a memo or a lazy component is accepted and anything else is invalid-template', () => {
  for (const view of [View, class extends React.Component { override render(): null { return null; } }, React.memo(View), React.forwardRef(() => null), React.lazy(() => Promise.resolve({ default: View }))]) {
    const template = { id: 'v', view };
    assert.equal(definePanel(template as PanelTemplate), template);
  }
  for (const view of [undefined, null, 'div', 42, {}, [], { render: () => null }]) {
    const error = invalidTemplate({ id: 'v', view });
    assert.equal(error.code, 'invalid-template');
    assert.match(error.message, /view/);
  }
});

test('definePanel: the template settings go through the resolver, so a bad key, value or tuning key is invalid-settings naming the template layer', () => {
  const rows: ReadonlyArray<readonly [what: string, settings: unknown, key: string]> = [
    ['an unknown key', { nope: 1 }, 'nope'],
    ['a wrong type', { closable: 'yes' }, 'closable'],
    ['a tuning key with a workspace leaf', { tuning: { dragToClose: { distanceFraction: 0.3 } } }, 'tuning'],
    ['a tuning key with a workspace-only leaf', { tuning: { rowGap: 8 } }, 'tuning'],
    ['an invalid pin definition', { pinning: { pinned: { placement: 'row-end' }, unpinned: { placement: 'row-start' } } }, 'pinning'],
    ['an in-place placeOnAdd', { placeOnAdd: 'in-place' }, 'placeOnAdd'],
  ];
  for (const [what, settings, key] of rows) {
    const error = invalidTemplate({ id: 'notes', view: View, settings });
    assert.equal(error.code, 'invalid-settings', what);
    assert.equal(error.layer, 'template', what);
    assert.equal(error.key, key, what);
  }
  const accepted = { id: 'notes', view: View, settings: { hostCreatable: false, multiple: true, maxInstances: 3, parkable: false, overflow: 'park' } } as const;
  assert.equal(definePanel(accepted as PanelTemplate), accepted, 'a rule collision is a conflict, never an error');
});

test('definePanel: a template that is not an object is invalid-template', () => {
  for (const t of [undefined, null, 'notes', 5]) assert.equal(invalidTemplate(t).code, 'invalid-template');
});

test('PanelManagerError: is an Error with a name, a code, and the layer and key when given, undefined otherwise', () => {
  const plain = new PanelManagerError('disposed', 'the workspace is disposed');
  assert.ok(plain instanceof Error && plain instanceof PanelManagerError);
  assert.deepEqual([plain.name, plain.code, plain.message, plain.layer, plain.key], ['PanelManagerError', 'disposed', 'the workspace is disposed', undefined, undefined]);
  const located = new PanelManagerError('invalid-settings', 'template.closable: expected a boolean', { layer: 'template', key: 'closable' });
  assert.deepEqual([located.code, located.layer, located.key], ['invalid-settings', 'template', 'closable']);
  const codes = ['invalid-template', 'duplicate-template', 'unknown-template', 'root-mismatch', 'invalid-options', 'invalid-settings', 'instance-id-required', 'already-attached', 'disposed'] as const;
  for (const code of codes) assert.equal(new PanelManagerError(code, 'm').code, code);
  assert.equal(codes.length, 9);
});
