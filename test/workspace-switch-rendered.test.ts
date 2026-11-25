/**
 * Switching workspaces in a real browser: which way each cell moves, frame by frame. jsdom draws nothing and runs no transition,
 * so these tests build a column into a page (tools/proof/switch-entry.tsx.txt), open it in headless Chromium and read every cell's
 * place and opacity on every animation frame while the column switches.
 *
 * What each check could not pass by accident: every side is read moving (a frame part way, both cells in sight) and ending where it
 * should, so "came in from the right" is never read off a cell that snapped; the no-jump check is shown seeing motion in the same
 * run; the fade is read part way. Without a browser every test here is skipped loudly (test/support/chromium.ts).
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
type Page = any;
interface Cell { id: string; left: number; top: number; width: number; height: number; opacity: number }
interface Frame { t: number; v: Cell[] }

const W = 800;
const H = 600;
let browser: LaunchedBrowser<Page> | undefined;
let server: Server | undefined;
let port = 0;
let dir = '';

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'switch-rendered-'));
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'workspace-switch-rendered');
  if (browser === undefined) return false;
  if (server === undefined) {
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/switch-entry.tsx.txt'), 'utf8'));
    await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT_DIR }, nodePaths: [join(ROOT_DIR, 'node_modules')], logLevel: 'silent' });
    const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root" style="width:100vw;height:100vh"></div><script type="module" src="out.js"></script></body></html>';
    server = createServer((req, res) => {
      const js = req.url?.startsWith('/out.js') === true;
      res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
      res.end(js ? readFileSync(join(dir, 'out.js')) : html);
    }).listen(0);
    port = (server.address() as { port: number }).port;
  }
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function onPage(query: string, body: (page: Page) => Promise<void>, width = W): Promise<void> {
  const ctx = await browser!.newContext({ viewport: { width, height: H } });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  try {
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => (window as any).__s?.ready(), undefined, { timeout: 20000 });
    await sleep(300);
    await body(page);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await ctx.close();
  }
}

/** Records every cell on every frame for `ms`, running each step's code (with `c` the column) at its time from the start. */
function record(page: Page, steps: [number, string][], ms: number): Promise<Frame[]> {
  return page.evaluate(
    ({ steps, ms }: { steps: [number, string][]; ms: number }) => {
      const s = (window as any).__s;
      for (const [at, code] of steps) setTimeout(() => new Function('c', 'ws', code)(s.column, s.column.workspaces), at);
      return s.sample(ms, () => s.cells());
    },
    { steps, ms },
  );
}

const cellIn = (f: Frame, id: string): Cell => f.v.find((c) => c.id === id) as Cell;
const inSight = (c: Cell): boolean => c.opacity > 0.01 && c.left < W - 0.5 && c.left + c.width > 0.5 && c.top < H - 0.5 && c.top + c.height > 0.5;
const atRest = (c: Cell): boolean => Math.abs(c.left) < 0.5 && Math.abs(c.top) < 0.5;
/** The offset along the axis that side names, signed so that the side itself is positive. */
const along = (c: Cell, side: string): number => (side === 'right' ? c.left / W : side === 'left' ? -c.left / W : side === 'below' ? c.top / H : -c.top / H);
const across = (c: Cell, side: string): number => (side === 'right' || side === 'left' ? c.top / H : c.left / W);

/** The frames from the first in which anything moved off where the switch found it. */
function fromSwitch(frames: Frame[]): Frame[] {
  const first = frames[0]!;
  const k = frames.findIndex((f) => f.v.some((c) => {
    const was = cellIn(first, c.id);
    if (was === undefined) return true;
    return Math.abs(c.left - was.left) > 0.5 || Math.abs(c.top - was.top) > 0.5 || Math.abs(c.opacity - was.opacity) > 0.01;
  }));
  assert.ok(k > 0, 'positive control: something changed after the switch');
  return frames.slice(k);
}

/** Checks one switch from `from` to `to` that came in from `side`. */
function cameFrom(frames: Frame[], from: string, to: string, side: string): void {
  const moving = fromSwitch(frames);
  const first = moving[0]!;
  const last = moving[moving.length - 1]!;
  const a = along(cellIn(first, to), side);
  assert.ok(a > 0.5 && a < 1.001, `${side}: ${to} starts on that side, ${a.toFixed(3)} of the window out`);
  assert.ok(Math.abs(across(cellIn(first, to), side)) < 0.001, `${side}: and not off to another side`);
  // The first frame draws the transition at its start: the one leaving is still in place, and moves out from the next.
  assert.ok(along(cellIn(first, from), side) <= 0 && along(cellIn(first, from), side) > -0.5, `${side}: ${from} is at most a little way out`);
  assert.ok(along(cellIn(moving[2]!, from), side) < 0, `${side}: ${from} moves out the other way`);
  assert.ok(moving.some((f) => inSight(cellIn(f, to)) && inSight(cellIn(f, from)) && !atRest(cellIn(f, to))), `${side}: a frame part way, both in sight`);
  // Until the one arriving is in place; after that the one left, out of sight, waits wherever a hidden cell waits.
  const slid = moving.slice(0, moving.findIndex((f) => atRest(cellIn(f, to))) + 1);
  assert.ok(slid.length > 3, `${side}: the switch took several frames (${slid.length})`);
  for (let k = 1; k < slid.length; k += 1) {
    assert.ok(along(cellIn(slid[k]!, to), side) <= along(cellIn(slid[k - 1]!, to), side) + 1e-6, `${side}: ${to} only ever moves in`);
    assert.ok(along(cellIn(slid[k]!, from), side) <= along(cellIn(slid[k - 1]!, from), side) + 1e-6, `${side}: ${from} only ever moves out`);
  }
  assert.ok(atRest(cellIn(last, to)), `${side}: ${to} ends in place`);
  assert.ok(!inSight(cellIn(last, from)), `${side}: ${from} ends out of sight`);
}

