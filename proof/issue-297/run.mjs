// node run.mjs <bundle.js> [chromium|webkit|firefox]   Prints, per layout and mode, what the window shows after each step of a trackpad-style swipe.
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
const PROFILE = [2, 4, 9, 18, 32, 50, 70, 88, 100, 104, 100, 92, 82, 72, 62, 52, 44, 36, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 1];
const errors = [];
const results = [];
for (const layout of ['left', 'left2', 'right']) {
  for (const mode of ['hidden', 'visible']) {
    const page = await (await browser.newContext({ viewport: { width: 2046, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${srv.address().port}/?layout=${layout}&mode=${mode}`);
    await page.waitForSelector('[data-body="next"]');
    await page.waitForTimeout(1500);
    const shown = () => page.evaluate(() => {
      const win = innerWidth;
      return [...document.querySelectorAll('[data-body]')].map((b) => {
        const r = b.closest('[data-row-slot]').querySelector('[data-panel-size-box]').getBoundingClientRect();
        const vis = Math.max(0, Math.min(r.right, win) - Math.max(r.left, 0));
        return vis > 1 ? `${b.getAttribute('data-body')}:${Math.round(vis)}px` : null;
      }).filter(Boolean).join(' ');
    });
    const swipe = async (sign) => { await page.mouse.move(600, 300); for (const v of PROFILE) { await page.mouse.wheel(sign * v, 0); await page.waitForTimeout(16); } await page.waitForTimeout(900); };
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-body]')].map((b) => b.getAttribute('data-body')).join(' > '));
    const frames = [];
    for (let i = 0; i < 6; i++) await swipe(-1); // back to the first stop
    frames.push(`start: ${await shown()}`);
    for (let i = 1; i <= 5; i++) { await swipe(1); frames.push(`step ${i}: ${await shown()}`); }
    results.push({ layout, mode, order, frames });
    console.log(`\n[${engine}] layout=${layout} mode=${mode}   row order: ${order}`);
    for (const f of frames) console.log(`  ${f}`);
    await page.context().close();
  }
}
console.log(errors.length ? `\nconsole errors: ${errors.join(' | ')}` : '\nno console errors');
await browser.close(); srv.close();
