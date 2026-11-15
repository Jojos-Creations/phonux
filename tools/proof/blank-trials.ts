/**
 * The blank-panel gate: repeated trials of a far glide on a real row, each in a fresh page on a magenta background, so a panel
 * the page says is there but does not paint shows as magenta. Two measures, since one frame in a screenshot can miss a flash:
 *
 *   shot  a screenshot at a random delay (40 to 250 ms) after the glide starts; a trial is blank when every sampled pixel is magenta.
 *   cast  every frame the compositor presents during a glide out and back, measured against the settled row's ink.
 *
 *   node --import tsx tools/proof/blank-trials.ts <shot|cast> <glide|lefthold|clipnone|hidden> <trials> <panels> [--prod]
 *
 * `clipnone` strips every clip-path (the floor of the ink a moving row shows); `hidden` hides the strip, a row known to be blank,
 * which must fail: run it first, since a gate that passes it proves nothing. Exits 1 on a blank trial, a presented frame under
 * 40 percent of the settled ink, or a run that measured nothing. --prod builds the entry with the production bundle.
 *
 * What a pass does not show: frames above the floor are not full ink. Quiet runs have measured a worst frame near 0.98 of the settled
 * ink, but under load and in the production bundle frames well under that appear (5 of 10 trials under load, 1 of 14 quiet, in
 * production), and with wide panels one frame fell near 0.76. They are tiles the compositor had not rasterised yet, and the
 * `clipnone` control dips the same way, so they are not the clip. A pass shows no blank panel and no frame under 0.4, nothing more.
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../test/support/chromium.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const [MODE, COND, TRIALS = '10', PANELS = '35'] = process.argv.slice(2);
const PROD = process.argv.includes('--prod');
if ((MODE !== 'shot' && MODE !== 'cast') || COND === undefined) {
  console.error('usage: blank-trials.ts <shot|cast> <glide|lefthold|clipnone|hidden> <trials> <panels> [--prod]');
  process.exit(2);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const browser: any = await launchChromium({ skip() {} } as never, 'blank-trials');
const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'blank-trials-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/row-render-entry.tsx.txt'), 'utf8'));
await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': PROD ? '"production"' : '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
const html = '<!doctype html><html><body style="margin:0;background:#ff00ff"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const server = createServer((req, res) => {
  const js = req.url?.startsWith('/out.js') === true;
  res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  res.end(js ? readFileSync(join(dir, 'out.js')) : html);
}).listen(0);
const port = (server.address() as { port: number }).port;

const decoder = await (await browser.newContext({ viewport: { width: 200, height: 200 } })).newPage();
await decoder.goto('about:blank');
/** The share of sampled pixels that are not page magenta. */
const inkOf = (png: Buffer | string): Promise<number> =>
  decoder.evaluate(async (b64: string) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const x = c.getContext('2d')!;
    x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, bm.height).data;
    let non = 0;
    let n = 0;
    for (let yy = 4; yy < bm.height; yy += 10)
      for (let xx = 4; xx < bm.width; xx += 10) {
        const i = (yy * bm.width + xx) * 4;
        n += 1;
        if (!(d[i]! > 240 && d[i + 1]! < 15 && d[i + 2]! > 240)) non += 1;
      }
    return non / n;
  }, typeof png === 'string' ? png : png.toString('base64'));

let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const holds = COND === 'lefthold' ? '&holds=root:left' : '';
const last = Number(PANELS) - 1;
const rows: { blankTrial: boolean; frames: number; belowFloor: number; worst: number }[] = [];
for (let t = 0; t < Number(TRIALS); t += 1) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?slots=${Array.from({ length: Number(PANELS) }, () => 1).join(',')}&filler=240${holds}`);
  await page.waitForFunction(() => (window as any).__r?.ready());
  await sleep(700);
  const rest = await inkOf(await page.screenshot());
  if (rest < 0.3) throw new Error(`the settled row has ink ${rest}: the row did not render, nothing is proven`);
  if (COND === 'clipnone') await page.addStyleTag({ content: '[data-row-window],[data-row-strip],[data-row-slot]{clip-path:none !important}' });
  if (COND === 'hidden') await page.addStyleTag({ content: '[data-row-strip]{visibility:hidden !important}' });
  if (MODE === 'shot') {
    await page.evaluate((k: number) => (window as any).__r.scrollTo(k, 'into-view'), last);
    await sleep(Math.round(40 + rnd() * 210));
    const ink = await inkOf(await page.screenshot());
    rows.push({ blankTrial: ink === 0, frames: 1, belowFloor: ink / rest < 0.4 ? 1 : 0, worst: ink / rest });
  } else {
    const cdp = await ctx.newCDPSession(page);
    const frames: string[] = [];
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
      frames.push(f.data);
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.evaluate((k: number) => (window as any).__r.scrollTo(k, 'into-view'), last);
    await sleep(1400);
    await page.evaluate(() => (window as any).__r.scrollTo(0, 'into-view'));
    await sleep(1400);
    await cdp.send('Page.stopScreencast');
    const ratios: number[] = [];
    for (const f of frames) ratios.push((await inkOf(f)) / rest);
    rows.push({ blankTrial: ratios.some((r) => r === 0), frames: frames.length, belowFloor: ratios.filter((r) => r < 0.4).length, worst: Math.min(...ratios) });
  }
  await ctx.close();
}
await browser.close();
server.close();
const frames = rows.reduce((a, r) => a + r.frames, 0);
const blank = rows.filter((r) => r.blankTrial).length;
const below = rows.reduce((a, r) => a + r.belowFloor, 0);
console.log(JSON.stringify({ mode: MODE, cond: COND, bundle: PROD ? 'production' : 'development', panels: Number(PANELS), trials: rows.length, presentedFramesMeasured: frames, trialsWithAFullyBlankSample: blank, framesUnder40PercentInk: below, worstInkVsSettled: +Math.min(...rows.map((r) => r.worst)).toFixed(2) }));
if (rows.length === 0 || frames === 0) {
  console.error('nothing was measured');
  process.exit(1);
}
process.exit(blank > 0 || below > 0 ? 1 : 0);
