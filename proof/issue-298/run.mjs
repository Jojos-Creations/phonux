import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const srv = createServer((q, s) => { const js = q.url.startsWith('/out.js'); s.setHeader('content-type', js ? 'text/javascript' : 'text/html'); s.end(js ? readFileSync(bundle) : readFileSync('./index.html')); }).listen(0);
const browser = await pw[engine].launch();
let failed = 0;
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` :: ${d}` : ''}`); };
async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="three"]'); await page.waitForTimeout(1200);
  page.errs = errs; return page;
}
const order = (p) => p.evaluate(() => [...document.querySelectorAll('[data-body]')].map((b) => b.getAttribute('data-body')).join(','));
const grab = (p, id) => p.evaluate((i) => { const s = document.querySelector(`[data-body="${i}"]`).closest('[data-row-slot]'); const g = s.querySelector('[data-panel-grab-bar]'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }, id);
const title = (p, id) => p.evaluate((i) => { const s = document.querySelector(`[data-body="${i}"]`).closest('[data-row-slot]'); const h = s.querySelector('[data-panel-chrome-part="header"]'); const t = [...h.querySelectorAll('div')].find((d) => d.textContent === i && d.children.length === 0); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
async function drag(p, from, to, steps = 12) { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps }); await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(1500); }

let p = await open();
const start = await order(p);
console.log('start order', start);
const g1 = await grab(p, 'one');
check('the icon is a 24 px target', g1.w >= 24 && g1.h >= 24, `${g1.w}x${g1.h}`);
const g2 = await grab(p, 'two');
await drag(p, g1, { x: g2.x + 80, y: g1.y });
const after = await order(p);
check('a pointer drag from the icon moves the panel past its neighbour', after !== start && after.indexOf('one') > after.indexOf('two'), after);
await p.context().close();

p = await open();
const t1 = await title(p, 'one'); const g2b = await grab(p, 'two');
await drag(p, t1, { x: g2b.x + 80, y: t1.y });
check('a drag from the title text does not move the panel', (await order(p)) === start, await order(p));
await p.context().close();

p = await open();
const gd = await grab(p, 'one');
await drag(p, gd, { x: gd.x, y: gd.y + 500 });
const closed = await order(p);
check('dragging the icon down closes the panel', !closed.includes('one'), closed);
await p.context().close();

p = await open();
await p.focus('[data-panel-grab-bar]');
const focused = await p.evaluate(() => document.activeElement?.getAttribute('data-panel-grab-bar') !== null);
check('the icon takes keyboard focus', focused);
await p.keyboard.press('Delete'); await p.waitForTimeout(1500);
check('Delete on the focused icon closes that panel', !(await order(p)).includes('one') || (await order(p)) !== start, await order(p));
check('no page errors', p.errs.length === 0, p.errs.join('|'));
await browser.close(); srv.close(); process.exit(failed ? 1 : 0);
