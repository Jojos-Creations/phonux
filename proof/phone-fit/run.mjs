// node run.mjs <bundle.js> [chromium|webkit|firefox]   The default mount with phoneFit 'fit' under StrictMode.
// Playwright from /opt/node22 on the cloud; on the Mac pass PLAYWRIGHT_MODULE=<path to playwright/index.mjs>.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const browser = await pw[engine].launch();
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const GAP = 24;

async function open(width, height, fit = 'fit') {
  const context = await browser.newContext({ viewport: { width, height } });
  const pg = await context.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  await pg.goto(`${base}?fit=${fit}`);
  await pg.waitForSelector('[data-box="root"]');
  await pg.waitForTimeout(1500);
  return { pg, context, errors };
}
const read = (pg) => pg.evaluate((GAP) => {
  const c = document.querySelector('[data-row-scroller]');
  const box = c.getBoundingClientRect();
  const slots = [...c.querySelectorAll('[data-row-slot]')].map((el) => { const r = el.getBoundingClientRect(); return { left: Math.round((r.left - box.left) * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height) }; });
  const frame = c.querySelector('[data-box]').getBoundingClientRect();
  return { window: c.clientWidth, height: c.clientHeight, scrollH: c.scrollHeight, overflowY: getComputedStyle(c).overflowY, scrollLeft: c.scrollLeft, slots, boxWidth: Math.round(frame.width * 10) / 10 };
}, GAP);
const expected = (pg, r) => pg.evaluate(({ r, GAP }) => window.__fitPhone({ windowWidth: r.window, heightBudget: Math.max(0, r.height - 96 - GAP), rowCount: 1, preferred: { width: 390, height: 700 }, gap: GAP, edge: GAP, min: 0.82, max: 1.13 }), { r, GAP });

const windows = [[844, 900], [1280, 720], [1280, 900], [1800, 720], [1800, 900], [844, 390], [1280, 650]];
for (const [width, height] of windows) {
  const { pg, context, errors } = await open(width, height);
  const r = await read(pg);
  const e = await expected(pg, r);
  const first = r.slots[1];
  const visible = r.slots.filter((s) => s.left >= GAP - 0.5 && s.left + s.width <= r.window - GAP + 0.5).length;
  console.log(`-- ${width}x${height}: container ${r.window}x${r.height}, fit ${JSON.stringify(e)}, slots ${r.slots.map((s) => `${s.left}+${s.width}x${s.height}`).join(' ')}`);
  check(`${width}x${height}: the panels are drawn at the fitted width`, r.slots.every((s) => s.width === e.width), `${r.slots.map((s) => s.width).join(',')} vs ${e.width}`);
  const lead = (r.window - (e.count * e.width + (e.count - 1) * GAP)) / 2;
  check(`${width}x${height}: the first panel sits ${lead} px from the edge, the leftover centred`, Math.abs(r.slots[0].left - lead) <= 1, String(r.slots[0].left));
  check(`${width}x${height}: ${e.count} whole slots fit between the edges`, visible === Math.min(e.count, r.slots.length) || r.slots.length < e.count, `visible ${visible}`);
  check(`${width}x${height}: no slot at rest is cut by the window edge`, r.slots.filter((s, k) => k < visible).every((s) => s.left + s.width <= r.window - GAP + 0.5));
  check(`${width}x${height}: the panel is the fitted height`, first.height === e.height, `${first.height} vs ${e.height}`);
  if (height === 390 || e.heightCapped && e.height > r.height - 96 - GAP) check(`${width}x${height}: the height cap sits below the minimum, so the row scrolls vertically`, r.scrollH > r.height, `scrollHeight ${r.scrollH} client ${r.height}`);
  check(`${width}x${height}: no errors or warnings under StrictMode`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// A window dragged across the 3-slot breakpoint (container 1056 at gap 24): nothing moves while it is moving, one change after it settles.
{
  const { pg, context, errors } = await open(1040, 900);
  const start = await read(pg);
  const seen = [];
  for (let w = 1040; w <= 1100; w += 1) {
    await pg.setViewportSize({ width: w, height: 900 });
    await pg.waitForTimeout(25);
    seen.push((await read(pg)).slots[1].width);
  }
  const during = new Set(seen);
  check('breakpoint sweep 1040 to 1100: the drawn width holds still while the window moves', during.size === 1 && [...during][0] === start.slots[1].width, [...during].join(','));
  await pg.waitForTimeout(1500);
  const settled = await read(pg);
  const e = await expected(pg, settled);
  check('breakpoint sweep: one change after the window settles, to the fit of the final width (3 slots of 334)', settled.slots[1].width === e.width && settled.slots[1].width !== start.slots[1].width, `${start.slots[1].width} -> ${settled.slots[1].width} (fit ${e.width})`);
  // Held within 1 px of the breakpoint for many frames: the count changes at most once.
  const widths = [];
  for (let i = 0; i < 40; i += 1) {
    await pg.setViewportSize({ width: 1055 + (i % 2), height: 900 });
    await pg.waitForTimeout(40);
    widths.push((await read(pg)).slots[1].width);
  }
  await pg.waitForTimeout(1500);
  widths.push((await read(pg)).slots[1].width);
  const changes = widths.filter((x, k) => k > 0 && x !== widths[k - 1]).length;
  check('a width flickering 1 px across the breakpoint for 40 frames changes the size at most once', changes <= 1, `${changes} changes: ${[...new Set(widths)].join(',')}`);
  check('breakpoint sweep: no errors or warnings', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// phoneFit off: today's draw, the preferred 390 at every window.
for (const [width, height] of [[844, 900], [1280, 720]]) {
  const { pg, context, errors } = await open(width, height, 'off');
  const r = await read(pg);
  check(`off @${width}x${height}: the panels keep the preferred 390x700`, r.slots.every((s) => s.width === 390 && s.height === 700), r.slots.map((s) => `${s.width}x${s.height}`).join(','));
  check(`off @${width}x${height}: no errors or warnings`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