/** The cells that moved, or changed opacity, between any two frames. */
const movedIn = (frames: Frame[]): string[] => [
  ...new Set(
    frames.slice(1).flatMap((f, k) =>
      f.v
        .filter((c) => {
          const was = cellIn(frames[k]!, c.id);
          return Math.abs(c.left - was.left) > 0.5 || Math.abs(c.top - was.top) > 0.5 || Math.abs(c.opacity - was.opacity) > 0.01;
        })
        .map((c) => c.id),
    ),
  ),
];

/** The largest move of any cell in sight between two frames, in windows per 60 Hz frame. */
function worstStep(frames: Frame[]): number {
  let worst = 0;
  for (let k = 1; k < frames.length; k += 1) {
    const [p, n] = [frames[k - 1]!, frames[k]!];
    const frames60 = Math.max(1, (n.t - p.t) / (1000 / 60));
    for (const c of n.v) {
      const was = cellIn(p, c.id);
      if (!inSight(c) && !inSight(was)) continue;
      const step = Math.max(Math.abs(c.left - was.left) / W, Math.abs(c.top - was.top) / H, Math.abs(c.opacity - was.opacity));
      worst = Math.max(worst, step / frames60);
    }
  }
  return worst;
}

test('with enterSide, each side: the new space starts on that side and the old one leaves the other way', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&enter=1', async (page) => {
    const order: [string, string, string, string][] = [['w1', 'w2', 'right', 'c.scrollTo(1)'], ['w2', 'w3', 'left', 'c.step("down")'], ['w3', 'w4', 'below', 'c.scrollTo(3)'], ['w4', 'w1', 'above', 'c.scrollTo(0)']];
    for (const [from, to, side, code] of order) {
      const frames = await record(page, [[60, `window.__side = '${side}'; ${code}`]], 1000);
      cameFrom(frames, from, to, side);
    }
    assert.deepEqual(await page.evaluate(() => (window as any).__s.asked), order.map(([from, to]) => ({ from, to })), 'asked once per switch, with the workspace left and the one arrived at');
  });
});

test('without enterSide: a space further down comes up from below and one further up comes down from above, as before', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4', async (page) => {
    const down = await record(page, [[60, 'c.scrollTo(2)']], 1000);
    cameFrom(down, 'w1', 'w3', 'below');
    assert.ok(down.every((f) => !inSight(cellIn(f, 'w2'))), 'the space passed over never shows');
    cameFrom(await record(page, [[60, 'c.scrollTo(0)']], 1000), 'w3', 'w1', 'above');
  });
});

test('a move past several is one slide of one window, and the spaces between never show', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&enter=1', async (page) => {
    const frames = await record(page, [[60, 'c.scrollTo(3)']], 1000);
    cameFrom(frames, 'w1', 'w4', 'right');
    assert.ok(frames.every((f) => !inSight(cellIn(f, 'w2')) && !inSight(cellIn(f, 'w3'))), 'w2 and w3 never show');
  });
});

test('a workspace made and made current in the same turn slides in from its side too', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&enter=1', async (page) => {
    cameFrom(await record(page, [[60, "c.scrollTo(c.addWorkspace({ id: 'w5' }))"]], 1000), 'w1', 'w5', 'right');
  });
});

test('a removed current workspace: the one taking its place comes in from the side enterSide names', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&enter=1', async (page) => {
    await record(page, [[0, 'c.scrollTo(1)']], 900);
    const frames = await record(page, [[60, "window.__side = 'left'; c.removeWorkspace(1)"]], 1000);
    const moving = fromSwitch(frames);
    assert.ok(along(cellIn(moving[0]!, 'w3'), 'left') > 0.5, 'w3 starts on the left');
    assert.ok(atRest(cellIn(moving[moving.length - 1]!, 'w3')), 'and ends in place');
    assert.deepEqual((await page.evaluate(() => (window as any).__s.asked)).at(-1), { from: 'w2', to: 'w3' }, 'asked with the removed workspace as from');
  });
});

