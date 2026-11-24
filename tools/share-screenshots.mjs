// Draws the share view demo (test/phone/share-demo.tsx) in light and dark and writes PNGs at deviceScaleFactor 2.
// Usage: node tools/share-screenshots.mjs <output-dir>
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? '.');
const built = await build({
  entryPoints: [join(here, '..', 'test', 'phone', 'share-demo.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const bundle = built.outputFiles.map((file) => file.text).join('');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
let written = 0;
for (const scheme of ['light', 'dark']) {
  for (const scene of ['space', 'playlist', 'offer']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 200 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`about:blank#${scene}`);
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"></body></html>');
    await page.evaluate((s) => { window.location.hash = s; }, scene);
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('h2');
    const file = join(out, `built-${scene}${scheme === 'dark' ? '-dark' : ''}.png`);
    await page.screenshot({ path: file, fullPage: true });
    written += 1;
    await context.close();
  }
}
await browser.close();
if (written !== 6) throw new Error(`wrote ${written} screenshots, expected 6`);
