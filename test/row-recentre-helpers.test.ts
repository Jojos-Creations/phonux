/**
 * The pure parts of the row's own motion: reading a drawn translate and clip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipRightOf, rowClip, translateXOf } from '../rowRecentre.js';

test('translateXOf reads the x of a computed translate, and none as 0', () => {
  assert.equal(translateXOf('none'), 0);
  assert.equal(translateXOf('12.5px'), 12.5);
  assert.equal(translateXOf('-184px 0px'), -184);
});

test('clipRightOf reads back the right edge of the clip rowClip writes, and null for another shape', () => {
  assert.equal(clipRightOf(rowClip(1202, 16)), 1218);
  assert.equal(clipRightOf('polygon(-16px -100000px, 1623.52px -100000px, 1623.52px 100000px, -16px 100000px)'), 1623.52);
  assert.equal(clipRightOf('none'), null);
  assert.equal(clipRightOf('inset(0px)'), null);
});
