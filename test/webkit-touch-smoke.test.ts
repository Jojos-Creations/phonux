/**
 * A touch smoke test in WebKit, the engine a Capacitor iPhone web view runs. It runs only where WebKit is installed
 * (`npx playwright install webkit`); elsewhere it reports a skip with the reason, so a run never passes it silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_REASON =
  'WebKit is not installed here, so the WebKit touch smoke did not run; run `npx playwright install webkit` where WebKit runs, or the coordinator Mac check (`npm run phone:webkit`)';

interface Locator {
  count(): Promise<number>;
  tap(): Promise<void>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
  locator(selector: string): Locator;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
}
interface Browser {
  newContext(o: { viewport: { width: number; height: number }; hasTouch: boolean; isMobile: boolean }): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  webkit: { launch(): Promise<Browser> };
}

async function loadPlaywright(): Promise<PlaywrightModule | undefined> {
  try {
    return (await import('@playwright/test')) as unknown as PlaywrightModule;
  } catch {
    return undefined;
  }
}

test('a touch tap on the phone demo lands in WebKit with no sideways scroll', async (t) => {
  const pw = await loadPlaywright();
  if (pw === undefined) return void t.skip('@playwright/test is not installed');
  let browser: Browser;
  try {
    browser = await pw.webkit.launch();
  } catch {
    return void t.skip(SKIP_REASON);
  }
  const built = await build({
    entryPoints: [join(ROOT, 'test/phone/demo.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'webkit-touch-'));
  writeFileSync(join(dir, 'demo.js'), built.outputFiles.map((file) => file.text).join(''));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body style="margin:0"><div id="root"></div><script src="demo.js"></script></body></html>';
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/demo.js') === true) {
      res.setHeader('content-type', 'text/javascript');
      res.end(readFileSync(join(dir, 'demo.js')));
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(html);
    }
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('text=Hello from a phone-shaped panel.');
    await page.locator('text=Hello from a phone-shaped panel.').tap();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    await context.close();
  } finally {
    server.close();
    await browser.close();
  }
});
