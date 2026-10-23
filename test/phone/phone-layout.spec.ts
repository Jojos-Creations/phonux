import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

// Bundled once per run: the demo imports the library source, so the phone sees the code under test.
const built = await build({
  entryPoints: [join(here, 'demo.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const bundle = built.outputFiles.map((file) => file.text).join('');

const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>
<body style="margin:0"></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.setContent(html);
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText('Hello from a phone-shaped panel.')).toBeVisible();
});

test('the page never scrolls sideways at phone width', async ({ page }) => {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

// Synthetic touch events, so the same test runs in WebKit and Chromium. They do not scroll the page
// natively; this guards against script moving the page on a touch. The row's own swipe is checked with #429.
test('a touch swipe on the page does not scroll the page itself', async ({ page }) => {
  const scrolled = await page.evaluate(() => {
    const target = document.body;
    const point = (x: number) => new Touch({ identifier: 1, target, clientX: x, clientY: 300 });
    const fire = (type: string, x: number) => {
      const touch = point(x);
      const list = type === 'touchend' ? [] : [touch];
      target.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: [touch], bubbles: true, cancelable: true }));
    };
    fire('touchstart', 300);
    for (let x = 270; x >= 0; x -= 30) fire('touchmove', x);
    fire('touchend', 0);
    return window.scrollX;
  });
  expect(scrolled).toBe(0);
});

test('the viewport reports the phone width, not a desktop width', async ({ page }) => {
  const size = page.viewportSize();
  if (!size) throw new Error('the phone profile sets a viewport');
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(size.width);
});
