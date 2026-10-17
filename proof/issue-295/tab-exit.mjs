// node tab-exit.mjs <bundle.js> [chromium|webkit|firefox]
// The panel next to History is dragged to the far right, so the panel drawn last is the first in the DOM. Tab from a button before the row
// must walk the panels in drawn order and then leave to the button after the row; Shift+Tab from that button must walk them back.
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
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'after';
  b.textContent = 'after the row';
  document.body.appendChild(b);
});
const grab = page.locator('[data-frame="one"]').locator('xpath=ancestor::*[@data-row-slot][1]').locator('[data-panel-grab-bar]');
const box = await grab.boundingBox();
const x = box.x + box.width / 2, y = box.y + box.height / 2;
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 60; i += 1) { await page.mouse.move(x + i * 36, y); await page.waitForTimeout(16); }
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(1500);
const drawn = await page.evaluate(() => [...document.querySelectorAll('[data-row-slot]')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((s) => s.dataset.rowId));
const where = () => page.evaluate(() => { const a = document.activeElement; return a?.id || a?.closest?.('[data-row-slot]')?.dataset.rowId || null; });
const walk = async (from, key) => {
  await page.focus(from);
  const seen = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press(key);
    const id = await where();
    if (id !== null && seen[seen.length - 1] !== id) seen.push(id);
  }
  return seen.join(',');
};
const panels = drawn.filter((id) => id !== 'root');
const forward = (await walk('#before', 'Tab')).split(',').slice(0, panels.length + 1).join(',');
const backward = (await walk('#after', 'Shift+Tab')).split(',').slice(0, panels.length + 1).join(',');
console.log('drawn           :', panels.join(','));
console.log('Tab from before :', forward);
console.log('Shift+Tab after :', backward);
const okForward = forward === [...panels, 'after'].join();
const okBackward = backward === [...panels].reverse().concat('before').join();
console.log(okForward && okBackward ? 'PASS Tab and Shift+Tab walk the drawn order and leave the row' : 'FAIL Tab or Shift+Tab does not follow the drawn order or does not leave the row');
await browser.close();
srv.close();
process.exit(okForward && okBackward ? 0 : 1);
