/**
 * The row's gestures in a real browser, driven the way a person drives them: mouse-wheel notches, arrow keys, clicks. jsdom cannot
 * see scroll geometry or where a panel is drawn, so the owner's complaints about the row's movement live here. Needs Playwright and
 * Chromium; it skips when either is missing (PLAYWRIGHT_DIR=<a directory whose node_modules holds playwright> finds a copy
 * elsewhere). The page is tools/proof/gesture-entry.tsx.txt: the real Workspace, PanelRow and a dot bar from usePanelDots.
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './support/chromium.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Page {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: ((arg: A) => T) | string, arg?: A): Promise<T>;
  mouse: { move(x: number, y: number): Promise<void>; wheel(dx: number, dy: number): Promise<void>; click(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
}
interface G {
  offset(): number;
  target(): number | null;
  stops(): number[];
}
declare global {
  interface Window {
    __g: G;
  }
}

/** A built page of the real row, and a way to open it in a fresh browser context. */
async function rig(t: TestContext): Promise<{ open(query: string, width?: number): Promise<Page> } | undefined> {
  const browser = await launchChromium<Page>(t, 'row-gestures-chromium.test.ts');
  if (browser === undefined) return undefined;
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'row-gestures-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/gesture-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    server.close();
  });
  return {
    async open(query, width = 1000) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
      await page.goto(`http://localhost:${port}/?${query}`);
      await page.waitForFunction(() => (window as unknown as { __g?: { ready(): boolean } }).__g?.ready());
      await page.waitForTimeout(400);
      return page;
    },
  };
}

const offsetOf = (page: Page): Promise<number> => page.evaluate('window.__g.offset()') as Promise<number>;
const stopsOf = (page: Page): Promise<number[]> => page.evaluate('window.__g.stops()') as Promise<number[]>;
const aim = (page: Page): Promise<void> => page.mouse.move(500, 300);

for (const gap of [60, 120, 200]) {
  test(`mouse-wheel notches ${gap} ms apart each move the row exactly one stop`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open('slots=1,1,1,1,1,1,1,1');
    const stops = await stopsOf(page);
    assert.ok(stops.length >= 6, `the row has stops to walk (${stops.length})`);
    await aim(page);
    const asked: number[] = [];
    for (let k = 1; k <= 4; k += 1) {
      await page.mouse.wheel(100, 0);
      await page.waitForTimeout(25);
      asked.push((await page.evaluate('window.__g.target()')) as number);
      await page.waitForTimeout(gap - 25);
    }
    await page.waitForTimeout(900);
    assert.deepEqual(asked.map((a, k) => a === stops[k + 1]), [true, true, true, true], `each notch's target is the next stop: asked ${asked.join(',')} of ${stops.slice(0, 6).join(',')}`);
    assert.equal(await offsetOf(page), stops[4], 'four notches rest four stops on');
  });
}

test('arrow keys pressed 60 ms apart each move the row exactly one stop', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1,1,1');
  const stops = await stopsOf(page);
  await aim(page);
  for (let k = 0; k < 4; k += 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(900);
  assert.equal(await offsetOf(page), stops[4]);
});

