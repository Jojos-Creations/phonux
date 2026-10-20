// node frame-corner-ring-probe.mjs <libDir> [outDir]
// Renders the library's PanelFrame at <libDir> around an opaque full-bleed child in headless WebKit and Chromium at deviceScaleFactor 2,
// in the dark and the light scheme, and scores the ring along all four corner arcs: at each sampled point on the middle of the 1 px
// ring, the pixel must match the same frame rendered with nothing in it. Writes the four corner crops and a contact sheet per
// engine and scheme into <outDir>, prints one JSON line per engine, scheme and corner, and exits 1 unless every sample on every arc
// is ring-coloured (and 2 when the run could not prove anything).
// Needs: esbuild and react, react-dom and @mui/material resolvable from <libDir>/node_modules, PLAYWRIGHT_ENTRY=<path to playwright-core/index.mjs>
// (else `playwright` from cwd), WEBKIT_BIN=<pw_run.sh> and CHROMIUM_BIN=<headless shell> for engines that are not playwright's own.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [libArg, outArg] = process.argv.slice(2);
if (!libArg) throw new Error('usage: node frame-corner-ring-probe.mjs <libDir> [outDir]');
const lib = resolve(libArg);
const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), 'frame-corner-ring-')));
mkdirSync(out, { recursive: true });

const DPR = 2;
const CROP = 40; // CSS px around a corner
const ANGLES = Array.from({ length: 17 }, (_, i) => 5 + i * 5); // degrees along each arc, 5..85
const TOLERANCE = 40; // largest channel difference from the empty frame's pixel that still counts as ring
const MIN_CONTRAST = 100; // the child must differ from the ring by at least this, or the score proves nothing
const CORNERS = { TL: [-1, -1], TR: [1, -1], BL: [-1, 1], BR: [1, 1] };

const req = createRequire(join(lib, 'package.json'));
const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
const pwNs = await import(process.env.PLAYWRIGHT_ENTRY ? pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href : 'playwright');
const pw = pwNs.chromium ? pwNs : pwNs.default;

const dir = mkdtempSync(join(tmpdir(), 'frame-corner-entry-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(new URL('./frame-corner-entry.tsx.txt', import.meta.url), 'utf8'));
await build({
  entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib }, nodePaths: [join(lib, 'node_modules')], logLevel: 'warning',
});
const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);

const ENGINES = [
  ['webkit', pw.webkit, process.env.WEBKIT_BIN ?? process.env.BROWSER_BIN],
  ['chromium', pw.chromium, process.env.CHROMIUM_BIN],
];

// Decodes PNG bytes in the page and returns the RGB at each device pixel, so no image library is needed here.
const readPixels = (page, png, devicePoints) => page.evaluate(async ({ b64, points }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  return points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, { b64: png.toString('base64'), points: devicePoints });

// Four corner crops, nearest-neighbour at 5x, as a 2 x 2 sheet: TL TR over BL BR.
const sheet = (page, png, crops) => page.evaluate(async ({ b64, crops: boxes, scale }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const side = boxes.TL.size * scale;
  const canvas = new OffscreenCanvas(side * 2 + 8, side * 2 + 8);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ff00ff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  [['TL', 0, 0], ['TR', 1, 0], ['BL', 0, 1], ['BR', 1, 1]].forEach(([k, cx, cy]) => {
    const b = boxes[k];
    g.drawImage(bitmap, b.x, b.y, b.size, b.size, cx * (side + 8), cy * (side + 8), side, side);
  });
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const byte of buf) s += String.fromCharCode(byte);
  return btoa(s);
}, { b64: png.toString('base64'), crops, scale: 5 });

