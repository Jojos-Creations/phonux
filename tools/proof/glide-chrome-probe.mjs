// node glide-chrome-probe.mjs <libDir> [firefox|webkit|chromium] [slots=1,4,1,2] [width=1800] [cpu=1] [gap=16] [frame=auto|self|selfy]
// Builds a stepping row of default-frame panels (frame=auto) from the library at <libDir>, sends wheel steps both ways and, on every
// animation frame of each glide, samples the chrome the size glide has to keep true: the phone frame, the header pill and the grab
// bar pill. Per sample it takes the box's scale from its transform and, per axis, the DRAWN corner radius (computed radius x scale)
// and the DRAWN edge thickness (computed shadow offsets x scale), and compares them with the same element at rest.
// Prints one JSON summary line. Needs esbuild and react/react-dom resolvable from <libDir>/node_modules and playwright
// (cwd, or PLAYWRIGHT_DIR=/path/to/node_modules).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ENTRY_SRC = readFileSync(new URL('./step-entry.tsx.txt', import.meta.url), 'utf8');

/** Runs the probe and returns the summary object. `pw` is the Playwright module. */
export async function probe({ pw, lib, engine = 'chromium', slots = '1,4,1,2', width = 1800, cpu = 1, gap = 16, steps = 3, frame = 'auto' }) {
  const req = createRequire(join(lib, 'package.json'));
  const { build } = await import(pathToFileURL(req.resolve('esbuild')).href);
  const dir = mkdtempSync(join(tmpdir(), 'glide-chrome-'));
  writeFileSync(join(dir, 'entry.tsx'), ENTRY_SRC);
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: lib }, nodePaths: [join(lib, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(join(dir, 'out.js')) : html); }).listen(0);
  const browser = await pw[engine].launch();
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${srv.address().port}/?mode=visible&slots=${slots}&gap=${gap}&control=none&reduce=0&frame=${frame}`);
    await page.waitForSelector('[data-phone-frame]');
    await page.waitForTimeout(1500);
    if (cpu > 1 && engine === 'chromium') await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.evaluate(() => {
      const num = (v) => Number.parseFloat(v);
      const pair = (v) => { const [a, b = a] = v.split(' ').map(num); return [a, b]; };
      // computed `box-shadow`: "<color> x y blur spread inset, ..." with the colour first in Chrome and last elsewhere
      const shadows = (v) => v.split(/,(?![^(]*\))/).map((part) => {
        const nums = part.replace(/rgba?\([^)]*\)/g, ' ').match(/-?\d*\.?\d+(?:e-?\d+)?px|(?<![\w.])-?0(?![\w.])/g) ?? [];
        const n = nums.map(num);
        return { x: n[0] ?? 0, y: n[1] ?? 0, spread: n[3] ?? 0 };
      });
      const KINDS = { frame: '[data-phone-frame]', header: '[data-panel-chrome-part="header"]', grab: '[data-panel-grab-bar] > div' };
      window.__samples = [];
      window.__rec = false;
      const tick = (t) => {
        if (window.__rec) {
          for (const box of document.querySelectorAll('[data-panel-size-box]')) {
            const r = box.getBoundingClientRect();
            if (r.right < 1 || r.left > innerWidth - 1) continue;
            const m = /matrix\(([^)]*)\)/.exec(getComputedStyle(box).transform);
            const [a, , , d] = m === null ? [1, 0, 0, 1] : m[1].split(',').map(num);
            const slot = box.closest('[data-row-slot]')?.getAttribute('data-row-slot') ?? '?';
            for (const [kind, sel] of Object.entries(KINDS)) {
              const el = box.querySelector(sel);
              if (el === null) continue;
              const cs = getComputedStyle(el);
              window.__samples.push({ t, slot, kind, sx: a, sy: d, varsSet: box.style.getPropertyValue('--phonux-size-x') !== '', radius: pair(cs.borderTopLeftRadius), borders: [num(cs.borderLeftWidth), num(cs.borderRightWidth), num(cs.borderTopWidth), num(cs.borderBottomWidth)], shadow: shadows(cs.boxShadow), w: el.getBoundingClientRect().width });
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const samples = [];
    let endWithVars = 0;
    const mark = (kind) => page.evaluate(() => { window.__samples = []; window.__rec = true; });
    for (const [delta, n] of [[300, steps], [-300, steps]]) {
      for (let i = 0; i < n; i++) {
        await page.mouse.move(Math.min(600, width - 50), 300);
        await mark();
        await page.mouse.wheel(delta, 0);
        await page.waitForTimeout(1200 * Math.max(1, cpu / 2));
        const stepSamples = await page.evaluate(() => { window.__rec = false; return window.__samples; });
        samples.push(...stepSamples);
        // The last sample of each element in the step is at rest: no variable may be left on its box.
        const lastOf = new Map(stepSamples.map((s) => [`${s.slot}/${s.kind}`, s]));
        for (const s of lastOf.values()) if (s.varsSet) endWithVars++;
      }
    }
    // Rest reference per element: the last sample of its (slot, kind) that is at scale 1 with no variables set.
    const rest = new Map();
    for (const s of samples) if (s.sx === 1 && s.sy === 1 && !s.varsSet) rest.set(`${s.slot}/${s.kind}`, s);
    const out = { engine, frame, slots, width, cpu, gap, frames: 0, glidingSamples: 0, endWithVars, perKind: {} };
    for (const s of samples) {
      out.frames++;
      const ref = rest.get(`${s.slot}/${s.kind}`);
      if (s.sx === 1 && s.sy === 1) continue;
      if (ref === undefined) continue;
      out.glidingSamples++;
      out.perKind[s.kind] ??= { samples: 0, worstRadiusX: 0, worstRadiusY: 0, worstEdge: 0, minScaleX: 9, maxScaleX: 0, minScaleY: 9, maxScaleY: 0 };
      const k = out.perKind[s.kind];
      k.samples++;
      k.minScaleX = Math.min(k.minScaleX, s.sx); k.maxScaleX = Math.max(k.maxScaleX, s.sx);
      k.minScaleY = Math.min(k.minScaleY, s.sy); k.maxScaleY = Math.max(k.maxScaleY, s.sy);
      k.worstRadiusX = Math.max(k.worstRadiusX, Math.abs(s.radius[0] * s.sx - ref.radius[0]));
      k.worstRadiusY = Math.max(k.worstRadiusY, Math.abs(s.radius[1] * s.sy - ref.radius[1]));
      // The edge is an inset shadow (bands while gliding) or, on a tree that still draws a border, the border: its thickness drawn per axis must be 1 px.
      if (s.kind !== 'grab') {
        const bordered = s.borders.some((b) => b > 0);
        const drawn = bordered
          ? [s.borders[0] * s.sx, s.borders[1] * s.sx, s.borders[2] * s.sy, s.borders[3] * s.sy]
          : [Math.abs(s.shadow[1].x) * s.sx, Math.abs(s.shadow[2].x) * s.sx, Math.abs(s.shadow[3].y) * s.sy, Math.abs(s.shadow[4].y) * s.sy];
        k.worstEdge = Math.max(k.worstEdge, ...drawn.map((d) => Math.abs(d - 1)), bordered ? 0 : Math.abs(s.shadow[0].spread));
      }
    }
    return out;
  } finally {
    await browser.close();
    srv.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [libArg, engine = 'chromium', slots = '1,4,1,2', widthArg = '1800', cpuArg = '1', gap = '16', frame = 'auto'] = process.argv.slice(2);
  if (!libArg) throw new Error('usage: node glide-chrome-probe.mjs <libDir> [firefox|webkit|chromium] [slots] [width] [cpu] [gap] [auto|self|selfy]');
  const pwNs = process.env.PLAYWRIGHT_DIR ? await import(pathToFileURL(createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright')).href) : await import('playwright');
  const pw = pwNs.chromium ? pwNs : pwNs.default;
  console.log(JSON.stringify(await probe({ pw, lib: resolve(libArg), engine, slots, width: Number(widthArg), cpu: Number(cpuArg), gap: Number(gap), frame })));
}
