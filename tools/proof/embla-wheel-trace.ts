/**
 * Why a frame a wheel reached can leave the Embla row still: traces, per animation frame, the wheels that arrived, what the
 * wheel-gestures plugin passed to Embla (its untrusted mousedown, mousemove and mouseup) and how far the row moved.
 *
 *   node --import tsx tools/proof/embla-wheel-trace.ts [--engine embla] [--slots 1,3,1,2,...]
 *
 * Streams: `steady-feed` (deltaX 12 every frame, handed in by feedRowWheel), `steady-mouse` (page.mouse.wheel 12 every ~16 ms,
 * the browser's own input path), and `trackpad` (three gestures shaped like a trackpad's: a ramp up, a plateau, an exponential
 * momentum tail, with skipped frames, and a pause between gestures). For each, every frame inside the row's motion that a wheel
 * reached but that did not move is a stall, classed by whether the plugin passed a move that frame. Exits 2 when a stream moved
 * nothing.
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../test/support/chromium.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const arg = (name: string): string | undefined => {
  const k = process.argv.indexOf(`--${name}`);
  return k < 0 ? undefined : process.argv[k + 1];
};
const SLOTS = arg('slots') ?? '1,3,1,2,1,3,1,2,1,3,1,2';
// The slice of Playwright's Page this script uses, typed loosely.
type Page = any;
const browser = await launchChromium<Page>({ skip: () => {} }, 'embla-wheel-trace');
if (browser === undefined) process.exit(2);
const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'embla-trace-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/embla-row-entry.tsx.txt'), 'utf8'));
await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const server = createServer((req, res) => {
  const js = req.url?.startsWith('/out.js') === true;
  res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  res.end(js ? readFileSync(join(dir, 'out.js')) : html);
}).listen(0);
const port = (server.address() as { port: number }).port;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const g = (page: Page, fn: string, ...args: unknown[]): Promise<any> => page.evaluate(([f, a]: [string, unknown[]]) => (window as any).__g[f](...a), [fn, args]);

// One trackpad gesture: ramp, plateau, momentum tail decaying by `decay` a frame, a skipped frame every `gapEvery`.
function gesture(peak: number, plateau: number, decay: number, gapEvery: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = 1; k <= 6; k += 1) out.push((peak * k) / 6);
  for (let k = 0; k < plateau; k += 1) out.push(peak);
  for (let d = peak * decay; d >= 0.5; d *= decay) out.push(+d.toFixed(2));
  return out.map((d, k) => (k > 0 && k % gapEvery === 0 ? null : d));
}
const pause = (frames: number): null[] => Array(frames).fill(null);
const TRACKPAD = [...gesture(30, 20, 0.93, 7), ...pause(30), ...gesture(18, 30, 0.95, 9), ...pause(30), ...gesture(45, 10, 0.9, 5)];

async function run(name: string, send: (page: Page) => Promise<number>): Promise<Record<string, unknown>> {
  const ctx = await browser!.newContext({ viewport: { width: 1800, height: 900 } });
  const page: Page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?engine=${arg('engine') ?? 'embla'}&slots=${SLOTS}`);
  await page.waitForFunction(() => (window as any).__g?.ready(), undefined, { timeout: 15000 });
  await sleep(600);
  await page.mouse.move(900, 400);
  await g(page, 'record');
  const input = await send(page);
  await sleep(1500);
  const fr = await g(page, 'stop');
  await ctx.close();
  const rows = fr.slice(1).map((f: any, k: number) => ({ t: Math.round(f.t), m: +Math.abs(f.pos - fr[k].pos).toFixed(2), ml: +Math.abs(f.logical - fr[k].logical).toFixed(2), w: f.wheels, pd: f.pd, pm: f.pm, pu: f.pu }));
  const a = rows.findIndex((r: any) => r.m > 0.01);
  const b = rows.length - 1 - [...rows].reverse().findIndex((r: any) => r.m > 0.01);
  const span = a < 0 ? [] : rows.slice(a, b + 1);
  const stalls = span.filter((r: any) => r.m <= 0.01 && r.w > 0);
  const moved = fr.length === 0 ? 0 : fr[fr.length - 1].pos - fr[0].pos;
  return {
    name,
    input: +input.toFixed(1),
    movedPx: +moved.toFixed(1),
    frames: span.length,
    wheelFrames: span.filter((r: any) => r.w > 0).length,
    stalls: stalls.length,
    // The same count read off Embla's logical location instead of the drawn transform.
    stallsByLogicalLocation: span.filter((r: any) => r.ml <= 0.01 && r.w > 0).length,
    stallsPluginPassedAMove: stalls.filter((r: any) => r.pm > 0).length,
    stallsPluginPassedNothing: stalls.filter((r: any) => r.pm === 0).length,
    pluginDowns: rows.reduce((s: number, r: any) => s + r.pd, 0),
    pluginUps: rows.reduce((s: number, r: any) => s + r.pu, 0),
    // Each stall with its neighbours: t, row move, wheels, plugin down/move/up.
    stallContext: stalls.slice(0, 6).map((r: any) => {
      const i = rows.indexOf(r);
      return rows.slice(Math.max(0, i - 2), i + 3).map((x: any) => `${x.t}:${x.m}/w${x.w}/d${x.pd}m${x.pm}u${x.pu}`).join(' ');
    }),
  };
}

const out = [
  await run('steady-feed', (page) => g(page, 'feedStream', 12, 2500)),
  await run('steady-mouse', async (page) => {
    let input = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      await page.mouse.wheel(12, 0);
      input += 12;
      await sleep(16);
    }
    return input;
  }),
  await run('trackpad', (page) => g(page, 'feedShape', TRACKPAD)),
];
await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
process.exit(out.some((r) => r.frames === 0) ? 2 : 0);
