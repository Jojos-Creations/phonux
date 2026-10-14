// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Five anonymous panels, the first three closed, then a reload (the id counter restarts) and three more panels.
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const ready = async () => { await page.goto(base); await page.waitForFunction(() => window.__ws?.status === 'ready'); };
const keys = () => page.evaluate(() => window.__ws.panels.getSnapshot().panels.filter((p) => p.status !== 'closed').map((p) => p.id).filter((id) => id.startsWith('web')));

await ready();
const made = await page.evaluate(() => {
  window.__handles = [1, 2, 3, 4, 5].map(() => window.__ws.addPanel('web'));
  return window.__handles.map((h) => h.id);
});
await page.waitForTimeout(300);
for (let k = 0; k < 3; k += 1) {
  await page.evaluate((n) => window.__handles[n].close(), k);
  await page.waitForTimeout(100);
}
await page.waitForTimeout(300);
const saved = await keys();
check('five made, three closed, two left', made.length === 5 && saved.length === 2, saved.join(', '));

await ready();
const restored = await keys();
check('the reload restored the same two keys', JSON.stringify(restored) === JSON.stringify(saved), restored.join(', '));
const added = await page.evaluate(() => [1, 2, 3, 4, 5, 6].map(() => window.__ws.addPanel('web').id));
await page.waitForTimeout(300);
const all = await keys();
check('no new panel took a restored key', added.every((k) => !restored.includes(k)), `new ${added.join(', ')}`);
check('every key is unique and all eight panels are present', new Set(all).size === 8 && all.length === 8, all.join(', '));
check('no console errors or warnings', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
