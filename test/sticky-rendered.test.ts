/**
 * Sticky panels in a real browser. jsdom has no layout, so it cannot say where a panel is drawn; these tests build the library's
 * Workspace and PanelRow into a page (tools/proof/sticky-entry.tsx.txt), open it in headless Chromium at a given window size and read
 * every slot's rect off the page: at rest, and on every animation frame while the row glides.
 *
 * What each check could not pass by accident: the sticky panel's x is read in the same runs where a panel that is NOT sticky is read
 * moving, so "x unchanged" is a result and not an absence; and the cut check is shown firing on the frames in mid-glide, where
 * a page is cut by the window's edge by design. Without a browser every test here is skipped loudly (test/support/chromium.ts).
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
interface Snap { slots: Slot[]; win: Rect; offset: number }

let browser: LaunchedBrowser<Page> | undefined;
let server: Server | undefined;
let port = 0;
let dir = '';
let built = false;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sticky-rendered-'));
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** Bundles the proof page once and serves it, then launches the browser; false (with the skip said) when there is no Chromium. */
async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'sticky-rendered');
  if (browser === undefined) return false;
  if (!built) {
    built = true;
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/sticky-entry.tsx.txt'), 'utf8'));
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
    await page.waitForFunction(() => (window as unknown as { __s?: { ready(): boolean } }).__s?.ready(), undefined, { timeout: 20000 });
    await sleep(500);
    await body(page, errors);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await ctx.close();
  }
}

const snap = (page: Page): Promise<Snap> => page.evaluate(() => ({ slots: (window as any).__s.slots(), win: (window as any).__s.window(), offset: (window as any).__s.offset() }));
const slotIn = (s: Snap, id: string): Slot => {
  const slot = s.slots.find((x) => x.id === id);
  assert.ok(slot, `slot ${id} is drawn`);
  return slot;
};

/** Waits until the row has stopped: the drawn scroll holds for 300 ms. */
async function atRest(page: Page): Promise<Snap> {
  let last = Number.NaN;
  let still = 0;
  for (let k = 0; k < 200; k += 1) {
    const s = await snap(page);
    still = s.offset === last ? still + 1 : 0;
    last = s.offset;
    if (still >= 6) return s;
    await sleep(50);
  }
  throw new Error('the row never came to rest');
}

/** Strip pages the row draws in sight that the window cuts or does not hold: none at rest. */
function cutPages(s: Snap): string[] {
  return s.slots.filter((x) => x.group === null && !x.inert && (x.left < s.win.left - 0.5 || x.right > s.win.right + 0.5)).map((x) => x.id);
}

/** Records the slots on every frame for `ms` while `act` runs, so a panel that moves for a single frame is seen. */
async function frames(page: Page, ms: number, act: () => Promise<void>): Promise<Snap[]> {
  const pending = page.evaluate((span: number) => (window as any).__s.sample(span, () => ({ slots: (window as any).__s.slots(), win: (window as any).__s.window(), offset: (window as any).__s.offset() })), ms);
  await sleep(120);
  await act();
  return pending as Promise<Snap[]>;
}
const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
const leftsOf = (all: Snap[], id: string): number[] => all.map((s) => slotIn(s, id).left);

const PAGES12 = Array.from({ length: 12 }, () => 1).join(',');

// ---------------------------------------------------------------------------
// H1: a 1800 px window, History and twelve pages, History sticky at the start
// ---------------------------------------------------------------------------

