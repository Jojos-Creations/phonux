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
const base = `http://localhost:${srv.address().port}/`;
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const open = async (seed) => {
  await page.goto(seed === undefined ? base : `${base}?seed=${encodeURIComponent(JSON.stringify(seed))}`);
  await page.waitForFunction(() => window.__ws?.status === 'ready');
  await page.waitForTimeout(400);
};

await open();
const id = await page.evaluate(() => window.__ws.addPanel('note').id);
await page.waitForTimeout(300);
const locked = await page.evaluate(async (k) => {
  const tick = () => new Promise((r) => setTimeout(r, 200));
  const h = window.__handles.get(k);
  const lock = h.configure({ closable: false });
  await tick();
  const closeRefused = h.close();
  await tick();
  const s = window.__ws.panels.get(k).getSettings();
  const up = h.configure({ closable: true });
  return { lock: lock.ok, close: closeRefused.code, value: s.value.closable, source: s.source.closable, up: [up.ok, up.code] };
}, id);
check('a view locks its own panel', locked.lock === true && locked.value === false && locked.source === 'instance', JSON.stringify(locked));
check('a locked panel refuses close with not-closable', locked.close === 'not-closable', String(locked.close));
check('a view cannot ask closable true', locked.up[0] === false && locked.up[1] === 'not-view-settable', JSON.stringify(locked.up));
await page.waitForTimeout(800);
const saved = await page.evaluate(() => window.__saved());
check('the lock is saved as closable false', saved.includes('"closable":false'), saved.slice(0, 300));

await open(JSON.parse(saved));
const after = await page.evaluate((k) => { const p = window.__ws.panels.get(k); return p && p.getSettings().value.closable; }, id);
check('the lock survives a reload from the saved file', after === false, String(after));

const unlocked = await page.evaluate(async (k) => { const h = window.__handles.get(k); const ok = h.configure({ closable: null }).ok; await new Promise((r) => setTimeout(r, 200)); return [ok, window.__ws.panels.get(k).getSettings().value.closable]; }, id);
check('null unlocks it again', unlocked[0] === true && unlocked[1] === true, JSON.stringify(unlocked));
const closed = await page.evaluate((k) => window.__handles.get(k).close().ok, id);
check('an unlocked panel closes', closed === true, String(closed));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); srv.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
