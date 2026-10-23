import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

// The handle is a touch press in Chromium only: desktop WebKit cannot synthesize touch, and the iOS Simulator check covers it.
test.skip(({ browserName }) => browserName !== 'chromium', 'touch is synthesized through CDP, which is Chromium only');

const built = await build({
  entryPoints: [join(here, 'touch-close-demo.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const bundle = built.outputFiles.map((file) => file.text).join('');

const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body style="margin:0"><div id="root"></div></body></html>';

test.beforeEach(async ({ page }) => {
  await page.setContent(html);
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-grab]')).toBeVisible();
});

/** A one-finger touch on the handle that moves `distance` px down (positive) or up (negative) in steps, after `holdMs`. */
async function touchDrag(page: import('@playwright/test').Page, distance: number, holdMs: number): Promise<void> {
  const box = await page.locator('[data-grab]').boundingBox();
  if (!box) throw new Error('the handle is drawn');
  const session = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: { x: number; y: number }[]) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: at });
  await touch('touchStart', [{ x, y }]);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  const steps = 10;
  for (let step = 1; step <= steps; step++) await touch('touchMove', [{ x, y: y + Math.round((distance * step) / steps) }]);
  await touch('touchEnd', []);
  // A close runs its exit animation before onClose.
  await page.waitForTimeout(1000);
}

test('a vertical touch drag on the handle scrolls the page and does not start a close', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 800));
  await touchDrag(page, 300, 0);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(800);
  expect(await page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(0);
});

test('a touch held on the handle, then dragged down, does not start the close', async ({ page }) => {
  await touchDrag(page, 300, 400);
  expect(await page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(0);
});
