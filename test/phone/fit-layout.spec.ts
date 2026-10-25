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
