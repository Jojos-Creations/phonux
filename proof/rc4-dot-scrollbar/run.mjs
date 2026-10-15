// node run.mjs <bundle.js> [chromium|webkit|firefox]   Pass/fail checks on the dot bar at three window widths.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;
const browser = await pw[engine].launch();
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const STRIP = 6 * 390 + 5 * 16;
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
for (const W of [390, 600, 800]) {
  const pg = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${base}/?w=${W}`);
  await pg.waitForSelector('[data-oval]');
  const expectOval = W * 1000 / STRIP;
  const oval = await pg.$eval('[data-oval]', (el) => el.getBoundingClientRect().width);
  check(`W=${W}: oval width is the window in track px`, near(oval, expectOval, 2), `${oval.toFixed(1)} vs ${expectOval.toFixed(1)}`);
  const dotCount = await pg.$$eval('[data-dot]', (els) => els.length);
  check(`W=${W}: one dot per panel`, dotCount === 6, `${dotCount}`);
  const dotA = await pg.$eval('[data-dot="a"]', (el) => el.getBoundingClientRect().width);
  check(`W=${W}: a 390 panel is a ${(390 * 1000 / STRIP).toFixed(0)} px dot`, near(dotA, 390 * 1000 / STRIP, 2), `${dotA.toFixed(1)}`);
  // Click the dot of panel c: it should centre in the window.
  await pg.click('[data-dot="c"]');
  await pg.waitForTimeout(1200);
  const max = STRIP - W;
  const want = Math.min(Math.max(812 + 195 - W / 2, 0), max);
  const got = await pg.$eval('[data-row-scroller]', (el) => el.scrollLeft);
  check(`W=${W}: click on dot c centres panel c`, near(got, want, 3), `scrollLeft ${got.toFixed(1)} vs ${want.toFixed(1)}`);
  // Drag the oval 60 px to the right: the row moves by 60 * strip / track, clamped.
  const before = await pg.$eval('[data-row-scroller]', (el) => el.scrollLeft);
  const box = await pg.$eval('[data-oval]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pg.mouse.move(box.x, box.y);
  await pg.mouse.down();
  await pg.mouse.move(box.x - 60, box.y, { steps: 4 });
  await pg.mouse.up();
  const after = await pg.$eval('[data-row-scroller]', (el) => el.scrollLeft);
  const wantDrag = Math.min(Math.max(before - 60 * STRIP / 1000, 0), max);
  check(`W=${W}: dragging the oval 60 px left moves the row`, near(after, wantDrag, 3), `${before.toFixed(1)} to ${after.toFixed(1)}, want ${wantDrag.toFixed(1)}`);
  check(`W=${W}: no page errors`, errors.length === 0, errors.join('; ').slice(0, 200));
  await pg.close();
}
console.log(`SUMMARY passed=${passed} failed=${failed}`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
