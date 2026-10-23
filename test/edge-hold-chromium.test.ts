/**
 * A held panel in a real layout: Chromium scrolls the row, and the held panel must stay at its edge while the strip slides under it,
 * and a panel that cannot fit must scroll normally. Needs Playwright and Chromium; it skips when either is missing (PLAYWRIGHT_DIR=<a
 * directory whose node_modules holds playwright> finds a copy elsewhere). WebKit and Firefox are not run here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Page {
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
}
interface Browser {
  newContext(o: { viewport: { width: number; height: number } }): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: { launch(): Promise<Browser> };
}

async function loadPlaywright(): Promise<PlaywrightModule | undefined> {
  try {
    const from = process.env.PLAYWRIGHT_DIR === undefined ? undefined : createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright');
    const ns = (await import(from === undefined ? 'playwright' : pathToFileURL(from).href)) as PlaywrightModule & { default?: PlaywrightModule };
    return ns.chromium === undefined ? ns.default : ns;
  } catch {
    return undefined;
  }
}

/** One row as the page reports it: the held panels, the rest of the strip, and where each slot sits in the window. */
interface Geometry {
  scrollLeft: number;
  maxScroll: number;
  windowWidth: number;
  held: { id: string; side: string }[];
  /** The stops a stepping row rests on; empty when the row does not step. */
  stops: number[];
  rects: Record<string, { left: number; right: number }>;
  /** The slot on top at a point 200 px in from the window's left, and from its right, at the row's middle. */
  coverLeft: string | null;
  coverRight: string | null;
}

const GAP = 16;
const PHONE = 390;