const rows = [];
let unproven = 0;
for (const [name, type, exe] of ENGINES) {
  let browser;
  try {
    browser = await type.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  } catch (e) {
    console.log(`UNPROVEN ${name}: could not launch (${String(e.message).split('\n')[0]})`);
    unproven++;
    continue;
  }
  for (const scheme of ['dark', 'light']) {
    const shoot = async (child) => {
      const ctx = await browser.newContext({ viewport: { width: 440, height: 660 }, deviceScaleFactor: DPR, colorScheme: scheme });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      await page.goto(`http://localhost:${srv.address().port}/?scheme=${scheme}&child=${child}`);
      await page.waitForSelector('[data-phone-frame]');
      await page.waitForTimeout(300);
      const geo = await page.evaluate(() => {
        const f = document.querySelector('[data-phone-frame]');
        const r = f.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, radius: Number.parseFloat(getComputedStyle(f).borderRadius), full: document.querySelector('[data-fullbleed]') !== null };
      });
      const png = await page.screenshot();
      return { ctx, page, geo, png };
    };
    const ref = await shoot('none');
    const test = await shoot('full');
    const { x, y, w, h, radius: R } = test.geo;
    if (!test.geo.full || ref.geo.full || !(R > 1)) { console.log(`UNPROVEN ${name} ${scheme}: fixture did not render as described`); unproven++; continue; }
    const centre = { TL: [x + R, y + R], TR: [x + w - R, y + R], BL: [x + R, y + h - R], BR: [x + w - R, y + h - R] };
    const samples = [];
    for (const [corner, [sx, sy]] of Object.entries(CORNERS)) {
      for (const deg of ANGLES) {
        const t = (deg * Math.PI) / 180;
        const px = centre[corner][0] + sx * (R - 0.5) * Math.cos(t);
        const py = centre[corner][1] + sy * (R - 0.5) * Math.sin(t);
        samples.push({ corner, deg, dev: [Math.floor(px * DPR), Math.floor(py * DPR)] });
      }
    }
    const inside = [Math.floor((x + w / 2) * DPR), Math.floor((y + h / 2) * DPR)];
    const devPoints = [...samples.map((s) => s.dev), inside];
    const got = await readPixels(test.page, test.png, devPoints);
    const want = await readPixels(ref.page, ref.png, devPoints);
    const ringRef = want[samples.findIndex((s) => s.corner === 'TL' && s.deg === 45)];
    const childVsRing = Math.max(...got.at(-1).map((v, i) => Math.abs(v - ringRef[i])));
    if (childVsRing < MIN_CONTRAST) { console.log(`UNPROVEN ${name} ${scheme}: the child differs from the ring by only ${childVsRing}`); unproven++; continue; }
    const byCorner = {};
    samples.forEach((s, i) => {
      const diff = Math.max(...got[i].map((v, k) => Math.abs(v - want[i][k])));
      byCorner[s.corner] ??= { ring: 0, total: 0, worst: 0 };
      const c = byCorner[s.corner];
      c.total++;
      c.worst = Math.max(c.worst, diff);
      if (diff <= TOLERANCE) c.ring++;
    });
    const crops = {};
    for (const [corner, [sx, sy]] of Object.entries(CORNERS)) {
      const cx = sx < 0 ? x - 4 : x + w + 4 - CROP;
      const cy = sy < 0 ? y - 4 : y + h + 4 - CROP;
      crops[corner] = { x: Math.round(cx * DPR), y: Math.round(cy * DPR), size: CROP * DPR };
      writeFileSync(join(out, `${name}-${scheme}-${corner}.png`), await test.page.screenshot({ clip: { x: cx, y: cy, width: CROP, height: CROP } }));
    }
    writeFileSync(join(out, `${name}-${scheme}-sheet.png`), Buffer.from(await sheet(test.page, test.png, crops), 'base64'));
    for (const [corner, c] of Object.entries(byCorner)) {
      rows.push({ engine: name, scheme, corner, ring: c.ring, total: c.total, worst: c.worst });
      console.log(JSON.stringify(rows.at(-1)));
    }
    await ref.ctx.close();
    await test.ctx.close();
  }
  await browser.close();
}
srv.close();

const expected = ENGINES.length * 2 * Object.keys(CORNERS).length;
const bad = rows.filter((r) => r.ring !== r.total);
const arcs = rows.length;
const ringPx = rows.reduce((a, r) => a + r.ring, 0);
const totalPx = rows.reduce((a, r) => a + r.total, 0);
console.log(`\n${ringPx} of ${totalPx} samples ring-coloured over ${arcs} of ${expected} arcs (tolerance ${TOLERANCE}, dpr ${DPR}); crops in ${out}`);
if (unproven > 0 || arcs !== expected) {
  console.log('UNPROVEN: not every engine, scheme and corner was scored');
  process.exitCode = 2;
} else if (bad.length > 0) {
  console.log(`FAIL: ${bad.length} of ${arcs} arcs are not fully ring-coloured:`, bad.map((r) => `${r.engine}/${r.scheme}/${r.corner} ${r.ring}/${r.total}`).join(', '));
  process.exitCode = 1;
} else {
  console.log('PASS: every sampled point on all four arcs is ring-coloured in every engine and scheme');
}
