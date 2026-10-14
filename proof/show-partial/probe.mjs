// node proof/show-partial/probe.mjs <libDir> [chromium|firefox|webkit] [width=1100] [slots=1,2,1,1,1] [outDir=.]
// For each shrink mode, opens the stepping row of the library at <libDir> (the harness of tools/proof/step-entry.tsx.txt), steps one stop
// at a time with a real wheel event and prints, per stop, each panel's rect, its opacity filter and whether it is inert, then saves a
// screenshot per mode and stop. Off must draw the neighbour cut by the window edge at its own width: opaque, not inert, width unchanged.
// Needs esbuild and react/react-dom resolvable from <libDir>/node_modules, and playwright (cwd, or PLAYWRIGHT_DIR=/path/to/node_modules).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ENTRY_SRC = readFileSync(new URL('../../tools/proof/step-entry.tsx.txt', import.meta.url), 'utf8');
const [libArg, engine = 'chromium', widthArg = '1100', slots = '1,2,1,1,1', outArg = '.'] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node probe.mjs <libDir> [engine] [width] [slots] [outDir]');
const lib = resolve(libArg);
const width = Number(widthArg);
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pwNs = process.env.PLAYWRIGHT_DIR ? await import(pathToFileURL(createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright')).href) : await import('playwright');
const pw = pwNs.chromium ? pwNs : pwNs.default;
const dir = mkdtempSync(join(tmpdir(), 'show-partial-'));
writeFileSync(join(dir, 'entry.tsx'), ENTRY_SRC);
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib, ...(process.env.REACT_DIR ? { react: `${process.env.REACT_DIR}/node_modules/react`, 'react-dom': `${process.env.REACT_DIR}/node_modules/react-dom` } : {}) }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
const browser = await pw[engine].launch();

const read = (pg) => pg.evaluate(() => {
  const c = window.__g.container();
  const view = c.getBoundingClientRect();
  return {
    scrollLeft: Math.round(c.scrollLeft), window: { left: view.left, right: view.right },
    panels: [...c.querySelectorAll('[data-row-slot]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.rowId, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), filter: el.style.filter, inert: el.hasAttribute('inert') };
    }),
  };
});

let failed = false;
for (const mode of ['off', 'visible', 'hidden']) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const pg = await context.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await pg.goto(`http://localhost:${srv.address().port}/?mode=${mode}&slots=${slots}&gap=16&control=none&reduce=0&frame=none`);
  await pg.waitForSelector('[data-box="p1"]');
  await pg.waitForTimeout(1500);
  const stops = await pg.evaluate(() => window.__g.stops());
  for (let k = 0; k < stops.length; k++) {
    if (k > 0) {
      await pg.mouse.move(600, 300);
      await pg.mouse.wheel(300, 0);
      await pg.waitForTimeout(1200);
    }
    const state = await read(pg);
    console.log(JSON.stringify({ engine, mode, stop: k, stops, ...state }));
    await pg.screenshot({ path: join(outArg, `${engine}-${mode}-stop${k}.png`) });
    if (mode === 'off') {
      const cut = state.panels.filter((p) => (p.left < state.window.left && p.right > state.window.left) || (p.left < state.window.right && p.right > state.window.right));
      const ok = state.panels.every((p) => p.filter === '') && cut.every((p) => !p.inert);
      console.log(`${ok ? 'OK' : 'FAIL'} off stop ${k}: ${cut.length} panel(s) cut by an edge, all opaque and reachable: ${ok}`);
      if (!ok) failed = true;
    }
  }
  await context.close();
}
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
