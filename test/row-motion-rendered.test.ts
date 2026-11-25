/**
 * The row's own motion in a real browser (tools/proof/row-motion-entry.tsx.txt in headless Chromium, every slot's rect read on each
 * animation frame). A strip that fits is centered by its container, so opening or closing a page moves every other panel; these check
 * that move glides on the slide's clock rather than landing in one frame, and that a slow wheel's pause does not send the row
 * gliding to the next stop. Each glide check also reads the total distance moved, so "no frame jumped" is a result and not a row
 * that never moved. Without a browser every test here is skipped loudly (test/support/chromium.ts).
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
  dir = mkdtempSync(join(tmpdir(), 'row-motion-rendered-'));
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'row-motion-rendered');
  if (browser === undefined) return false;
  if (!built) {
    built = true;
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/row-motion-entry.tsx.txt'), 'utf8'));
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

async function open(width: number, start: number): Promise<Page> {
  const ctx = await browser!.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  // tsx names each arrow function it compiles through a `__name` helper the page does not have.
  await page.addInitScript('window.__name = (f) => f');
  await page.goto(`http://localhost:${port}/?slots=1,1,1,1,1,1&start=${start}`);
  await page.waitForFunction(() => (window as any).__s.ready());
  await page.waitForTimeout(1200);
  return page;
}

interface Frame { t: number; x: Record<string, number> }

/** Runs `op(id)` on the page and reads every slot's left on each frame for `ms`, the frame before the op included. */
async function framesOf(page: Page, op: 'add' | 'close', id: string, ms: number): Promise<Frame[]> {
  return page.evaluate(
    async ([op, id, ms]: [string, string, number]) => {
      const s = (window as any).__s;
      const read = (t0: number) => ({ t: performance.now() - t0, x: Object.fromEntries(s.slots().map((x: any) => [x.id, x.left])) });
      const t0 = performance.now();
      const out = [read(t0)];
      s[op](id);
      await new Promise<void>((done) => {
        const tick = () => {
          out.push(read(t0));
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return out;
    },
    [op, id, ms],
  );
}

/**
 * The largest move of `id` from one frame to the next, and its total move from the first frame to the last. The first step, from
 * before the op to the first frame after it, counts whatever its length: that is the frame a jump lands in. Later steps count only
 * between frames at most 40 ms apart, so a frame the browser dropped is not read as a jump.
 */
function motionOf(frames: readonly Frame[], id: string): { largestStep: number; total: number } {
  let largestStep = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]!.x[id];
    const b = frames[k]!.x[id];
    if (a === undefined || b === undefined || (k > 1 && frames[k]!.t - frames[k - 1]!.t > 40)) continue;
    largestStep = Math.max(largestStep, Math.abs(b - a));
  }
  const first = frames[0]!.x[id]!;
  const last = frames.at(-1)!.x[id]!;
  return { largestStep, total: Math.abs(last - first) };
}

// Half a slot (one phone and one gap, 406 px), 203 px, is how far a centered row moves when a page comes or goes; a glide moves
// under half of it in the first frame after the commit, however late that frame is.
const MAX_STEP = 100;

test('opening a page in a row with room: the root glides aside, it does not jump', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(2240, 1);
  try {
    const frames = await framesOf(page, 'add', 'p2', 900);
    const root = motionOf(frames, 'root');
    assert.ok(root.total > 150, `the root moved ${root.total}px: the check below would pass on a row that never moved`);
    assert.ok(root.largestStep < MAX_STEP, `the root moved ${root.largestStep}px in one frame`);
    const p1 = motionOf(frames, 'p1');
    assert.ok(p1.largestStep < MAX_STEP, `the open page beside it moved ${p1.largestStep}px in one frame`);
  } finally {
    await page.close();
  }
});

