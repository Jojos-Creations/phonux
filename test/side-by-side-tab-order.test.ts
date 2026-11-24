/** Real Tab and Shift+Tab presses over spaces side by side: screen order, frames as stops, reordered rows, and focus that no Tab caused. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, ready, sleep, onPage, shown, call, until, WHERE, STOPS, PLANT_BUTTONS, PLANT_OUTSIDE, PLANT_FRAMES, tabWalk, frameAsOne, tabUntil, tabRound, WATCH_ENTRY, START, END, withEnds, ring, focusStop, inOrder, ON_SCREEN } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

for (const order of ['list', 'stepped', 'placed-first'] as const) {
  for (const bands of ['', '&bands=none']) {
    test(`Tab, ${order} order${bands === '' ? '' : ', bands with nothing tabbable'}: the column alone on the page is walked in screen order, and left and entered at the end the key heads to`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, `n=3${bands}`, async (page) => {
        assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
        assert.ok((await page.evaluate(PLANT_BUTTONS)) > 0, 'some planted buttons are in panels the row keeps inert, so a walk that stops at one is seen');
        const stops: string[] = await page.evaluate(STOPS);
        assert.ok(stops.length >= 5 && stops.includes('div0'), `the stops are several and the divider is one: ${stops.join(' ')}`);
        await focusStop(page, stops[0]!);
        assert.equal(await page.evaluate(WHERE), stops[0]);
        await page.evaluate(WATCH_ENTRY);
        const all = await withEnds(page, stops);
        assert.equal(all.length - stops.length, order === 'list' ? 0 : 2, 'drawn as mounted the column has no stop of its own; drawn otherwise, one at each end');
        // Forward from the first stop: every stop, then out of the page, then in again at the first.
        assert.deepEqual(await tabRound(page, all.length), ring(all, stops[0]!));
        // Backward from the first stop: out of the page, in again at the last, then every stop.
        assert.deepEqual(await tabRound(page, all.length, true), ring(all, stops[0]!, true));
      });
    });

    test(`Tab, ${order} order${bands === '' ? '' : ', bands with nothing tabbable'}: between a button before the column and one after it, the walk is the screen's both ways`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, `n=3${bands}`, async (page) => {
        assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
        await page.evaluate(PLANT_BUTTONS);
        await page.evaluate(PLANT_OUTSIDE);
        const stops = await withEnds(page, await page.evaluate(STOPS));
        await page.focus('#before');
        assert.deepEqual(await tabWalk(page, stops.length + 1), [...stops, 'after']);
        assert.deepEqual(await tabWalk(page, stops.length + 1, true), [...[...stops].reverse(), 'before']);
      });
    });
  }
}

for (const order of ['list', 'stepped'] as const) {
  test(`Tab, ${order} order, a frame as each space's last stop and nothing tabbable in the bands: a Tab pressed inside the frame goes on to the divider, and past the last space out of the column`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
      await page.evaluate(PLANT_BUTTONS);
      await page.evaluate(PLANT_FRAMES);
      await page.evaluate(PLANT_OUTSIDE);
      const stops = frameAsOne(await page.evaluate(STOPS));
      const [left, right] = (await shown(page)).map((x) => x.id) as [string, string];
      assert.equal(stops[stops.indexOf('div0') - 1], `${left}:frame`, 'the frame is the last stop before the divider');
      assert.equal(stops[stops.length - 1], `${right}:frame`, 'and the last stop of all');
      const all = await withEnds(page, stops);
      await page.focus('#before');
      assert.deepEqual(await tabUntil(page, 'after', 3 * stops.length), [...all, 'after']);
      assert.deepEqual(await tabUntil(page, 'before', 3 * stops.length, true), [...[...all].reverse(), 'before']);
    });
  });

  test(`Tab, ${order} order, a frame as each space's last stop, the column alone on the page: the step out of the last frame is spent, so focus rests for one press before it leaves`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
      await page.evaluate(PLANT_BUTTONS);
      await page.evaluate(PLANT_FRAMES);
      await page.evaluate(WATCH_ENTRY);
      const stops = frameAsOne(await page.evaluate(STOPS));
      const right = (await shown(page))[1]!.id;
      await focusStop(page, stops[0]!);
      // Drawn as mounted, the row rests on its own end as a row alone does; drawn otherwise, the column's end is where every step out rests.
      const all = order === 'list' ? [...stops, `${right}:row-end`] : await withEnds(page, stops);
      assert.deepEqual(frameAsOne(await tabRound(page, all.length)), ring(all, stops[0]!));
      const back = await withEnds(page, stops);
      assert.deepEqual(frameAsOne(await tabRound(page, back.length, true)), ring(back, stops[0]!, true));
    });
  });
}

for (const outside of [true, false]) {
  test(`Tab across spaces whose rows were reordered, ${outside ? 'between two buttons' : 'the column alone'}: the row's last panel on screen is not its last in the DOM, and the walk still leaves each space after it`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
      assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true]);
      await sleep(900);
      await page.evaluate(PLANT_BUTTONS);
      const stops: string[] = await page.evaluate(STOPS);
      const inDom: string[] = await page.evaluate(() => [...document.querySelectorAll('[data-workspace-id="w3"] [data-tab]')].filter((el) => el.closest('[inert]') === null).map((el) => `w3:${el.getAttribute('data-tab')}`));
      const planted = stops.filter((x) => inDom.includes(x));
      assert.equal(planted.length, inDom.length);
      assert.notDeepEqual(planted, inDom, `on screen ${planted.join(' ')}, in the DOM ${inDom.join(' ')}`);
      assert.notEqual(stops[stops.indexOf('div0') - 1], inDom[inDom.length - 1], 'the last stop before the divider is not the DOM-last one');
      // Out of a row whose last panel on screen has later ones in the DOM the row hands the key to the column, which leaves in the
      // same press; every other step out of or into the column rests on its end, as everywhere the two orders disagree.
      assert.deepEqual(await withEnds(page, stops), [START, ...stops, END]);
      const [forward, backward] = [[START, ...stops], [START, ...stops, END]];
      if (outside) {
        await page.evaluate(PLANT_OUTSIDE);
        await page.focus('#before');
        assert.deepEqual(await tabWalk(page, forward.length + 1), [...forward, 'after']);
        assert.deepEqual(await tabWalk(page, backward.length + 1, true), [...[...backward].reverse(), 'before']);
      } else {
        await page.evaluate(WATCH_ENTRY);
        await focusStop(page, stops[0]!);
        assert.deepEqual(await tabRound(page, forward.length), ring(forward, stops[0]!));
        assert.deepEqual(await tabRound(page, backward.length, true), ring(backward, stops[0]!, true));
      }
    });
  });
}

test('Tab with three spaces side by side, the last one placed first: both dividers are stops, each after the space on its left', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none', async (page) => {
    await until(page, 'c.showSide(ws[1])');
    await until(page, 'c.showSide(ws[2], { at: 0 })');
    await sleep(700);
    assert.deepEqual((await shown(page)).map((x) => x.name), ['Notes', 'Research', 'Trip food']);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    const stops: string[] = await page.evaluate(STOPS);
    assert.deepEqual(stops.filter((x) => !x.includes(':')), ['div0', 'div1']);
    assert.ok(stops.indexOf('w3:root') < stops.indexOf('div0') && stops.indexOf('div0') < stops.indexOf('w1:root') && stops.indexOf('w1:root') < stops.indexOf('div1') && stops.indexOf('div1') < stops.indexOf('w2:root'), stops.join(' '));
    const all = await withEnds(page, stops);
    await page.focus('#before');
    assert.deepEqual(await tabWalk(page, all.length + 1), [...all, 'after']);
    assert.deepEqual(await tabWalk(page, all.length + 1, true), [...[...all].reverse(), 'before']);
  });
});

test('Tab from a cell element, where a step leaves focus: Shift+Tab leaves the column when the cell is the left-most on screen, and Tab goes into the cell', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none', async (page) => {
    await until(page, 'c.showSide(ws[1])');
    await sleep(700);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    const onCell = async (): Promise<void> => {
      await focusStop(page, 'w1:root');
      if ((await shown(page))[0]!.name !== 'Notes') assert.equal(await call(page, 'c.step("down")'), true);
      else await page.evaluate(() => document.querySelector<HTMLElement>('[data-workspace-cell][data-workspace-id="w3"]')!.focus());
      await sleep(900);
      assert.deepEqual((await shown(page)).map((x) => x.name), ['Notes', 'Trip food']);
      assert.equal(await page.evaluate(WHERE), 'w3:CELL', 'the step left focus on the cell it moved to');
    };
    await onCell();
    assert.deepEqual(await tabWalk(page, 1, true), ['before'], 'Notes is on the left: Shift+Tab leaves, and does not go to Trip food, the element before it in the DOM');
    await onCell();
    assert.deepEqual(await tabWalk(page, 1), ['w3:root']);
    // The right-hand cell's own element: Shift+Tab goes to the divider on its left, Tab into the cell.
    const onRight = (): Promise<void> => page.evaluate(() => document.querySelector<HTMLElement>('[data-workspace-cell][data-workspace-id="w2"]')!.focus());
    await onRight();
    assert.deepEqual(await tabWalk(page, 1, true), ['div0']);
    await onRight();
    assert.deepEqual(await tabWalk(page, 1), ['w2:root']);
  });
});

test('focus that no Tab caused stays where it went: a click, a script, and a press on the page with nothing focused', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3', async (page) => {
    assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    await page.click('[data-workspace-id="w2"] [data-tab="p1"]');
    assert.equal(await page.evaluate(WHERE), 'w2:p1');
    assert.equal(await call(page, 'ws[c.current].id'), 'w2', 'and the side clicked in is the current one');
    await page.click('[data-workspace-id="w3"] [data-tab="p2"]');
    assert.equal(await page.evaluate(WHERE), 'w3:p2');
    for (const stop of ['w2:root', 'w3:p1', 'w2:p2']) {
      await focusStop(page, stop);
      assert.equal(await page.evaluate(WHERE), stop, 'a script’s focus stays');
    }
    await page.evaluate(() => document.querySelector<HTMLElement>('[role="separator"]')!.focus());
    assert.equal(await page.evaluate(WHERE), 'div0');
    // After a click the walk goes on from the element clicked, in screen order.
    await page.click('[data-workspace-id="w3"] [data-tab="p2"]');
    const stops: string[] = await page.evaluate(STOPS);
    assert.deepEqual(await tabWalk(page, 2), stops.slice(stops.indexOf('w3:p2') + 1, stops.indexOf('w3:p2') + 3));
  });
});

test('Tab after the page dropped focus (a blur): the walk goes on from where focus was, in screen order, and out of the column at its ends', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none', async (page) => {
    assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    const stops: string[] = await page.evaluate(STOPS);
    const at = stops.indexOf('div0');
    const blurAt = async (stop: string, shift: boolean): Promise<string> => {
      if (stop === 'div0') await page.evaluate(() => document.querySelector<HTMLElement>('[role="separator"]')!.focus());
      else await focusStop(page, stop);
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      assert.equal(await page.evaluate(WHERE), 'BODY', 'nothing holds focus');
      return (await tabWalk(page, 1, shift))[0]!;
    };
    assert.equal(await blurAt('div0', false), stops[at + 1]);
    assert.equal(await blurAt('div0', true), stops[at - 1]);
    assert.equal(await blurAt(stops[at - 1]!, false), 'div0');
    assert.equal(await blurAt(stops[at + 1]!, true), 'div0');
    // Out of the column the browser's own step runs from where focus was, and the column's end is where it lands.
    assert.equal(await blurAt(stops[stops.length - 1]!, false), END);
    assert.equal(await blurAt(stops[0]!, true), START);
  });
});

for (const shift of [false, true]) {
  test(`${shift ? 'Shift+Tab' : 'Tab'} into a page that never held focus comes in at the column's ${shift ? 'end' : 'start'} and goes on to the ${shift ? 'last' : 'first'} stop in screen order`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
      await page.evaluate(PLANT_BUTTONS);
      const stops: string[] = await page.evaluate(STOPS);
      assert.equal(await page.evaluate(WHERE), 'BODY');
      assert.deepEqual(await tabWalk(page, 2, shift), shift ? [END, stops[stops.length - 1]] : [START, stops[0]]);
      assert.ok((shift ? stops[stops.length - 1]! : stops[0]!).startsWith(shift ? 'w2:' : 'w3:'), 'which is in the space drawn at that end, not the one the DOM holds there');
    });
  });
}

test('a column without sideBySide has no stop of the column’s own, and Tab walks its one space as the browser and the row do', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&side=0&bands=none', async (page) => {
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_FRAMES);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-column-sentinel]').length), 0);
    const stops = frameAsOne(await page.evaluate(STOPS));
    await focusStop(page, stops[0]!);
    await page.evaluate(WATCH_ENTRY);
    // The row alone rests on its own end sentinel after the frame, as a cell side by side rests on the cell's end.
    assert.deepEqual(frameAsOne(await tabRound(page, stops.length + 1)), [...stops.slice(1), 'w1:row-end', 'OUT', stops[0]]);
    await page.evaluate(PLANT_OUTSIDE);
    await page.focus('#before');
    assert.deepEqual(await tabUntil(page, 'after', 3 * stops.length), [...stops, 'after']);
    assert.deepEqual(await tabUntil(page, 'before', 3 * stops.length, true), [...[...stops].reverse(), 'before']);
  });
});
