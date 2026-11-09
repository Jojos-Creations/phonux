import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { PanelManagerError, definePanel } from '../index.js';

const view = (): null => null;

test('definePanel takes a boolean for verticalDrag and refuses anything else', () => {
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, verticalDrag: true }));
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, verticalDrag: false }));
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, verticalDrag: undefined }));
  for (const verticalDrag of ['yes', 1, null, {}]) {
    assert.throws(
      () => definePanel({ id: 'bad', view, verticalDrag: verticalDrag as never }),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-template' && e.message.includes('verticalDrag must be a boolean'),
    );
  }
});
