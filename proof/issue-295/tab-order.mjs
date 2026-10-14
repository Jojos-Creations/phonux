// node tab-order.mjs <bundle.js> [chromium|webkit|firefox]
// DRAG_STEPS=60 drags the panel to the drawn-first place, where the first Tab into the row must land on it.
// After a left drag, Tab must visit the panels in the order they are drawn on screen (WCAG 2.4.3 Focus Order).
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
const page = await (await browser.newContext({ viewport: { width: 2200, height: 900 } })).newPage();
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-frame="five"]');
await page.waitForTimeout(1200);
const grab = page.locator('[data-frame="four"]').locator('xpath=ancestor::*[@data-row-slot][1]').locator('[data-panel-grab-bar]');
const box = await grab.boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height / 2;
await page.mouse.move(x, y);
await page.mouse.down();
const steps = Number(process.env.DRAG_STEPS ?? 24);
for (let i = 1; i <= steps; i += 1) { await page.mouse.move(x - i * 36, y); await page.waitForTimeout(16); }
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(1500);
const screenOrder = await page.evaluate(() => [...document.querySelectorAll('[data-row-slot]')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((s) => s.dataset.rowId));
await page.evaluate(() => { document.body.focus(); document.activeElement?.blur(); });
await page.focus('#before');
const visited = [];
for (let i = 0; i < 40; i += 1) {
  await page.keyboard.press('Tab');
  const id = await page.evaluate(() => document.activeElement?.closest?.('[data-row-slot]')?.dataset.rowId ?? null);
  if (id !== null && visited[visited.length - 1] !== id) visited.push(id);
}
const unique = [...new Set(visited)];
const tabbable = await page.evaluate(() => [...document.querySelectorAll('[data-row-slot]')].filter((s) => [...s.querySelectorAll('a[href],button,input,select,textarea,iframe,[tabindex]')].some((e) => e.tabIndex >= 0)).map((s) => s.dataset.rowId));
const expected = screenOrder.filter((id) => tabbable.includes(id));
console.log('on screen :', screenOrder.join(','));
console.log('Tab visits:', unique.join(','));
const ok = unique.join() === expected.join();
console.log(ok ? 'PASS Tab order follows the on-screen order' : 'FAIL Tab order differs from the on-screen order');
await browser.close();
srv.close();
process.exit(ok ? 0 : 1);
