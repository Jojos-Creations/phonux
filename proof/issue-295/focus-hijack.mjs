// node focus-hijack.mjs out.js: script focus() of one control from outside the row (as an app or a screen reader does) must land on that control.
// No reorder is done; on main it prints got == want.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const dir=new URL('./', import.meta.url).pathname;
const srv = createServer((q,s)=>{const js=q.url.startsWith('/out.js');s.setHeader('content-type',js?'text/javascript':'text/html');s.end(js?readFileSync(process.argv[2]):readFileSync(dir+'index.html'));}).listen(0);
const b = await pw.chromium.launch(); const page = await (await b.newContext({viewport:{width:2200,height:900}})).newPage();
await page.goto(`http://localhost:${srv.address().port}/`); await page.waitForSelector('[data-frame="five"]'); await page.waitForTimeout(1200);
await page.focus('#before');
const r = await page.evaluate(() => { const t=[...document.querySelectorAll('[data-row-slot]')].filter(s=>s.querySelector('[data-panel-grab-bar]')).map(s=>s.querySelector('[data-panel-grab-bar]'))[3]; const want=t.closest('[data-row-slot]').dataset.rowId; t.focus(); return {want, got: document.activeElement.closest('[data-row-slot]')?.dataset.rowId}; });
console.log(JSON.stringify(r)); await b.close(); srv.close();
