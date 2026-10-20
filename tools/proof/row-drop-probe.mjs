// PLAYWRIGHT_ENTRY=<playwright-core/index.mjs> BROWSER_BIN=<webkit pw_run.sh> node row-drop-probe.mjs <libDir> <outDir>
// Builds a row of the library at <libDir>: History (the root) with a tile for each panel, then panels one, two and three live and four parked.
// A tile is a plain element in History's view that drives usePanelRowDrop() from a real pointer: down begins, move updates, up ends.
// Scenario 'hidden': drags the tile of the parked 'four' across the row from right to left in steps, sampling every panel's left edge and the
// gap at each step, screenshots mid-drag, and drops it between 'one' and 'two'. Scenario 'live': drags the tile of 'three' three hops left, to just before 'one'.
// Prints one JSON line per sample and a verdict line; exits 1 when the neighbours did not part or the drop did not land at the pointed index.
// Needs esbuild, react and react-dom in <libDir>/node_modules. Headless only.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const [libArg, outArg = '.'] = process.argv.slice(2);
if (!libArg || !process.env.PLAYWRIGHT_ENTRY || !process.env.BROWSER_BIN) throw new Error('usage: PLAYWRIGHT_ENTRY=... BROWSER_BIN=... node row-drop-probe.mjs <libDir> <outDir>');
const lib = resolve(libArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const entry = `
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, usePanelRowDrop } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';
const colours = { one: '#c62828', two: '#2e7d32', three: '#1565c0', four: '#f9a825' };
const body = (id) => () => <div data-body={id} style={{ height: '100%', background: colours[id], color: '#000', font: '24px sans-serif', padding: 12, boxSizing: 'border-box' }}>{id}</div>;
const plain = (id) => definePanel({ id, settings: { title: id }, view: body(id) });
function Tile({ id }) {
  const drop = usePanelRowDrop();
  return (
    <div
      data-tile={id}
      style={{ margin: 8, padding: 12, background: '#ddd', font: '18px sans-serif', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={(e) => {
        window.__began = drop.begin(id);
        if (window.__began) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => { if (window.__began) drop.update(e.clientX); }}
      onPointerUp={() => { if (window.__began) { window.__result = drop.end(); window.__began = false; } }}
    >{id}</div>
  );
}
const History = () => <div data-body="root" style={{ height: '100%', background: '#eee' }}>{['four', 'three'].map((id) => <Tile key={id} id={id} />)}</div>;
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: History }),
  templates: [plain('one'), plain('two'), plain('three'), plain('four')],
});
window.__ws = ws;
for (const id of ['one', 'two', 'three', 'four']) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
`;
const dir = mkdtempSync(join(tmpdir(), 'row-drop-'));
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
let failed = false;
const check = (ok, what) => { if (!ok) failed = true; console.log(JSON.stringify({ check: what, ok })); };
try {
  const pw = await import(process.env.PLAYWRIGHT_ENTRY);
  browser = await pw.webkit.launch({ headless: true, executablePath: process.env.BROWSER_BIN });
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="three"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__ws.panels.get('four').hide());
  await page.waitForTimeout(1200);
  const lefts = () => page.evaluate(() => Object.fromEntries(['root', 'one', 'two', 'three', 'four'].map((id) => [id, (() => { const r = document.querySelector(`[data-body="${id}"]`)?.closest('[data-row-slot]')?.getBoundingClientRect(); return r ? Math.round(r.left) : null; })()])));
  const gap = () => page.evaluate(() => { const g = document.querySelector('[data-panel-row-drop-gap]'); if (!g) return null; const r = g.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width) }; });
  const order = () => page.evaluate(() => window.__ws.panels.getSnapshot().panels.map((p) => `${p.id}:${p.status}`).join(','));
  const rest = await lefts();
  console.log(JSON.stringify({ phase: 'rest', lefts: rest, order: await order() }));
  check(rest.four === null, 'four is parked before the drag');

  // hidden source: from the tile across the row, right to left, ending between one and two
  const tile = await (await page.$('[data-tile="four"]')).boundingBox();
  const startX = tile.x + tile.width / 2;
  const y = tile.y + tile.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // The header's hop rule: the gap moves a whole slot once the pointer passes half the next neighbour's span from where the last hop ended,
  // so 1100 (one hop left of three, 209 px from the gap's start) puts the gap between one and two.
  const samples = [];
  const xs = [1500, 1300, 900, 500, 1100];
  for (const [i, x] of xs.entries()) {
    await page.mouse.move(x, y, { steps: 6 });
    await page.waitForTimeout(700);
    const s = { x, lefts: await lefts(), gap: await gap() };
    samples.push(s);
    console.log(JSON.stringify({ phase: 'hidden-drag', ...s }));
    if (i === 2) await page.screenshot({ path: join(out, 'mid-drag-hidden.png') });
  }
  await page.screenshot({ path: join(out, 'at-target-hidden.png') });
  const gapAtTarget = samples.at(-1).gap;
  check(gapAtTarget !== null && gapAtTarget.width === 390, 'a gap as wide as the entry shows while dragging');
  const gapLefts = new Set(samples.map((s) => s.gap?.left));
  check(gapLefts.size >= 3, `the gap moved across the row (${[...gapLefts].join(',')})`);
  const twoPositions = new Set(samples.map((s) => s.lefts.two));
  check(twoPositions.size >= 2, `a neighbour parted as the pointer moved (two at ${[...twoPositions].join(',')})`);
  check(samples.every((s) => s.lefts.four === null), 'the parked panel is not in the row while dragging');
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const landed = await lefts();
  const after = await order();
  console.log(JSON.stringify({ phase: 'hidden-drop', lefts: landed, order: after, result: await page.evaluate(() => window.__result) }));
  await page.screenshot({ path: join(out, 'after-drop-hidden.png') });
  check(after.startsWith('root:live,one:live,four:live,two:live,three:live'), `four landed between one and two (${after})`);
  // The row recentres once it holds five panels, so the gap's x is compared after the same shift as the root's.
  const shift = landed.root - rest.root;
  check(landed.four === (gapAtTarget?.left ?? 0) + shift, `four rests where the gap was (${landed.four} vs ${gapAtTarget?.left} + ${shift})`);
  check(gapAtTarget && (await gap()) === null, 'the gap is gone after the drop');

  // live source: the tile of three, dragged to the left of one
  const tile3 = await (await page.$('[data-tile="three"]')).boundingBox();
  await page.mouse.move(tile3.x + tile3.width / 2, tile3.y + tile3.height / 2);
  await page.mouse.down();
  const before3 = await lefts();
  const liveSamples = [];
  const centreOf = (id) => before3[id] + 195;
  for (const x of [centreOf('three') - 100, centreOf('three') - 450, centreOf('three') - 800, centreOf('three') - 1200]) {
    await page.mouse.move(x, tile3.y + tile3.height / 2, { steps: 6 });
    await page.waitForTimeout(700);
    const s = { x, lefts: await lefts() };
    liveSamples.push(s);
    console.log(JSON.stringify({ phase: 'live-drag', ...s }));
  }
  await page.screenshot({ path: join(out, 'mid-drag-live.png') });
  check(new Set(liveSamples.map((s) => s.lefts.two)).size >= 2, 'neighbours part for a live panel too');
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after3 = await order();
  console.log(JSON.stringify({ phase: 'live-drop', lefts: await lefts(), order: after3 }));
  check(after3.startsWith('root:live,three:live,one:live,four:live,two:live'), `three moved three slots left, to just before one (${after3})`);
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log(JSON.stringify({ verdict: failed ? 'FAIL' : 'PASS', shots: ['mid-drag-hidden.png', 'at-target-hidden.png', 'after-drop-hidden.png', 'mid-drag-live.png'].map((f) => join(out, f)) }));
} finally {
  await browser?.close();
  srv.close();
}
process.exit(failed ? 1 : 0);
