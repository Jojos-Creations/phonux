// node run.mjs <libDir> <width> <slots> [resizeTo]: the six-panel row in Chromium, for the rc4-half-step-grid plan.
// Phase 1: one wheel event per step, scrollLeft read at rest, then two steps back. Phase 2: the window is resized to resizeTo
// (default: width + 240) and the row settles from that mid-row rest. Phase 3: one more step after the resize. Every rest must lie on the one-phone grid
// (multiples of phone + gap, 406 at phone 390) or on the row's end; every step before the end must be 406.
// Exits non-zero on a rest off the grid, a short step before the end, or a page error.
// Drag release is not run here: it is covered by test/pinned-edge-release.test.ts in jsdom.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [libArg, width = '1000', slots = '1,1,1,1,1,1', resizeArg] = process.argv.slice(2);
const resizeTo = Number(resizeArg ?? Number(width) + 240);
const STEP = 406;
const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(libArg);
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pw = (await import('/opt/node-tools/node_modules/playwright/index.mjs')).default;

const dir = mkdtempSync(join(tmpdir(), 'half-step-'));
await build({ entryPoints: [join(here, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning' });
const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: Number(width), height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.goto(`http://localhost:${srv.address().port}/?slots=${slots}&gesture=step&shrink=off`);
await page.waitForSelector('[data-body="p1"]');
await page.waitForTimeout(1500);

const scroller = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 50 && getComputedStyle(e).overflowX !== 'visible');
  return c ? { left: Math.round(c.scrollLeft), max: Math.round(c.scrollWidth - c.clientWidth) } : { left: -1, max: -1 };
});
const settle = async () => { await page.waitForTimeout(900); return scroller(); };
const stepPhase = async (label) => {
  await page.mouse.move(500, 300);
  const first = await scroller();
  const rests = [first.left];
  let quiet = 0;
  let max = first.max;
  for (let k = 0; k < 40 && quiet < 2; k++) {
    await page.mouse.wheel(120, 0);
    await page.waitForTimeout(700);
    const at = await scroller();
    max = at.max;
    if (at.left === rests.at(-1)) quiet++;
    else { rests.push(at.left); quiet = 0; }
  }
  const steps = rests.slice(1).map((at, k) => at - rests[k]);
  const offGrid = rests.filter((at) => at % STEP !== 0 && at !== max);
  const shortSteps = steps.slice(0, -1).filter((s) => s !== STEP);
  return { label, rests, max, steps, offGrid, shortSteps };
};

const phases = [];
phases.push(await stepPhase('step'));
for (let k = 0; k < 2; k++) { await page.mouse.wheel(-120, 0); await page.waitForTimeout(700); }
const midRest = await settle();
phases.push({ label: 'back two steps', rests: [midRest.left], max: midRest.max, offGrid: midRest.left % STEP !== 0 ? [midRest.left] : [] });
await page.setViewportSize({ width: resizeTo, height: 800 });
const afterResize = await settle();
phases.push({ label: 'resize rest', rests: [afterResize.left], max: afterResize.max, offGrid: afterResize.left % STEP !== 0 && afterResize.left !== afterResize.max ? [afterResize.left] : [] });
phases.push(await stepPhase('step after resize'));

const failed = phases.some((p) => p.offGrid.length > 0 || (p.shortSteps ?? []).length > 0) || errors.length > 0;
console.log(JSON.stringify({ width: Number(width), resizeTo, slots, phases, errors, failed }));
await browser.close();
srv.close();
if (!process.env.BEFORE && failed) process.exit(1);
