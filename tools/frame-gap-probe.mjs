// Drives a production build of test/frame-gap/demo.tsx in Chromium under CPU throttling through the row's motions and
// fails when a frame is late or two neighbors overlap. `npm run check:frame-gap`; `--json` prints the measurements only.
//
// Exit codes: 0 every motion within budget, 1 a motion over budget, 2 the probe proved nothing (a control did not
// behave, a motion sampled too few frames or moved nothing), so a broken sampler can never pass.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THROTTLE = Number(process.env.FRAME_GAP_THROTTLE ?? 4);
const MAX_GAP_MS = Number(process.env.FRAME_GAP_MAX_MS ?? 50);
// Sub-pixel rounding between two slots that touch at the row gap of 0 reads as a hair of overlap, never half a pixel.
const MIN_NEIGHBOR_PX = -0.5;
const json = process.argv.includes('--json');

const built = await build({
  entryPoints: [join(root, 'test/frame-gap/demo.tsx')],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const bundle = built.outputFiles.map((file) => file.text).join('');
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script src="/demo.js"></script></body></html>';
const server = createServer((request, response) => {
  const js = request.url === '/demo.js';
  response.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  response.end(js ? bundle : html);
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

// The repo pins its own Playwright; a container that ships a different Chromium build names it here.
const bundled = chromium.executablePath();
const executablePath = process.env.FRAME_GAP_CHROMIUM ?? (existsSync(bundled) ? bundled : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ executablePath });

// Each rAF reads every slot's rect: a frame the probe sees is a frame the person sees, and the read lands after the
// frame's own animation writes.
function installSampler() {
  window.sample = (ms) =>
    new Promise((done) => {
      const frames = [];
      const start = performance.now();
      const tick = (ts) => {
        const slots = [...document.querySelectorAll('[data-row-slot]')]
          .map((el) => ({ id: el.querySelector('[data-probe-body]')?.dataset.probeBody ?? el.dataset.rowId, rect: el.getBoundingClientRect() }))
          .filter((s) => s.rect.width > 1)
          .sort((a, b) => a.rect.left - b.rect.left);
        let minGap = Number.POSITIVE_INFINITY;
        let pair = '';
        for (let i = 1; i < slots.length; i++) {
          const gap = slots[i].rect.left - slots[i - 1].rect.right;
          if (gap < minGap) {
            minGap = gap;
            pair = `${slots[i - 1].id}|${slots[i].id}`;
          }
        }
        // The bodies, not the slots, carry a maximize: the panel leaves its slot in place and grows over the row.
        const shape = [...document.querySelectorAll('[data-probe-body]')]
          .map((el) => { const r = el.getBoundingClientRect(); return `${el.dataset.probeBody}:${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)}x${r.height.toFixed(1)}`; })
          .join(' ');
        frames.push({ ts, minGap, pair, shape });
        if (ts - start < ms) requestAnimationFrame(tick);
        else done(frames);
      };
      requestAnimationFrame(tick);
    });
}

function summarize(name, frames, windowMs) {
  let maxGapMs = 0;
  let worstAt = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].ts - frames[i - 1].ts;
    if (gap > maxGapMs) {
      maxGapMs = gap;
      worstAt = frames[i - 1].ts - frames[0].ts;
    }
  }
  const tightest = frames.reduce((worst, f) => (f.minGap < worst.minGap ? f : worst), { minGap: Number.POSITIVE_INFINITY, pair: '' });
  return {
    name,
    frames: frames.length,
    // At the budget's own rate a window of this length holds windowMs / MAX_GAP_MS frames; far fewer means the sampler starved.
    minFrames: Math.floor(windowMs / MAX_GAP_MS / 2),
    shapes: new Set(frames.map((f) => f.shape)).size,
    maxGapMs: +maxGapMs.toFixed(1),
    maxGapAtMs: Math.round(worstAt),
    minNeighborPx: Number.isFinite(tightest.minGap) ? +tightest.minGap.toFixed(1) : null,
    tightestPair: tightest.pair,
  };
}

const results = [];
const controls = [];
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('[data-probe-body="p6"]', { state: 'attached' });
  await page.evaluate(installSampler);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.waitForTimeout(1500);

  const measure = async (name, windowMs, act) => {
    const sampled = page.evaluate((ms) => window.sample(ms), windowMs);
    await page.waitForTimeout(50);
    await act();
    const summary = summarize(name, await sampled, windowMs);
    // Past the resize hold and its glide, so one motion's tail never lands in the next one's window.
    await page.waitForTimeout(1500);
    return summary;
  };
  const resize = async (from, to) => {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.setViewportSize({ width: Math.round(from + ((to - from) * i) / steps), height: 900 });
      await page.waitForTimeout(40);
    }
  };

  // Controls: an idle row must pass, a 150 ms task must read as a late frame, and two slots pushed together must read as an overlap.
  controls.push({ ...(await measure('control: idle', 800, async () => {})), expect: 'pass' });
  controls.push({ ...(await measure('control: 150 ms task', 800, () => page.evaluate(() => { const end = performance.now() + 150; while (performance.now() < end); }))), expect: 'late' });
  controls.push({
    ...(await measure('control: forced overlap', 800, () =>
      page.evaluate(() => {
        const slot = document.querySelectorAll('[data-row-slot]')[1];
        slot.style.translate = '-40px';
        setTimeout(() => { slot.style.translate = ''; }, 200);
      }),
    )),
    expect: 'overlap',
  });

  results.push(await measure('window resize 844 to 1800', 2200, () => resize(844, 1800)));
  results.push(await measure('window resize 1800 to 844', 2200, () => resize(1800, 844)));
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.waitForTimeout(1500);
  results.push(await measure('phone size 390 to 430, six panels', 1500, () => page.evaluate(() => window.probe.setPhone(430, 932))));
  results.push(await measure('phone size 430 to 390, six panels', 1500, () => page.evaluate(() => window.probe.setPhone(390, 844))));
  results.push(await measure('expand in (open between p3 and p4)', 1500, () => page.evaluate(() => window.probe.addMid())));
  results.push(await measure('shrink out (close it again)', 1500, () => page.evaluate(() => window.probe.closeMid())));
  results.push(await measure('maximize p2', 1500, () => page.evaluate(() => window.probe.toggleMaximize('p2'))));
  results.push(await measure('unmaximize p2', 1500, () => page.evaluate(() => window.probe.toggleMaximize('p2'))));
} finally {
  await browser.close();
  server.close();
}

