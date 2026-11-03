/**
 * The quiet window the header menu opens around its pin and focus: nested calls stay quiet to the end, and an error inside
 * still leaves the window closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietly, quietly } from '../quietMove.js';

test('quietly is quiet for the whole of its work, nested work included, and loud again after it', () => {
  assert.equal(isQuietly(), false);
  quietly(() => {
    assert.equal(isQuietly(), true);
    quietly(() => assert.equal(isQuietly(), true));
    assert.equal(isQuietly(), true, 'still quiet after the inner call returns');
  });
  assert.equal(isQuietly(), false);
});

test('an error inside quietly still closes the window', () => {
  assert.throws(() =>
    quietly(() => {
      throw new Error('boom');
    }),
  );
  assert.equal(isQuietly(), false);
});
