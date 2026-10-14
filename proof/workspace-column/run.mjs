// node run.mjs <bundle.js> [chromium|webkit|firefox] [outdir]
// Playwright from /opt/node22 on the cloud; on the Mac pass PLAYWRIGHT_MODULE=<path to playwright/index.mjs>.
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
const base = `http://localhost:${srv.address().port}/`;
const browser = await pw[engine].launch();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

// The column needs inset + 830 px: 24 + 24 for the button and input, the 56 px header hang, the 700 px phone, a 2 px gap and the 24 px bottom button. A shorter window (832 with inset 32) is reported, not failed.
// inset 32 is the app's drag strip: the controls must start below it.
for (const [height, inset] of [[832, 0], [832, 32], [900, 32], [1080, 0], [1080, 32]]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  await page.goto(`${base}?inset=${inset}`);
  await page.waitForSelector('[data-workspace-cell] [data-row-slot]');
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), width: Math.round(r.width) }; };
    const cells = [...document.querySelectorAll('[data-workspace-cell]')];
    const active = cells.find((c) => c.hasAttribute('data-workspace-active'));
    const slots = [...active.querySelectorAll('[data-row-slot]')].map(rect);
    const slotTop0 = Math.min(...slots.map((s) => s.top));
    const headerTop = Math.min(...[...active.querySelectorAll('[data-row-slot] *')].map((e) => e.getBoundingClientRect()).filter((r) => r.top < slotTop0 && r.height >= 20 && r.height <= 40 && r.width > 100).map((r) => Math.round(r.top)));
    return {
      cells: cells.length,
      active: cells.indexOf(active),
      above: active.querySelector('[data-workspace-neighbour="above"]').textContent,
      below: active.querySelector('[data-workspace-neighbour="below"]').textContent,
      aboveRect: rect(active.querySelector('[data-workspace-neighbour="above"]')),
      belowRect: rect(active.querySelector('[data-workspace-neighbour="below"]')),
      input: active.querySelector('[data-workspace-name-input]').value,
      inputRect: rect(active.querySelector('[data-workspace-name-input]')),
      headerTop,
      slotTop: Math.min(...slots.map((s) => s.top)),
      slotBottom: Math.max(...slots.map((s) => s.bottom)),
      inert: cells.map((c) => c.hasAttribute('inert')),
      activeRect: rect(active),
    };
  });
  const first = await read();
  console.log(`@1280x${height}`, JSON.stringify(first));
  await page.screenshot({ path: `${outdir}/${engine}-${height}-${inset}-first.png` });
  const fits = height >= inset + 830;
  if (!fits) console.log(`NOTE ${height}/${inset}: shorter than the ${inset + 830} px the column needs; the input ends at ${first.inputRect.bottom} and the headers start at ${first.headerTop}, the phone ends at ${first.slotBottom} and the bottom button starts at ${first.belowRect.top}`);
  check(`${height}/${inset}: three cells, first current, the others inert`, first.cells === 3 && first.active === 0 && first.inert.join() === 'false,true,true');
  check(`${height}/${inset}: top button creates, bottom names the next workspace`, first.above === 'Create new workspace' && first.below === 'Workspace 2');
  check(`${height}/${inset}: the input holds Workspace 1 and sits above the phone headers`, first.input === 'Workspace 1' && (!fits || first.inputRect.bottom <= first.headerTop), `input bottom ${first.inputRect.bottom} header top ${first.headerTop}`);
  const tall = (r) => r.bottom - r.top;
  check(`${height}/${inset}: both buttons and the input are exactly 24 px high`, tall(first.aboveRect) === 24 && tall(first.belowRect) === 24 && tall(first.inputRect) === 24, `${tall(first.aboveRect)} ${tall(first.inputRect)} ${tall(first.belowRect)}`);
  check(`${height}/${inset}: the top button starts at or below the inset (clear of the drag strip)`, first.aboveRect.top >= inset, `${first.aboveRect.top}`);
  check(`${height}/${inset}: the top button is above the input`, first.aboveRect.bottom <= first.inputRect.top);
  check(`${height}/${inset}: the phone keeps its height (700)`, first.slotBottom - first.slotTop === 700, `${first.slotBottom - first.slotTop}`);
  check(`${height}/${inset}: the bottom button clears the phone`, !fits || first.belowRect.top >= first.slotBottom, `button top ${first.belowRect.top} phone bottom ${first.slotBottom}`);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(900);
  const second = await read();
  check(`${height}/${inset}: ArrowDown brings in the second workspace`, second.active === 1 && second.input === 'Workspace 2' && second.above === 'Workspace 1' && second.below === 'Workspace 3');
  check(`${height}/${inset}: the second cell fills the window`, second.activeRect.top === 0 && second.activeRect.bottom === height, JSON.stringify(second.activeRect));
  await page.screenshot({ path: `${outdir}/${engine}-${height}-${inset}-second.png` });

  await page.fill('[data-workspace-cell][data-workspace-active] [data-workspace-name-input]', 'Reading');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  check(`${height}/${inset}: ArrowDown in the name input types, it does not move`, (await read()).active === 1);
  await page.keyboard.press('Enter');
  await page.click('[data-workspace-cell][data-workspace-active] [data-workspace-neighbour="above"]');
  await page.waitForTimeout(900);
  const back = await read();
  check(`${height}/${inset}: the button names the renamed workspace and moves there`, back.active === 0 && back.below === 'Reading');
  await page.click('[data-workspace-cell][data-workspace-active] [data-workspace-neighbour="above"]');
  await page.waitForTimeout(900);
  const created = await read();
  check(`${height}/${inset}: Create new workspace at the top makes a fourth and scrolls to it`, created.cells === 4 && created.active === 0 && created.input === 'Workspace 4', JSON.stringify([created.cells, created.active, created.input]));
  await page.screenshot({ path: `${outdir}/${engine}-${height}-${inset}-created.png` });
  check(`${height}/${inset}: no page error or console warning`, errors.length === 0, errors.join(' | '));
}
await browser.close();
srv.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
