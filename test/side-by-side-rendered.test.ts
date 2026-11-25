/**
 * Spaces side by side in a real browser. jsdom has no layout, so it cannot say where a panel is drawn; these tests build the library's
 * WorkspaceColumn into a page (tools/proof/side-entry.tsx.txt), open it in headless Chromium at a given window size and read every
 * cell, slot and divider off the page: at rest, and on every animation frame while a row scrolls or a divider is dragged.
 *
 * What each check could not pass by accident: a row's offset and a sticky panel's x are read in the same runs where the row that
 * is scrolled is read moving, so "unchanged" is a result and not an absence; a divider drag is shown to leave the split alone
 * when it moves less than half a slot, and to clamp at the least a side keeps; and the cut check is shown firing on the frames in
 * mid-glide, where the window cuts a page by design. Without a browser every test here is skipped loudly (test/support/chromium.ts).
 * The real-key Tab walks are in the side-by-side-tab-* files, split so each stays well inside the per-file time limit.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, PITCH, ready, sleep, onPage, cells, shown, slots, offset, stripWindow, dividers, call, named, until, twoSides, atRest, cutPages, frames, spread, wholeSlots, type Page, type Cell } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

// ---------------------------------------------------------------------------
// Two spaces at 2560 px, each with a sticky panel
// ---------------------------------------------------------------------------

test('2560 px, two of three spaces side by side with a sticky panel each: slots, places, and no panel cut at rest', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&sticky=1', async (page) => {
    assert.equal((await shown(page)).length, 1, 'one space shows before another is added');
    await until(page, 'c.showSide(ws[1])');
    await sleep(700);
    // The new side takes half of the current space's 5 row slots (6 less its sticky panel): 2 slots, of which its own sticky panel is one.
    assert.equal(named(await shown(page)), 'Research 4/3, Trip food 2/1');
    assert.deepEqual(await call(page, 'c.setSplit([2,2])'), { ok: true });
    await sleep(700);
    assert.equal(named(await shown(page)), 'Research 3/2, Trip food 3/2', 'rows of 2 and a sticky panel each: three slots each');
    await atRest(page, ['w1', 'w2']);

    const all = await cells(page);
    const [a, b, c] = ['w1', 'w2', 'w3'].map((id) => all.find((x) => x.id === id)!) as [Cell, Cell, Cell];
    assert.ok(a.shown && b.shown, 'both cells are in view');
    assert.ok(!c.shown, 'the third space is mounted but out of view, inert');
    // One group centered like a single row: 6 slots' content is 6 * 406 - 16 wide, in a 2560 window.
    assert.ok(Math.abs(a.left - (1280 - (6 * PITCH + 16) / 2)) < 0.5, `the first cell starts where six slots center (${a.left})`);
    assert.ok(Math.abs(a.right - a.left - (3 * PITCH + 16)) < 0.5, `the first cell is three slots and a gap wide (${a.right - a.left})`);
    assert.ok(Math.abs(b.left - (a.left + 3 * PITCH)) < 0.5, 'the second cell starts three slots on, overlapping the first by the gap each row keeps at its ends');

    for (const [id, first] of [['w1', a.left + 16], ['w2', b.left + 16]] as const) {
      const row = await slots(page, id);
      const root = row.find((x) => x.id === 'root')!;
      assert.equal(root.group, 'start', `${id}: History is sticky at the start`);
      assert.ok(Math.abs(root.left - first) < 0.5, `${id}: History stands at its cell's first slot (${root.left})`);
      assert.ok(root.topmost && !root.inert, `${id}: nothing is drawn over it and it is never out of sight`);
      const win = await stripWindow(page, id);
      assert.ok(Math.abs(win.right - win.left - (2 * PITCH - 16)) < 0.5, `${id}: its strip is seen through two slots (${win.right - win.left})`);
      assert.ok(Math.abs(win.left - root.right - 16) < 0.5, `${id}: the strip starts one gap after History`);
      assert.deepEqual(await cutPages(page, id), [], `${id}: no page is cut at rest`);
    }
    // Panels of the two spaces stand one gap apart, as panels of one row do.
    const lastA = (await stripWindow(page, 'w1')).right;
    const firstB = (await slots(page, 'w2')).find((x) => x.id === 'root')!.left;
    assert.ok(Math.abs(firstB - lastA - 16) < 0.5, `the spaces are one gap apart (${firstB - lastA})`);
  });
});

test('a column made without sideBySide shows one space across the window and refuses the verbs', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&sticky=1&side=0', async (page) => {
    const refused = await call(page, 'c.showSide(ws[1])');
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'not-enabled');
    const all = await cells(page);
    assert.equal(all.filter((x) => x.shown).length, 1);
    const only = all.find((x) => x.shown)!;
    assert.equal(only.right - only.left, 2560, 'the cell is the whole window, as it always was');
    assert.equal((await dividers(page)).length, 0, 'and has no divider');
  });
});

// ---------------------------------------------------------------------------
// Scrolling one row
// ---------------------------------------------------------------------------

test('scrolling one row moves neither the other row nor either sticky panel, by key and by wheel', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=2&sticky=1', async (page) => {
    await twoSides(page);
    await atRest(page, ['w1', 'w2']);
    const rootsX = async (): Promise<[number, number]> => [(await slots(page, 'w1')).find((x) => x.id === 'root')!.left, (await slots(page, 'w2')).find((x) => x.id === 'root')!.left];
    const [rootA, rootB] = await rootsX();
    const read = '({ a: s.offset("w1"), b: s.offset("w2"), ra: s.slots("w1").find((x) => x.id === "root").left, rb: s.slots("w2").find((x) => x.id === "root").left, cut: s.slots("w1").filter((x) => x.group === null && !x.inert && (x.left < s.window("w1").left - 0.5 || x.right > s.window("w1").right + 0.5)).length })';

    // Scroll Research by key: press in its strip first, which is what makes it the side that holds focus.
    const winA = await stripWindow(page, 'w1');
    await page.mouse.click((winA.left + winA.right) / 2, 450);
    assert.equal((await cells(page)).find((x) => x.current)!.id, 'w1');
    const keyed = await frames<{ a: number; b: number; ra: number; rb: number; cut: number }>(page, 2400, read, async () => {
      for (let k = 0; k < 2; k += 1) {
        await page.keyboard.press('ArrowRight');
        await sleep(40);
      }
    });
    assert.ok(keyed.some((s) => s.cut > 0), 'control: the cut check does see a page cut on a frame in mid-glide, where the window cuts one by design');
    assert.ok(spread(keyed.map((s) => s.a)) > 300, `Research's row scrolled: its offset spread over the frames is ${spread(keyed.map((s) => s.a))}`);
    assert.ok(spread(keyed.map((s) => s.b)) < 0.01, `Trip food's row did not move: spread ${spread(keyed.map((s) => s.b))}`);
    assert.ok(spread(keyed.map((s) => s.ra)) < 0.01 && spread(keyed.map((s) => s.rb)) < 0.01, 'neither sticky panel moved on any frame');
    await atRest(page, ['w1', 'w2']);
    assert.ok((await offset(page, 'w1')) > 600 && (await offset(page, 'w2')) === 0);
    assert.deepEqual(await rootsX(), [rootA, rootB], 'both sticky panels are where they were at rest');
    assert.deepEqual(await cutPages(page, 'w1'), [], 'no page of Research is cut at rest after the keys');

    // Control: the same keys with focus in Trip food scroll Trip food and leave Research where it stands.
    const winB = await stripWindow(page, 'w2');
    await page.mouse.click((winB.left + winB.right) / 2, 450);
    assert.equal((await cells(page)).find((x) => x.current)!.id, 'w2');
    const was = await offset(page, 'w1');
    const second = await frames<{ a: number; b: number; ra: number; rb: number; cut: number }>(page, 2400, read, async () => {
      for (let k = 0; k < 2; k += 1) {
        await page.keyboard.press('ArrowRight');
        await sleep(40);
      }
    });
    assert.ok(spread(second.map((s) => s.b)) > 300, `control: Trip food's row scrolled (spread ${spread(second.map((s) => s.b))}), so a row that moves is seen moving`);
    assert.ok(spread(second.map((s) => s.a)) < 0.01 && second[0]!.a === was, 'Research stood still while Trip food scrolled');
    await atRest(page, ['w1', 'w2']);
    assert.deepEqual(await rootsX(), [rootA, rootB]);
    assert.deepEqual(await cutPages(page, 'w2'), []);

    // By wheel over Research, the browser's own input: only the row under the pointer moves.
    const before = { a: await offset(page, 'w1'), b: await offset(page, 'w2') };
    await page.mouse.move((winA.left + winA.right) / 2, 450);
    const wheeled = await frames<{ a: number; b: number; ra: number; rb: number; cut: number }>(page, 2400, read, async () => {
      for (let k = 0; k < 3; k += 1) {
        await page.mouse.wheel(260, 0);
        await sleep(90);
      }
    });
    await atRest(page, ['w1', 'w2']);
    assert.ok((await offset(page, 'w1')) !== before.a, 'the wheel moved Research');
    assert.equal(await offset(page, 'w2'), before.b, 'and not Trip food');
    assert.ok(spread(wheeled.map((s) => s.rb)) < 0.01 && spread(wheeled.map((s) => s.ra)) < 0.01, 'no sticky panel moved under the wheel');
  });
});

// ---------------------------------------------------------------------------
// The divider
// ---------------------------------------------------------------------------

test('a divider drag changes the split by whole slots, clamps at one row panel a side, and leaves nothing cut', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=2&sticky=1', async (page) => {
    await twoSides(page);
    await atRest(page, ['w1', 'w2']);
    const [bar] = await dividers(page);
    assert.ok(bar, 'a divider stands between the two cells');
    assert.equal(bar!.now, '2');
    assert.equal(bar!.min, '1');
    assert.equal(bar!.max, '3', 'the left side may take 3 of the 4 row slots: the right keeps one');
    assert.equal(bar!.text, 'Research 2 panels, Trip food 2 panels');
    const x = (bar!.left + bar!.right) / 2;
    assert.ok(Math.abs(x - 1280) < 1, `the divider stands in the gap between the cells (${x})`);

    const widths = `s.cells().filter((c) => c.shown).map((c) => c.right - c.left)`;
    // Less than half a slot: the split does not move, and every frame the cells are whole slots wide.
    await page.mouse.move(x, 450);
    await page.mouse.down();
    await page.mouse.move(x + 0.35 * PITCH, 450, { steps: 6 });
    assert.equal(named(await shown(page)), 'Research 3/2, Trip food 3/2', 'a drag of a third of a slot leaves the split alone');
    // More than half: one slot moves from Trip food to Research, and the divider follows to the next slot line.
    const dragged = await frames<number[]>(page, 1500, widths, async () => {
      await page.mouse.move(x + 0.7 * PITCH, 450, { steps: 8 });
      await sleep(200);
    });
    await page.mouse.up();
    assert.ok(dragged.every((w) => w.every(wholeSlots)), 'on every frame of the drag each cell is a whole number of slots and a gap wide');
    assert.ok(dragged.some((w) => w[0] !== dragged[0]![0]), 'control: the widths do change during the drag, so the check above could have seen a fraction');
    assert.equal(named(await shown(page)), 'Research 4/3, Trip food 2/1');
    await sleep(700);
    await atRest(page, ['w1', 'w2']);
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: no page is cut at rest after the drag`);
    const [moved] = await dividers(page);
    assert.ok(Math.abs((moved!.left + moved!.right) / 2 - (1280 + PITCH)) < 1, `the divider stands one slot to the right (${(moved!.left + moved!.right) / 2})`);
    for (const id of ['w1', 'w2']) assert.equal((await slots(page, id)).find((s) => s.id === 'root')!.group, 'start', `${id}: its sticky panel is still at the start`);
    const win1 = await stripWindow(page, 'w1');
    const win2 = await stripWindow(page, 'w2');
    assert.ok(Math.abs(win1.right - win1.left - (3 * PITCH - 16)) < 0.5, 'Research now shows three slots of its row');
    assert.ok(Math.abs(win2.right - win2.left - 390) < 0.5, 'Trip food one');

    // Far to the right: Trip food keeps its one row panel (and its sticky panel), so Research cannot take more.
    const y = 450;
    const [bar2] = await dividers(page);
    const x2 = (bar2!.left + bar2!.right) / 2;
    await page.mouse.move(x2, y);
    await page.mouse.down();
    await page.mouse.move(x2 + 1500, y, { steps: 12 });
    await page.mouse.up();
    await sleep(700);
    assert.equal(named(await shown(page)), 'Research 4/3, Trip food 2/1', 'a drag past the minimum stops there');
    // Far to the left: Research keeps one row panel.
    const [bar3] = await dividers(page);
    const x3 = (bar3!.left + bar3!.right) / 2;
    await page.mouse.move(x3, y);
    await page.mouse.down();
    await page.mouse.move(x3 - 2400, y, { steps: 16 });
    await page.mouse.up();
    await sleep(700);
    await atRest(page, ['w1', 'w2']);
    assert.equal(named(await shown(page)), 'Research 2/1, Trip food 4/3');
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: no page is cut at rest at the other end`);
    const [last] = await dividers(page);
    assert.equal(last!.now, '1');
    assert.equal(last!.text, 'Research 1 panel, Trip food 3 panels');
  });
});

// ---------------------------------------------------------------------------
// One dot bar per space
// ---------------------------------------------------------------------------

test('every shown space has its own dot bar under its row, inside its own cell', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&sticky=1&wrap=1', async (page) => {
    await twoSides(page);
    await atRest(page, ['w1', 'w2']);
    const bars = await page.evaluate(() => (window as any).__s.dots());
    const live = bars.filter((x: { inert: boolean }) => !x.inert);
    assert.equal(live.length, 2, 'two dot bars are in view, one per shown space');
    assert.deepEqual(live.map((x: { cell: string }) => x.cell).sort(), ['w1', 'w2']);
    const all = await cells(page);
    for (const bar of live) {
      const cell = all.find((x) => x.id === bar.cell)!;
      assert.ok(bar.left >= cell.left - 0.5 && bar.right <= cell.right + 0.5, `${bar.cell}: its bar lies inside its own cell`);
    }
    assert.ok(live[0].right <= live[1].left, 'and the two bars do not overlap');
    // Control: the space out of view has a bar too, mounted and inert, so counting every bar would say three.
    assert.equal(bars.length, 3);
  });
});

// ---------------------------------------------------------------------------
// The window narrows and widens
// ---------------------------------------------------------------------------

test('narrowing: sticky panels go back into their rows first, then the side the person is not in gives up a slot, then the current one; widening restores', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&sticky=1', async (page) => {
    await twoSides(page);
    const grouped = async (id: string): Promise<string[]> => (await slots(page, id)).filter((x) => x.group !== null).map((x) => x.id);
    const settle = async (width: number): Promise<void> => {
      await page.setViewportSize({ width, height: 900 });
      await sleep(1000);
      await atRest(page, (await cells(page)).filter((c) => c.shown).map((c) => c.id));
    };
    assert.equal(named(await shown(page)), 'Research 3/2, Trip food 3/2');

    // 2240 px is five slots: the six the split asks for do not fit, so a sticky panel goes back, and of equal rank the later one in the column.
    await settle(2240);
    assert.equal(named(await shown(page)), 'Research 3/2, Trip food 2/2');
    assert.deepEqual(await grouped('w1'), ['root'], 'Research keeps its sticky panel');
    assert.deepEqual(await grouped('w2'), [], 'Trip food gave its sticky panel back to its row');
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: nothing cut at five slots`);

    // 2000 px is four: Research gives its sticky panel back as well, and each row keeps the two slots it was given.
    await settle(2000);
    assert.equal(named(await shown(page)), 'Research 2/2, Trip food 2/2');
    assert.deepEqual([await grouped('w1'), await grouped('w2')], [[], []]);
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: nothing cut at four slots`);

    // 1280 px is three: with no sticky panel left, the side the person is not in gives up the slot.
    await settle(1280);
    assert.equal(named(await shown(page)), 'Research 2/2, Trip food 1/1');
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: nothing cut at three slots`);

    // One slot: only the current space shows, and it is the whole window.
    await settle(390);
    assert.equal(named(await shown(page)), 'Research 1/1');
    assert.equal((await cells(page)).filter((c) => c.shown).length, 1);
    assert.equal((await dividers(page)).length, 0);

    // Widening brings the saved list and split back.
    await settle(2560);
    assert.equal(named(await shown(page)), 'Research 3/2, Trip food 3/2');
    assert.deepEqual([await grouped('w1'), await grouped('w2')], [['root'], ['root']], 'and both sticky panels are sticky again');
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: nothing cut once the window is wide again`);
  });
});

test('narrowing a split whose current side is the wider: the other side gives up its slots first, the current one only after', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3', async (page) => {
    await twoSides(page, [4, 2]);
    const settle = async (width: number): Promise<void> => {
      await page.setViewportSize({ width, height: 900 });
      await sleep(1000);
      await atRest(page, (await cells(page)).filter((c) => c.shown).map((c) => c.id));
    };
    assert.equal(named(await shown(page)), 'Research 4/4, Trip food 2/2');
    await settle(2240);
    assert.equal(named(await shown(page)), 'Research 4/4, Trip food 1/1', 'five slots: Trip food gives one up, though Research is the wider');
    await settle(1920);
    assert.equal(named(await shown(page)), 'Research 3/3, Trip food 1/1', 'four slots: only now the current side gives one up');
    for (const id of ['w1', 'w2']) assert.deepEqual(await cutPages(page, id), [], `${id}: nothing cut`);
    await settle(2560);
    assert.equal(named(await shown(page)), 'Research 4/4, Trip food 2/2', 'and widening restores the split');
  });
});

// ---------------------------------------------------------------------------
// A cell never moves in the DOM
// ---------------------------------------------------------------------------

/** Plants an iframe that counts its loads and carries a mark in its window, and a box scrolled to 300, in every cell. */
async function plant(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const cell of document.querySelectorAll<HTMLElement>('[data-workspace-cell]')) {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-plant', '');
      wrap.style.cssText = 'position:absolute;top:0;left:0;width:120px;height:60px;pointer-events:none;';
      const frame = document.createElement('iframe');
      frame.srcdoc = '<p>plant</p>';
      frame.style.cssText = 'width:60px;height:60px;border:0;';
      const loads = { n: 0 };
      (frame as any).__loads = loads;
      frame.addEventListener('load', () => {
        loads.n += 1;
        if (loads.n === 1) (frame.contentWindow as any).__mark = true;
      });
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:60px;top:0;width:60px;height:60px;overflow:auto;';
      box.innerHTML = '<div style="height:1000px"></div>';
      wrap.append(frame, box);
      cell.append(wrap);
      box.scrollTop = 300;
    }
  });
  await sleep(300);
}
/** Per cell: how many times its frame loaded, whether the mark set in its window is still there, and how far its box is scrolled. */
const planted = (page: Page): Promise<Record<string, { loads: number; mark: boolean; scrollTop: number }>> =>
  page.evaluate(() => {
    const out: Record<string, { loads: number; mark: boolean; scrollTop: number }> = {};
    for (const cell of document.querySelectorAll<HTMLElement>('[data-workspace-cell]')) {
      const frame = cell.querySelector<HTMLIFrameElement>('[data-plant] iframe')!;
      out[cell.dataset.workspaceId!] = { loads: (frame as any).__loads.n, mark: (frame.contentWindow as any)?.__mark === true, scrollTop: cell.querySelector<HTMLElement>('[data-plant] div')!.scrollTop };
    }
    return out;
  });

