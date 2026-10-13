// node step-end-probe.mjs <libDir> [firefox|webkit|chromium] [slots=1,4] [width=1800]
// Builds a stepping 'visible' row of the library at <libDir> (History + panels of the given slots), sends wheel deltaX +300 every 900 ms
// until well past the last stop, then the same back, and prints one JSON line per step: scrollLeft, the browser's own scroll range,
// the library's numbers (stops, endPad, maxScroll, atStop), every panel's drawn width and rect, and the scroll events seen.
// Needs: esbuild and react/react-dom resolvable from <libDir>/node_modules, and playwright (cwd, or PLAYWRIGHT_DIR=/path/to/node_modules).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ENTRY_SRC = readFileSync(new URL('./step-entry.tsx.txt', import.meta.url), 'utf8');
const [libArg, engine = 'firefox', slots = '1,4', widthArg = '1800', gap = '16'] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node step-end-probe.mjs <libDir> [firefox|webkit|chromium] [slots] [width] [gap]');
const lib = resolve(libArg);
const width = Number(widthArg);
const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pwNs = process.env.PLAYWRIGHT_DIR ? await import(pathToFileURL(createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright')).href) : await import('playwright');
const pw = pwNs.chromium ? pwNs : pwNs.default;
const dir = mkdtempSync(join(tmpdir(), 'step-end-'));
writeFileSync(join(dir, 'entry.tsx'), ENTRY_SRC);
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib, ...(process.env.REACT_DIR ? { react: `${process.env.REACT_DIR}/node_modules/react`, 'react-dom': `${process.env.REACT_DIR}/node_modules/react-dom` } : {}) }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html><body style="margin:0;user-select:none;-webkit-user-select:none"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
await page.goto(`http://localhost:${srv.address().port}/?mode=visible&slots=${slots}&gap=${gap}&control=none&reduce=0&frame=none`);
await page.waitForSelector('[data-box="p1"]');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const c = window.__g.container();
  window.__events = [];
  c.addEventListener('scroll', () => window.__events.push(Math.round(c.scrollLeft * 100) / 100));
  // Every frame of every step: where the scroll is and how far the browser lets it go, so a range that shrinks mid-glide shows.
  window.__glide = [];
  const sample = () => { window.__glide.push([Math.round(performance.now()), Math.round(c.scrollLeft * 10) / 10, c.scrollWidth - c.clientWidth]); requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
});
const snap = () => page.evaluate(() => {
  const g = window.__g, c = g.container(), p = g.provided(), n = p.rowNumbers;
  const cs = getComputedStyle(c);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10]; };
  const events = window.__events.splice(0);
  return {
    scrollLeft: c.scrollLeft, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, browserMax: c.scrollWidth - c.clientWidth,
    paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
    lib: { stops: n.stops, stopFirsts: n.stopFirsts, atStop: n.atStop, endPad: n.endPad, maxScroll: Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth), windowWidth: n.windowWidth, stripWidth: n.stripWidth, rowMarginLeft: n.rowMarginLeft, drawnWidths: n.drawnWidths },
    strip: rect(c.querySelector('[data-row-strip]')), endPadEl: rect(c.querySelector('[data-row-end-pad]')),
    boxes: [...c.querySelectorAll('[data-box]')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > 1 && r.left < innerWidth - 1; }).map((b) => [b.getAttribute('data-box'), ...rect(b)]),
    events,
    glide: window.__glide.splice(0),
  };
});
const direction = [['right', 300, 'go'], ['left', -300, 'back']];
const out = [];
for (const [name, delta] of direction.map(([, d, n]) => [n, d])) {
  for (let i = 1; i <= 9; i++) {
    await page.mouse.move(600, 300);
    await page.mouse.wheel(delta, 0);
    await page.waitForTimeout(900);
    const s = await snap();
    out.push({ phase: name, step: i, ...s });
    console.log(JSON.stringify({ engine, slots, width, phase: name, step: i, ...s }));
  }
}
await browser.close(); srv.close();


