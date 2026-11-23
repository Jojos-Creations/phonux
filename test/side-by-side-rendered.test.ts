/**
 * Spaces side by side in a real browser. jsdom has no layout, so it cannot say where a panel is drawn; these tests build the library's
 * WorkspaceColumn into a page (tools/proof/side-entry.tsx.txt), open it in headless Chromium at a given window size and read every
 * cell, slot and divider off the page: at rest, and on every animation frame while a row scrolls or a divider is dragged.
 *
 * What each check could not pass by accident: a row's offset and a sticky panel's x are read in the same runs where the row that
 * is scrolled is read moving, so "unchanged" is a result and not an absence; a divider drag is shown to leave the split alone
 * when it moves less than half a slot, and to clamp at the least a side keeps; and the cut check is shown firing on the frames in
 * mid-glide, where the window cuts a page by design. Without a browser every test here is skipped loudly (test/support/chromium.ts).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, type LaunchedBrowser } from './support/chromium.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
// The slice of Playwright's Page these tests use, typed loosely: a page is only reached through functions it evaluates.
type Page = any;

interface Rect { left: number; right: number; top: number; bottom: number }
interface Slot extends Rect { id: string; inert: boolean; group: 'start' | 'end' | null; topmost: boolean }
interface Cell extends Rect { id: string; shown: boolean; current: boolean }
interface Shown { id: string; name: string; slots: number; rowSlots: number }

const PITCH = 390 + 16;
let browser: LaunchedBrowser<Page> | undefined;
let server: Server | undefined;
let port = 0;
let dir = '';
let built = false;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'side-rendered-'));
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** Bundles the proof page once and serves it, then launches the browser; false (with the skip said) when there is no Chromium. */
async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'side-by-side-rendered');
  if (browser === undefined) return false;
  if (!built) {
    built = true;
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/side-entry.tsx.txt'), 'utf8'));
    await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT_DIR }, nodePaths: [join(ROOT_DIR, 'node_modules')], logLevel: 'silent' });
    const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
    server = createServer((req, res) => {
      const js = req.url?.startsWith('/out.js') === true;
      res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
      res.end(js ? readFileSync(join(dir, 'out.js')) : html);
    }).listen(0);
    port = (server.address() as { port: number }).port;
  }
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Opens the page at `query` in a window `width` wide, runs `body`, and closes the context. */
async function onPage(width: number, query: string, body: (page: Page, errors: string[]) => Promise<void>): Promise<void> {
  const ctx = await browser!.newContext({ viewport: { width, height: 900 } });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  try {
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => (window as any).__s?.ready(), undefined, { timeout: 20000 });
    await sleep(500);
    await body(page, errors);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await ctx.close();
  }
}

const cells = (page: Page): Promise<Cell[]> => page.evaluate(() => (window as any).__s.cells());
const shown = (page: Page): Promise<Shown[]> => page.evaluate(() => (window as any).__s.shown());
const slots = (page: Page, id: string): Promise<Slot[]> => page.evaluate((i: string) => (window as any).__s.slots(i), id);
const offset = (page: Page, id: string): Promise<number> => page.evaluate((i: string) => (window as any).__s.offset(i), id);
const stripWindow = (page: Page, id: string): Promise<Rect> => page.evaluate((i: string) => (window as any).__s.window(i), id);
const dividers = (page: Page): Promise<(Rect & { now: string; min: string; max: string; text: string })[]> => page.evaluate(() => (window as any).__s.dividers());
const call = (page: Page, body: string): Promise<any> => page.evaluate(`(() => { const c = window.__s.column; const ws = window.__s.column.workspaces; return ${body}; })()`);
const named = (list: Shown[]): string => list.map((s) => `${s.name} ${s.slots}/${s.rowSlots}`).join(', ');

/** The column is measured after the page's first layout; a verb asked before then answers `not-measured`, so ask until it answers. */
async function until(page: Page, body: string): Promise<any> {
  let last: unknown;
  for (let k = 0; k < 100; k += 1) {
    last = await call(page, body);
    if ((last as { ok?: boolean }).ok === true) return last;
    await sleep(50);
  }
  throw new Error(`${body} never answered ok: ${JSON.stringify(last)}`);
}

