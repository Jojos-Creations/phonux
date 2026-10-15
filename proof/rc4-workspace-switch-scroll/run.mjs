// node run.mjs <bundle.js> [chromium|webkit|firefox] [outdir]
// Samples the column track's translateY every animation frame through each way of switching workspaces, and checks the
// Reduce Motion cases. Playwright from /opt/node22 on the cloud; elsewhere pass PLAYWRIGHT_MODULE=<path to playwright/index.mjs>.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium', outdir = '.'] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const browser = await pw[engine].launch();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

// Installs a per-frame sampler of the track's translateY, in percent of a cell, and returns the track's transition too.
const sampler = () => {
  window.__samples = [];
  const track = document.querySelector('[data-workspace-cell]').parentElement;
  const tick = () => {
    // The computed transform, not the inline style: the inline style is the target from the first frame on.
    const r = track.getBoundingClientRect();
    const top = track.parentElement.getBoundingClientRect().top;
    window.__samples.push({ y: -(r.top - top) / r.height, t: performance.now(), transition: track.style.transition });
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
};
const stop = () => { cancelAnimationFrame(window.__raf); return window.__samples; };
const isIntermediate = (y, from, to) => y > Math.min(from, to) + 0.01 && y < Math.max(from, to) - 0.01;

const cases = [
  ['ArrowDown key', (p) => p.keyboard.press('ArrowDown'), 1],
  ['neighbour button', (p) => p.evaluate(() => document.querySelector('[data-workspace-cell][data-workspace-active] [data-workspace-neighbour="below"]').click()), 2],
  ['column.scrollTo API', (p) => p.evaluate(() => window.column.scrollTo(0)), 0],
  ['not-yet-rendered target', (p) => p.evaluate(() => { const ws = window.column.addWorkspace(); window.column.scrollTo(ws); }), 3],
];

for (const [mc, osReduce, label] of [['none', false, 'default'], ['always', false, 'MotionConfig always, OS off'], ['none', true, 'OS reduce, no MotionConfig'], ['user', true, 'MotionConfig user, OS reduce']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1080 }, reducedMotion: osReduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`${base}?mc=${mc}`);
  await page.waitForSelector('[data-workspace-cell] [data-row-slot]');
  await page.waitForTimeout(800);
  for (const [name, act, target] of cases) {
    if (name === 'column.scrollTo API') await page.evaluate(() => window.column.scrollTo(2));
    await page.waitForTimeout(700);
    const from = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-workspace-cell]')]; return c.indexOf(c.find((x) => x.hasAttribute('data-workspace-active'))); });
    await page.evaluate(sampler);
    await act(page);
    await page.waitForTimeout(1200);
    const samples = (await page.evaluate(stop)).filter((s) => Number.isFinite(s.y));
    const first = samples[0]?.y;
    const last = samples.at(-1)?.y;
    const to = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-workspace-cell]')]; return c.indexOf(c.find((x) => x.hasAttribute('data-workspace-active'))); });
    const distinct = new Set(samples.filter((s) => isIntermediate(s.y, first, last)).map((s) => Math.round(s.y * 10))).size;
    const transitions = [...new Set(samples.map((s) => s.transition))];
    const reducedRun = mc === 'always' || mc === 'user' ? true : osReduce;
    if (reducedRun) {
      check(`${label} / ${name}: snaps with no intermediate frame`, distinct === 0 && transitions.join() === 'none', `distinct ${distinct}, transitions ${transitions.join('|')}`);
    } else {
      check(`${label} / ${name}: animates through at least 5 intermediate positions`, distinct >= 5, `distinct ${distinct}, frames ${samples.length}, transitions ${transitions.join('|')}`);
    }
    check(`${label} / ${name}: lands on the target workspace`, to === target || name === 'not-yet-rendered target' && to >= 3, `from ${from} to ${to}`);
  }
  check(`${label}: no page errors`, errors.length === 0, errors.join(' ; '));
  await page.screenshot({ path: `${outdir}/${engine}-${mc}-${osReduce ? 'reduce' : 'no-preference'}.png` });
  await ctx.close();
}
await browser.close();
srv.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
