/**
 * One glide after a window resize settles, in a real browser (tools/proof/window-glide-entry.tsx.txt in headless Chromium: the
 * default mount with the phone fit on, in a box sized frame by frame). The sizes are the ones Chrome handed a page on an iMac
 * (ux-week-out/maximize-probe, 2026-11-25): Window > Fill, one size a frame for ~345 ms; Zoom, an 8 px nudge then the final size at
 * ~340 ms; entering full screen, the width at ~23 ms then two height-only changes at ~585 and ~625 ms; leaving it, a height-only
 * change then the final size ~30 ms later. While the sizes come each lands at once; once they stop the new phone size glides in once.
 * Each glide check also reads the distance moved, so "no frame jumped" is a result and not a row that never moved. Without a browser
 * every test here is skipped loudly (test/support/chromium.ts).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, type LaunchedBrowser } from './support/chromium.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
// The slice of Playwright's Page these tests use, typed loosely: a page is only reached through functions it evaluates.
type Page = any;

let browser: LaunchedBrowser<Page> | undefined;
let server: Server | undefined;
let port = 0;
let dir = '';
let built = false;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'window-glide-rendered-'));
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'window-glide-rendered');
  if (browser === undefined) return false;
  if (!built) {
    built = true;
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/window-glide-entry.tsx.txt'), 'utf8'));
    await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT_DIR }, nodePaths: [join(ROOT_DIR, 'node_modules')], logLevel: 'silent' });
    const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
    server = createServer((req, res) => {
      const js = req.url?.startsWith('/out.js') === true;
      res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
      res.end(js ? readFileSync(join(dir, 'out.js')) : html);
    }).listen(0);
    port = (server.address() as { port: number }).port;
  }
  return true;
}

async function open(size: string, n: number, reduced = false): Promise<Page> {
  const ctx = await browser!.newContext({ viewport: { width: 2400, height: 1300 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/?n=${n}&size=${size}`);
  await page.waitForFunction(() => (window as any).__s.ready());
  await page.waitForTimeout(1500);
  return page;
}

type Step = [number, number, number];
interface Frame { t: number; x: Record<string, number>; w: Record<string, number>; root: number | null; view: number; size: [number, number] }
interface Seen { first: number; startTime: number; props: string[]; on: string; current0: number | null }
interface Run { frames: Frame[]; writes: Record<string, number[]>; anims: Seen[]; last: number }

const perFrame = (from: [number, number], sizes: [number, number][]): Step[] => sizes.map(([w, h], k) => [k * 16, w, h]);
/** Measured shapes: [ms after the first change, width, height]. */
const SHAPES = {
  fillUp: { from: '900x557', steps: perFrame([900, 557], [[911, 562], [1053, 621], [1260, 708], [1466, 794], [1643, 869], [1784, 928], [1892, 973], [1973, 1007], [2031, 1031], [2072, 1048], [2101, 1061], [2122, 1069], [2136, 1075], [2145, 1079], [2152, 1082], [2156, 1084], [2159, 1085], [2161, 1086], [2163, 1086], [2164, 1087], [2165, 1087]]) },
  fillDown: { from: '2165x1087', steps: perFrame([2165, 1087], [[2110, 1064], [1928, 988], [1717, 899], [1521, 818], [1350, 745], [1210, 690], [1100, 645], [1020, 612], [965, 590], [935, 578], [918, 570], [909, 566], [905, 562], [903, 560], [902, 559], [901, 558]]) },
  zoomUp: { from: '901x557', steps: [[0, 909, 562], [339, 2165, 1087]] as Step[] },
  zoomDown: { from: '2165x1087', steps: [[0, 2153, 1083], [353, 901, 558]] as Step[] },
  fullScreenEnter: { from: '901x557', steps: [[0, 901, 645], [23, 2240, 1204], [584, 2240, 1163], [623, 2240, 1116]] as Step[] },
  fullScreenExit: { from: '2240x1116', steps: [[0, 2240, 1040], [30, 901, 557]] as Step[] },
};

async function drive(page: Page, steps: Step[], ms = 1800): Promise<Run> {
  return page.evaluate(([s, m]: [Step[], number]) => (window as any).__s.drive(s, m), [steps, ms]);
}

