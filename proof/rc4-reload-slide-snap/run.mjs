// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Load and reload with panels present at mount, in a window that fits them to a size other than the preferred one.
// Every animation frame records each panel slot's left and width: a slide shows as many distinct states, a snap as at most the unmeasured first frame and the settled one.
// A panel added after the load must still slide, which proves the sampler can see a slide.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: Number(process.env.WINDOW_HEIGHT ?? 700) } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  const seen = {};
  window.__seen = seen;
  const tick = () => {
    for (const s of document.querySelectorAll('[data-row-slot]')) {
      const r = s.getBoundingClientRect();
      const key = `${Math.round(r.left)}x${Math.round(r.width)}`;
      (seen[s.querySelector('[data-body]')?.dataset.body ?? 'none'] ??= new Set()).add(key);
      if (s.querySelector('[data-body=one]')) (window.__frames ??= []).push(key);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const url = `http://localhost:${srv.address().port}/`;
const states = () => page.evaluate(() => Object.fromEntries(Object.entries(window.__seen).map(([k, v]) => [k, [...v]])));
for (const phase of ['first load', 'reload']) {
  if (phase === 'reload') await page.reload(); else await page.goto(url);
  await page.waitForSelector('[data-body="three"]');
  await page.waitForTimeout(1500);
  const seen = await states();
  const ids = ['one', 'two', 'three'];
  const frames = await page.evaluate(() => window.__frames);
  const settled = frames[frames.length - 1];
  const off = frames.filter((f) => f !== settled).length;
  const detail = ids.map((id) => `${id}:${(seen[id] ?? []).join('>')}`).join(' ');
  check(`${phase}: panels present at mount snap to their place (at most 2 frames away from it, no slide)`, off <= 2 && ids.every((id) => (seen[id] ?? []).length <= 2), `${detail}; frames away from the settled place: ${off}`);
}
await page.evaluate(() => { window.__ws.addPanel('late'); });
await page.waitForSelector('[data-body="late"]');
await page.waitForTimeout(1500);
const late = (await states()).late ?? [];
check('a panel added later still slides in (the sampler sees a slide)', late.length > 1, `late:${late.length}`);
check('no console errors', errors.length === 0, errors.join(' | '));
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
