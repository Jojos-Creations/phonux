// node run.mjs <bundle.js> [chromium|webkit|firefox]   The footer against the frame, the header and the row's bottom, at three window heights.
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
const browser = await pw[engine].launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
for (const [W, H] of [[1000, 700], [1280, 900], [1100, 800]]) {
  const pg = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(base);
  await pg.waitForSelector('[data-footer-button]');
  await pg.waitForTimeout(1500);
  const r = await pg.evaluate(() => {
    const footer = document.querySelector('[data-panel-footer]');
    const frame = footer.previousElementSibling;
    const header = [...document.querySelectorAll('[data-panel-chrome-part="header"]')][0] ?? null;
    const scroller = document.querySelector('[data-row-scroller]');
    const f = footer.getBoundingClientRect(), fr = frame.getBoundingClientRect(), c = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
    return { footTop: f.top, footBottom: f.bottom, footH: f.height, frameBottom: fr.bottom, scrollerBottom: c.bottom, headerH: header?.getBoundingClientRect().height ?? null, hitFooter: footer.contains(hit) };
  });
  const tag = `${W}x${H}`;
  const offset = r.footTop - r.frameBottom, reserve = r.scrollerBottom - r.frameBottom;
  console.log(`${tag}: footer offset ${offset}, footer height ${r.footH}, header height ${r.headerH}, frame-to-row-bottom ${reserve}`);
  check(`${tag}: the footer sits 4px below the frame`, Math.abs(offset - 4) < 0.5, `${offset}`);
  check(`${tag}: the footer ends inside the row`, r.footBottom <= r.scrollerBottom + 0.5, `${r.footBottom} vs ${r.scrollerBottom}`);
  check(`${tag}: the row reserves the footer's offset plus its height under the frame`, reserve >= offset + r.footH - 0.5, `${reserve} vs ${offset + r.footH}`);
  check(`${tag}: a click at the footer's centre hits the footer`, r.hitFooter);
  check(`${tag}: no page errors`, errors.length === 0, errors.join('; '));
  await pg.close();
}
await browser.close();
srv.close();
console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