test('closing a page below the row\'s room: the root glides back to centre, it does not jump', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(2240, 3);
  try {
    const frames = await framesOf(page, 'close', 'p2', 900);
    const root = motionOf(frames, 'root');
    assert.ok(root.total > 150, `the root moved ${root.total}px`);
    assert.ok(root.largestStep < MAX_STEP, `the root moved ${root.largestStep}px in one frame`);
  } finally {
    await page.close();
  }
});

test('the whole workspace moving sideways (a side by side cell placed again): the row goes with it at once, no glide inside it', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(2240, 2);
  try {
    const { before, after, later, running } = await page.evaluate(async () => {
      const s = (window as any).__s;
      const rootLeft = () => s.slots().find((x: any) => x.id === 'root').left as number;
      const before = rootLeft();
      s.move(400);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = rootLeft();
      const running = document.querySelector('[data-row-root]')!.getAnimations().length;
      await new Promise((r) => setTimeout(r, 600));
      return { before, after, later: rootLeft(), running };
    });
    assert.ok(Math.abs(later - before - 400) < 2, `the root ended ${later - before}px from where it was: the workspace moved 400px`);
    assert.ok(Math.abs(after - before - 400) < 2, `the root was ${after - before}px along on the first frame after the move: a glide inside the moved workspace`);
    assert.equal(running, 0, 'no glide runs on the root');
  } finally {
    await page.close();
  }
});

test('closing a page: a page sliding into the gap is never cut by the narrower window while it slides', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(2240, 3);
  try {
    const cuts = await page.evaluate(async () => {
      const s = (window as any).__s;
      const win = document.querySelector<HTMLElement>('[data-row-embla-window]')!;
      const clipRight = () => {
        const m = /^polygon\(\s*[-\d.]+px\s+[-\d.]+px,\s*([-\d.]+)px/.exec(getComputedStyle(win).clipPath);
        return win.getBoundingClientRect().left + (m === null ? win.getBoundingClientRect().width : Number(m[1]));
      };
      const out: number[] = [];
      const t0 = performance.now();
      s.close('p2');
      await new Promise<void>((done) => {
        const tick = () => {
          const p3 = s.slots().find((x: any) => x.id === 'p3');
          if (p3 !== undefined) out.push(p3.right - clipRight());
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return out;
    });
    assert.ok(cuts.length > 10, 'p3 was read on the frames of the close');
    assert.ok(Math.max(...cuts) <= 1, `p3 ran ${Math.max(...cuts)}px past the clip`);
  } finally {
    await page.close();
  }
});

test('a slow, uneven wheel: the row takes one step in one glide, never stalling or turning back, and rests on it', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(1300, 6);
  try {
    const { seen, start } = await page.evaluate(async (): Promise<{ seen: number[]; start: number }> => {
      const s = (window as any).__s;
      const win = document.querySelector('[data-row-embla-window]')!;
      const wheel = (dx: number) => win.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, bubbles: true, cancelable: true }));
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const start = s.offset();
      const seen: number[] = [];
      let on = true;
      const sample = () => {
        seen.push(s.offset());
        if (on) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      for (const pause of [16, 90, 240, 60, 310, 130, 80, 270]) {
        wheel(6);
        await sleep(pause);
      }
      await sleep(900);
      on = false;
      return { seen, start };
    });
    const moved = seen[seen.length - 1]! - start;
    assert.ok(Math.abs(moved - 406) < 1, `the row ended ${moved}px along: one stop is 406px`);
    const back = Math.max(0, ...seen.slice(1).map((v: number, k: number) => seen[k]! - v));
    assert.ok(back < 1, `the row turned back ${back}px`);
    // Between leaving the start and nearing the stop every frame moves: a stall there is the jitter this guards.
    const gliding = seen.filter((v: number) => v - start > 4 && v - start < 390);
    assert.ok(gliding.length > 5, `only ${gliding.length} frames of the glide were read`);
    const still = gliding.slice(1).filter((v: number, k: number) => Math.abs(v - gliding[k]!) < 0.05).length;
    assert.ok(still <= 2, `${still} of ${gliding.length} glide frames stood still`);
  } finally {
    await page.close();
  }
});
