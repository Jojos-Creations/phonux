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

test('a touch swipe on the page does not scroll the page itself', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'desktop WebKit cannot synthesize touch; covered by the iOS Simulator check');
  const size = page.viewportSize();
  if (!size) throw new Error('the phone profile sets a viewport');
  const y = Math.round(size.height / 2);
  const session = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await touch('touchStart', size.width - 20);
  for (let step = 1; step <= 10; step++) await touch('touchMove', size.width - 20 - step * 30);
  await touch('touchEnd', 0);
  const scrolled = await page.evaluate(() => window.scrollX);
  expect(scrolled).toBe(0);
});

test('the viewport reports the phone width, not a desktop width', async ({ page }) => {
  const size = page.viewportSize();
  if (!size) throw new Error('the phone profile sets a viewport');
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(size.width);
});
