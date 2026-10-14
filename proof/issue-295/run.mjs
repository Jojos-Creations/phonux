// node run.mjs <bundle.js> [chromium|webkit|firefox]
// A real drag of the fourth panel two places left, then the drop. Nothing may move in the DOM, no iframe may reload, and no panel the drag crosses may leave the span between its start and end positions.
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-frame="five"]');
await page.waitForTimeout(1200);

// Watch from the page: every slot node's DOM index, its left edge each animation frame, and the nodes React adds or removes.
await page.evaluate(() => {
  const slots = () => [...document.querySelectorAll('[data-row-slot]')];
  const w = (window).__watch = { moves: 0, frames: [], ids: slots().map((s) => s.dataset.rowId), nodes: slots(), run: true };
  new MutationObserver((list) => { for (const m of list) w.moves += m.addedNodes.length + m.removedNodes.length; }).observe(slots()[0].parentElement, { childList: true });
  const tick = () => {
    w.frames.push(Object.fromEntries(slots().map((s) => [s.dataset.rowId, Math.round(s.getBoundingClientRect().left)])));
    if (w.run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const order = () => page.evaluate(() => [...document.querySelectorAll('[data-body],[data-frame]')].map((n) => n.dataset.body ?? n.dataset.frame).filter((b) => b !== 'root'));
const startOrder = (await order()).join();
const slotOrder = () => page.evaluate(() => (window).__ws.panels.list().map((h) => h.id).join());
const startSlotOrder = await slotOrder();
const grab = page.locator('[data-frame="four"]').locator('xpath=ancestor::*[@data-row-slot][1]').locator('[data-panel-grab-bar]');
const box = await grab.boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height / 2;
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 24; i += 1) { await page.mouse.move(x - i * 36, y); await page.waitForTimeout(16); }
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const w = (window).__watch; w.run = false;
  const now = [...document.querySelectorAll('[data-row-slot]')];
  return { moves: w.moves, same: w.nodes.every((n, i) => n === now.find((m) => m.dataset.rowId === w.ids[i])), frames: w.frames, loads: (window).__loads };
});
const slotAfter = await slotOrder();
check('the drop reordered the row', slotAfter !== startSlotOrder, `${startSlotOrder} -> ${slotAfter}`);
check('no slot node was added or removed in the DOM', r.moves === 0, String(r.moves));
check('every slot is the same element after the drop', r.same === true);
check('the DOM order of the panels never changed', (await order()).join() === startOrder, `${startOrder} -> ${(await order()).join()}`);
check('no hosted iframe reloaded', Object.values(r.loads).every((n) => n === 1), JSON.stringify(r.loads));
// Excursion: a panel that is not the dragged one may only travel between its start and end position (plus a few pixels).
const ids = Object.keys(r.frames[0]);
const dragged = 'four';
let worst = 0, who = '';
for (const id of ids) {
  if (id === dragged) continue;
  const xs = r.frames.map((f) => f[id]).filter((v) => v !== undefined);
  const lo = Math.min(xs[0], xs[xs.length - 1]), hi = Math.max(xs[0], xs[xs.length - 1]);
  const out = Math.max(lo - Math.min(...xs), Math.max(...xs) - hi);
  if (out > worst) { worst = out; who = id; }
}
check('no crossed panel leaves the span between its start and end position', worst <= 6, `${who} ${worst}px`);
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