test('Reduce Motion with enterSide: a short fade in place, and nothing moves', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&enter=1&reduce=1', async (page) => {
    const frames = await record(page, [[60, 'c.scrollTo(1)']], 700);
    const moving = fromSwitch(frames);
    for (const f of moving) {
      for (const id of ['w1', 'w2']) {
        const c = cellIn(f, id);
        if (inSight(c)) assert.ok(atRest(c), `${id} is drawn only in place while it can be seen (${c.left}, ${c.top} at ${f.t.toFixed(0)} ms)`);
      }
    }
    assert.ok(moving.some((f) => cellIn(f, 'w2').opacity > 0.1 && cellIn(f, 'w2').opacity < 0.9 && cellIn(f, 'w1').opacity > 0.1 && cellIn(f, 'w1').opacity < 0.9), 'a frame part way through the fade, both half seen');
    const done = moving.find((f) => cellIn(f, 'w2').opacity === 1)!;
    const span = done.t - moving[0]!.t;
    assert.ok(span > 80 && span < 300, `the fade takes about 150 ms (${span.toFixed(0)} ms)`);
    const last = moving[moving.length - 1]!;
    assert.ok(atRest(cellIn(last, 'w2')) && cellIn(last, 'w2').opacity === 1, 'w2 ends in place and opaque');
    assert.ok(!inSight(cellIn(last, 'w1')), 'w1 ends out of sight');
  });
});

test('Reduce Motion without enterSide: the switch is instant, as before', async (t) => {
  if (!(await ready(t))) return;
  await onPage('n=4&reduce=1', async (page) => {
    const moving = fromSwitch(await record(page, [[60, 'c.scrollTo(1)']], 400));
    assert.ok(atRest(cellIn(moving[0]!, 'w2')) && cellIn(moving[0]!, 'w2').opacity === 1, 'w2 is in place and opaque in the first frame');
    assert.ok(!inSight(cellIn(moving[0]!, 'w1')), 'w1 is gone in the same frame');
  });
});

for (const [name, query, first, second] of [
  ['with enterSide, on in the same direction', 'n=4&enter=1', 'c.scrollTo(1)', 'c.scrollTo(2)'],
  ['with enterSide, back where it came from', 'n=4&enter=1', 'c.scrollTo(1)', 'c.scrollTo(0)'],
  ['with enterSide, to a third space from the other side', 'n=4&enter=1', 'c.scrollTo(1)', "window.__side = 'left'; c.scrollTo(3)"],
  ['without enterSide, down then up', 'n=4', 'c.scrollTo(2)', 'c.scrollTo(1)'],
  ['with enterSide under Reduce Motion, a fade into a fade', 'n=4&enter=1&reduce=1', 'c.scrollTo(1)', 'c.scrollTo(2)'],
] as const) {
  test(`switching again mid-switch carries on from where everything is drawn: ${name}`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(query, async (page) => {
      const fade = query.includes('reduce=1');
      const frames = await record(page, [[60, first], [60 + (fade ? 70 : 150), second]], 1200);
      const worst = worstStep(frames);
      t.diagnostic(`largest step of a cell in sight: ${worst.toFixed(3)} of the window per frame`);
      assert.ok(worst > 0.01, `positive control: the cells were seen moving (${worst.toFixed(3)})`);
      // A slide of one window in 0.6 s moves at most about a tenth of a window per frame at its fastest; a jump is a half.
      assert.ok(worst < (fade ? 0.4 : 0.2), `no cell in sight moved more than a fifth of the window in one frame (${worst.toFixed(3)})`);
      const last = frames[frames.length - 1]!;
      const current = await page.evaluate(() => (window as any).__s.column.workspaces[(window as any).__s.column.current].id);
      assert.ok(atRest(cellIn(last, current)) && cellIn(last, current).opacity === 1, `${current} ends in place`);
      assert.deepEqual(last.v.filter((c) => inSight(c)).map((c) => c.id), [current], 'and alone in sight');
    });
  });
}

test('side by side: moving to a space the window already shows only moves focus, and asks for no side', async (t) => {
  if (!(await ready(t))) return;
  await onPage(
    'n=3&enter=1&side=1',
    async (page) => {
      let shown: { ok: boolean } = { ok: false };
      for (let k = 0; k < 100 && !shown.ok; k += 1) {
        shown = await page.evaluate(() => (window as any).__s.column.showSide(1));
        if (!shown.ok) await sleep(50);
      }
      assert.ok(shown.ok, 'positive control: the second space is shown beside the first');
      await sleep(900);
      const frames = await record(page, [[60, 'c.scrollTo(1)']], 800);
      assert.equal(await page.evaluate(() => (window as any).__s.column.current), 1, 'the second space is current');
      assert.deepEqual(movedIn(frames), [], 'no cell moved');
      assert.deepEqual(await page.evaluate(() => (window as any).__s.asked), [], 'no side was asked for');
      // Control: a space the window does not show does slide in, so the check above could have seen a move.
      const step = await record(page, [[60, 'c.scrollTo(2)']], 1000);
      assert.ok(movedIn(step).includes('w3'), 'a space not shown slides in');
      assert.equal((await page.evaluate(() => (window as any).__s.asked)).length, 1, 'and its side was asked for once');
    },
    1700,
  );
});
