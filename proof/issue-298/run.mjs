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
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-body="one"]');
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const slot = document.querySelector('[data-body="one"]').closest('[data-row-slot]');
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const header = slot.querySelector('[data-panel-chrome-part="header"]');
  const grabs = slot.querySelectorAll('[data-panel-grab-bar]');
  const title = [...header.querySelectorAll('div')].find((d) => d.textContent === 'one' && d.children.length === 0);
  return { grabs: grabs.length, grab: box(grabs[0]), header: box(header), title: box(title), inHeader: header.contains(grabs[0]), role: grabs[0].getAttribute('role'), tab: grabs[0].tabIndex, label: grabs[0].getAttribute('aria-label') };
});
check('one grab handle', r.grabs === 1, String(r.grabs));
check('the handle is inside the header', r.inHeader);
check('the icon is left of the title', r.grab.r <= r.title.x + 0.5, `grab right ${r.grab.r.toFixed(1)}, title left ${r.title.x.toFixed(1)}`);
check('the icon is within the header\'s height', r.grab.y >= r.header.y - 0.5 && r.grab.b <= r.header.b + 0.5, `grab ${r.grab.y.toFixed(1)}..${r.grab.b.toFixed(1)}, header ${r.header.y.toFixed(1)}..${r.header.b.toFixed(1)}`);
check('no bar sits below the header', r.grab.y < r.header.b - 1, `grab top ${r.grab.y.toFixed(1)}, header bottom ${r.header.b.toFixed(1)}`);
check('still a focusable button named for the panel', r.role === 'button' && r.tab === 0 && r.label === 'Move or close one', JSON.stringify({ role: r.role, tab: r.tab, label: r.label }));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
