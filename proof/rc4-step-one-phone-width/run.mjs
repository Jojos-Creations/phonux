// node run.mjs <libDir> <width> <slots>: one wheel event per step, recording the row's scrollLeft after each.
// Prints the events to rest and the largest and smallest step between rests.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [libArg, width = '1280', slots = '5,1,1,1,1,1'] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(libArg);
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pw = (await import('/opt/node-tools/node_modules/playwright/index.mjs')).default;

const dir = mkdtempSync(join(tmpdir(), 'step-'));
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

const scrollerLeft = () => page.evaluate(() => {
  const c = [...document.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 50 && getComputedStyle(e).overflowX !== 'visible');
  return c ? Math.round(c.scrollLeft) : -1;
});
await page.mouse.move(500, 300);
const rests = [await scrollerLeft()];
let quiet = 0;
for (let k = 0; k < 40 && quiet < 2; k++) {
  await page.mouse.wheel(120, 0);
  await page.waitForTimeout(700);
  const at = await scrollerLeft();
  if (at === rests.at(-1)) quiet++;
  else { rests.push(at); quiet = 0; }
}
const steps = rests.slice(1).map((at, k) => at - rests[k]);
console.log(JSON.stringify({ width: Number(width), slots, rests, events: steps.length, steps, maxStep: Math.max(...steps), minStep: Math.min(...steps), errors }));
await browser.close();
srv.close();
// The fixed tree steps one phone width per event; BEFORE=1 runs the old tree and only reports.
if (!process.env.BEFORE && (steps.some((s) => s !== 406) || errors.length > 0)) process.exit(1);