/** Two spaces side by side: Research, then Trip food taking half of its room, then an even split of the row slots. */
async function twoSides(page: Page, rows: [number, number] = [2, 2]): Promise<void> {
  await until(page, 'c.showSide(ws[1])');
  assert.deepEqual(await call(page, `c.setSplit([${rows.join(',')}])`), { ok: true });
  await sleep(700);
}

/** Waits until every cell's strip has stopped: its drawn scroll holds for 300 ms. */
async function atRest(page: Page, ids: string[]): Promise<void> {
  let last = '';
  let still = 0;
  for (let k = 0; k < 200; k += 1) {
    const now = (await Promise.all(ids.map((id) => offset(page, id)))).join(',');
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 6) return;
    await sleep(50);
  }
  throw new Error('the rows never came to rest');
}

/** Strip pages a cell draws in sight that its window cuts or does not hold: none at rest. */
async function cutPages(page: Page, id: string): Promise<string[]> {
  const [all, win] = await Promise.all([slots(page, id), stripWindow(page, id)]);
  return all.filter((x) => x.group === null && !x.inert && (x.left < win.left - 0.5 || x.right > win.right + 0.5)).map((x) => x.id);
}

/** Records `read()` on every frame for `ms` while `act` runs, so a panel that moves for a single frame is seen. */
async function frames<T>(page: Page, ms: number, read: string, act: () => Promise<void>): Promise<T[]> {
  const pending = page.evaluate(({ span, body }: { span: number; body: string }) => (window as any).__s.sample(span, new Function(`return (${body})`)()), { span: ms, body: `() => { const s = window.__s; return ${read}; }` });
  await sleep(120);
  await act();
  return pending as Promise<T[]>;
}
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

const wholeSlots = (width: number): boolean => Math.abs(((width - 16) / PITCH) - Math.round((width - 16) / PITCH)) < 0.002;

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

// ---------------------------------------------------------------------------
// Tab and Shift+Tab, pressed for real
// ---------------------------------------------------------------------------
// A synthetic keydown has no default action, so only a real press shows where the browser's own step goes after the column's
// handlers ran. Every walk below is read off `document.activeElement` after `page.keyboard.press`.

/** Where focus is: `BODY` when the page holds none, `before` / `after`, `div<k>`, or `<workspace id>:<what>`. */
const WHERE = `(() => {
  const a = document.activeElement;
  if (a === null || a === document.body) return 'BODY';
  if (a.id === 'before' || a.id === 'after') return a.id;
  if (a.getAttribute('role') === 'separator') return 'div' + a.getAttribute('data-column-divider');
  const cell = a.closest('[data-workspace-cell]');
  const c = cell ? cell.dataset.workspaceId : '?';
  if (a.tagName === 'IFRAME') return c + ':frame>' + (a.contentDocument?.activeElement?.id || 'doc');
  return c + ':' + (a.getAttribute('data-tab') ?? a.getAttribute('data-workspace-neighbour') ?? (a.hasAttribute('data-column-sentinel') ? 'column-' + a.getAttribute('data-column-sentinel') : null) ?? (a.hasAttribute('data-row-sentinel') ? 'row-' + a.getAttribute('data-row-sentinel') : null) ?? (a.hasAttribute('data-workspace-cell') ? 'CELL' : a.tagName));
})()`;

/**
 * The stops a walk must make, worked out here and not by the column: for each shown space left to right, every button, input, frame and
 * element with a tab index of its cell that is neither inert nor a sentinel, in the order the cell holds them, then the divider after that space.
 */
const STOPS = `(() => {
  const out = [];
  const shown = window.__s.shown();
  shown.forEach((s, k) => {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    for (const el of cell.querySelectorAll('button,input,iframe,[tabindex]')) {
      if (el.closest('[inert]') !== null || el.tabIndex < 0 || el.hasAttribute('data-column-sentinel') || el.hasAttribute('data-row-sentinel')) continue;
      out.push(s.id + ':' + (el.tagName === 'IFRAME' ? 'frame>inner' : el.getAttribute('data-tab') ?? el.getAttribute('data-workspace-neighbour') ?? el.tagName));
    }
    if (k < shown.length - 1) out.push('div' + k);
  });
  return out;
})()`;

