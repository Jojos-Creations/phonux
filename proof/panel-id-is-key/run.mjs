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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForFunction(() => window.__ws?.status === 'ready');
const handles = await page.evaluate(() => [1, 2, 3].map(() => window.__ws.addPanel('web').id));
await page.waitForTimeout(500);
check('three keyed panels were made', handles.length === 3 && handles.every((id) => id.startsWith('web~')), handles.join(', '));

const pairs = await page.$$eval('[data-panel-id]', (n) => n.map((e) => [e.dataset.panelId, e.dataset.handleId]));
check('every view got panel.id equal to handle.id', pairs.length >= 3 && pairs.every(([a, b]) => a === b), JSON.stringify(pairs));

const listed = await page.evaluate(() => window.__panels.panelList.map((p) => p.id));
check('panelList lists the keys', handles.every((id) => listed.includes(id)), listed.join(', '));

await page.evaluate((id) => window.__setActive(id), handles[1]);
await page.waitForTimeout(100);
const active = await page.$$eval('[data-active]', (n) => [...new Set(n.map((e) => e.dataset.active))]);
check('useActivePanel reports the key it was given', active.length === 1 && active[0] === handles[1], active.join(', '));
const marked = await page.$$eval('[data-is-active="true"]', (n) => n.map((e) => e.dataset.handleId));
check('and that panel is the one marked active', marked.length === 1 && marked[0] === handles[1], marked.join(', '));

await page.evaluate((id) => window.__panels.setSlots(id, 2), handles[0]);
await page.waitForTimeout(500);
const width = await page.evaluate((id) => parseFloat(document.querySelector(`[data-panel-id="${id}"]`).closest('[data-row-slot]').style.width), handles[0]);
check('setSlots(key, 2) widened that panel', width > 390 * 1.5, `${width}px`);
await page.evaluate((id) => window.__panels.close(id), handles[2]);
await page.waitForTimeout(500);
const closed = await page.evaluate((id) => window.__ws.panels.get(id)?.getState().status, handles[2]);
check('close(key) closed that panel', closed === 'closed', String(closed));
check('no console errors or warnings', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
