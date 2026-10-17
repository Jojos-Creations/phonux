// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Step a stepping row to a late stop, reload, and sample the row from the first frame of the reload: every frame that shows
// the row's panels must rest on the saved stop, with no frame at 0 or at the end of the strip.
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
const page = await (await browser.newContext({ viewport: { width: 2240, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  window.__samples = [];
  const sample = () => {
    const c = document.querySelector('[data-row-scroller]');
    if (c !== null) {
      const slots = [...document.querySelectorAll('[data-row-slot]')].map((s) => {
        const r = s.getBoundingClientRect();
        return [s.querySelector('[data-body]')?.dataset.body ?? 'none', Math.round(r.left)];
      });
      window.__samples.push({ sl: c.scrollLeft, max: c.scrollWidth - c.clientWidth, n: slots.length, slots });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const url = `http://localhost:${srv.address().port}/`;
const rowState = () => page.evaluate(() => {
  const c = document.querySelector('[data-row-scroller]');
  return c === null ? null : { sl: c.scrollLeft, max: c.scrollWidth - c.clientWidth };
});

await page.goto(url);
await page.waitForSelector('[data-body="p5"]');
await page.waitForTimeout(800);
for (let step = 0; step < 3; step += 1) {
  await page.mouse.move(1000, 350);
  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(700);
}
const before = await rowState();
await page.waitForTimeout(1200);
const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), 'phonux-proof-rest');
check('the stepped row rests on a late stop, not at the start or the end', before.sl > 0 && before.sl < before.max, `scrollLeft ${before.sl} of ${before.max}`);
check('the step saved a scroll marker', saved?.scroll !== undefined, JSON.stringify(saved?.scroll));

await page.evaluate(() => { window.__samples = []; });
await page.reload();
await page.waitForSelector('[data-body="p5"]');
await page.waitForTimeout(1500);
const samples = await page.evaluate(() => window.__samples);
const shown = samples.filter((s) => s.n >= 5);
const rests = [...new Set(shown.map((s) => s.sl))];
const early = samples.length - shown.length;
check('every frame that shows the row panels rests on the saved stop', shown.length > 0 && rests.length === 1 && rests[0] === before.sl, `distinct scrollLeft ${JSON.stringify(rests)} over ${shown.length} frames (saved ${before.sl}); ${early} frames before the panels were in the row`);
check('no frame at the start or the end of the strip', shown.every((s) => s.sl !== 0 && s.sl !== s.max), `max ${shown[0]?.max}`);
check('no console errors', errors.length === 0, errors.join(' | '));
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
