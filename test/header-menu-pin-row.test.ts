/**
 * A pin made inside the header menu's quiet window does not scroll the row, where the same pin outside it does: the row
 * follows a moved panel only when nothing holds it quiet.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { quietly } from '../quietMove.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { letter, matrixRig, viewLog } from './support/configure-matrix.js';

afterEach(() => {
  cleanup();
  viewLog.reset();
});

test('a pin inside the quiet window leaves the row where it is; the same pin outside it scrolls the row to follow', async () => {
  const pinned = async (quiet: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
    await r.settle();
    r.turn(() => r.h.a!.scrollTo('start'));
    await r.settle();
    const before = r.m.container.scrollLeft;
    const pin = (): string => letter(r.turn(() => r.h.b!.pin()));
    assert.equal(quiet ? quietly(pin) : pin(), 'T');
    await r.settle();
    const at = r.m.container.scrollLeft;
    r.m.unmount();
    assert.equal(before, 406, 'a at the left edge of the window, so b is in view');
    return at;
  };
  const quiet = await pinned(true);
  const loud = await pinned(false);
  assert.equal(quiet, 406, 'the quiet pin leaves the row where it was');
  assert.notEqual(loud, 406, 'the same pin outside the window follows the moved panel');
});
