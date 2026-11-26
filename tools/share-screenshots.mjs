// Draws the share view demo (test/phone/share-demo.tsx) in light and dark and writes PNGs at deviceScaleFactor 2, named <shot>-light.png and <shot>-dark.png.
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
// Each shot is a demo scene plus the taps that reach it; the safety page is opened by pressing the person's button.
const SHOTS = [
  { name: 'space', scene: 'space' },
  { name: 'playlist', scene: 'playlist' },
  { name: 'offer', scene: 'offer' },
  { name: 'people-gone', scene: 'space' },
  { name: 'safety-list', scene: 'safety' },
  { name: 'safety-numbers', scene: 'safety', taps: ['Check safety code, Maya'] },
  { name: 'safety-qr', scene: 'safety', taps: ['Check safety code, Maya', 'Show QR'] },
  { name: 'safety-mismatch', scene: 'safety', taps: ['Check safety code, Maya', 'They do not match'] },
  { name: 'safety-checked', scene: 'safety-checked' },
  { name: 'safety-changed', scene: 'safety-changed', taps: ['Review new safety code, Maya'] },
];
let written = 0;
for (const scheme of ['light', 'dark']) {
  for (const { name, scene, taps = [] } of SHOTS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 200 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`about:blank#${scene}`);
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"></body></html>');
    await page.evaluate((s) => { window.location.hash = s; }, scene);
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('h2');
    for (const tap of taps) await page.locator(`[aria-label="${tap}"], button:text-is("${tap}"), [role="tab"]:text-is("${tap}")`).first().click();
    const file = join(out, `${name}${scheme === 'dark' ? '-dark' : '-light'}.png`);
    await page.screenshot({ path: file, fullPage: true });
    written += 1;
    await context.close();
  }
}
await browser.close();
if (written !== SHOTS.length * 2) throw new Error(`wrote ${written} screenshots, expected ${SHOTS.length * 2}`);