/** A button in every panel of every cell, the ones the row keeps out of sight too; answers how many of them sit in an inert slot of a shown cell. */
const PLANT_BUTTONS = `(() => {
  let inert = 0;
  for (const cell of document.querySelectorAll('[data-workspace-cell]')) {
    for (const box of cell.querySelectorAll('[data-box]')) {
      const b = document.createElement('button');
      b.setAttribute('data-tab', box.getAttribute('data-box'));
      b.textContent = box.getAttribute('data-box');
      box.appendChild(b);
      if (!cell.hasAttribute('inert') && b.closest('[inert]') !== null) inert += 1;
    }
  }
  return inert;
})()`;

/** A real button first and last in the page, outside the column. */
const PLANT_OUTSIDE = `(() => {
  const b = document.createElement('button'); b.id = 'before'; document.body.prepend(b);
  const a = document.createElement('button'); a.id = 'after'; document.body.append(a);
})()`;

/** A frame holding one button as the last thing in the last panel in sight of each shown space, so a cell's last stop is inside a frame. */
const PLANT_FRAMES = `(async () => {
  const loaded = [];
  for (const s of window.__s.shown()) {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]'));
    const f = document.createElement('iframe');
    f.srcdoc = '<button id="inner">inner</button>';
    f.style.cssText = 'width:100px;height:40px';
    loaded.push(new Promise((r) => f.addEventListener('load', r)));
    boxes[boxes.length - 1].appendChild(f);
  }
  await Promise.all(loaded);
})()`;

async function tabWalk(page: Page, n: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  for (let k = 0; k < n; k += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(80);
    out.push(await page.evaluate(WHERE));
  }
  return out;
}

/** A frame is one stop however many presses the row spends in and around it. */
const frameAsOne = (walk: string[]): string[] => walk.map((x) => x.replace(/:frame>.*/, ':frame')).filter((x, k, all) => !(x.endsWith(':frame') && all[k - 1] === x));

/** Presses until focus is on `target`, giving up after `most` presses; the walk with a frame as one stop. */
async function tabUntil(page: Page, target: string, most: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  while (out[out.length - 1] !== target && out.length < most) out.push(...(await tabWalk(page, 1, shift)));
  return frameAsOne(out);
}

/**
 * A walk that goes out of the page and comes in again at its other end. What a browser does between the two is its own: the headless
 * shell rests on the page's body for one press, the full browser sometimes does and sometimes comes straight back in. So `OUT` stands
 * for the step out, whether or not it took a press of its own, and anything else the walk rests on outside the stops fails the comparison.
 * `n` counts the stops reached, a frame as one.
 */
async function tabRound(page: Page, n: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  let was: string = await page.evaluate(WHERE);
  while (frameAsOne(out).filter((x) => x !== 'OUT').length < n) {
    assert.ok(out.length < 3 * n + 3, `the walk never came round: ${out.join(' ')}`);
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(80);
    const now: string = await page.evaluate(WHERE);
    const entered: number = await page.evaluate('window.__entered.splice(0).length');
    if (now === 'BODY') out.push('OUT');
    else {
      if (was !== 'BODY' && entered > 0) out.push('OUT');
      out.push(now);
    }
    was = now;
  }
  return out;
}

/** Counts focus that reaches the page from the browser itself, which a column end sentinel is the first to get. */
const WATCH_ENTRY = `(() => {
  window.__entered = [];
  document.addEventListener('focusin', (e) => { if (e.relatedTarget === null && ['start', 'end'].includes(e.target.getAttribute('data-column-sentinel'))) window.__entered.push(1); }, true);
})()`;

const focusStop = (page: Page, stop: string): Promise<void> =>
  page.evaluate((s: string) => {
    const [id, what] = s.split(':') as [string, string];
    const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${id}"]`)!;
    (cell.querySelector<HTMLElement>(`[data-tab="${what}"]`) ?? cell.querySelector<HTMLElement>(`[data-workspace-neighbour="${what}"]`) ?? cell.querySelector<HTMLElement>(what))!.focus();
  }, stop);

type Order = 'list' | 'stepped' | 'placed-first';

