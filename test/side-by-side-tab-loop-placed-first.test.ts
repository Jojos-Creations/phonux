/** No walk is a loop: placed-first arrangements, and a modal dialog in a space's first page. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, ready, sleep, onPage, until, WHERE, PLANT_BUTTONS, tabWalk, ARRANGEMENTS, noTabLoop } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

for (const arrangement of ARRANGEMENTS.filter((a) => a.order === 'placed-first')) {
  for (const reorder of [false, true]) {
    for (const bands of ['&bands=none', '']) {
      const { spaces, order } = arrangement;
      test(`no Tab loop: ${spaces} space${spaces === 1 ? '' : 's'}, ${order} order, rows ${reorder ? 'reordered' : 'as opened'}, ${bands === '' ? 'buttons in the bands' : 'nothing in the bands'}: Tab and Shift+Tab pass every stop once and leave the page`, async (t) => {
        await noTabLoop(t, arrangement, reorder, bands);
      });
    }
  }
}

for (const side of ['', '&side=0']) {
  test(`a modal dialog in a space's first page${side === '' ? ', two spaces side by side' : ', one space'}: Tab on the dialog's last button is not held there by a hand-over to a page the dialog makes inert`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, `n=3&bands=none&slots=1,1,1${side}`, async (page) => {
      if (side === '') {
        await until(page, 'c.showSide(ws[1])');
        await sleep(700);
      }
      await page.evaluate(PLANT_BUTTONS);
      const refused: boolean = await page.evaluate(() => {
        const live = [...document.querySelectorAll<HTMLElement>('[data-workspace-id="w1"] [data-row-slot]')].filter((s) => s.closest('[inert]') === null);
        const box = live[0]!.querySelector('[data-box]')!;
        box.insertAdjacentHTML('beforeend', '<dialog><button data-tab="m1">m1</button><button data-tab="m2">m2</button></dialog>');
        box.querySelector('dialog')!.showModal();
        // The page beside it is drawn and reads as a tab stop, and refuses focus all the same.
        const beside = live[1]!.querySelector<HTMLElement>('[data-tab]')!;
        beside.focus();
        box.querySelector<HTMLElement>('[data-tab="m2"]')!.focus();
        return beside.checkVisibility() && document.activeElement !== beside;
      });
      assert.equal(refused, true, 'the next page on screen refuses focus while the dialog is open');
      assert.equal(await page.evaluate(WHERE), 'w1:m2');
      const walk = await tabWalk(page, 4);
      assert.ok(walk.every((x) => x === 'w1:m1' || x === 'w1:m2' || x === 'BODY'), `focus stays with the dialog or goes to the browser: ${walk.join(' ')}`);
      assert.notEqual(walk[0], 'w1:m2', `the first press moves focus off the last button: ${walk.join(' ')}`);
      assert.ok(walk.includes('w1:m1'), `and the walk comes round to the dialog's first button: ${walk.join(' ')}`);
    });
  });
}