test('1800 px, History sticky at the start: it does not move while the row scrolls by key and by wheel, and no page is cut at rest', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}&sticky=root:start`, async (page) => {
    const rest0 = await atRest(page);
    const root0 = slotIn(rest0, 'root');
    assert.equal(root0.group, 'start', 'History is in the start group');
    assert.ok(!root0.inert, 'and never marked out of sight');
    assert.ok(root0.left >= 0 && root0.right <= 1800, `it is wholly on screen (${root0.left}..${root0.right})`);
    assert.ok(root0.topmost, 'nothing is drawn over it');
    assert.ok(Math.abs(rest0.win.left - root0.right - 16) < 0.5, `the strip's window starts one gap after it (${rest0.win.left} after ${root0.right})`);
    assert.ok(Math.abs(rest0.win.right - rest0.win.left - (3 * 406 - 16)) < 0.5, 'the strip is seen through the three slots it has left');
    assert.deepEqual(cutPages(rest0), [], 'no page is cut at rest at the start');

    // By key: every frame of three steps, then the rest.
    const keyed = await frames(page, 2600, async () => {
      for (let k = 0; k < 3; k += 1) {
        await page.keyboard.press('ArrowRight');
        await sleep(40);
      }
    });
    assert.ok(spread(leftsOf(keyed, 'root')) < 0.01, `History's x moved on a frame while the row glided by key: spread ${spread(leftsOf(keyed, 'root'))}`);
    assert.ok(keyed.some((s) => cutPages(s).length > 0), 'control: the cut check does see a page cut on a frame in mid-glide, where the window cuts one by design');
    const afterKeys = await atRest(page);
    assert.ok(afterKeys.offset > 600, `the row moved (${afterKeys.offset})`);
    assert.equal(slotIn(afterKeys, 'root').left, root0.left, 'History is where it was after three keys');
    assert.deepEqual(cutPages(afterKeys), [], 'no page is cut at rest after the keys');
    assert.ok(slotIn(afterKeys, 'root').topmost);

    // By wheel: the browser's own input.
    await page.mouse.move(1100, 400);
    const wheeled = await frames(page, 3000, async () => {
      for (let k = 0; k < 4; k += 1) {
        await page.mouse.wheel(260, 0);
        await sleep(90);
      }
    });
    assert.ok(spread(leftsOf(wheeled, 'root')) < 0.01, `History's x moved on a frame while the row scrolled by wheel: spread ${spread(leftsOf(wheeled, 'root'))}`);
    const afterWheel = await atRest(page);
    assert.ok(afterWheel.offset > afterKeys.offset, `the wheel moved the row on (${afterKeys.offset} to ${afterWheel.offset})`);
    assert.equal(slotIn(afterWheel, 'root').left, root0.left, 'History is where it was after the wheel');
    assert.deepEqual(cutPages(afterWheel), [], 'no page is cut at rest after the wheel');

    // To the far end and back.
    for (let k = 0; k < 14; k += 1) await page.keyboard.press('ArrowRight');
    const end = await atRest(page);
    assert.equal(slotIn(end, 'root').left, root0.left, 'History is where it was at the row end');
    assert.deepEqual(cutPages(end), [], 'no page is cut at the row end');
    for (let k = 0; k < 20; k += 1) await page.keyboard.press('ArrowLeft');
    const back = await atRest(page);
    assert.equal(Math.abs(back.offset), 0, 'the row came back to its start');
    assert.equal(slotIn(back, 'root').left, root0.left);
    assert.deepEqual(cutPages(back), []);
  });
});

test('negative control: with History NOT sticky the same steps move it, so the x read above could have changed', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}`, async (page) => {
    const rest0 = await atRest(page);
    const root0 = slotIn(rest0, 'root');
    assert.equal(root0.group, null, 'History is in the strip');
    const keyed = await frames(page, 2600, async () => {
      for (let k = 0; k < 3; k += 1) {
        await page.keyboard.press('ArrowRight');
        await sleep(40);
      }
    });
    assert.ok(spread(leftsOf(keyed, 'root')) > 300, `History's x spread over the frames is ${spread(leftsOf(keyed, 'root'))}: it scrolled`);
    const after = await atRest(page);
    assert.ok(after.offset > 600);
    assert.ok(slotIn(after, 'root').inert || slotIn(after, 'root').right <= after.win.left + 0.5, 'and it has left the window, marked out of sight');
  });
});

// ---------------------------------------------------------------------------
// The other layouts, at 1800 px (four slots)
// ---------------------------------------------------------------------------

/** Scrolls by key and by wheel and asserts the sticky panels `ids` kept their x on every frame and no page is cut at rest. */
async function scrollAndHold(page: Page, ids: string[]): Promise<void> {
  const rest0 = await atRest(page);
  const x0 = new Map(ids.map((id) => [id, slotIn(rest0, id).left]));
  assert.deepEqual(cutPages(rest0), [], 'no page is cut at the start');
  const moved = await frames(page, 2800, async () => {
    for (let k = 0; k < 3; k += 1) {
      await page.keyboard.press('ArrowRight');
      await sleep(40);
    }
    await page.mouse.move(900, 400);
    await page.mouse.wheel(260, 0);
  });
  for (const id of ids) assert.ok(spread(leftsOf(moved, id)) < 0.01, `${id} moved on a frame while the row scrolled: spread ${spread(leftsOf(moved, id))}`);
  const after = await atRest(page);
  assert.ok(after.offset > 0, 'the row moved');
  for (const id of ids) {
    assert.equal(slotIn(after, id).left, x0.get(id), `${id} is where it was`);
    assert.ok(!slotIn(after, id).inert && slotIn(after, id).topmost, `${id} is in sight and nothing is over it`);
  }
  assert.deepEqual(cutPages(after), [], 'no page is cut at rest after the scroll');
}