/** Two spaces side by side in the screen order asked for; answers the names left to right. */
async function inOrder(page: Page, order: Order): Promise<string[]> {
  if (order === 'placed-first') await until(page, 'c.showSide(ws[1], { at: 0 })');
  else await until(page, 'c.showSide(ws[1])');
  await sleep(700);
  if (order === 'stepped') {
    assert.equal(await call(page, 'c.step("down")'), true);
    await sleep(900);
  }
  return (await shown(page)).map((s) => s.name);
}
const ON_SCREEN: Record<Order, string[]> = { list: ['Research', 'Trip food'], stepped: ['Notes', 'Trip food'], 'placed-first': ['Trip food', 'Research'] };

for (const order of ['list', 'stepped', 'placed-first'] as const) {
  for (const bands of ['', '&bands=none']) {
    test(`Tab, ${order} order${bands === '' ? '' : ', bands with nothing tabbable'}: the column alone on the page is walked in screen order, left by one press at either end, and entered at the right end from the browser`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, `n=3${bands}`, async (page) => {
        assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
        assert.ok((await page.evaluate(PLANT_BUTTONS)) > 0, 'some planted buttons are in panels the row keeps inert, so a walk that stops at one is seen');
        const stops: string[] = await page.evaluate(STOPS);
        assert.ok(stops.length >= 5 && stops.includes('div0'), `the stops are several and the divider is one: ${stops.join(' ')}`);
        await focusStop(page, stops[0]!);
        assert.equal(await page.evaluate(WHERE), stops[0]);
        await page.evaluate(WATCH_ENTRY);
        // Forward from the first stop: every stop, then out of the page, then in again at the first.
        assert.deepEqual(await tabRound(page, stops.length), [...stops.slice(1), 'OUT', stops[0]]);
        // Backward from the first stop: out of the page, in again at the last, then every stop.
        assert.deepEqual(await tabRound(page, stops.length, true), ['OUT', ...[...stops].reverse()]);
      });
    });

    test(`Tab, ${order} order${bands === '' ? '' : ', bands with nothing tabbable'}: between a button before the column and one after it, each is one press from the column's end`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, `n=3${bands}`, async (page) => {
        assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
        await page.evaluate(PLANT_BUTTONS);
        await page.evaluate(PLANT_OUTSIDE);
        const stops: string[] = await page.evaluate(STOPS);
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
      await page.focus('#before');
      assert.deepEqual(await tabUntil(page, 'after', 3 * stops.length), [...stops, 'after']);
      assert.deepEqual(await tabUntil(page, 'before', 3 * stops.length, true), [...[...stops].reverse(), 'before']);
    });
  });

  test(`Tab, ${order} order, a frame as each space's last stop, the column alone on the page: the step out of the last frame is spent, so focus rests on the cell's end and the next press leaves`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
      await page.evaluate(PLANT_BUTTONS);
      await page.evaluate(PLANT_FRAMES);
      await page.evaluate(WATCH_ENTRY);
      const stops = frameAsOne(await page.evaluate(STOPS));
      const right = (await shown(page))[1]!.id;
      await focusStop(page, stops[0]!);
      assert.deepEqual(frameAsOne(await tabRound(page, stops.length + 1)), [...stops.slice(1), `${right}:column-cell-end`, 'OUT', stops[0]]);
      assert.deepEqual(frameAsOne(await tabRound(page, stops.length, true)), ['OUT', ...[...stops].reverse()]);
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
    await page.focus('#before');
    assert.deepEqual(await tabWalk(page, stops.length + 1), [...stops, 'after']);
    assert.deepEqual(await tabWalk(page, stops.length + 1, true), [...[...stops].reverse(), 'before']);
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
    assert.equal(await blurAt(stops[stops.length - 1]!, false), 'after');
    assert.equal(await blurAt(stops[0]!, true), 'before');
  });
});

for (const shift of [false, true]) {
  test(`${shift ? 'Shift+Tab' : 'Tab'} into a page that never held focus lands on the ${shift ? 'last' : 'first'} stop in screen order`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none', async (page) => {
      assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
      await page.evaluate(PLANT_BUTTONS);
      const stops: string[] = await page.evaluate(STOPS);
      assert.equal(await page.evaluate(WHERE), 'BODY');
      assert.deepEqual(await tabWalk(page, 1, shift), [shift ? stops[stops.length - 1] : stops[0]]);
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
