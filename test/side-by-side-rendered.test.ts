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
 * element with a tab index of its cell that is neither inert nor a sentinel, then the divider after that space. Inside a cell they go
 * as the cell holds them, but the panels of its row left to right as they are drawn, which a reorder makes unlike the DOM's order.
 */
const stopsScript = (numbered: boolean): string => `(() => {
  const out = [];
  const tag = (el) => (${numbered} ? '#' + window.__number(el) : '');
  const shown = window.__s.shown();
  shown.forEach((s, k) => {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const found = [];
    let inRow = false;
    for (const el of cell.querySelectorAll('button,input,iframe,summary,[tabindex]')) {
      if (el.closest('[inert]') !== null || el.tabIndex < 0 || !el.checkVisibility() || el.hasAttribute('data-column-sentinel') || el.hasAttribute('data-row-sentinel')) continue;
      const slot = el.closest('[data-row-slot]');
      inRow = inRow || slot !== null;
      const x = slot !== null ? slot.getBoundingClientRect().left : inRow ? Infinity : -Infinity;
      found.push({ x, at: found.length, name: s.id + ':' + (el.tagName === 'IFRAME' ? 'frame>inner' : el.getAttribute('data-tab') ?? el.getAttribute('data-workspace-neighbour') ?? el.tagName) + tag(el) });
    }
    found.sort((a, b) => (a.x === b.x ? a.at - b.at : a.x < b.x ? -1 : 1));
    out.push(...found.map((f) => f.name));
    if (k < shown.length - 1) out.push('div' + k + tag(document.querySelector('[data-column-divider="' + k + '"]')));
  });
  return out;
})()`;
const STOPS = stopsScript(false);

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
  await page.evaluate('window.__entered.splice(0)');
  while (frameAsOne(out).filter((x) => x !== 'OUT').length < n) {
    assert.ok(out.length < 3 * n + 3, `the walk never came round: ${out.join(' ')}`);
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(80);
    const now: string = await page.evaluate(WHERE);
    const entered: number = await page.evaluate('window.__entered.splice(0).length');
    if (now === 'BODY') out.push('OUT');
    else {
      // A step out of a frame has no source either, and stays in the page.
      if (was !== 'BODY' && !was.includes(':frame') && entered > 0) out.push('OUT');
      out.push(now);
    }
    was = now;
  }
  return out;
}

/** Counts focus that reaches the page with no element it came from: from the browser itself, when the page held focus just before. */
const WATCH_ENTRY = `(() => {
  window.__entered = [];
  document.addEventListener('focusin', (e) => { if (e.relatedTarget === null) window.__entered.push(1); }, true);
})()`;

const START = '?:column-start';
const END = '?:column-end';

/**
 * The stops with the column's own ends among them. Where the space drawn first (last) is not the first (last) shown one in the DOM,
 * the browser's step into or out of the column lands on the column's start (end) and rests there for one press; where the two orders
 * agree the column has no stop of its own at that end. Worked out here from the cells and not from the sentinels.
 */
