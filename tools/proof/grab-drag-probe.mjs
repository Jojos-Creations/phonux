// PLAYWRIGHT_ENTRY=<playwright-core/index.mjs> BROWSER_BIN=<webkit pw_run.sh> node grab-drag-probe.mjs <libDir> <outDir>
// Builds a row of the library at <libDir>: History (the root), then panels one, two and three. Each panel draws its own Panel inside a
// DragToClose with onDragMove and onDragEnd logging, and the page draws a name strip across the top and a dot bar across the bottom (fixed,
// z-index 2, as an app's preview strips are). A real mouse grabs panel 'two' by its handle.
// 1. Up: with closeOnRelease off, drags up past the row's top edge into the strip, checks with elementFromPoint that the dragged panel is the
//    topmost element at a point above the row and at one on the row edge, that its slot's z is raised and its neighbors' are not, screenshots
//    mid-drag, releases over the strip, and checks the panel is back at rest, nothing closed, z back to the base layer.
// 2. Down: the same below the row and over the dot bar.
// 3. Controls: at rest the strip is topmost over the panel's own top (so the lift, not the strips, decides the mid-drag answer), and with
//    closeOnRelease on the same long drag down closes the panel.
// Prints one JSON line per step and a verdict; exits 1 when any check fails. Needs esbuild, react and react-dom in <libDir>/node_modules. Headless only.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const [libArg, outArg = '.'] = process.argv.slice(2);
if (!libArg || !process.env.PLAYWRIGHT_ENTRY || !process.env.BROWSER_BIN) throw new Error('usage: PLAYWRIGHT_ENTRY=... BROWSER_BIN=... node grab-drag-probe.mjs <libDir> <outDir>');
const lib = resolve(libArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const entry = `
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, DragToClose, Panel, PanelFrame, PanelSizeBox, usePanelDragProps } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';
window.__log = [];
window.__optOut = !location.search.includes('close');
const colours = { one: '#ef9a9a', two: '#a5d6a7', three: '#90caf9' };
function GrabView({ panel }) {
  const { onClose } = usePanelDragProps();
  return (
    <DragToClose
      {...(onClose === undefined ? {} : { onClose })}
      closeOnRelease={!window.__optOut}
      onDragMove={(m) => window.__log.push({ type: 'move', ...m })}
      onDragEnd={(e) => window.__log.push({ type: 'end', ...e })}
    >
      {(grab) => (
        <PanelSizeBox>
          <Panel title={panel.title} grabProps={{ ...grab }} sx={{ height: '100%' }}>
            <PanelFrame>
              <div data-body={panel.title} style={{ height: '100%', background: colours[panel.title], color: '#000', font: '24px sans-serif', padding: 12, boxSizing: 'border-box' }}>{panel.title}</div>
            </PanelFrame>
          </Panel>
        </PanelSizeBox>
      )}
    </DragToClose>
  );
}
const plain = (id) => definePanel({ id, settings: { title: id }, view: GrabView });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: [plain('one'), plain('two'), plain('three')],
});
window.__ws = ws;
for (const id of ['one', 'two', 'three']) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:absolute;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
const strip = (id, css, text) => {
  const s = document.createElement('div');
  s.id = id;
  s.textContent = text;
  s.style.cssText = 'position:fixed;left:0;right:0;z-index:2;background:#263238;color:#fff;font:16px sans-serif;text-align:center;display:flex;align-items:center;justify-content:center;' + css;
  document.body.appendChild(s);
};
strip('name-strip', 'top:0;height:60px', 'workspace above: name strip');
strip('dot-bar', 'bottom:0;height:60px', 'workspace below: dot bar');
const cover = document.createElement('div');
cover.id = 'cover';
cover.textContent = 'app overlay';
cover.style.cssText = 'position:fixed;z-index:2;left:560px;top:380px;width:120px;height:40px;background:#ff6f00;color:#000;font:14px sans-serif;display:flex;align-items:center;justify-content:center';
document.body.appendChild(cover);
`;
const dir = mkdtempSync(join(tmpdir(), 'grab-drag-'));
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

const failures = [];
const check = (name, ok, detail) => {
  console.log(JSON.stringify({ check: name, ok, ...detail }));
  if (!ok) failures.push(name);
};
let browser;
try {
  const pw = await import(process.env.PLAYWRIGHT_ENTRY);
  browser = await pw.webkit.launch({ headless: true, executablePath: process.env.BROWSER_BIN });
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="three"]');
  await page.waitForTimeout(1500);

  // Where the page's elements are, and who is topmost at a point: 'two' if the point is inside the dragged panel's slot, 'name-strip' / 'dot-bar', else the tag.
  const probe = (x, y) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'none';
    const slot = el.closest('[data-row-slot]');
    if (slot) return `slot:${slot.querySelector('[data-body]')?.dataset.body ?? '?'}`;
    if (el.closest('#cover')) return 'cover';
    if (el.closest('#name-strip')) return 'name-strip';
    if (el.closest('#dot-bar')) return 'dot-bar';
    return el.tagName.toLowerCase();
  }, [x, y]);
  const geometry = () => page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const slotOf = (id) => document.querySelector(`[data-body="${id}"]`).closest('[data-row-slot]');
    const box = document.querySelector('[data-body="two"]').closest('[data-drag-to-close]');
    return { strip: r(document.querySelector('[data-row-strip]')), box: r(box), name: r(document.getElementById('name-strip')), dots: r(document.getElementById('dot-bar')), z: Object.fromEntries(['one', 'two', 'three'].map((id) => [id, slotOf(id).style.zIndex])) };
  });
  const handle = async () => {
    const b = await page.evaluate(() => { const h = document.querySelector('[data-body="two"]').closest('[data-row-slot]').querySelector('[data-panel-chrome-part="grab-bar"]'); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    return b;
  };
  const liveIds = () => page.evaluate(() => [...document.querySelectorAll('[data-row-slot] [data-body]')].map((b) => b.dataset.body).join(','));

  const rest = await geometry();
  const h0 = await handle();
  const px = Math.round((rest.box.left + rest.box.right) / 2);
  console.log(JSON.stringify({ step: 'rest', geometry: rest, handle: h0, live: await liveIds() }));
  const liveRest = await liveIds();

  // Control: the app's overlay sits on the panel at rest (its z is 2, the base layer's 1), so the lift is what changes the answer mid-drag.
  const COVER = { x: px, y: rest.strip.top + 320 };
  await page.evaluate(({ x, y }) => { const c = document.getElementById('cover'); c.style.left = `${x - 60}px`; c.style.top = `${y - 20}px`; }, COVER);
  const coveredAtRest = await probe(COVER.x, COVER.y);
  console.log(JSON.stringify({ step: 'control-rest-overlap', topmost: coveredAtRest }));

  async function dragBy(dy, label, { shot = false, release = true } = {}) {
    const h = await handle();
    await page.evaluate(() => { window.__log.length = 0; });
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    const steps = 24;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(h.x, h.y + (dy * i) / steps);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(250);
    const mid = await geometry();
    const here = { x: h.x, y: h.y + dy };
    const sample = { aboveRow: null, rowEdge: null, belowRow: null };
    sample.overlay = await probe(COVER.x, COVER.y);
    if (dy < 0) {
      sample.aboveRow = await probe(px, mid.name.bottom - 20);
      sample.rowEdge = await probe(px, mid.strip.top + 25);
    } else {
      sample.rowEdge = await probe(px, mid.strip.bottom - 25);
      sample.belowRow = await probe(px, mid.dots.top + 20);
    }
    let shotFile = null;
    if (shot) {
      shotFile = join(out, `grab-drag-mid-${label}.png`);
      await page.screenshot({ path: shotFile });
    }
    const midLog = await page.evaluate(() => window.__log.slice());
    if (release) {
      await page.mouse.up();
      await page.waitForTimeout(1500);
    }
    return { h, here, mid, sample, shotFile, midLog };
  }

  // 1. up
  const up = await dragBy(-(rest.box.top - 28), 'up', { shot: true });
  console.log(JSON.stringify({ step: 'up', boxMid: up.mid.box, stripRect: up.mid.strip, z: up.mid.z, topmost: up.sample, shot: up.shotFile }));
  check('up: the box is drawn above the row top', up.mid.box.top < up.mid.strip.top - 20, { boxTop: up.mid.box.top, rowTop: up.mid.strip.top });
  check('up: dragged panel is topmost above the row (over the name strip)', up.sample.aboveRow === 'slot:two', { got: up.sample.aboveRow });
  check('up: dragged panel is topmost at the row edge', up.sample.rowEdge === 'slot:two', { got: up.sample.rowEdge });
  check('up: dragged panel is topmost over the app overlay', up.sample.overlay === 'slot:two', { got: up.sample.overlay });
  check('up: the dragged slot is raised and its neighbours are not', up.mid.z.two === '3' && up.mid.z.one === '1' && up.mid.z.three === '1', { z: up.mid.z });
  const upMoves = up.midLog.filter((e) => e.type === 'move');
  const last = upMoves.at(-1);
  check('up: onDragMove reported every move with x, y, clientX, clientY', upMoves.length >= 10 && ['x', 'y', 'clientX', 'clientY'].every((k) => Number.isFinite(last?.[k])) && Math.abs(last.clientY - up.here.y) < 1 && Math.abs(last.y - (up.here.y - up.h.y)) < 1 && Math.abs(last.clientX - up.here.x) < 1, { moves: upMoves.length, last, expectedClientY: up.here.y });
  const afterUp = await geometry();
  const endUp = (await page.evaluate(() => window.__log.slice())).filter((e) => e.type === 'end');
  console.log(JSON.stringify({ step: 'up-released', end: endUp, box: afterUp.box, z: afterUp.z, live: await liveIds() }));
  check('up: onDragEnd reported the release', endUp.length === 1 && Math.abs(endUp[0].clientY - up.here.y) < 1 && Math.abs(endUp[0].offsetY - (up.here.y - up.h.y)) < 1 && Math.abs(endUp[0].clientX - up.here.x) < 1 && Math.abs(endUp[0].offsetX) < 1, { end: endUp, expectedClientY: up.here.y });
  check('up: release springs back to rest', Math.abs(afterUp.box.top - rest.box.top) <= 1 && Math.abs(afterUp.box.left - rest.box.left) <= 1, { rest: rest.box, after: afterUp.box });
  check('up: z returns to normal after release', afterUp.z.two === '1', { z: afterUp.z });
  check('up: nothing closed', (await liveIds()) === liveRest, { before: liveRest, live: await liveIds() });

  // 2. down, far past the row's bottom (a drag this long closes with closeOnRelease on)
  const down = await dragBy(rest.dots.bottom - rest.box.bottom - 20, 'down', { shot: true });
  console.log(JSON.stringify({ step: 'down', boxMid: down.mid.box, stripRect: down.mid.strip, z: down.mid.z, topmost: down.sample, shot: down.shotFile }));
  check('down: the box is drawn below the row bottom', down.mid.box.bottom > down.mid.strip.bottom + 20, { boxBottom: down.mid.box.bottom, rowBottom: down.mid.strip.bottom });
  check('down: dragged panel is topmost below the row (over the dot bar)', down.sample.belowRow === 'slot:two', { got: down.sample.belowRow });
  check('down: dragged panel is topmost at the row edge', down.sample.rowEdge === 'slot:two', { got: down.sample.rowEdge });
  check('down: dragged panel is topmost over the app overlay', down.sample.overlay === 'slot:two', { got: down.sample.overlay });
  check('down: the dragged slot is raised', down.mid.z.two === '3', { z: down.mid.z });
  const afterDown = await geometry();
  const endDown = (await page.evaluate(() => window.__log.slice())).filter((e) => e.type === 'end');
  console.log(JSON.stringify({ step: 'down-released', end: endDown, box: afterDown.box, z: afterDown.z, live: await liveIds() }));
  check('down: onDragEnd reported the release', endDown.length === 1 && Math.abs(endDown[0].clientY - down.here.y) < 1 && Math.abs(endDown[0].offsetY - (down.here.y - down.h.y)) < 1, { end: endDown, expectedClientY: down.here.y });
  // The same drag with the pointer taken far past the close line (175 px) and released: with closeOnRelease on this closes (see the last control).
  const far = await dragBy(800, 'far');
  const afterFar = await geometry();
  const farEnds = (await page.evaluate(() => window.__log.slice())).filter((e) => e.type === 'end');
  console.log(JSON.stringify({ step: 'far-released', end: farEnds, box: afterFar.box, live: await liveIds() }));
  check('opt-out: a release 800 px down springs back and closes nothing', Math.abs(afterFar.box.top - rest.box.top) <= 1 && (await liveIds()) === liveRest && farEnds.length === 1 && farEnds[0].offsetY > 700, { rest: rest.box, after: afterFar.box, live: await liveIds(), end: farEnds, midTop: far.mid.box.top });
  check('down: z returns to normal after release', afterDown.z.two === '1', { z: afterDown.z });

  // 3. controls: the strip covers the panel at rest, and closeOnRelease on closes the same drag
  check('control: at rest the app overlay, not the panel, is topmost where they overlap (the lift is what changes it)', coveredAtRest === 'cover', { got: coveredAtRest });
  await page.goto(`http://localhost:${srv.address().port}/?close=1`);
  await page.waitForSelector('[data-body="three"]');
  await page.waitForTimeout(1500);
  const before = await liveIds();
  const h2 = await handle();
  await page.mouse.move(h2.x, h2.y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) { await page.mouse.move(h2.x, h2.y + (500 * i) / 24); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(1800);
  const after = await liveIds();
  console.log(JSON.stringify({ step: 'control-close-on', before, after }));
  check('control: with closeOnRelease on the same long drag down closes the panel', before.includes('two') && !after.includes('two'), { before, after });
  console.log(JSON.stringify({ errors }));
  check('no page errors', errors.length === 0, { errors });
} finally {
  await browser?.close();
  srv.close();
}
console.log(JSON.stringify({ verdict: failures.length === 0 ? 'PASS' : 'FAIL', failures }));
if (failures.length > 0) process.exitCode = 1;
