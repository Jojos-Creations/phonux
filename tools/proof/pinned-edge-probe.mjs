// node pinned-edge-probe.mjs <libDir> [chromium|firefox|webkit] [width=1800] [gap=16] [slots=1,1,1,1,1]
// A real pointer drag of a panel's left grabber (the width drawn pinned at its end) on the stepping row of the library at <libDir>, in
// every shrink mode and from every stop that has a panel with room to widen: press, move left, release. Prints one JSON line per drag,
// then a verdict per drag: the row rests on a stop; that stop is the nearest to the scroll that puts the panel's right edge back where
// it was at the press (within 1 px of the best stop); and how far the right edge ended from where it was. The same script on main shows
// the scroll that is nearest the scroll at the release instead.
// Needs: esbuild and react/react-dom resolvable from <libDir>/node_modules, and playwright (cwd, or PLAYWRIGHT_DIR=/path/to/node_modules).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ENTRY_SRC = readFileSync(new URL('./step-entry.tsx.txt', import.meta.url), 'utf8');
const [libArg, engine = 'chromium', widthArg = '1800', gapArg = '16', slots = '1,1,1,1,1'] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node pinned-edge-probe.mjs <libDir> [engine] [width] [gap] [slots]');
const lib = resolve(libArg);
const width = Number(widthArg);
const gap = Number(gapArg);
const PHONE = 390;
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pwNs = process.env.PLAYWRIGHT_DIR ? await import(pathToFileURL(createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright')).href) : await import('playwright');
const pw = pwNs.chromium ? pwNs : pwNs.default;
const dir = mkdtempSync(join(tmpdir(), 'pinned-edge-'));
writeFileSync(join(dir, 'entry.tsx'), ENTRY_SRC);
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib, ...(process.env.REACT_DIR ? { react: `${process.env.REACT_DIR}/node_modules/react`, 'react-dom': `${process.env.REACT_DIR}/node_modules/react-dom` } : {}) }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html><body style="margin:0;user-select:none;-webkit-user-select:none"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
const browser = await pw[engine].launch();
const rows = [];

const boxes = (pg) => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-box]')].map((el) => { const r = el.getBoundingClientRect(); return [el.getAttribute('data-box'), { left: r.left, right: r.right, width: r.width }]; })));

async function open(mode) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const pg = await context.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?mode=${mode}&slots=${slots}&gap=${gap}&control=none&reduce=0&frame=none`);
  await pg.waitForSelector('[data-box="p1"]');
  await pg.waitForTimeout(1500);
  return pg;
}

for (const mode of ['off', 'visible', 'hidden']) {
  const probe = await open(mode);
  const stopCount = (await probe.evaluate(() => window.__g.stops())).length;
  await probe.context().close();
  for (let stop = 0; stop < stopCount; stop++) {
    const pg = await open(mode);
    const stops = await pg.evaluate(() => window.__g.stops());
    await pg.evaluate((to) => { const c = window.__g.container(); c.scrollLeft = to; c.dispatchEvent(new Event('scroll')); }, stops[stop]);
    await pg.waitForTimeout(900);
    const b = await boxes(pg);
    // The panel fully in the window with the most room to widen leftwards, and room enough for a visible drag.
    const shown = Object.entries(b).filter(([id, r]) => id !== 'root' && r.left >= 10 && r.right <= width - 10).sort((x, y) => y[1].left - x[1].left);
    const pick = shown.find(([, r]) => r.left - 10 >= 250) ?? shown[0];
    if (pick === undefined) { await pg.context().close(); continue; }
    const [id, start] = pick;
    const grab = await pg.locator(`[data-grab="${id}:left"]`).boundingBox();
    const x0 = grab.x + grab.width / 2, y0 = grab.y + grab.height / 2;
    const room = start.left - 10;
    const dx = Math.min(room, Number(process.env.DX ?? 420));
    await pg.mouse.move(x0, y0);
    await pg.mouse.down();
    for (const f of [0.25, 0.5, 0.75, 1]) { await pg.mouse.move(x0 - dx * f, y0); await pg.waitForTimeout(40); }
    const held = (await boxes(pg))[id];
    const scrollAtRelease = await pg.evaluate(() => window.__g.container().scrollLeft);
    await pg.mouse.up();
    await pg.waitForTimeout(1500);
    const after = (await boxes(pg))[id];
    const scroll = await pg.evaluate(() => window.__g.container().scrollLeft);
    const finalStops = await pg.evaluate(() => window.__g.stops());
    const atStop = await pg.evaluate(() => window.__g.provided().rowNumbers.atStop);
    const kept = await pg.evaluate((id) => window.__g.provided().entries[Number(id.slice(1))].slots, id);
    rows.push({ mode, startStop: stop, id, start, held, after, scrollAtRelease, scroll, stops: finalStops, atStop, slots: kept, dx, E: start.right });
    console.log(JSON.stringify(rows.at(-1)));
    await pg.context().close();
  }
}

console.log('\nverdicts (width', width, 'gap', gap, engine, '):');
let failed = 0;
for (const r of rows) {
  const wanted = r.after.right + r.scroll - r.E;
  const best = Math.min(...r.stops.map((s) => Math.abs(s - wanted)));
  const onStop = r.stops.some((s) => Math.abs(s - r.scroll) < 1);
  const nearest = Math.abs(r.scroll - wanted) <= best + 1;
  const todayStop = r.stops.reduce((a, s) => (Math.abs(s - r.scrollAtRelease) < Math.abs(a - r.scrollAtRelease) ? s : a), r.stops[0]);
  const spacing = Math.max(...r.stops.slice(1).map((s, k) => s - r.stops[k]), 0);
  const ok = onStop && nearest;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.mode} from stop ${r.startStop}: ${r.id} widened ${r.dx.toFixed(0)} px from its left grabber; stored at ${r.slots} slots and drawn ${r.after.width.toFixed(0)} px wide; rests on stop ${r.scroll.toFixed(0)}${onStop ? '' : ' (NOT a stop)'}, wanted ${wanted.toFixed(0)}, ${nearest ? 'nearest' : `NOT nearest (best ${best.toFixed(0)} away)`}; right edge ${(r.after.right - r.E).toFixed(1)} px from where it was (limit ${(spacing / 2).toFixed(0)}); nearest the scroll at release would be ${todayStop.toFixed(0)}`);
}
console.log(`${rows.length - failed} of ${rows.length} pass`);
await browser.close(); srv.close();