async function withEnds(page: Page, stops: string[]): Promise<string[]> {
  const [start, end]: [boolean, boolean] = await page.evaluate(() => {
    const dom = [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')].map((c) => c.dataset.workspaceId);
    const screen = (window as any).__s.shown().map((x: { id: string }) => x.id);
    return [dom[0] !== screen[0], dom[dom.length - 1] !== screen[screen.length - 1]] as [boolean, boolean];
  });
  return [...(start ? [START] : []), ...stops, ...(end ? [END] : [])];
}

/** What a walk round the page from `from` passes, ending on `from` again: every stop of `all`, and the step out of the page between its two ends. */
function ring(all: string[], from: string, back = false): string[] {
  const seq = back ? [...all].reverse() : all;
  // Two stops can share a name (a summary at each end of a cell): `from` is the first of them in screen order.
  const at = back ? seq.lastIndexOf(from) : seq.indexOf(from);
  return [...seq.slice(at + 1), 'OUT', ...seq.slice(0, at + 1)];
}

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

// ---------------------------------------------------------------------------
// Content that is in the DOM and not drawn
// ---------------------------------------------------------------------------

const UNDRAWN: Record<string, string> = {
  'a hidden panel': '<div role="tabpanel" hidden><button data-tab="undrawn">x</button></div>',
  'a closed dialog': '<dialog><button data-tab="undrawn">x</button></dialog>',
  // The button is before the summary at a cell's start and after it at its end, so it is the cell's outermost element either way.
  'a closed details': '<details>@first<summary data-tab="summary">s</summary>@last</details>',
};

/** Puts `html` first in the first panel and last in the last panel in sight of each shown space: the two ends of what the cell holds. */
const plantUndrawn = (page: Page, html: string): Promise<number> =>
  page.evaluate((markup: string) => {
    const button = '<button data-tab="undrawn">x</button>';
    let count = 0;
    for (const s of (window as any).__s.shown()) {
      const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${s.id}"]`)!;
      const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      boxes[0]!.insertAdjacentHTML('afterbegin', markup.replace('@first', button).replace('@last', ''));
      boxes[boxes.length - 1]!.insertAdjacentHTML('beforeend', markup.replace('@first', '').replace('@last', button));
      const all = [...cell.querySelectorAll<HTMLElement>('button,summary')].filter((el) => el.closest('[inert]') === null);
      if (all[0]!.dataset.tab === 'undrawn' && all[all.length - 1]!.dataset.tab === 'undrawn') count += 1;
    }
    return count;
  }, html);

for (const [what, html] of Object.entries(UNDRAWN)) {
  for (const outside of [true, false]) {
    test(`Tab past ${what} at both ends of each space, ${outside ? 'between two buttons' : 'the column alone'}: a button that is not drawn is no stop, and no press is spent on it`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, 'n=3&bands=none', async (page) => {
        assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
        await page.evaluate(PLANT_BUTTONS);
        assert.equal(await plantUndrawn(page, html), 2, 'in both shown cells the outermost buttons are the ones not drawn');
        const stops: string[] = await page.evaluate(STOPS);
        assert.ok(!stops.some((x) => x.endsWith(':undrawn')) && stops.length >= 5, stops.join(' '));
        const all = await withEnds(page, stops);
        if (outside) {
          await page.evaluate(PLANT_OUTSIDE);
          await page.focus('#before');
          assert.deepEqual(await tabWalk(page, all.length + 1), [...all, 'after']);
          assert.deepEqual(await tabWalk(page, all.length + 1, true), [...[...all].reverse(), 'before']);
          await page.focus('#after');
          assert.deepEqual(await tabWalk(page, 3, true), [END, stops[stops.length - 1], stops[stops.length - 2]], 'Shift+Tab from after the column comes into it');
        } else {
          await page.evaluate(WATCH_ENTRY);
          await focusStop(page, stops[0]!);
          assert.deepEqual(await tabRound(page, all.length), ring(all, stops[0]!));
          assert.deepEqual(await tabRound(page, all.length, true), ring(all, stops[0]!, true));
        }
      });
    });
  }
}

// Undrawn content that still has a box ends a panel that is drawn before another one: the row must not take it for that panel's last
// stop, or the Tab on the real last stop is never handed over and the panel drawn after it is passed by.
const UNDRAWN_WITH_A_BOX: Record<string, string> = {
  'a closed details': UNDRAWN['a closed details']!,
  'content kept unrendered': '<div style="content-visibility:hidden">@first@last</div>',
};
for (const [what, html] of Object.entries(UNDRAWN_WITH_A_BOX)) {
  test(`Tab past ${what} ending a page that is not the last one drawn, rows reordered: the page drawn after it is still walked, both ways`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none&slots=1,1,1', async (page) => {
      await until(page, 'c.showSide(ws[1])');
      await sleep(700);
      assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true]);
      await sleep(900);
      await page.evaluate(PLANT_BUTTONS);
      assert.equal(await plantUndrawn(page, html), 2, 'in both shown cells the outermost buttons in the DOM are the ones not drawn');
      const stops: string[] = await page.evaluate(STOPS);
      assert.ok(!stops.some((x) => x.endsWith(':undrawn')) && stops.length >= 13, stops.join(' '));
      const drawnLast = stops[stops.indexOf('div0') - 1]!;
      const domLast: string = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-workspace-id="w1"] [data-row-slot] [data-box] > [data-tab]')].filter((x) => x.closest('[inert]') === null).pop()!.dataset.tab!);
      assert.notEqual(drawnLast, `w1:${domLast}`, 'the page that holds the undrawn button is not the one drawn last');
      await page.evaluate(PLANT_OUTSIDE);
      await page.focus('#before');
      assert.deepEqual(await tabWalk(page, stops.length + 1), [...stops, 'after']);
      assert.deepEqual(await tabWalk(page, stops.length + 1, true), [...[...stops].reverse(), 'before']);
    });
  });
}

