// node app-keys.mjs <url> [chromium|webkit|firefox]   The real phonux-app (npm run dev:web) against the library under test.
// Eight panels at cap 8, the last grown to three slots, then its right grabber focused and ArrowLeft pressed twice, in Show, Hide and Off.
// After each press every panel that was in view before must still be in view.
// Playwright from /opt/node-tools on the cloud; on the Mac pass PLAYWRIGHT_MODULE=<path to playwright/index.mjs>.
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs');
const [url = 'http://127.0.0.1:5173/', engine = 'chromium'] = process.argv.slice(2);
const browser = await pw[engine].launch(engine === 'chromium' && !process.env.PLAYWRIGHT_MODULE ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] } : {});
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
const SNAP = () => {
  let sc = document.querySelector('[data-row-slot]');
  while (sc && !['scroll', 'auto'].includes(getComputedStyle(sc).overflowX)) sc = sc.parentElement;
  const c = sc.getBoundingClientRect();
  return { scroll: Math.round(sc.scrollLeft), slots: [...document.querySelectorAll('[data-row-slot]')].map((s) => {
    const r = s.getBoundingClientRect();
    return { id: s.dataset.rowId, left: Math.round(r.left - c.left), width: Math.round(r.width), faded: /opacity\(0\)/.test(s.style.filter), inView: r.left >= c.left - 1 && r.right <= c.right + 1 && !/opacity\(0\)/.test(s.style.filter) };
  }) };
};
for (const mode of ['visible', 'hidden', 'off']) {
  const ctx = await browser.newContext({ viewport: { width: 2240, height: 1000 } });
  await ctx.addInitScript(([m]) => { try { localStorage.setItem('phonux.panelCap.value', '8'); localStorage.setItem('phonux.shrinkOutOfView.mode', m); } catch {} }, [mode]);
  const page = await ctx.newPage();
  await page.route('**/picsum.photos/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.goto(url); await page.waitForTimeout(3500);
  const prompt = page.locator('[data-phone-detect-prompt] button[aria-label]'); if (await prompt.count()) await prompt.click();
  for (let i = 0; i < 8; i++) { await page.locator('button.MuiFab-root').first().click(); await page.waitForTimeout(600); }
  const last = (await page.locator('[data-panel-grabber="right"]').count()) - 1;
  for (let k = 0; k < 2; k++) { await page.evaluate((n) => document.querySelectorAll('[data-panel-grabber="right"]')[n]?.click(), last); await page.waitForTimeout(900); }
  await page.evaluate((n) => document.querySelectorAll('[data-panel-grabber="right"]')[n].focus(), last);
  let prev = await page.evaluate(SNAP);
  for (const round of [1, 2]) {
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(1500);
    const now = await page.evaluate(SNAP);
    const lost = prev.slots.filter((p) => p.inView && !now.slots.find((n) => n.id === p.id)?.inView).map((p) => p.id);
    console.log(`${mode} press ${round}: scroll ${prev.scroll} -> ${now.scroll}, in view ${now.slots.filter((s) => s.inView).map((s) => `${s.id}+${s.width}`).join(' ')}`);
    check(`${mode} ArrowLeft ${round}: no panel that was in view leaves it (lost: ${lost.join(',') || 'none'})`, lost.length === 0);
    prev = now;
  }
  await ctx.close();
}
console.log(`${passed} passed, ${failed} failed`);
await browser.close();
