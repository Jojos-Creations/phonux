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
