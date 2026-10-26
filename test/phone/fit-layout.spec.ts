import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

const built = await build({
  entryPoints: [join(here, 'fit-demo.tsx')],
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

// The phone the simulator showed the header cut off on, and the profile's own screen, which is shorter.
for (const height of [714, undefined]) {
  test(`every panel's header and frame are on screen${height === undefined ? '' : ` at 402 x ${height}`}`, async ({ page }) => {
    if (height !== undefined) await page.setViewportSize({ width: 402, height });
    await page.setContent(html);
    await page.addScriptTag({ content: bundle });
    await expect(page.getByText('One line 0')).toBeVisible();
    await expect.poll(() => page.locator('[data-phone-frame]').count()).toBe(3);
    const boxes = await page.evaluate(() => {
      const top = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect().top);
      const frames = [...document.querySelectorAll('[data-phone-frame]')].map((el) => el.getBoundingClientRect().bottom);
      return { headers: top('[data-panel-chrome-part="header"]'), frames, height: window.innerHeight };
    });
    expect(boxes.headers.length).toBeGreaterThan(0);
    for (const top of boxes.headers) expect(top).toBeGreaterThanOrEqual(0);
    for (const bottom of boxes.frames) expect(bottom).toBeLessThanOrEqual(boxes.height);
  });
}

// A page whose row fills the screen cannot pan vertically, so the browser sends no pointercancel and the moves keep coming.
test('a vertical touch drag on a grab bar never moves the panel', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'desktop WebKit cannot synthesize touch; covered by the iOS Simulator check');
  await page.setViewportSize({ width: 402, height: 714 });
  await page.setContent(html);
  await page.addScriptTag({ content: bundle });
  const bar = await page.locator('[data-panel-grab-bar]').first().boundingBox();
  if (!bar) throw new Error('the first panel draws a grab bar');
  const session = await page.context().newCDPSession(page);
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;
  const offset = () => page.evaluate(() => /translateY\((-?[\d.]+)px\)/.exec(document.querySelector<HTMLElement>('[data-drag-to-close]')!.style.transform)?.[1] ?? '0');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 15; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 20 }] });
    expect(Number(await offset())).toBe(0);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.locator('[data-phone-frame]').count()).toBe(3);
});
