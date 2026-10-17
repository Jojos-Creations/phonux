// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Light and dark system schemes, with the auto-mount's own theme. The header carries no pill (no fill, shadow or radius), its title and
// buttons read against what is behind them (WCAG AA contrast, 4.5), its buttons have no fill, and the scrollbar thumb follows the text colour.
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
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
for (const scheme of ['light', 'dark']) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${srv.address().port}/`);
  await page.waitForSelector('[data-body="alpha"]');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const title = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Title alpha');
    let header = title;
    while (header && getComputedStyle(header).position !== 'absolute') header = header.parentElement;
    const hs = getComputedStyle(header);
    let behind = null;
    for (let e = header.parentElement; e && !behind; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) behind = c; }
    behind = behind ?? { r: 255, g: 255, b: 255, a: 1 };
    const fg = parse(getComputedStyle(title).color);
    const mix = { r: fg.r * fg.a + behind.r * (1 - fg.a), g: fg.g * fg.a + behind.g * (1 - fg.a), b: fg.b * fg.a + behind.b * (1 - fg.a) };
    const [hi, lo] = [lum(mix), lum(behind)].sort((a, b) => b - a);
    const buttons = [...header.querySelectorAll('button, [role=button]')].map((b) => getComputedStyle(b).backgroundColor);
    const thumbs = [];
    for (const sheet of document.styleSheets) for (const rule of sheet.cssRules ?? []) if (rule.selectorText?.includes('scrollbar-thumb')) thumbs.push(`${rule.selectorText.split(',').pop().slice(-28)} ${rule.style.background || rule.style.backgroundColor}`);
    return { bg: hs.backgroundColor, shadow: hs.boxShadow, radius: hs.borderRadius, border: hs.borderTopWidth, color: getComputedStyle(title).color, behind: `rgb(${behind.r},${behind.g},${behind.b})`, contrast: (hi + 0.05) / (lo + 0.05), buttons, thumbs };
  });
  console.log(`-- ${scheme}: title ${r.color} on ${r.behind}`);
  check(`${scheme}: the header has no fill`, r.bg === 'rgba(0, 0, 0, 0)', r.bg);
  check(`${scheme}: the header has no edge ring or shadow`, r.shadow === 'none' && r.border === '0px', `${r.shadow} ${r.border}`);
  check(`${scheme}: the header has no radius`, r.radius === '0px', r.radius);
  check(`${scheme}: the title reads against what is behind it (contrast >= 4.5)`, r.contrast >= 4.5, r.contrast.toFixed(2));
  check(`${scheme}: header buttons have no fill`, r.buttons.length > 0 && r.buttons.every((c) => c === 'rgba(0, 0, 0, 0)'), `${r.buttons.length} buttons ${[...new Set(r.buttons)].join(' ')}`);
  if (engine !== 'firefox') check(`${scheme}: the scrollbar thumb follows the text colour`, r.thumbs.length > 0 && (scheme === 'light' ? r.thumbs.every((t) => !t.includes('255, 255, 255')) : r.thumbs.every((t) => t.includes('255, 255, 255'))), r.thumbs.join(' ; '));
  check(`${scheme}: no page errors`, errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/header-${scheme}-${engine}.png` : undefined }).catch(() => {});
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
await browser.close();
srv.close();
process.exit(failed === 0 ? 0 : 1);
