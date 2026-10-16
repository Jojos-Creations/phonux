// node run.mjs <bundle.js> [chromium] [outdir]
// Wheels 300 px vertically over the row and over the inner panel, then reports which element scrolled and where the row sits.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium', outdir = '.'] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForSelector('[data-row-scroller]');
await page.waitForTimeout(600);
const state = () => page.evaluate(() => {
  const row = document.querySelector('[data-row-scroller]');
  const scrolled = [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => (e.getAttribute('data-row-scroller') !== null ? 'row' : e.getAttribute('data-inner') !== null ? 'inner' : e.tagName.toLowerCase()));
  const phone = row.querySelector('[data-row-slot]');
  return { rowScrollTop: row.scrollTop, rowRectTop: Math.round(row.getBoundingClientRect().top), phoneTop: phone ? Math.round(phone.getBoundingClientRect().top) : null, scrolled };
});
const wheelAt = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
};
const before = await state();
await wheelAt('[data-row-scroller]');
const overRow = await state();
await page.evaluate(() => { document.querySelector('[data-row-scroller]').scrollTop = 0; });
await page.waitForTimeout(100);
await wheelAt('[data-inner]');
const overInner = await state();
await page.evaluate(() => { document.querySelector('[data-row-scroller]').scrollTop = 0; });
await page.waitForTimeout(100);
await wheelAt('[data-plain]');
const overPlain = await state();
console.log(JSON.stringify({ before, overRow, overInner, overPlain, errors }));
await page.screenshot({ path: `${outdir}/${engine}-after-inner-wheel.png` });
await browser.close();
srv.close();