/** What the frames after the last size show: each panel's largest one-frame move against its whole move, the glides that started, and the width writes. */
function settleOf(run: Run) {
  // The frame that applied the last size, then the first frame drawn with it: the window has stopped from there on.
  const applied = run.frames.findIndex((f) => f.t >= run.last);
  const from = applied + 1;
  const after = run.frames.slice(from);
  const stopT = after[0]!.t;
  const ids = Object.keys(after[0]!.x);
  const panels = ids.map((id) => {
    let largest = 0;
    for (let k = 1; k < after.length; k++) {
      const a = after[k - 1]!.x[id];
      const b = after[k]!.x[id];
      if (a === undefined || b === undefined || after[k]!.t - after[k - 1]!.t > 40) continue;
      largest = Math.max(largest, Math.abs(b - a));
    }
    let widthLargest = 0;
    for (let k = 1; k < after.length; k++) {
      const a = after[k - 1]!.w[id];
      const b = after[k]!.w[id];
      if (a !== undefined && b !== undefined && after[k]!.t - after[k - 1]!.t <= 40) widthLargest = Math.max(widthLargest, Math.abs(b - a));
    }
    const total = Math.abs(after.at(-1)!.x[id]! - after[0]!.x[id]!);
    const widthTotal = Math.abs(after.at(-1)!.w[id]! - after[0]!.w[id]!);
    return { id, largest, total, widthLargest, widthTotal };
  });
  const glides = run.anims.filter((a) => a.first >= stopT - 0.5);
  const starts = [...new Set(glides.map((a) => Math.round(a.startTime)))];
  const intervals = run.frames.slice(1).map((f, k) => f.t - run.frames[k]!.t).sort((a, b) => a - b);
  const frameMs = intervals[Math.floor(intervals.length / 2)]!;
  const writes = Object.fromEntries(Object.entries(run.writes).map(([k, ts]) => [k, ts.filter((t) => t >= stopT - 0.5).length]));
  return { panels, glides, starts, frameMs, writes, stopT };
}

/**
 * Two ways a panel can turn back. `strict`: any move against the one before it within two frames, ignoring moves under half a pixel;
 * the glide after the window stops must have none. `flash`: a frame drawn away from its neighbours that the next frame or the one after
 * takes back to within a quarter of the move (a frame of mixed old and new numbers, 822 -> 1222 -> 842 in the 2026-11-24 probe). While the window changes a step may
 * turn a panel back for real (the count on screen changes as the window crosses a size), so there only a flash counts, and only while the row's window keeps its width (the same panels on screen).
 */
function reversals(frames: readonly Frame[], id: string, kind: 'strict' | 'flash'): string[] {
  const xs = frames.map((f) => f.x[id]);
  const found: string[] = [];
  for (let k = 0; k + 2 < xs.length; k++) {
    const a = xs[k];
    const b = xs[k + 1];
    if (a === undefined || b === undefined || Math.abs(b - a) < 0.5) continue;
    for (const j of [k + 2, k + 3]) {
      const c = xs[j];
      const before = xs[j - 1];
      if (c === undefined || before === undefined) continue;
      if (kind === 'strict' && Math.abs(c - before) >= 0.5 && Math.sign(c - before) !== Math.sign(b - a)) found.push(`${Math.round(frames[k]!.t)}ms ${a} ${b} ${before} ${c}`);
      // The row's window holding its width throughout: the same number of panels on screen, so nothing but the numbers moved it.
      const sameView = frames.slice(k, j + 1).every((f) => Math.abs(f.view - frames[k]!.view) < 0.5);
      if (kind === 'flash' && sameView && Math.abs(b - a) > 2 && Math.abs(c - a) <= Math.max(2, Math.abs(b - a) / 4)) found.push(`${Math.round(frames[k]!.t)}ms ${a} ${b} ${before} ${c}`);
    }
  }
  return found;
}

