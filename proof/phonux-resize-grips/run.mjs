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
const errors = [];
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

async function open(reducedMotion) {
  const page = await (await browser.newContext({ viewport: { width: 2400, height: 1000 }, reducedMotion })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="bare"]');
  await page.waitForTimeout(1200);
  return page;
}
const boxWidth = (page) => page.evaluate(() => document.querySelector('[data-body="bare"]').closest('[data-row-slot]').querySelector('[data-panel-size-box]').getBoundingClientRect().width);
const rect = (page, side) => page.evaluate((s) => { const r = document.querySelector(`[data-panel-resize-grip="${s}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, side);
const slots = (page) => page.evaluate(() => Number(document.querySelector('[data-panel-resize-grip="right"]').getAttribute('aria-valuenow')));
const rightEdge = (page) => page.evaluate(() => document.querySelector('[data-body="bare"]').closest('[data-row-slot]').querySelector('[data-panel-size-box]').getBoundingClientRect().right);

let page = await open('no-preference');
const phone = await boxWidth(page);
const right = await rect(page, 'right');
check('a grip on each side, each a 24 px wide target', right.w >= 24 && (await rect(page, 'left')).w >= 24, `${right.w} x ${right.h}`);
check('each grip is a separator with a spoken value', await page.evaluate(() => [...document.querySelectorAll('[data-panel-resize-grip]')].every((g) => g.getAttribute('role') === 'separator' && /slots wide$/.test(g.getAttribute('aria-valuetext')))));

const cx = right.x + right.w / 2, cy = right.y + right.h / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 100, cy, { steps: 6 });
await page.waitForTimeout(300);
const mid = await boxWidth(page);
check('the width follows the pointer between two slots', Math.abs(mid - (phone + 100)) < 3, `${mid} vs ${phone + 100}`);
check('nothing is stored while the pointer is held', (await slots(page)) === 1);
await page.mouse.move(cx + 420, cy, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(1500);
check('the release settles on the nearest slot', (await slots(page)) === 2, `slots ${await slots(page)}`);
check('and the panel rests at two phones and a gap', Math.abs((await boxWidth(page)) - (2 * phone + 24)) < 1, `${await boxWidth(page)}`);

const edge = await rightEdge(page);
const left = await rect(page, 'left');
const lx = left.x + left.w / 2, ly = left.y + left.h / 2;
await page.mouse.move(lx, ly);
await page.mouse.down();
await page.mouse.move(lx - 100, ly, { steps: 6 });
await page.waitForTimeout(300);
check('the left grip keeps the right edge still while the panel widens', Math.abs((await rightEdge(page)) - edge) < 3 && (await boxWidth(page)) > 2 * phone + 24 + 90, `edge ${edge} -> ${await rightEdge(page)}`);
await page.mouse.up();
await page.waitForTimeout(1500);
check('and the release settles back on two slots', (await slots(page)) === 2);

await page.focus('[data-panel-resize-grip="right"]');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1500);
check('ArrowRight on the right grip grows by one slot', (await slots(page)) === 3, `slots ${await slots(page)}`);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(1500);
check('ArrowLeft on the right grip shrinks by one slot', (await slots(page)) === 2);
await page.context().close();

page = await open('reduce');
const r2 = await rect(page, 'right');
await page.mouse.move(r2.x + r2.w / 2, r2.y + r2.h / 2);
await page.mouse.down();
await page.mouse.move(r2.x + r2.w / 2 + 420, r2.y + r2.h / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
check('under Reduce Motion the release snaps at once', Math.abs((await boxWidth(page)) - (2 * phone + 24)) < 1, `${await boxWidth(page)}`);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