const late = (r) => r.maxGapMs >= MAX_GAP_MS;
const overlaps = (r) => r.minNeighborPx !== null && r.minNeighborPx < MIN_NEIGHBOR_PX;
const nothing = [];
for (const c of controls) {
  const ok = c.expect === 'pass' ? !late(c) && !overlaps(c) : c.expect === 'late' ? c.maxGapMs >= 100 : overlaps(c);
  if (!ok) nothing.push(`${c.name} did not read as ${c.expect}`);
}
for (const r of [...controls, ...results]) {
  if (r.frames < r.minFrames) nothing.push(`${r.name}: ${r.frames} frames sampled, fewer than ${r.minFrames}`);
}
for (const r of results) {
  if (r.shapes < 2) nothing.push(`${r.name}: nothing on screen moved`);
}
if (errors.length > 0) nothing.push(`page errors: ${errors.join('; ')}`);
const failed = results.filter((r) => late(r) || overlaps(r));

if (json) console.log(JSON.stringify({ throttle: THROTTLE, maxGapMs: MAX_GAP_MS, minNeighborPx: MIN_NEIGHBOR_PX, controls, results, nothing }, null, 1));
else {
  console.log(`frame-gap probe: Chromium, CPU throttle x${THROTTLE}, budget: frame gap < ${MAX_GAP_MS} ms, neighbor gap >= 0 px`);
  for (const r of [...controls, ...results]) {
    const mark = nothing.some((n) => n.startsWith(r.name)) ? 'BROKEN' : r.expect ? 'ok' : late(r) || overlaps(r) ? 'FAIL' : 'pass';
    console.log(`  ${mark.padEnd(6)} ${r.name.padEnd(38)} max gap ${String(r.maxGapMs).padStart(6)} ms at ${String(r.maxGapAtMs).padStart(5)} ms  min neighbor ${String(r.minNeighborPx).padStart(7)} px ${r.tightestPair}  (${r.frames} frames)`);
  }
}
if (nothing.length > 0) {
  console.error(`frame-gap probe proved nothing:\n  ${nothing.join('\n  ')}`);
  process.exit(2);
}
if (failed.length > 0) {
  console.error(`frame-gap probe: ${failed.length} of ${results.length} motions over budget`);
  process.exit(1);
}
console.log(`frame-gap probe: all ${results.length} motions within budget`);
