/**
 * A stepping row moves by its strip's transform, never a scroll: at every rest the container's scrollLeft is 0, the strip is drawn at
 * its margin less the row's offset, and the offset is on a stop. A step glides as one Web Animations API animation with no style
 * write per frame, which the compositor runs while the main thread is busy. Needs real layout, so it drives headless Chromium through
 * Playwright and skips when Playwright or Chromium is not installed (PLAYWRIGHT_DIR=<node_modules holding playwright> finds a copy
 * elsewhere).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './support/chromium.js';

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
/** What tools/proof/step-entry.tsx.txt puts on the page. */
interface Probe {
  container(): HTMLElement;
  offset(): number;
  provided(): { rowNumbers: { stops: number[]; rowMarginLeft: number } };
}

const ROWS = ['1,4', '2,4,1,1', '1,4,1,2'];
const WIDTHS = [1800, 1280, 844];
const GAPS = [16, 24];

test('a stepping row rests on every stop by its strip transform alone, at 1800, 1280 and 844 with gaps of 16 and 24, and glides on the compositor', async (t) => {
  const browser = await launchChromium<Page>(t, 'row-transform-chromium.test.ts');
  if (browser === undefined) return;
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'row-transform-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/step-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  let glides = 0;
  try {
    const port = (server.address() as { port: number }).port;
    for (const slots of ROWS) {
      for (const width of WIDTHS) {
        for (const gap of GAPS) {
          const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
          await page.goto(`http://localhost:${port}/?mode=visible&slots=${slots}&gap=${gap}&control=none&reduce=0&frame=none`);
          await page.waitForSelector('[data-box="p1"]');
          await page.waitForTimeout(600);
          const rest = async (): Promise<{ scrollLeft: number; offset: number; drawn: number; margin: number; stops: number[]; atStop: number }> => {
            let last = -1;
            for (let tries = 0; tries < 40; tries++) {
              const now = await page.evaluate(() => (window as unknown as { __g: Probe }).__g.offset());
              if (now === last) break;
              last = now;
              await page.waitForTimeout(150);
            }
            // A step past the row's end pushes the strip and springs back once the input has been quiet: wait for it to be home.
            for (let tries = 0; tries < 30; tries++) {
              const home = await page.evaluate(() => {
                const g = (window as unknown as { __g: Probe }).__g;
                const strip = g.container().querySelector<HTMLElement>('[data-row-strip]')!;
                return Math.abs(new DOMMatrix(getComputedStyle(strip).transform).m41 - (g.provided().rowNumbers.rowMarginLeft - g.offset())) < 0.5;
              });
              if (home) break;
              await page.waitForTimeout(150);
            }
            return page.evaluate(() => {
              const g = (window as unknown as { __g: Probe }).__g;
              const c = g.container();
              const n = g.provided().rowNumbers;
              const strip = c.querySelector<HTMLElement>('[data-row-strip]')!;
              const drawn = new DOMMatrix(getComputedStyle(strip).transform).m41;
              const atStop = n.stops.reduce((best, stop, k) => (Math.abs(stop - g.offset()) < Math.abs(n.stops[best]! - g.offset()) ? k : best), 0);
              return { scrollLeft: c.scrollLeft, offset: g.offset(), drawn, margin: n.rowMarginLeft, stops: n.stops, atStop };
            });
          };
          const where = `${slots} at ${width}, gap ${gap}`;
          const first = await rest();
          const count = first.stops.length;
          const seen: Awaited<ReturnType<typeof rest>>[] = [first];
          for (const delta of [300, -300]) {
            for (let step = 0; step < count + 1; step++) {
              await page.mouse.move(Math.min(600, width - 50), 300);
              // The first step right is watched as it glides: one running transform animation, and no style write per frame.
              const watch = delta > 0 && step === 0 && count > 1;
              if (watch)
                await page.evaluate(() => {
                  const strip = document.querySelector('[data-row-strip]')!;
                  const w = window as unknown as { __writes: number; __anims: number };
                  w.__writes = 0;
                  w.__anims = 0;
                  // The strip's clip follows it from the frame loop by design; what must not be written per frame is its transform.
                  new MutationObserver((records) => void (w.__writes += records.filter((r) => (/transform:[^;]*/.exec(r.oldValue ?? '')?.[0] ?? '') !== (/transform:[^;]*/.exec(strip.getAttribute('style') ?? '')?.[0] ?? '')).length)).observe(strip, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
                });
              await page.mouse.wheel(delta, 0);
              if (watch) {
                await page.waitForTimeout(150);
                const during = await page.evaluate(() => {
                  const strip = document.querySelector('[data-row-strip]')!;
                  const running = strip.getAnimations().filter((a) => a.playState === 'running').length;
                  return { running, writes: (window as unknown as { __writes: number }).__writes };
                });
                assert.equal(during.running, 1, `${where}: the step glides as one running animation on the strip`);
                assert.ok(during.writes <= 2, `${where}: ${during.writes} transform writes 150 ms into the glide`);
                glides += 1;
              }
              seen.push(await rest());
            }
          }
          for (const r of seen) {
            assert.equal(r.scrollLeft, 0, `${where}: the container never scrolls`);
            assert.ok(Math.abs(r.drawn - (r.margin - r.offset)) < 0.5, `${where}: the strip is drawn at its margin less the offset (${r.drawn} against ${r.margin - r.offset})`);
            if (count === 0) continue;
            assert.ok(Math.abs(r.offset - r.stops[r.atStop]!) < 1, `${where}: at rest the offset is ${r.offset} but the stop is ${r.stops[r.atStop]}`);
          }
          if (count > 0) assert.ok(seen.some((r) => r.atStop === count - 1), `${where}: the steps reach the last stop`);
          await page.context().close();
        }
      }
    }
  } finally {
    server.close();
    await browser.close();
  }
  assert.ok(glides > 0, 'control: at least one row glided while watched');
});
