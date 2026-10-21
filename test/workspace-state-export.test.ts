/**
 * The package entry exports the saved-file guard, so a host can check an imported workspace file the way the
 * library checks saved state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspaceState } from '../index.js';

test('the entry exports isWorkspaceState and it accepts an empty workspace file', () => {
  assert.equal(typeof isWorkspaceState, 'function');
  assert.equal(isWorkspaceState({ version: 1, panels: [] }), true);
});

test('the entry exports isWorkspaceState and it rejects a file of another version', () => {
  assert.equal(isWorkspaceState({ version: 2, panels: [] }), false);
});
