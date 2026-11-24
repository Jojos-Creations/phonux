/** No walk is a loop: list-order arrangements of one to three spaces, each walked both ways from outside the page. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, ready, sleep, onPage, until, WATCH_ENTRY, withEnds, NUMBER, walkedBothWays, rowsReordered, ARRANGEMENTS, noTabLoop } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

for (const arrangement of ARRANGEMENTS.filter((a) => a.order === 'list')) {
  for (const reorder of [false, true]) {
    for (const bands of ['&bands=none', '']) {
      const { spaces, order } = arrangement;
      test(`no Tab loop: ${spaces} space${spaces === 1 ? '' : 's'}, ${order} order, rows ${reorder ? 'reordered' : 'as opened'}, ${bands === '' ? 'buttons in the bands' : 'nothing in the bands'}: Tab and Shift+Tab pass every stop once and leave the page`, async (t) => {
        await noTabLoop(t, arrangement, reorder, bands);
      });
    }
  }
}

test('Tab and Shift+Tab leave a column of three one-slot spaces whose rows were reordered, drawn as listed with nothing else on the page: no press comes back to a stop', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none&slots=1,1,1', async (page) => {
    await until(page, 'c.showSide(ws[1])');
    await sleep(700);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true]);
    await sleep(900);
    assert.equal(await rowsReordered(page), true);
    assert.deepEqual(await withEnds(page, []), [], 'drawn as listed, so neither end of the column is a stop');
    await page.evaluate(NUMBER);
    await page.evaluate(WATCH_ENTRY);
    assert.ok((await walkedBothWays(page)) >= 9, 'two spaces of two pages, two controls a page, and the divider');
  });
});