test('1800 px, [sticky | row of 2 | sticky]: both ends hold while the strip scrolls', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}&sticky=root:start,p12:end`, async (page) => {
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['root:left', 'p12:right']);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.segments().map((s: any) => [s.kind, s.slots])), [['sticky', 1], ['scroll', 2], ['sticky', 1]]);
    const rest = await atRest(page);
    assert.ok(Math.abs(rest.win.right - rest.win.left - (2 * 406 - 16)) < 0.5, 'the strip is seen through two slots');
    assert.ok(slotIn(rest, 'p12').left >= rest.win.right && slotIn(rest, 'p12').right <= 1800, 'the end panel is whole, past the strip, on screen');
    await scrollAndHold(page, ['root', 'p12']);
  });
});

test('1800 px, [sticky | sticky | row of 2]: two stack at the start in row order', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}&sticky=root:start,p1:start`, async (page) => {
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['root:left', 'p1:left']);
    const rest = await atRest(page);
    assert.ok(slotIn(rest, 'p1').left > slotIn(rest, 'root').right, 'the second sits after the first');
    assert.ok(Math.abs(slotIn(rest, 'p1').left - slotIn(rest, 'root').right - 16) < 0.5, 'a gap apart');
    await scrollAndHold(page, ['root', 'p1']);
  });
});

test('1800 px, a sticky page in the middle of the row leaves it and holds, and the others close up', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}&sticky=p5:end`, async (page) => {
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['p5:right']);
    const rest = await atRest(page);
    assert.equal(slotIn(rest, 'p5').group, 'end');
    assert.ok(slotIn(rest, 'p5').left >= rest.win.right, 'it is past the strip');
    await scrollAndHold(page, ['p5']);
  });
});

// ---------------------------------------------------------------------------
// Resizing and changing the setting while the page is open
// ---------------------------------------------------------------------------

test('a sticky panel turned on while the page is open holds from then on, and turned off scrolls with the strip', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}`, async (page) => {
    const asked = await page.evaluate(() => (window as any).__s.configure('p1', { sticky: 'start' }));
    assert.equal(asked.ok, true, JSON.stringify(asked));
    await sleep(600);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['p1:left']);
    const rest = await atRest(page);
    assert.equal(slotIn(rest, 'p1').group, 'start');
    await scrollAndHold(page, ['p1']);
    const undone = await page.evaluate(() => (window as any).__s.configure('p1', { sticky: 'off' }));
    assert.equal(undone.ok, true, JSON.stringify(undone));
    await sleep(600);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), []);
    const off = await atRest(page);
    assert.equal(slotIn(off, 'p1').group, null, 'back in the strip');
    assert.deepEqual(cutPages(off), [], 'no page is cut once it is back');
  });
});

test('the window narrowing gives the lowest-ranked sticky panel back to the row and widening takes it again, with no page cut', async (t) => {
  if (!(await ready(t))) return;
  await onPage(1800, `slots=${PAGES12}&sticky=root:start,p1:start&rank=p1:3`, async (page) => {
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['root:left', 'p1:left'], 'two slots of four: both are sticky');
    await page.setViewportSize({ width: 1000, height: 900 });
    await sleep(900);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['p1:left'], 'two slots hold one sticky panel and a slot of row: the lower rank (History) goes back');
    const narrow = await atRest(page);
    assert.equal(slotIn(narrow, 'root').group, null);
    assert.deepEqual(cutPages(narrow), []);
    await page.setViewportSize({ width: 1800, height: 900 });
    await sleep(900);
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), ['root:left', 'p1:left'], 'and sticky again when the room returns');
    const wide = await atRest(page);
    assert.equal(slotIn(wide, 'root').group, 'start');
    assert.deepEqual(cutPages(wide), []);
  });
});

test('a phone-width window has no sticky panel', async (t) => {
  if (!(await ready(t))) return;
  await onPage(390, `slots=${PAGES12}&sticky=root:start`, async (page) => {
    assert.deepEqual(await page.evaluate(() => (window as any).__s.held()), []);
    const rest = await atRest(page);
    assert.equal(slotIn(rest, 'root').group, null, 'History scrolls with the strip');
  });
});