// ---------------------------------------------------------------------------
// Controls the document's own queries do not see: shadow roots
// ---------------------------------------------------------------------------

/** Where focus is, read through shadow roots (a closed one is kept on its host as `__root` by the test that made it). */
const WHERE_DEEP = `(() => {
  let a = document.activeElement;
  if (a === null || a === document.body) return 'BODY';
  if (a.id === 'before' || a.id === 'after') return a.id;
  if (a.getAttribute('role') === 'separator') return 'div' + a.getAttribute('data-column-divider');
  const c = a.closest('[data-workspace-cell]')?.dataset.workspaceId ?? '?';
  for (;;) {
    const inner = (a.shadowRoot ?? a.__root)?.activeElement;
    if (!inner) break;
    a = inner;
  }
  if (a.tagName === 'IFRAME') return c + ':' + a.getAttribute('data-tab') + '>' + (a.contentDocument?.activeElement?.id || 'doc');
  return c + ':' + (a.getAttribute('data-tab') ?? (a.hasAttribute('data-column-sentinel') ? 'column-' + a.getAttribute('data-column-sentinel') : null) ?? a.tagName);
})()`;

/** What a component holds, by kind: the markup of its shadow root (`@` stands for the host's tag, `A.` or `Z.`) and its stops in order. */
const COMPONENTS: Record<string, { mode: 'open' | 'closed'; html: string; inner?: string; stops: string[] }> = {
  'an open shadow root': { mode: 'open', html: '<button data-tab="@s1">1</button><button data-tab="@s2">2</button><button data-tab="@s3">3</button>', stops: ['s1', 's2', 's3'] },
  'a shadow root inside a shadow root': { mode: 'open', html: '<button data-tab="@n1">1</button><x-inner></x-inner><button data-tab="@n4">4</button>', inner: '<button data-tab="@n2">2</button><button data-tab="@n3">3</button>', stops: ['n1', 'n2', 'n3', 'n4'] },
  'a frame inside a shadow root': { mode: 'open', html: '<button data-tab="@f1">1</button><iframe data-tab="@fr" srcdoc="<button id=inner>i</button>" style="width:60px;height:30px"></iframe><button data-tab="@f2">2</button>', stops: ['f1', 'fr>inner', 'f2'] },
  'a closed shadow root': { mode: 'closed', html: '<button data-tab="@c1">1</button><button data-tab="@c2">2</button><button data-tab="@c3">3</button>', stops: ['c1', 'c2', 'c3'] },
};

