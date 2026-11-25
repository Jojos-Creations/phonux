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

test('a slow wheel that pauses mid-creep: the row holds still through the pause', async (t) => {
  if (!(await ready(t))) return;
  const page = await open(1300, 6);
  try {
    const { during, moved } = await page.evaluate(async () => {
      const s = (window as any).__s;
      const win = document.querySelector('[data-row-embla-window]')!;
      const wheel = (dx: number) => win.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, bubbles: true, cancelable: true }));
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const start = s.offset();
      for (let k = 0; k < 30; k++) {
        wheel(2);
        await sleep(16);
      }
      // The row trails the wheel: let it reach the wheel's target before the pause is read.
      await sleep(40);
      const seen: number[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 200) {
        seen.push(s.offset());
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { during: Math.max(...seen) - Math.min(...seen), moved: seen[0]! - start };
    });
    assert.ok(moved > 30, `the creep moved the row ${moved}px: a row the wheel never reached would hold still too`);
    assert.ok(during < 8, `the row moved ${during}px during a 200 ms pause in a slow wheel`);
  } finally {
    await page.close();
  }
});