for (const key of [null, 'ArrowRight']) {
  test(`a panel grown by hand past a window it fitted in settles the row on a stop${key === null ? '' : ', and a step asked just after the release lands one stop on'}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open('slots=1,1', 1800);
    await aim(page);
    const margin = (): Promise<number> => page.evaluate('window.__g.provided().rowNumbers.rowMarginLeft') as Promise<number>;
    const before = await margin();
    assert.ok(before > 200, `control: a row that fits is centered (${before})`);
    await page.evaluate('window.__g.resizing(1, true)');
    await page.evaluate('window.__g.setSlots(1, 5)');
    await page.waitForTimeout(400);
    await page.evaluate('window.__g.resizing(1, false)');
    if (key !== null) {
      await page.waitForTimeout(150);
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(1800);
    const stops = await stopsOf(page);
    assert.ok(stops.length >= 3, `the grow added stops (${stops.join(',')})`);
    assert.ok((await margin()) < 100, 'the centering margin went to the overflowing row\'s');
    assert.equal(await offsetOf(page), key === null ? stops[0] : stops[1]);
  });
}

test('a scroll asked of the row while a panel is being resized by hand is made once the resize is released', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1,1,1', 1000);
  await aim(page);
  assert.equal(await offsetOf(page), 0, 'control: the row starts at its first stop');
  await page.evaluate('window.__g.resizing(0, true)');
  await page.evaluate('window.__g.scrollTo(5)');
  await page.waitForTimeout(400);
  assert.equal(await offsetOf(page), 0, 'control: the held row has not moved');
  await page.evaluate('window.__g.resizing(0, false)');
  await page.waitForTimeout(1800);
  const at = await offsetOf(page);
  const left = (await page.evaluate("(() => { const id = window.__g.engineId(5); const r = window.__g.rect(id); return r === null ? null : r.left; })()")) as number | null;
  assert.ok(at > 1000, `the row went to the panel that was asked for (${at})`);
  assert.ok(left !== null && left >= 0 && left < 1000, `the asked-for panel is in the window (${left})`);
});

const SWAP_WIDE = 'slots=1,3,1,3,1,2,1,1&park=1&rootpark=1';

/** The ids of the panels drawn beside the root, as numbers, left to right. */
const drawnBesideRoot = async (page: Page): Promise<number[]> => (await page.evaluate("window.__g.ids().filter((id) => id !== 'root').map(Number).sort((a, b) => a - b)")) as number[];

// A row that swaps, wide panels among narrow ones: each press goes to the panel next to the one before it in the list, whatever
// the panels' widths, so a run of presses reaches the first panel instead of going back and forth between two sets.
test('pressing left in a swapping row with wide panels reaches each panel in list order and stays at the first', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open(SWAP_WIDE, 1800);
  await aim(page);
  const seen = [(await drawnBesideRoot(page))[0]!];
  for (let k = 0; k < 8; k += 1) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(700);
    seen.push((await drawnBesideRoot(page))[0]!);
  }
  assert.ok(seen[0]! > 2, `control: the row starts away from the first panel: ${seen.join(', ')}`);
  seen.forEach((now, k) => {
    if (k === 0) return;
    const expected = Math.max(seen[k - 1]! - 1, 2);
    assert.equal(now, expected, `press ${k} left: the leftmost panel beside the root is ${now}, the one next to the press before it is ${expected}: ${seen.join(', ')}`);
  });
});

/** The panels drawn beside the root are neighbours in the list: a step parks at the far end, never inside the run. */
const assertOneRun = (run: readonly number[], trace: string): void => {
  assert.ok(run.length > 0, `control: a panel is drawn beside the root: ${trace}`);
  for (let k = 1; k < run.length; k += 1) assert.equal(run[k], run[k - 1]! + 1, `the drawn run is broken at ${run.join(' ')}: ${trace}`);
};

for (const width of [1800, 1400]) {
  test(`right then left in a swapping row with wide panels keeps one unbroken run at window ${width}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(SWAP_WIDE, width);
    await aim(page);
    let trace = (await drawnBesideRoot(page)).join('-');
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(750);
      const run = await drawnBesideRoot(page);
      trace += ` ${key === 'ArrowRight' ? '>' : '<'}${run.join('-')}`;
      assertOneRun(run, trace);
    }
  });

  test(`a seeded walk of presses in a swapping row with wide panels never splits the run at window ${width}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(SWAP_WIDE, width);
    await aim(page);
    let seed = width;
    let trace = (await drawnBesideRoot(page)).join('-');
    const seen = new Set<string>();
    for (let k = 0; k < 14; k += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const right = Math.floor(seed / 65536) % 2 === 0;
      await page.keyboard.press(right ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForTimeout(750);
      const run = await drawnBesideRoot(page);
      seen.add(run.join('-'));
      trace += ` ${right ? '>' : '<'}${run.join('-')}`;
      assertOneRun(run, trace);
    }
    assert.ok(seen.size >= 3, `control: the walk moved the row: ${trace}`);
  });
}

test('pressing right in a swapping row with wide panels reaches each panel in list order and stays at the last', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open(SWAP_WIDE, 1800);
  await aim(page);
  for (let k = 0; k < 8; k += 1) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
  }
  const seen = [(await drawnBesideRoot(page))[0]!];
  assert.equal(seen[0], 2, `control: the row has reached the first panel: ${seen.join(', ')}`);
  for (let k = 0; k < 8; k += 1) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    seen.push((await drawnBesideRoot(page)).at(-1)!);
  }
  // After the first press the rightmost drawn panel moves up by at most one, never back.
  for (let k = 2; k < seen.length; k += 1) {
    assert.ok(seen[k]! >= seen[k - 1]! && seen[k]! - seen[k - 1]! <= 2, `press ${k} right went from panel ${seen[k - 1]} to ${seen[k]}: ${seen.join(', ')}`);
  }
  assert.equal(seen.at(-1), 9, `the last panel is reached: ${seen.join(', ')}`);
});
