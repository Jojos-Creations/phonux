// node run.mjs <bundle.js> [chromium|webkit|firefox]
// The default mount's header text against its pill, in a light and a dark window.
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
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
for (const scheme of ['light', 'dark']) {
  const page = await (await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('text=Panel title');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const h = [...document.querySelectorAll('div')].filter((d) => d.textContent === 'Panel title').at(-1).parentElement;
    const s = getComputedStyle(h);
    return { color: s.color, background: s.backgroundColor, position: s.position, cls: h.className };
  });
  check(`${scheme}: the header text differs from the pill`, r.color !== r.background, `${r.color} on ${r.background} (${r.position} ${r.cls})`);
  if (scheme === 'light') check('light: the header text is dark', /^rgba?\(0, 0, 0/.test(r.color), r.color);
  else check('dark: the header text is white', /^rgb\(255, 255, 255\)$/.test(r.color), r.color);
  check(`${scheme}: no page errors`, errors.length === 0, errors.join(' | '));
}
await browser.close();
srv.close();
process.exit(failed ? 1 : 0);
