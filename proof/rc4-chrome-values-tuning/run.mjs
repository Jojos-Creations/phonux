// node run.mjs <bundle.js> [chromium|webkit|firefox]
// Prints the chrome's pixel geometry, measured in the browser, for one default panel.
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
const mode = process.env.MODE ?? 'header';
await pg.goto(`http://localhost:${srv.address().port}/?mode=${mode}`);
await pg.waitForSelector('[data-content]');
await pg.waitForTimeout(800);
const m = await pg.evaluate(() => {
  const r = (el) => (el ?? document.body).getBoundingClientRect();
  const q = (sel) => document.querySelector(sel);
  const frame = r(q('[data-phone-frame]') ?? q('[data-content]'));
  const foot = q('[data-foot]');
  const footPad = foot ? { x: Math.round(r(foot).left - r(foot.parentElement).left), y: Math.round(r(foot).top - r(foot.parentElement).top) } : null;
  const textNode = [...document.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && /Sessions/.test(n.textContent ?? ''))).pop();
  let pill = textNode ?? null;
  while (pill && getComputedStyle(pill).position !== 'absolute') pill = pill.parentElement;
  const grab = q('[data-panel-grab-bar]');
  const grabPill = grab?.firstElementChild;
  return {
    contentLeftInFrame: Math.round(r(q('[data-content]')).left - frame.left),
    footPad,
    headerTextLeftInFrame: textNode ? Math.round(r(textNode).left - frame.left) : null,
    headerGapAboveFrame: pill ? Math.round(frame.top - r(pill).bottom) : null,
    headerPillHeight: pill ? Math.round(r(pill).height) : null,
    grabBarHeight: grab ? Math.round(r(grab).height) : null,
    grabPill: grabPill ? { w: Math.round(r(grabPill).width), h: Math.round(r(grabPill).height) } : null,
  };
});
console.log(JSON.stringify({ engine, mode, ...m, errors }));
await browser.close();
srv.close();
