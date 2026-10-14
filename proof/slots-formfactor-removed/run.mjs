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
const base = `http://localhost:${srv.address().port}/`;
const browser = await pw[engine].launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const open = async (seed) => {
  await page.goto(seed === undefined ? base : `${base}?seed=${encodeURIComponent(JSON.stringify(seed))}`);
  await page.waitForFunction(() => window.__ws?.status === 'ready');
  await page.waitForTimeout(400);
};
const width = (id) => page.evaluate((k) => Math.round(document.querySelector(`[data-box="${k}"]`)?.getBoundingClientRect().width ?? -1), id);
const entry = (id, extra) => ({ id, view: 'web', url: '', live: true, anchor: { panel: 'root', position: 'right', priority: Number(id.slice(1)) }, ...extra });

const gap = 16;
const phone = 390;
// A template view sits inside the library's frame, which takes a fixed margin off the slot's width.
const inner = async (slots) => slots * phone + (slots - 1) * gap - (phone - (await width('root')));
// 1. A file saved before slots: a plain entry with only a top-level formFactor.
await open({ version: 1, panels: [entry('a1', { formFactor: 'tablet' }), entry('a2', { formFactor: 'phone' })] });
const plain = await page.evaluate(() => [...document.querySelectorAll('[data-box]')].map((e) => [e.dataset.box, Math.round(e.getBoundingClientRect().width)]));
check('a top-level formFactor tablet is drawn two slots wide, phone one slot', plain.some(([, w]) => w === 2 * phone + gap) && plain.filter(([, w]) => w === phone).length === 1, JSON.stringify(plain));

// 2. A template panel whose file holds only overrides.formFactor.
await open({ version: 1, panels: [{ id: 'b1', view: 'wide', key: 'wide~1', url: '', live: true, anchor: { panel: 'root', position: 'right', priority: 0 }, instance: {}, overrides: { formFactor: 'tablet' }, applied: { placeOnAdd: 'row-end' } }] });
const old = await page.evaluate(() => { const p = window.__ws.panels.list().find((s) => s.templateId === 'wide'); return p && [p.id, window.__ws.panels.get(p.id).getSettings().value.slots]; });
check('overrides.formFactor tablet reads as 2 slots', old?.[1] === 2, JSON.stringify(old));
check('the panel is drawn two slots wide', old && (await width(old[0])) === (await inner(2)), old && String(await width(old[0])));

// 3. maxSlots caps an old desktop override.
await open({ version: 1, panels: [{ id: 'c1', view: 'wide', key: 'wide~1', url: '', live: true, anchor: { panel: 'root', position: 'right', priority: 0 }, instance: {}, overrides: { formFactor: 'desktop' }, applied: { placeOnAdd: 'row-end' } }] });
const capped = await page.evaluate(() => { const p = window.__ws.panels.list().find((s) => s.templateId === 'wide'); return window.__ws.panels.get(p.id).getSettings().value.slots; });
check('overrides.formFactor desktop is held to maxSlots 3', capped === 3, String(capped));

// 4. A view sets its own slots through configure, and no formFactor is accepted or written.
await open();
const res = await page.evaluate(() => {
  const h = window.__ws.addPanel('tablet');
  return { id: h.id };
});
await page.waitForTimeout(300);
const configured = await page.evaluate(async (id) => {
  const own = window.__handles.get(id);
  const ok = own.configure({ slots: 2 });
  let thrown = null;
  try { own.configure({ formFactor: 'tablet' }); } catch (e) { thrown = e.code; }
  await new Promise((r) => setTimeout(r, 300));
  return { ok: ok.ok, later: ok.later, thrown, slots: window.__ws.panels.get(id).getSettings().value.slots, source: window.__ws.panels.get(id).getSettings().source.slots };
}, res.id);
check('a view configures its own slots', configured.ok === true && configured.slots === 2 && configured.source === 'instance', JSON.stringify(configured));
check('a formFactor key is invalid-settings', configured.thrown === 'invalid-settings', String(configured.thrown));

// 5. setSlots resizes the panel, and the saved file holds slots, never formFactor.
await page.evaluate((id) => window.__ws.panels.get(id).setSlots(3), res.id);
await page.waitForTimeout(800);
const saved = await page.evaluate(() => window.__saved());
check('three slots wide', (await width(res.id)) === (await inner(3)), String(await width(res.id)));
check('the saved file holds slots 3 and no formFactor', saved.includes('"slots":3') && !saved.includes('formFactor'), saved.slice(0, 300));
check('no console errors or warnings', errors.length === 0, errors.join(' | '));
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
