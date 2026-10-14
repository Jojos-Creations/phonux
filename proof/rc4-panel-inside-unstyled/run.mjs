// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Prints where the view's content sits relative to the frame's outer box, in px.
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
const pg = await browser.newPage({ viewport: { width: 844, height: 900 } });
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(`http://localhost:${srv.address().port}/`);
await pg.waitForSelector('[data-content]');
await pg.waitForTimeout(800);
const m = await pg.evaluate(() => {
  const frame = document.querySelector('[data-phone-frame]').getBoundingClientRect();
  const c = document.querySelector('[data-content]').getBoundingClientRect();
  return { left: Math.round(c.left - frame.left), top: Math.round(c.top - frame.top) };
});
console.log(JSON.stringify({ engine, ...m, errors }));
await browser.close();
srv.close();
