/** No walk is a loop: stepped-order arrangements of one to three spaces, each walked both ways from outside the page. */
import { test, before, after } from 'node:test';
import { rigUp, rigDown, ARRANGEMENTS, noTabLoop } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

for (const arrangement of ARRANGEMENTS.filter((a) => a.order === 'stepped')) {
  for (const reorder of [false, true]) {
    for (const bands of ['&bands=none', '']) {
      const { spaces, order } = arrangement;
      test(`no Tab loop: ${spaces} space${spaces === 1 ? '' : 's'}, ${order} order, rows ${reorder ? 'reordered' : 'as opened'}, ${bands === '' ? 'buttons in the bands' : 'nothing in the bands'}: Tab and Shift+Tab pass every stop once and leave the page`, async (t) => {
        await noTabLoop(t, arrangement, reorder, bands);
      });
    }
  }
}
