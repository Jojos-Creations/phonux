/**
 * What the row's drawing pass writes for a held panel, seen in a real browser: where the panel is drawn after the row is measured
 * again, how far it may travel, and the cut at the window's edge. jsdom has no layout, so none of it shows there. Needs
 * Playwright and Chromium; it skips when either is missing. The page is tools/proof/edge-hold-entry.tsx.txt.
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './support/chromium.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAP = 16;

interface Page {
  goto(url: string): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<unknown>;
  waitForFunction(fn: () => unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: ((arg: A) => T) | string, arg?: A): Promise<T>;
}

async function rig(t: TestContext): Promise<{ open(query: string, width?: number): Promise<Page> } | undefined> {
  const browser = await launchChromium<Page>(t, 'row-draw-chromium.test.ts');
  if (browser === undefined) return undefined;
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'row-draw-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/edge-hold-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    server.close();
  });
  return {
    async open(query, width = 1000) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
      await page.goto(`http://localhost:${port}/?${query}`);
      await page.waitForFunction(() => (window as unknown as { __e?: { provided(): unknown } }).__e?.provided());
      await page.waitForTimeout(400);
      return page;
    },
  };
}

const moveTo = async (page: Page, at: number): Promise<void> => {
  await page.evaluate(`window.__e.moveTo(${at})`);
  await page.waitForTimeout(150);
};
/** Where the slot of `id` is drawn, from the scroller's left edge. */
const slotRect = (page: Page, id: string): Promise<{ left: number; right: number }> =>
  page.evaluate(
    `(() => { const c = document.querySelector('[data-row-scroller]').getBoundingClientRect(); const r = document.querySelector('[data-row-slot][data-row-id="${id}"]').getBoundingClientRect(); return { left: r.left - c.left, right: r.right - c.left }; })()`,
  );
const heldId = (page: Page): Promise<string> => page.evaluate('window.__e.provided().rowNumbers.held[0].id');
/** The slot drawn on top at `x` px from the scroller's left, at the row's middle. */
const coverAt = (page: Page, x: number): Promise<string | null> =>
  page.evaluate(
    `(() => { const cr = document.querySelector('[data-row-scroller]').getBoundingClientRect(); return document.elementFromPoint(cr.left + ${x}, cr.top + 300)?.closest('[data-row-id]')?.dataset.rowId ?? null; })()`,
  );

test('a held panel measured again while the row is scrolled returns to its own place when the row does', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1&holds=p1:left');
  const id = await heldId(page);
  await moveTo(page, 900);
  assert.equal((await slotRect(page, id)).left, GAP, 'control: scrolled on, the panel is held at its edge');
  // A resize commits the row, which measures the held box where it is drawn now, shifted.
  await page.setViewportSize({ width: 1020, height: 800 });
  await page.waitForTimeout(400);
  await moveTo(page, 0);
  assert.equal((await slotRect(page, id)).left, GAP, 'back at the start the panel is where its line puts it');
  await moveTo(page, 600);
  assert.equal((await slotRect(page, id)).left, GAP, 'and held again further on');
});

test('a held panel never travels past the row\'s own ends, whichever side holds it', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const left = await r.open('slots=1,1,1,1,1,1&holds=p1:left');
  const leftId = await heldId(left);
  const max = await left.evaluate<number>('window.__e.maxScroll()');
  await moveTo(left, max);
  assert.equal((await slotRect(left, leftId)).left, GAP, 'control: at the end the panel is held at its edge');
  await moveTo(left, max + 600);
  const past = await slotRect(left, leftId);
  assert.ok(past.left < GAP, `carried past the end, the row takes the held panel with it: ${past.left}`);
  const lastRight = Math.max(...(await left.evaluate<number[]>(`[...document.querySelectorAll('[data-row-slot]')].filter((e) => e.dataset.rowId !== '${leftId}').map((e) => e.getBoundingClientRect().right - document.querySelector('[data-row-scroller]').getBoundingClientRect().left)`)));
  assert.ok(past.right <= lastRight + 0.5, `the held panel stays inside the row's end: right ${past.right}, row ends ${lastRight}`);

  const right = await r.open('slots=1,1,1,1,1,1&holds=p1:right');
  const rightId = await heldId(right);
  await moveTo(right, 0);
  const home = await slotRect(right, rightId);
  await moveTo(right, -600);
  const before = await slotRect(right, rightId);
  assert.ok(before.left > home.left, `carried before the start, the row takes the held panel with it: ${before.left} against ${home.left}`);
});

test('a row that scrolls freely with a stuck panel is cut at the window\'s edges', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1&gesture=off&holds=p2:both');
  assert.equal(await page.evaluate('window.__e.provided().rowNumbers.stops.length'), 0, 'control: the row scrolls freely');
  assert.equal(await page.evaluate('window.__e.provided().rowNumbers.stuck.length'), 1, 'control: one panel is stuck');
  await moveTo(page, 300);
  assert.notEqual(await page.evaluate("document.querySelector('[data-row-window]').style.clipPath"), '', 'the window cuts the strip');
  assert.equal(await coverAt(page, 996), null, 'nothing is drawn in the window\'s right gap');
});

test('a row that scrolls freely with a held panel is cut at the window\'s edges', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1&gesture=off&holds=p1:right');
  assert.equal(await page.evaluate('window.__e.provided().rowNumbers.stops.length'), 0, 'control: the row scrolls freely');
  assert.equal(await page.evaluate('window.__e.provided().rowNumbers.held.length'), 1, 'control: one panel is held');
  await moveTo(page, 300);
  assert.notEqual(await page.evaluate("document.querySelector('[data-row-window]').style.clipPath"), '', 'the window cuts the strip');
  assert.equal(await coverAt(page, 992), null, 'nothing is drawn in the window\'s right gap');
});
