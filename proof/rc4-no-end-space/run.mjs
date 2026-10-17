// node run.mjs <bundle.js> [chromium|webkit|firefox]   (WIDTH=2240 by default)
// Loads the row at WIDTH wide, wheel-steps it to its end, and measures the room right of the last panel. After the fix the
// last panel's right edge is one row gap (16 px) inside the window, and the end element is one gap wide.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const WIDTH = Number(process.env.WIDTH ?? 2240);
const GAP = 16;
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-body="last"]');
await page.waitForTimeout(800);
const probe = () => page.evaluate(() => {
  const last = document.querySelector('[data-body="last"]');
  const slot = last.closest('[data-row-slot]') ?? last;
  const end = document.querySelector('[data-row-end-pad]');
  const c = end.parentElement;
  return { scrollLeft: c.scrollLeft, browserMax: c.scrollWidth - c.clientWidth, containerRight: c.getBoundingClientRect().right, lastRight: slot.getBoundingClientRect().right, end: end.getBoundingClientRect().width };
});
await page.mouse.move(WIDTH / 2, 300);
let previous = -1;
for (let step = 0; step < 40; step++) {
  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(700);
  const now = (await probe()).scrollLeft;
  if (now === previous) break;
  previous = now;
}
const m = await probe();
const blank = m.containerRight - m.lastRight;
const beyond = blank - GAP;
console.log(`scrollLeft ${m.scrollLeft}, browser range ${m.browserMax}, end element ${m.end}px, blank right of the last panel ${blank}px, beyond the row gap ${beyond}px`);
check('after wheel-stepping to the end, the scroll is at the browser range', Math.abs(m.scrollLeft - m.browserMax) < 1, `${m.scrollLeft} of ${m.browserMax}`);
check('the room right of the last panel beyond the row gap is 0', Math.abs(beyond) <= 1, `${beyond}px`);
check('the end element is one row gap wide', Math.abs(m.end - GAP) < 1, `${m.end}px`);
check('no console errors', errors.length === 0, errors.join(' | '));
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
