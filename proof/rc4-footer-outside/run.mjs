// node run.mjs <bundle.js> [chromium|webkit|firefox]   Pass/fail checks on the footer below the frame at three widths.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs');
const [bundle, engine = 'chromium'] = process.argv.slice(2);
const srv = createServer((q, s) => {
  const js = q.url.startsWith('/out.js');
  s.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  s.end(js ? readFileSync(bundle) : readFileSync(new URL('./index.html', import.meta.url)));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;
const browser = await pw[engine].launch();
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };
for (const W of [390, 600, 800]) {
  const pg = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(`${base}/?w=${W}`);
  await pg.waitForSelector('[data-footer]');
  const r = await pg.evaluate(() => {
    const frame = document.querySelector('[data-phone-frame]');
    const footer = document.querySelector('[data-panel-footer]');
    const f = frame.getBoundingClientRect(), ft = footer.getBoundingClientRect();
    return { frameH: f.height, frameB: f.bottom, footTop: ft.top, footH: ft.height, footPos: getComputedStyle(footer).position, footInFrame: frame.contains(footer), frameOverflow: getComputedStyle(frame).overflow };
  });
  await pg.goto(`${base}/?w=${W}&footer=0`);
  await pg.waitForSelector('[data-phone-frame]');
  const noFooterH = await pg.$eval('[data-phone-frame]', (el) => el.getBoundingClientRect().height);
  check(`W=${W}: the frame keeps its phone height with a footer`, Math.abs(r.frameH - 700) < 1, `${r.frameH} vs 700`);
  check(`W=${W}: the frame height is the same with and without a footer`, Math.abs(r.frameH - noFooterH) < 1, `${r.frameH} vs ${noFooterH}`);
  check(`W=${W}: the footer floats below the frame edge`, r.footTop >= r.frameB - 1 && r.footTop - r.frameB < 40, `top ${r.footTop.toFixed(1)} frame bottom ${r.frameB.toFixed(1)}`);
  check(`W=${W}: the footer is absolutely positioned and outside the frame's clip`, r.footPos === 'absolute' && !r.footInFrame, `position ${r.footPos}, in frame ${r.footInFrame}`);
  check(`W=${W}: the footer is drawn in full below the frame`, r.footH > 0, `height ${r.footH.toFixed(1)}`);
  check(`W=${W}: no page errors`, errors.length === 0, errors.join('; '));
  await pg.close();
}
await browser.close();
srv.close();
console.log(`SUMMARY passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
