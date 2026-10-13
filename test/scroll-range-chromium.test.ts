/**
 * The scroll range a stepping row asks for is the one the browser gives: every stop is reachable at every rest, and the farthest
 * stop is inside the range with the strip drawn on it. Needs real layout, so it drives Chromium through Playwright and skips when
 * Playwright or Chromium is not installed (PLAYWRIGHT_DIR=<node_modules holding playwright> finds a copy elsewhere). The same
 * harness runs in Firefox and WebKit with tools/proof/step-end-probe.mjs, which the Mac runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The slice of Playwright this test uses. */
interface Page {
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  mouse: { move(x: number, y: number): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  context(): { close(): Promise<void> };
}
interface Browser {
  newContext(o: { viewport: { width: number; height: number } }): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: { launch(): Promise<Browser> };
}
/** What tools/proof/step-entry.tsx.txt puts on the page. */
interface Probe {
  container(): HTMLElement;
  provided(): { rowNumbers: { stops: number[]; atStop: number; rowMarginLeft: number; stripWidth: number; endPad: number; windowWidth: number } };
}

async function loadPlaywright(): Promise<PlaywrightModule | undefined> {
  try {
    const from = process.env.PLAYWRIGHT_DIR === undefined ? undefined : createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright');
    const ns = (await import(from === undefined ? 'playwright' : pathToFileURL(from).href)) as PlaywrightModule & { default?: PlaywrightModule };
    return ns.chromium === undefined ? ns.default : ns;
  } catch {
    return undefined;
  }
}

const ROWS = ['1,4', '2,4,1,1', '1,4,1,2'];
const WIDTHS = [1800, 1280, 844];
const GAPS = [16, 24];

test('every stop of a stepping row is inside the range the browser gives, at 1800, 1280 and 844 with gaps of 16 and 24', async (t) => {
  const pw = await loadPlaywright();
  if (pw === undefined) return void t.skip('playwright is not installed');
  let browser: Browser;
  try {
    browser = await pw.chromium.launch();
  } catch {
    return void t.skip('chromium is not installed');
  }
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'scroll-range-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/step-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    for (const slots of ROWS) {
      for (const width of WIDTHS) {
        for (const gap of GAPS) {
          const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
          await page.goto(`http://localhost:${port}/?mode=visible&slots=${slots}&gap=${gap}&control=none&reduce=0&frame=none`);
          await page.waitForSelector('[data-box="p1"]');
          await page.waitForTimeout(600);
          const rest = async (): Promise<{ scrollLeft: number; browserMax: number; stops: number[]; atStop: number; maxScroll: number; endPad: number; padWidth: number | null }> => {
            let last = -1;
            for (let tries = 0; tries < 40; tries++) {
              const now = await page.evaluate(() => (window as unknown as { __g: Probe }).__g.container().scrollLeft);
              if (now === last) break;
              last = now;
              await page.waitForTimeout(150);
            }
            return page.evaluate(() => {
              const c = (window as unknown as { __g: Probe }).__g.container();
              const n = (window as unknown as { __g: Probe }).__g.provided().rowNumbers;
              const pad = c.querySelector('[data-row-end-pad]');
              return { scrollLeft: c.scrollLeft, browserMax: c.scrollWidth - c.clientWidth, stops: n.stops, atStop: n.atStop, maxScroll: Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth), endPad: n.endPad, padWidth: pad === null ? null : pad.getBoundingClientRect().width };
            });
          };
          const where = `${slots} at ${width}, gap ${gap}`;
          const first = await rest();
          const count = first.stops.length;
          const seen: Awaited<ReturnType<typeof rest>>[] = [first];
          for (const delta of [300, -300]) {
            for (let step = 0; step < count + 1; step++) {
              await page.mouse.move(Math.min(600, width - 50), 300);
              await page.mouse.wheel(delta, 0);
              seen.push(await rest());
            }
          }
          for (const r of seen) {
            if (count === 0) continue;
            assert.ok(Math.abs(r.scrollLeft - r.stops[r.atStop]!) < 1, `${where}: at rest the scroll is ${r.scrollLeft} but the stop is ${r.stops[r.atStop]}`);
            assert.ok(r.browserMax >= r.stops[count - 1]! - 1 || r.atStop < count - 1, `${where}: the range ${r.browserMax} ends before the last stop ${r.stops[count - 1]}`);
            assert.equal(r.padWidth, r.endPad + gap, `${where}: the end element is endPad + gap wide`);
          }
          if (count > 0) {
            const last = seen.find((r) => r.atStop === count - 1)!;
            assert.ok(last.browserMax >= last.stops[count - 1]! - 1, `${where}: the last stop is inside the range of the strip drawn on it (${last.browserMax})`);
            assert.ok(last.browserMax <= last.maxScroll + 1, `${where}: the range is no more than the library counts (${last.browserMax} against ${last.maxScroll})`);
          }
          await page.context().close();
        }
      }
    }
  } finally {
    server.close();
    await browser.close();
  }
});