test('a held panel stays at its edge in Chromium while the strip scrolls under it, and a panel that cannot fit lets go', async (t) => {
  const pw = await loadPlaywright();
  if (pw === undefined) return void t.skip('playwright is not installed');
  let browser: Browser;
  try {
    browser = await pw.chromium.launch();
  } catch {
    return void t.skip('chromium is not installed');
  }
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'edge-hold-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/edge-hold-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  const open = async (query: string): Promise<Page> => {
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForSelector('[data-row-strip]');
    await page.waitForTimeout(300);
    return page;
  };
  const measure = (page: Page): Promise<Geometry> =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('[data-row-scroller]')!;
      const cr = c.getBoundingClientRect();
      const rects: Record<string, { left: number; right: number }> = {};
      for (const el of document.querySelectorAll<HTMLElement>('[data-row-slot]')) {
        const r = el.getBoundingClientRect();
        rects[el.dataset.rowId!] = { left: r.left - cr.left, right: r.right - cr.left };
      }
      // The held panel covers the strip panels that slide under it: whatever is on top at 200 px in from either side is the held one.
      const y = cr.top + cr.height / 2;
      const coverLeft = document.elementFromPoint(cr.left + 200, y)?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? null;
      const coverRight = document.elementFromPoint(cr.right - 200, y)?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? null;
      const e = (window as unknown as { __e: { provided(): { rowNumbers: { held: { id: string; side: string }[]; windowWidth: number; stops: number[] } } } }).__e.provided();
      return { scrollLeft: c.scrollLeft, maxScroll: c.scrollWidth - c.clientWidth, windowWidth: e.rowNumbers.windowWidth, held: e.rowNumbers.held, stops: e.rowNumbers.stops, rects, coverLeft, coverRight };
    });
  const scrollTo = async (page: Page, at: number): Promise<void> => {
    await page.evaluate((x) => {
      document.querySelector<HTMLElement>('[data-row-scroller]')!.scrollLeft = x;
    }, at);
    await page.waitForTimeout(120);
  };
  const sweep = async (page: Page, id: string): Promise<{ at: number; left: number; right: number; coverLeft: string | null; coverRight: string | null }[]> => {
    const out: { at: number; left: number; right: number; coverLeft: string | null; coverRight: string | null }[] = [];
    const first = await measure(page);
    for (const at of [0, 300, 900, first.maxScroll]) {
      await scrollTo(page, at);
      const g = await measure(page);
      const r = g.rects[id]!;
      out.push({ at: g.scrollLeft, left: r.left, right: r.right, coverLeft: g.coverLeft, coverRight: g.coverRight });
    }
    return out;
  };
  try {
    // 1. Off: the control. Panel p1 scrolls away to the left like any panel.
    const off = await open('slots=1,1,1,1,1,1');
    const offGeo = await measure(off);
    assert.deepEqual(offGeo.held, []);
    const plain = await sweep(off, '2');
    assert.ok(plain[1]!.left < plain[0]!.left - 200, 'off: the panel moves left as the row scrolls');
    assert.ok(plain[3]!.left < 0, 'off: at the end it is off the window');

    // 2. Left: p1 is held. It sits at the gap from the window's left at every scroll, and on top of the strip panels sliding under it.
    const left = await open('slots=1,1,1,1,1,1&holds=p1:left');
    const leftGeo = await measure(left);
    assert.deepEqual(leftGeo.held.map((h) => h.side), ['left']);
    const heldId = leftGeo.held[0]!.id;
    const held = await sweep(left, heldId);
    for (const row of held) {
      assert.equal(row.left, GAP, `left: held at scroll ${row.at}`);
      assert.equal(row.right - row.left, PHONE, 'left: the held panel keeps its width');
      assert.equal(row.coverLeft, heldId, `left: the held panel is on top at its edge at scroll ${row.at}`);
    }
    // A strip panel slides under it: its left edge moves through the held panel as the row scrolls.
    await scrollTo(left, 0);
    const slid = await measure(left);
    await scrollTo(left, 300);
    const under = await measure(left);
    assert.ok(under.rects['3']!.left < slid.rects['3']!.left, 'left: the strip panel moves left under the held one');
    assert.equal(under.coverLeft, heldId, 'left: where the strip panels pass under the held panel, the held one is on top');

    // 3. Right: p6 is held at the right edge. It stays flush at W - gap at every scroll.
    const right = await open('slots=1,1,1,1,1,1&holds=p6:right');
    const rightGeo = await measure(right);
    assert.deepEqual(rightGeo.held.map((h) => h.side), ['right']);
    const rightId = rightGeo.held[0]!.id;
    const rightRows = await sweep(right, rightId);
    for (const row of rightRows) {
      assert.equal(row.right, 1000 - GAP, `right: held flush at the right gap at scroll ${row.at}`);
      assert.equal(row.coverRight, rightId, `right: on top at its edge at scroll ${row.at}`);
    }

    // 4. Both: the row holds it at the left edge, as left does; there is no two-sided hold (see the setting's doc comment).
    const both = await open('slots=1,1,1,1,1,1&holds=p1:both');
    const bothGeo = await measure(both);
    assert.deepEqual(bothGeo.held.map((h) => h.side), ['left']);
    const bothRows = await sweep(both, bothGeo.held[0]!.id);
    for (const row of bothRows) assert.equal(row.left, GAP, `both: held at the left gap at scroll ${row.at}`);

    // 4b. Stepping, the library default: the row rests on its stops, and the held panel is at its edge at every one.
    const stepped = await open('slots=1,1,1,1,1,1&holds=p1:left&gesture=step');
    const steppedGeo = await measure(stepped);
    assert.deepEqual(steppedGeo.held.map((h) => h.side), ['left']);
    assert.ok(steppedGeo.stops.length >= 3, 'the row steps on a grid');
    assert.equal(steppedGeo.stops.at(-1), steppedGeo.maxScroll, 'the last stop is the end of the browser range');
    for (const stop of steppedGeo.stops) {
      await scrollTo(stepped, stop);
      const g = await measure(stepped);
      assert.equal(g.rects[steppedGeo.held[0]!.id]!.left, GAP, `step: held at stop ${stop}`);
      assert.equal(g.coverLeft, steppedGeo.held[0]!.id, `step: held on top at stop ${stop}`);
    }

    // 5. No room: a three-phone panel cannot fit beside the strip in a 968 window, so it lets go and scrolls normally.
    const tooWide = await open('slots=1,1,3,1,1,1&holds=p3:left');
    const tooWideGeo = await measure(tooWide);
    assert.deepEqual(tooWideGeo.held, [], 'no room: nothing is held');
    const scrolled = await sweep(tooWide, '4');
    assert.ok(scrolled[1]!.left < scrolled[0]!.left - 200, 'no room: the panel scrolls away like any other');
  } finally {
    await browser.close();
    server.close();
  }
});
