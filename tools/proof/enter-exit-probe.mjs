// node enter-exit-probe.mjs <libDir> <chromium|webkit> <style> <outDir> [executablePath]
// Builds a row of the library at <libDir> (History, then panels one, two, three), adds a panel 'mid' right after 'one' and
// samples, every animation frame for 1 s, mid's slot width and left edge and two's left edge; then parks mid and samples again.
// <style> is a template enterFrom/exitTo pair such as 'expand/shrink', or 'default' for a panel that sets neither (the slide,
// which a library without the new values also runs). Writes three screenshots during the enter into <outDir> and prints one
// JSON line per phase. Needs esbuild, react and react-dom in <libDir>/node_modules, and playwright-core (PLAYWRIGHT_MODULE).
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const [libArg, engine = 'chromium', style = 'expand/shrink', outArg = '.', executablePath] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node enter-exit-probe.mjs <libDir> <chromium|webkit> <style> <outDir> [executablePath]');
const lib = resolve(libArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const [enterFrom, exitTo] = style === 'default' ? [undefined, undefined] : style.split('/');
const settings = { title: 'mid', placeOnAdd: { after: 'one' }, ...(enterFrom ? { enterFrom } : {}), ...(exitTo ? { exitTo } : {}) };

const entry = `
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';
const colours = { one: '#c62828', two: '#2e7d32', three: '#1565c0', mid: '#f9a825' };
const body = (id) => () => <div data-body={id} style={{ height: '100%', background: colours[id], color: '#000', font: '24px sans-serif', padding: 12, boxSizing: 'border-box' }}>{id} {'text that would reflow if squashed '.repeat(4)}</div>;
const plain = (id, settings) => definePanel({ id, settings: { title: id, ...settings }, view: body(id) });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: [plain('one'), plain('two'), plain('three'), plain('mid', ${JSON.stringify(settings)})],
});
window.__ws = ws;
for (const id of ['one', 'two', 'three']) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
`;
const dir = mkdtempSync(join(tmpdir(), 'enter-exit-'));
writeFileSync(join(dir, 'entry.tsx'), entry);
const require = createRequire(join(lib, 'package.json'));
const { build } = require('esbuild');
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html lang="en"><body style="margin:0"><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(join(dir, 'out.js')) : html);
}).listen(0);
let browser;
try {
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
  browser = await pw[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="three"]');
  await page.waitForTimeout(1200);
  const sample = (ms) => page.evaluate((ms) => new Promise((done) => {
    const frames = [];
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      const rect = (id) => document.querySelector(`[data-body="${id}"]`)?.closest('[data-row-slot]')?.getBoundingClientRect();
      const mid = rect('mid');
      const two = rect('two');
      frames.push({ t: Math.round(t), midWidth: mid ? Math.round(mid.width * 10) / 10 : null, midLeft: mid ? Math.round(mid.left) : null, twoLeft: two ? Math.round(two.left) : null });
      if (t < ms) requestAnimationFrame(tick);
      else done(frames);
    };
    requestAnimationFrame(tick);
  }), ms);
  const before = await page.evaluate(() => Math.round(document.querySelector('[data-body="two"]').closest('[data-row-slot]').getBoundingClientRect().left));
  const enterSamples = sample(1000);
  await page.evaluate(() => { window.__mid = window.__ws.addPanel('mid'); });
  const shots = [];
  for (const at of [150, 300, 450]) {
    await page.waitForTimeout(150);
    const file = join(out, `${engine}-${style.replace('/', '-')}-enter-${at}ms.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  }
  const enter = await enterSamples;
  await page.waitForTimeout(400);
  const exitSamples = sample(1000);
  const handled = await page.evaluate(() => String(window.__mid.hide()));
  const exit = await exitSamples;
  const summarise = (frames) => {
    const widths = frames.map((f) => f.midWidth).filter((w) => w !== null);
    const twoLefts = frames.map((f) => f.twoLeft);
    return {
      frames: frames.length,
      midWidths: [...new Set(widths)].length,
      midWidthFirst: widths[0] ?? null,
      midWidthLast: widths.at(-1) ?? null,
      midLeftSet: [...new Set(frames.map((f) => f.midLeft).filter((x) => x !== null))].slice(0, 6),
      twoLeftFirst: twoLefts[0], twoLeftLast: twoLefts.at(-1), twoLeftDistinct: new Set(twoLefts).size,
      overlap: frames.some((f) => f.midLeft !== null && f.twoLeft !== null && f.midWidth !== null && f.midLeft + f.midWidth > f.twoLeft + 0.5),
      timeline: frames.filter((_, i) => i % 6 === 0).map((f) => `${f.t}:${f.midWidth}@${f.midLeft}|two@${f.twoLeft}`),
    };
  };
  console.log(JSON.stringify({ engine, style, phase: 'enter', twoLeftBefore: before, ...summarise(enter), shots }));
  console.log(JSON.stringify({ engine, style, phase: 'exit', via: handled, ...summarise(exit) }));
  console.log(JSON.stringify({ engine, style, errors }));
} finally {
  await browser?.close();
  srv.close();
}
