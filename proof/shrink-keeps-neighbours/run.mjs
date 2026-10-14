// node run.mjs <bundle.js> [chromium|webkit|firefox]
// A row of History, two phone panels and a wide panel on the last stop. The wide panel's right grabber is dragged one slot
// narrower, twice. Every panel that fits the window after each release must stay in view, whole, and not faded.
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
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const read = (pg) => pg.evaluate(() => {
  const c = document.querySelector('[data-row-scroller]');
  const box = c.getBoundingClientRect();
  return { scrollLeft: c.scrollLeft, window: c.clientWidth, atStop: window.__g.provided().rowNumbers.atStop, stops: window.__g.stops(),
    slots: [...c.querySelectorAll('[data-row-slot]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.rowId, left: Math.round(r.left - box.left), width: Math.round(r.width), filter: el.style.filter || '' }; }) };
});
const line = (r) => `scroll ${r.scrollLeft} atStop ${r.atStop} :: ${r.slots.map((s) => `${s.id}@${s.left}+${s.width}${s.filter ? ' ' + s.filter : ''}`).join(' ')}`;

for (const mode of ['visible', 'hidden', 'off']) {
  for (const width of [2240]) {
    const context = await browser.newContext({ viewport: { width: 2240, height: 800 } });
    const pg = await context.newPage();
    pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await pg.goto(`${base}?mode=${mode}&slots=${process.env.SLOTS ?? "1,1,3"}&phone=412&gap=24&control=${process.env.CONTROL ?? "none"}`);
    await pg.waitForSelector('[data-box="p1"]'); await pg.evaluate(() => { const l = [...document.querySelectorAll('[data-box]')].at(-1); l.setAttribute('data-box', 'pW'); const gs = l.querySelectorAll('[data-grab]'); gs.forEach((g) => g.setAttribute('data-grab', g.getAttribute('data-grab').replace(/^[^:]+/, 'pW'))); });
    await pg.waitForTimeout(1500);
    for (let k = 0; k < 4; k++) { const r = await read(pg); if (r.atStop >= r.stops.length - 1) break; await pg.mouse.move(600, 300); await pg.mouse.wheel(50, 0); await pg.waitForTimeout(900); }
    console.log(`-- ${mode} ${width}`);
    let prev = await read(pg);
    console.log('start ' + line(prev));
    const shown = (r) => new Set(r.slots.filter((s) => !s.filter.includes('opacity(0)') && s.left >= -1 && s.left + s.width <= r.window + 1).map((s) => s.id));
    for (const round of [1, 2]) {
      const g = await pg.locator('[data-grab="pW:right"]').boundingBox();
      const x0 = g.x + 3, y0 = g.y + g.height / 2;
      await pg.mouse.move(x0, y0); await pg.mouse.down();
      for (let i = 1; i <= 12; i++) { await pg.mouse.move(x0 - (436 * i) / 12, y0); await pg.waitForTimeout(16); }
      await pg.mouse.up();
      await pg.waitForTimeout(1500);
      const r = await read(pg);
      console.log(`shrink ${round} ${line(r)}`);
      const before = shown(prev), after = shown(r);
      const lost = [...before].filter((id) => !after.has(id));
      check(`${mode} ${width} shrink ${round}: no panel that was in view leaves it (lost: ${lost.join(',') || 'none'})`, lost.length === 0, line(r));
      prev = r;
    }
    await context.close();
  }
}
console.log(`${passed} passed, ${failed} failed`);
await browser.close(); srv.close();
