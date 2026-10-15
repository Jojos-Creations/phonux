// node run.mjs <bundle.js> [chromium|webkit|firefox]
// A stepping row (History plus six one-slot panels, phone 412, gap 24, a 1500 px window, so the window edge cuts a neighbour at most stops)
// built with tuning.shrinkOutOfView absent, 'off', 'visible' and 'hidden'. Off is the only edge mode:
//   - every mode lays the row out exactly as 'off' does, stop by stop (slot left and width), and no slot is faded;
//   - at least one stop leaves a neighbour cut off by the window edge at its full phone width;
//   - 'visible' and 'hidden' log one console.error each (the other modes none), and the page keeps rendering.
// The bundle is built with NODE_ENV development; a stub `process` makes the library's development-only warning reachable.
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
const PHONE = 412;

const walk = async (mode) => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 800 } });
  await context.addInitScript(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  const pg = await context.newPage();
  const errors = [];
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  pg.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  await pg.goto(`${base}?slots=1,1,1,1,1,1&phone=${PHONE}&gap=24${mode === null ? '' : `&mode=${mode}`}`);
  await pg.waitForSelector('[data-box="p6"]');
  await pg.waitForTimeout(1200);
  const stops = await pg.evaluate(() => window.__g.stops());
  const rows = [];
  for (const [k, stop] of stops.entries()) {
    await pg.evaluate((left) => { document.querySelector('[data-row-scroller]').scrollTo({ left, behavior: 'instant' }); }, stop);
    await pg.waitForTimeout(500);
    rows.push(await pg.evaluate(() => {
      const c = document.querySelector('[data-row-scroller]');
      const box = c.getBoundingClientRect();
      return { scrollLeft: Math.round(c.scrollLeft), window: c.clientWidth,
        slots: [...c.querySelectorAll('[data-row-slot]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.rowId, left: Math.round(r.left - box.left), width: Math.round(r.width), filter: el.style.filter || '', inert: el.hasAttribute('inert') }; }) };
    }));
  }
  await context.close();
  return { stops, rows, errors };
};

const line = (r) => `scroll ${r.scrollLeft}/${r.window} :: ${r.slots.map((s) => `${s.id}@${s.left}+${s.width}${s.filter ? ` ${s.filter}` : ''}${s.inert ? ' inert' : ''}`).join(' ')}`;
const results = {};
for (const mode of ['off', null, 'visible', 'hidden']) {
  const name = mode ?? 'absent';
  results[name] = await walk(mode);
  console.log(`-- ${name}: ${results[name].stops.length} stops`);
  for (const r of results[name].rows) console.log(`   ${line(r)}`);
}
const geometry = (w) => JSON.stringify(w.rows.map((r) => ({ scrollLeft: r.scrollLeft, slots: r.slots.map((s) => [s.id, s.left, s.width, s.inert]) })));
for (const name of ['absent', 'visible', 'hidden']) {
  check(`${name}: same stops as off`, JSON.stringify(results[name].stops) === JSON.stringify(results.off.stops), `${results[name].stops.join(',')} vs ${results.off.stops.join(',')}`);
  check(`${name}: every slot at the same left and width as off, at every stop`, geometry(results[name]) === geometry(results.off));
}
for (const name of ['off', 'absent', 'visible', 'hidden']) {
  const faded = results[name].rows.flatMap((r) => r.slots.filter((s) => s.filter !== ''));
  check(`${name}: no slot is faded`, faded.length === 0, faded.map((s) => `${s.id} ${s.filter}`).join(' '));
}
const cut = results.off.rows.flatMap((r) => r.slots.filter((s) => (s.left < 0 || s.left + s.width > r.window) && s.left + s.width > 0 && s.left < r.window));
check('off: the window edge cuts a neighbour at some stop, at its full phone width', cut.length > 0 && cut.every((s) => s.width === PHONE), cut.map((s) => `${s.id}@${s.left}+${s.width}`).join(' '));
const warns = (n) => results[n].errors.filter((e) => e.includes('shrinkOutOfView'));
check('off logs no warning', warns('off').length === 0 && results.off.errors.length === 0, results.off.errors.join(' | '));
check('absent logs no warning', warns('absent').length === 0 && results.absent.errors.length === 0, results.absent.errors.join(' | '));
for (const name of ['visible', 'hidden']) {
  check(`${name} logs exactly one removed-value warning and nothing else`, warns(name).length === 1 && warns(name)[0].includes(`'${name}'`) && warns(name)[0].includes('removed') && results[name].errors.length === 1, results[name].errors.join(' | '));
}
console.log(`${passed} passed, ${failed} failed`);
await browser.close(); srv.close();
process.exitCode = failed === 0 ? 0 : 1;
