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
await page.waitForSelector('[data-body="notes"]');
await page.waitForTimeout(1200);
const order = () => page.evaluate(() => [...document.querySelectorAll('[data-body]')].map((n) => n.dataset.body));
const said = () => page.evaluate(() => document.querySelector('[data-workspace-announcer]').textContent);
const scrollLeft = () => page.evaluate(() => document.querySelector('[data-row-scroller]').scrollLeft);

const names = await page.evaluate(() => ({
  region: [document.querySelector('[data-row-scroller]').getAttribute('role'), document.querySelector('[data-row-scroller]').getAttribute('aria-label')],
  groups: [...document.querySelectorAll('[data-row-slot]')].map((n) => n.getAttribute('aria-label')),
}));
check('the row is a region named Panels', names.region.join('|') === 'region|Panels', names.region.join('|'));
check('each panel is a group with its place', names.groups.join(' / ') === 'History, 1 of 4 / Notes, 2 of 4 / Todo, 3 of 4 / Mail, 4 of 4', names.groups.join(' / '));

const handle = await page.evaluate(() => { const b = document.querySelector('[data-body="notes"]').closest('[data-row-slot]').querySelector('[data-panel-grab-bar]'); return { role: b.getAttribute('role'), label: b.getAttribute('aria-label'), tab: b.tabIndex }; });
check('the grab strip is a focusable button named for its panel', handle.role === 'button' && handle.tab === 0 && handle.label === 'Move or close Notes', JSON.stringify(handle));

await page.evaluate(() => document.querySelector('[data-body="notes"]').closest('[data-row-slot]').querySelector('[data-panel-grab-bar]').focus());
const before = await scrollLeft();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(800);
check('ArrowRight on the strip moves Notes one slot right', (await order()).join() === 'todo,notes,mail', (await order()).join());
check('and the live region says so', (await said()) === 'Moved Notes right', await said());
check('and the row did not also step', Math.abs((await scrollLeft()) - before) < 1, `${before} -> ${await scrollLeft()}`);
await page.evaluate(() => document.querySelector('[data-body="notes"]').closest('[data-row-slot]').querySelector('[data-panel-grab-bar]').focus());
await page.keyboard.press('Delete');
await page.waitForTimeout(1200);
check('Delete on the strip closes Notes', (await order()).join() === 'todo,mail', (await order()).join());
check('and the live region says so', (await said()) === 'Closed Notes', await said());

const box = await page.evaluate(() => { const r = document.querySelector('[data-body="todo"]').closest('[data-row-slot]').querySelector('[data-panel-grab-bar]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x + 30, box.y, { steps: 4 });
const live = await page.evaluate(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent);
check('a pointer drag says the title', live === 'Picked up Todo', live);
await page.mouse.up();
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
