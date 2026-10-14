// node run.mjs <bundle.js> [chromium|webkit|firefox]
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
const page = await (await browser.newContext({ viewport: { width: 2400, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-body="own"]');
await page.waitForTimeout(1000);
const phone = await page.evaluate(() => document.querySelector('[data-panel-size-box]').getBoundingClientRect().width);
for (const id of ['bare', 'own']) {
  const w = await page.evaluate((id) => {
    const body = document.querySelector(`[data-body="${id}"]`);
    const slot = body.closest('[data-row-slot]');
    const box = slot.querySelector('[data-panel-size-box]') ?? slot;
    const frame = slot.querySelector('[data-phone-frame]');
    return { slot: parseFloat(slot.style.width), box: box.getBoundingClientRect().width, frame: frame.getBoundingClientRect().width };
  }, id);
  check(`${id}: the box, the frame and the slot are one width`, Math.abs(w.box - w.slot) < 0.5 && Math.abs(w.frame - w.slot) < 0.5, JSON.stringify(w));
  check(`${id}: two slots are two phones and the tuned 24 px gap`, Math.abs(w.slot - (2 * 390 + 24)) < 0.5, `${w.slot}, a phone is ${phone}`);
}
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
