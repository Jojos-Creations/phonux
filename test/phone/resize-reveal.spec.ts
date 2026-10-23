import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

const built = await build({
  entryPoints: [join(here, 'resize-reveal-demo.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const bundle = built.outputFiles.map((file) => file.text).join('');

test('under StrictMode, a scroll issued with a resize clear reveals the grown panel whole', async ({ page }) => {
  // A window wide enough for the grown panel (two phone widths) to be shown whole.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-row-scroller]')).toBeVisible();

  const wholeInWindow = () =>
    page.evaluate(() => {
      const slot = document.querySelector<HTMLElement>('[role="group"][aria-label^="Grow"]')!;
      const r = slot.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth;
    });
  // Grown while the resize mark holds the row: the panel is now wider than the window's share, and half out to the right.
  await page.evaluate(() => {
    const w = window as unknown as { tall: { setSlots(n: number): void }; setGrowResizing: (on: boolean) => void };
    w.setGrowResizing(true);
    w.tall.setSlots(2);
  });
  await page.waitForTimeout(300);
  expect(await wholeInWindow(), 'control: the grown panel starts out of the window').toBe(false);

  // The clear and the scroll land in the same tick, as a host that clears the mark and then scrolls does.
  await page.evaluate(() => {
    const w = window as unknown as { tall: { scrollTo(align: string): unknown }; setGrowResizing: (on: boolean) => void };
    w.setGrowResizing(false);
    w.tall.scrollTo('into-view');
  });
  await page.waitForTimeout(1500);
  expect(await wholeInWindow()).toBe(true);
});
