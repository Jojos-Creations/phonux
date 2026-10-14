// Drives the phonux-app web build (npx vite, port 5173; URL=... overrides) with a ramp-peak-fade wheel stream; run from any directory.
import { chromium } from '/opt/node-tools/node_modules/playwright-core/index.mjs';
const [width = '1800', mode = 'visible', n = '4', grow = '4:2'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext(process.env.REDUCE ? { reducedMotion: 'reduce' } : {});
await ctx.addInitScript(([m, process_cap]) => { try { localStorage.setItem('phonux.shrinkOutOfView.mode', m); localStorage.setItem('phonux.panelCap.value', process_cap); } catch {} }, [mode, process.env.CAP ?? '8']);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.setViewportSize({ width: Number(width), height: 900 });
await page.route('**/picsum.photos/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
await page.goto(''+(process.env.URL??'http://127.0.0.1:5173/')+''); await page.waitForTimeout(3500);
const pr = page.locator('[data-phone-detect-prompt] button[aria-label]'); if (await pr.count()) await pr.click();
for (let i = 0; i < Number(n); i++) { await page.locator('button.MuiFab-root').first().click(); await page.waitForTimeout(450); }
for (const g of grow.split(',')) { const [i, t] = g.split(':').map(Number); for (let k = 0; k < t; k++) { await page.evaluate((x) => document.querySelectorAll('[data-panel-grabber]')[x]?.click(), i); await page.waitForTimeout(600); } }
await page.waitForTimeout(800);
if (process.env.RELOAD) { await page.waitForTimeout(2500); await page.reload(); await page.waitForTimeout(3500); }
const SNAP = () => { let sc = document.querySelector('[data-row-slot]'); while (sc && !['scroll', 'auto'].includes(getComputedStyle(sc).overflowX)) sc = sc.parentElement; const c = sc.getBoundingClientRect();
  return { scroll: Math.round(sc.scrollLeft), slots: [...document.querySelectorAll('[data-row-slot]')].map((s) => { const r = s.getBoundingClientRect(); return [Math.round(r.left - c.left), Math.round(r.width)].join('+') + (r.left >= c.left - 1 && r.right <= c.right + 1 ? '' : '!'); }).join(' ') }; };
await page.mouse.move(Number(width) / 2, 450);
console.log('start', JSON.stringify(await page.evaluate(SNAP)));
if (process.env.SWIPE) { const prof=[2,4,9,18,32,50,70,88,100,104,100,92,82,72,62,52,44,36,30,24,19,15,12,9,7,5,4,3,2,1]; for (const dir of (process.env.SWIPE).split(',').map(Number)) { for (const v of prof) { await page.mouse.wheel(dir*v,0); await page.waitForTimeout(16);} await page.waitForTimeout(900); console.log('swipe',dir, JSON.stringify(await page.evaluate(SNAP))); } }
for (const d of (process.env.SWIPE ? '' : process.env.DIRS ?? '300,300,300,300,300,300,300,-300,-300,-300,-300,-300,-300,-300').split(',').map(Number)) { await page.mouse.wheel(d, 0); await page.waitForTimeout(1000); console.log(d, JSON.stringify(await page.evaluate(SNAP))); }
await browser.close();