function checkOneGlide(name: string, run: Run): void {
  const s = settleOf(run);
  const report = JSON.stringify({ name, panels: s.panels, starts: s.starts, frameMs: s.frameMs, glides: s.glides.map((g) => ({ on: g.on, props: g.props, c0: g.current0, start: Math.round(g.startTime) })).slice(0, 12), writes: s.writes });
  if (process.env.WINDOW_GLIDE_TRACE === '1') process.stderr.write(`${report}\n`);
  if (process.env.WINDOW_GLIDE_TRACE === '2') process.stderr.write(`TRACE ${name} ${run.frames.slice(0, 40).map((f) => `${Math.round(f.t)}:${f.size.join('x')}:${Object.values(f.x).map((v) => Math.round(v)).join(',')}:r${Math.round(f.root ?? 0)}`).join(' | ')}\n`);
  const moved = Math.max(...s.panels.map((p) => p.total));
  assert.ok(moved >= 5, `${name}: after the window stopped the furthest panel moved ${moved}px, so no glide was seen: ${report}`);
  for (const p of s.panels) if (p.total >= 3) assert.ok(p.largest <= p.total / 3 + 0.5, `${name}: ${p.id} moved ${p.largest}px in one frame of ${p.total}px after the window stopped: ${report}`);
  // The drawn size rides the same glide: a panel whose size box was on screen before and after grows or shrinks over many frames.
  const sized0 = s.panels.filter((p) => p.widthTotal >= 6 && p.widthTotal < 200);
  assert.ok(sized0.length > 0, `${name}: no panel's drawn size changed after the window stopped: ${report}`);
  for (const p of sized0) assert.ok(p.widthLargest <= p.widthTotal / 3 + 0.5, `${name}: ${p.id}'s drawn width changed ${p.widthLargest}px in one frame of ${p.widthTotal}px: ${report}`);
  assert.equal(s.starts.length, 1, `${name}: ${s.starts.length} glides started after the window stopped (one start time each): ${report}`);
  const firstProgress = Math.min(...s.glides.map((g) => g.current0 ?? Number.POSITIVE_INFINITY));
  assert.ok(firstProgress <= s.frameMs + 1, `${name}: the glide's first frame was already ${firstProgress}ms in (a frame is ${s.frameMs}ms): ${report}`);
  const sized = s.glides.filter((g) => g.props.some((p) => p === 'width' || p === 'height'));
  assert.equal(sized.length, 0, `${name}: ${sized.length} animations eased a panel's real width or height: ${report}`);
  for (const [k, n] of Object.entries(s.writes)) assert.ok(n <= 2, `${name}: ${k} had its width written ${n} times in the glide: ${report}`);
  const settling = run.frames.filter((f) => f.t >= s.stopT - 0.5);
  for (const p of s.panels) {
    assert.deepEqual(reversals(settling, p.id, 'strict'), [], `${name}: ${p.id} turned back within two frames of the glide: ${report}`);
    assert.deepEqual(reversals(run.frames, p.id, 'flash'), [], `${name}: ${p.id} was drawn one frame away and back: ${report}`);
  }
}

for (const [name, shape] of Object.entries(SHAPES)) {
  test(`${name}: each size lands at once, then the new phone size glides in once, from where the row was drawn`, async (t) => {
    if (!(await ready(t))) return;
    const page = await open(shape.from, 4);
    try {
      const running = drive(page, shape.steps);
      // WINDOW_GLIDE_SHOT=<dir>: a picture of the glide's middle, to look at the frames' rings and corners as they move.
      const shots = process.env.WINDOW_GLIDE_SHOT;
      if (shots !== undefined) {
        await page.waitForTimeout(Math.max(shape.steps.at(-1)![0] + 200, 700) + 330);
        await page.screenshot({ path: join(shots, `${name}-mid.png`) });
      }
      checkOneGlide(name, await running);
    } finally {
      await page.close();
    }
  });
}

test('Reduce Motion: every size lands at once, the new phone size with it, and nothing glides after the window stops', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(SHAPES.zoomUp.from, 4, true);
  try {
    const run = await drive(page, SHAPES.zoomUp.steps, 1200);
    const s = settleOf(run);
    const first = run.frames[0]!;
    const end = run.frames.at(-1)!;
    const resized = Math.max(...Object.keys(end.w).map((id) => Math.abs(end.w[id]! - first.w[id]!)));
    assert.ok(resized >= 6, `the panels' drawn size changed ${resized}px across the zoom, so the checks below can fail`);
    assert.deepEqual(s.glides.map((g) => g.on), [], 'no glide starts after the window stops');
    for (const p of s.panels) assert.ok(p.total < 0.5 && p.widthTotal < 0.5, `${p.id} moved ${p.total}px and resized ${p.widthTotal}px after the window stopped`);
  } finally {
    await page.close();
  }
});