test('no cell moves in the DOM: a frame and a scrolled box in every cell survive a step, a space shown at the left, and a resize to one slot and back', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3', async (page) => {
    await until(page, 'c.showSide(ws[1])');
    await sleep(700);
    await plant(page);
    const whole = { loads: 1, mark: true, scrollTop: 300 };
    const unchanged = async (what: string): Promise<void> => {
      await sleep(600);
      assert.deepEqual(await planted(page), { w1: whole, w2: whole, w3: whole }, what);
    };
    await unchanged('before anything moves');
    assert.equal(await call(page, 'c.step("down")'), true);
    await unchanged('after step("down"): Notes takes the left, Trip food stays on the right');
    assert.deepEqual((await shown(page)).map((x) => x.name), ['Notes', 'Trip food']);
    await until(page, 'c.showSide(ws[0], { at: 0 })');
    await unchanged('after Research is shown at the left');
    assert.deepEqual((await shown(page)).map((x) => x.name), ['Research', 'Notes', 'Trip food']);
    await page.setViewportSize({ width: 390, height: 900 });
    await unchanged('after the window narrows to one slot');
    await page.setViewportSize({ width: 2560, height: 900 });
    await unchanged('and widens again');
    // Control: moving a cell in the DOM does reload its frame and reset its scroll, so the checks above can see a move.
    await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('[data-workspace-cell][data-workspace-id="w1"]')!;
      cell.parentElement!.append(cell);
    });
    await sleep(600);
    const after = await planted(page);
    assert.equal(after.w1!.loads, 2, 'a cell moved by hand reloads its frame');
    assert.equal(after.w1!.mark, false);
    assert.equal(after.w1!.scrollTop, 0);
  });
});