/** A component first in the first panel (`A.`) and last in the last panel in sight (`Z.`) of each shown space. */
const plantComponents = (page: Page, spec: { mode: string; html: string; inner?: string }): Promise<void> =>
  page.evaluate(async (c: { mode: 'open' | 'closed'; html: string; inner?: string }) => {
    for (const s of (window as any).__s.shown()) {
      const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${s.id}"]`)!;
      const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      for (const tag of ['A.', 'Z.']) {
        const host = document.createElement('x-host');
        host.setAttribute('data-host', tag);
        const root = host.attachShadow({ mode: c.mode });
        root.innerHTML = c.html.replaceAll('@', tag);
        if (c.inner !== undefined) root.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML = c.inner.replaceAll('@', tag);
        (host as any).__root = root;
        if (tag === 'A.') boxes[0]!.prepend(host);
        else boxes[boxes.length - 1]!.append(host);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }, spec);

/** Focuses the component's first (`last`: last) own control, by script, as a click on it would. */
const focusInComponent = (page: Page, cell: string, tag: string, last: boolean): Promise<void> =>
  page.evaluate(([c, t, l]: [string, string, boolean]) => {
    const root = (document.querySelector(`[data-workspace-id="${c}"] [data-host="${t}"]`) as any).__root as ShadowRoot;
    const deep = [...root.querySelectorAll<HTMLElement>('button,x-inner')].flatMap((el) => (el.localName === 'x-inner' ? [...el.shadowRoot!.querySelectorAll<HTMLElement>('button')] : [el]));
    deep[l ? deep.length - 1 : 0]!.focus();
  }, [cell, tag, last] as [string, string, boolean]);

for (const [what, spec] of Object.entries(COMPONENTS)) {
  for (const outside of [true, false]) {
    test(`Tab inside ${what} at either end of a space, ${outside ? 'between two buttons' : 'the column alone'}: every control of the component is walked before focus leaves the space`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, 'n=3&bands=none', async (page) => {
        assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
        await page.evaluate(PLANT_BUTTONS);
        const base: string[] = await page.evaluate(STOPS);
        await plantComponents(page, spec);
        if (outside) await page.evaluate(PLANT_OUTSIDE);
        const at = base.indexOf('div0');
        const sides = { w3: base.slice(0, at), w2: base.slice(at + 1) };
        // Presses from inside a component, with the page's body dropped: what a browser rests on outside the page is its own.
        const from = async (cell: string, tag: string, shift: boolean, n: number): Promise<string[]> => {
          await focusInComponent(page, cell, tag, shift);
          const start: string = await page.evaluate(WHERE_DEEP);
          assert.equal(start, `${cell}:${tag}${spec.stops[shift ? spec.stops.length - 1 : 0]!.split('>')[0]}`, 'focus starts inside the component');
          const out: string[] = [];
          for (let k = 0; k < n + 2 && out.length < n; k += 1) {
            await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
            await sleep(80);
            const now: string = await page.evaluate(WHERE_DEEP);
            if (now !== 'BODY') out.push(now);
          }
          return out;
        };
        const rest = (cell: string, tag: string, shift: boolean): string[] => (shift ? [...spec.stops].reverse() : spec.stops).slice(1).map((x) => `${cell}:${tag}${x}`);
        const check = async (cell: 'w3' | 'w2', tag: string, shift: boolean, after: string[]): Promise<void> => {
          const want = [...rest(cell, tag, shift), ...after];
          assert.deepEqual(await from(cell, tag, shift, want.length), want, `${shift ? 'Shift+Tab' : 'Tab'} from ${cell} ${tag}`);
        };
        // The component at a space's end: Tab walks it, then leaves the space. Notes is on the left, Trip food on the right.
        // Into a space the browser steps by itself, so it comes in at the component, which a selector over the page would not find.
        await check('w3', 'Z.', false, ['div0', `w2:A.${spec.stops[0]}`]);
        await check('w2', 'Z.', false, [END, outside ? 'after' : START]);
        await check('w3', 'Z.', true, [sides.w3[sides.w3.length - 1]!]);
        await check('w2', 'Z.', true, [sides.w2[sides.w2.length - 1]!]);
        // The component at a space's start: Shift+Tab walks it, then leaves the space.
        await check('w2', 'A.', true, ['div0', `w3:Z.${spec.stops[spec.stops.length - 1]}`]);
        await check('w3', 'A.', true, [START, outside ? 'before' : END]);
        await check('w3', 'A.', false, [sides.w3[0]!]);
        await check('w2', 'A.', false, [sides.w2[0]!]);
      });
    });
  }
}

test('Tab through a group of radio buttons, editable text and a scrolling box at a space’s end: each is walked as the browser walks it before focus leaves the space', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none', async (page) => {
    assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    const base: string[] = await page.evaluate(STOPS);
    const first = base[base.indexOf('div0') + 1]!;
    const plant = (html: string): Promise<void> =>
      page.evaluate((markup: string) => {
        document.querySelectorAll('[data-planted]').forEach((el) => void el.remove());
        const boxes = [...document.querySelectorAll('[data-workspace-id="w3"] [data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
        boxes[boxes.length - 1]!.insertAdjacentHTML('beforeend', `<div data-planted="">${markup}</div>`);
        document.querySelector<HTMLElement>('[data-planted] [data-tab]')!.focus();
      }, html);
    const walk = async (n: number): Promise<string[]> => {
      const out: string[] = [];
      for (let k = 0; k < n; k += 1) {
        await page.keyboard.press('Tab');
        await sleep(80);
        out.push(await page.evaluate(WHERE_DEEP));
      }
      return out;
    };
    await plant('<div contenteditable="plaintext-only" data-tab="e1">e</div><div contenteditable="plaintext-only" data-tab="e2">e</div>');
    assert.deepEqual(await walk(3), ['w3:e2', 'div0', first], 'editable text is a stop although its tabIndex property says -1');
    await plant('<input type="radio" name="one" data-tab="r1"><input type="radio" name="one" data-tab="r2" checked><input type="radio" name="one" data-tab="r3">');
    assert.deepEqual(await walk(2), ['w3:r2', 'div0'], 'from an unchecked radio button Tab goes to the checked one of its group, and from there out');
    await plant('<input type="radio" name="none" data-tab="r1"><input type="radio" name="none" data-tab="r2">');
    assert.deepEqual(await walk(1), ['div0'], 'a group with none checked is one stop');
    await plant('<div data-tab="sc1" style="height:30px;width:80px;overflow:auto"><div style="height:300px">t</div></div><div data-tab="sc2" style="height:30px;width:80px;overflow:auto"><div style="height:300px">t</div></div>');
    assert.deepEqual(await walk(2), ['w3:sc2', 'div0'], 'a box that scrolls and holds nothing focusable is a stop of the browser’s own');
    await page.evaluate(() => {
      document.querySelectorAll('[data-planted]').forEach((el) => void el.remove());
      const boxes = [...document.querySelectorAll('[data-workspace-id="w3"] [data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      const wrap = document.createElement('div');
      wrap.setAttribute('data-planted', '');
      for (const mode of ['open', 'closed'] as const) {
        const host = wrap.appendChild(document.createElement('x-host'));
        const root = host.attachShadow({ mode });
        root.innerHTML = `<button data-tab="${mode}">b</button>`;
        (host as any).__root = root;
      }
      boxes[boxes.length - 1]!.append(wrap);
      wrap.querySelector('x-host')!.shadowRoot!.querySelector('button')!.focus();
    });
    assert.deepEqual(await walk(2), ['w3:closed', 'div0'], 'a root the column cannot read, after the control that has focus, is stepped into and not over');
  });
});

// ---------------------------------------------------------------------------
// Controls with stops of their own inside, which no script can list: media players, date fields
// ---------------------------------------------------------------------------

/** Gives every planted player something to play, so it shows all its controls: a second of silence, a canvas for a picture. */
const FEED_MEDIA = `(async () => {
  for (const a of document.querySelectorAll('audio[data-tab]')) {
    const n = 8000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    a.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  for (const v of document.querySelectorAll('video[data-tab]')) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32; c.getContext('2d').fillRect(0, 0, 64, 32);
    v.srcObject = c.captureStream(5);
  }
  await new Promise((r) => setTimeout(r, 600));
})()`;

/** Markup whose stops only the browser knows; `@` stands for the copy's tag, `A.` at a cell's start or `Z.` at its end. */
const INNER_STOPS: Record<string, string> = {
  'an audio player': '<audio controls data-tab="@audio"></audio>',
  'a video player': '<video controls muted data-tab="@video" style="width:240px;height:120px"></video>',
  'date and time fields': '<input type="date" data-tab="@date"><input type="time" data-tab="@time">',
  'form controls and an open details': '<select data-tab="@select"><option>o</option></select><textarea data-tab="@text"></textarea><input type="range" data-tab="@range"><input type="number" data-tab="@number"><input type="color" data-tab="@color"><details open><summary data-tab="@summary">s</summary><button data-tab="@inside">b</button></details>',
};

/** What the browser itself stops at in `html` between two buttons, on a page that holds nothing else: forward, and backward. */
async function nativeStops(page: Page, html: string): Promise<[string[], string[]]> {
  const bare = await page.context().newPage();
  try {
    await bare.setContent(`<button data-tab="first">a</button>${html.replaceAll('@', '')}<button data-tab="last">z</button>`);
    await bare.evaluate(FEED_MEDIA);
    const walk = async (from: string, to: string, key: string): Promise<string[]> => {
      await bare.focus(`[data-tab="${from}"]`);
      const out: string[] = [];
      while (out[out.length - 1] !== to && out.length < 40) {
        await bare.keyboard.press(key);
        await sleep(60);
        out.push(await bare.evaluate(() => document.activeElement?.getAttribute('data-tab') ?? 'none'));
      }
      assert.equal(out.pop(), to, `the walk on the bare page reaches its end: ${out.join(' ')}`);
      return out;
    };
    return [await walk('first', 'last', 'Tab'), await walk('last', 'first', 'Shift+Tab')];
  } finally {
    await bare.close();
  }
}

for (const [what, html] of Object.entries(INNER_STOPS)) {
  for (const order of ['list', 'stepped'] as const) {
    for (const outside of [true, false]) {
      test(`Tab through ${what} at the start and at the end of each space, ${order} order, ${outside ? 'between two buttons' : 'the column alone'}: every stop the browser makes in it on a bare page it makes here, both ways`, async (t) => {
        if (!(await ready(t))) return;
        await onPage(2560, 'n=3&bands=none', async (page) => {
          assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
          const [forward, backward] = await nativeStops(page, html);
          assert.ok(forward.length >= 2 && backward.length === forward.length, `the browser stops more than once: ${forward.join(' ')}`);
          if (html.includes('<audio') || html.includes('<video')) assert.ok(forward.length >= 4 && new Set(forward).size === 1, `all of them inside the one player: ${forward.join(' ')}`);
          await page.evaluate(PLANT_BUTTONS);
          const base: string[] = await page.evaluate(STOPS);
          const [left, right] = (await shown(page)).map((x) => x.id) as [string, string];
          const cut = base.indexOf('div0');
          const own: Record<string, string[]> = { [left]: base.slice(0, cut), [right]: base.slice(cut + 1) };
          // Next to the cell's own ends, outside its row: the first and the last thing the cell holds.
          await page.evaluate((markup: string) => {
            for (const cell of document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')) {
              cell.querySelector(':scope > [data-column-sentinel="cell-start"]')!.insertAdjacentHTML('afterend', `<div style="position:absolute;top:0">${markup.replaceAll('@', 'A.')}</div>`);
              cell.querySelector(':scope > [data-column-sentinel="cell-end"]')!.insertAdjacentHTML('beforebegin', `<div style="position:absolute;bottom:0">${markup.replaceAll('@', 'Z.')}</div>`);
            }
          }, html);
          await page.evaluate(FEED_MEDIA);
          if (outside) await page.evaluate(PLANT_OUTSIDE);
          const ends = await withEnds(page, []);
          assert.deepEqual(ends, order === 'list' ? [] : [START, END]);
          const named = (cell: string, tag: string, names: string[]): string[] => names.map((n) => `${cell}:${tag}${n}`);
          // Presses from where focus is, with the page's body dropped: what a browser rests on outside the page is its own.
          const walk = async (n: number, shift: boolean): Promise<string[]> => {
            const out: string[] = [];
            for (let k = 0; k < n + 2 && out.length < n; k += 1) {
              await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
              await sleep(80);
              const now: string = await page.evaluate(WHERE);
              if (now !== 'BODY') out.push(now);
            }
            return out;
          };
          const divider = (): Promise<void> => page.evaluate(() => document.querySelector<HTMLElement>('[role="separator"]')!.focus());
          const expect = async (shift: boolean, want: string[], why: string): Promise<void> => assert.deepEqual(await walk(want.length, shift), want, why);
          const last = (cell: string): string => own[cell]![own[cell]!.length - 1]!;
          const first = (cell: string): string => own[cell]![0]!;

          await focusStop(page, last(left));
          await expect(false, [...named(left, 'Z.', forward), 'div0', ...named(right, 'A.', forward), first(right)], 'Tab through the end of the left space, the divider, and the start of the right one');
          await focusStop(page, first(right));
          await expect(true, [...named(right, 'A.', backward), 'div0', ...named(left, 'Z.', backward), last(left)], 'and Shift+Tab back the same way');

          const after = order === 'list' ? [] : [END];
          const before = order === 'list' ? [] : [START];
          await focusStop(page, last(right));
          await expect(false, [...named(right, 'Z.', forward), ...after, ...(outside ? ['after'] : [...before, ...named(left, 'A.', forward).slice(0, 1)])], 'Tab through the end of the right space and out of the column');
          await focusStop(page, first(left));
          await expect(true, [...named(left, 'A.', backward), ...before, ...(outside ? ['before'] : [...after, ...named(right, 'Z.', backward).slice(0, 1)])], 'Shift+Tab through the start of the left space and out of the column');

          await divider();
          await expect(true, [...named(left, 'Z.', backward), last(left)], 'Shift+Tab from the divider comes into the left space at its end');
          await divider();
          await expect(false, [...named(right, 'A.', forward), first(right)], 'Tab from the divider comes into the right space at its start');
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------
// No walk is a loop
// ---------------------------------------------------------------------------
// A walk that names its stops by what they are cannot tell one page's buttons from the next page's, and a loop between two pages reads
// as a walk. So every element focus rests on is numbered, and a walk from outside the page must come out of it again without resting
// on any element twice.

/** Numbers every element it is asked about, the same element always the same. */
const NUMBER = `(() => {
  const numbers = new Map();
  window.__number = (el) => {
    if (!numbers.has(el)) numbers.set(el, numbers.size);
    return numbers.get(el);
  };
})()`;
const WHERE_NUMBERED = `(() => { const at = ${WHERE}; return at === 'BODY' ? at : at + '#' + window.__number(document.activeElement); })()`;
const isColumnEnd = (stop: string): boolean => /:column-(start|end)#/.test(stop);
/** A walk as the stops it made: without the rests on the column's ends and on a row's own sentinels, and a frame as one stop. */
const asStops = (walk: string[]): string[] => frameAsOne(walk.filter((x) => !isColumnEnd(x) && !/:row-(start|end)#/.test(x)).map((x) => x.replace(/:frame>.*#/, ':frame>#')));

/** A frame holding one button as the last thing in the panel drawn last of each shown space, which a reorder makes other than its last in the DOM. */
const PLANT_FRAMES_LAST_DRAWN = `(async () => {
  const loaded = [];
  for (const s of window.__s.shown()) {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const slots = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const f = document.createElement('iframe');
    f.srcdoc = '<button id="inner">inner</button>';
    f.style.cssText = 'width:100px;height:40px';
    loaded.push(new Promise((r) => f.addEventListener('load', r)));
    slots[slots.length - 1].querySelector('[data-box]').appendChild(f);
  }
  await Promise.all(loaded);
  return loaded.length;
})()`;

/**
 * Presses Tab from outside the page until focus has left the page again, and answers every element it rested on. Fails on an element
 * rested on twice, and when `most` presses have not left the page. Leaving is the body holding focus, or focus coming in with no
 * element it came from (the browser went out and straight back in).
 * The walk starts where a button at the page's start (Shift+Tab: end) was focused and then removed: the page then holds no focus,
 * and the browser's next step starts from that place, as it does coming in from its own interface.
 */
async function walkOut(page: Page, most: number, shift = false): Promise<string[]> {
  await page.evaluate((atEnd: boolean) => {
    const from = document.createElement('button');
    if (atEnd) document.body.append(from);
    else document.body.prepend(from);
    from.focus();
    from.remove();
  }, shift);
  assert.equal(await page.evaluate(WHERE), 'BODY');
  await page.evaluate('window.__entered.splice(0)');
  const seen: string[] = [];
  for (let k = 0; k < most; k += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(60);
    const now: string = await page.evaluate(WHERE_NUMBERED);
    const entered: number = await page.evaluate('window.__entered.splice(0).length');
    // A step out of a frame has no source either, and stays in the page.
    if (now === 'BODY' || (seen.length > 0 && entered > 0 && !seen[seen.length - 1]!.includes(':frame>'))) return seen;
    // Inside a frame the presses are the frame's own, and the row sends the first step out of one back into it: a frame is one stop
    // however many presses it holds focus, as long as focus does not come back to it from elsewhere.
    const frame = (x: string): string => x.replace(/:frame>.*#/, ':frame>#');
    const stillInFrame = now.includes(':frame>') && seen.length > 0 && frame(seen[seen.length - 1]!) === frame(now);
    assert.ok(stillInFrame || !seen.map(frame).includes(frame(now)), `${shift ? 'Shift+Tab' : 'Tab'} came back to ${now} without leaving the page: ${[...seen, now].join(' ')}`);
    seen.push(now);
  }
  assert.fail(`${most} presses of ${shift ? 'Shift+Tab' : 'Tab'} never left the page: ${seen.join(' ')}`);
}

/**
 * Both walks through the page as it stands, Tab and Shift+Tab: each passes every stop once in screen order and leaves the page. The
 * column's own start and end may be rested on only where the screen and the DOM disagree at that end. Answers how many stops there are.
 */
async function walkedBothWays(page: Page): Promise<number> {
  const stops: string[] = await page.evaluate(stopsScript(true));
  const ends = (await withEnds(page, [])).map((x) => x.slice(2));
  for (const shift of [false, true]) {
    const walk = await walkOut(page, 3 * stops.length + 6, shift);
    assert.deepEqual(asStops(walk), shift ? [...asStops(stops)].reverse() : asStops(stops), `${shift ? 'Shift+Tab' : 'Tab'} walks the stops in screen order: ${walk.join(' ')}`);
    for (const rest of walk.filter(isColumnEnd)) assert.ok(ends.some((end) => rest.includes(`:${end}#`)), `${rest} is rested on where the two orders agree: ${walk.join(' ')}`);
  }
  return stops.length;
}

/** Whether some shown space's row draws its panels in an order its DOM does not have. */
const rowsReordered = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')].some((cell) => {
      const lefts = [...cell.querySelectorAll<HTMLElement>('[data-row-slot]')].filter((x) => x.closest('[inert]') === cell || x.closest('[inert]') === null).map((x) => x.getBoundingClientRect().left);
      return lefts.some((x, k) => k > 0 && x < lefts[k - 1]!);
    }),
  );

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

type Arrangement = { spaces: 1 | 2 | 3; order: Order };
const ARRANGEMENTS: Arrangement[] = [
  { spaces: 1, order: 'list' },
  { spaces: 1, order: 'stepped' },
  ...(['list', 'stepped', 'placed-first'] as const).flatMap((order) => ([2, 3] as const).map((spaces) => ({ spaces, order }))),
];

/** Shows `spaces` spaces in the screen order asked for; answers the ids left to right. */
async function arrange(page: Page, { spaces, order }: Arrangement): Promise<string[]> {
  if (spaces >= 2) await until(page, order === 'placed-first' && spaces === 2 ? 'c.showSide(ws[1], { at: 0 })' : 'c.showSide(ws[1])');
  if (spaces === 3) await until(page, `c.showSide(ws[2], { at: ${order === 'placed-first' ? 0 : 2} })`);
  await sleep(700);
  if (order === 'stepped') {
    assert.equal(await call(page, 'c.step("down")'), true);
    await sleep(900);
  }
  const ids = (await shown(page)).map((s) => s.id);
  assert.equal(ids.length, spaces);
  return ids;
}

for (const arrangement of ARRANGEMENTS) {
  for (const reorder of [false, true]) {
    for (const bands of ['&bands=none', '']) {
      const { spaces, order } = arrangement;
      test(`no Tab loop: ${spaces} space${spaces === 1 ? '' : 's'}, ${order} order, rows ${reorder ? 'reordered' : 'as opened'}, ${bands === '' ? 'buttons in the bands' : 'nothing in the bands'}: Tab and Shift+Tab pass every stop once and leave the page`, async (t) => {
        if (!(await ready(t))) return;
        await onPage(spaces === 3 ? 3800 : 2560, `n=4&slots=1,1${bands}`, async (page) => {
          const ids = await arrange(page, arrangement);
          if (reorder) {
            assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true, true]);
            await sleep(900);
          }
          assert.equal(await rowsReordered(page), reorder);
          const ends = await withEnds(page, []);
          assert.equal(ends.length, spaces === 1 || order === 'list' ? 0 : 2, `the screen and the DOM disagree at both ends only when drawn out of list order: ${ids.join(' ')}`);
          await page.evaluate(NUMBER);
          await page.evaluate(WATCH_ENTRY);
          // The library's own controls alone, then a button in every panel as well, which gives the root panel a stop.
          const inSight: number = await page.evaluate(() => [...document.querySelectorAll('[data-workspace-cell]:not([inert]) [data-row-slot]')].filter((x) => x.closest('[inert]') === null).length);
          assert.ok(inSight >= spaces * 3 - 1, `at most one panel of the three a space has is out of sight: ${inSight}, ${named(await shown(page))}`);
          const own = await walkedBothWays(page);
          assert.ok(own >= (inSight - spaces) * 2 + (spaces - 1), `every page in sight has its two controls and every divider is a stop: ${own}`);
          await page.evaluate(PLANT_BUTTONS);
          assert.equal(await walkedBothWays(page), own + inSight, 'and one more stop for every panel in sight');
          // A Tab pressed inside a frame is not the page's to hear: the row acts only once the browser's step has come out of it.
          assert.equal(await page.evaluate(PLANT_FRAMES_LAST_DRAWN), spaces);
          await sleep(300);
          assert.equal(await walkedBothWays(page), own + inSight + spaces, 'and a frame at the end of every space');
        });
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
