/**
 * The Embla row (`Workspace rowEngine="embla"`) measured in headless Chromium, on the real Workspace and PanelRow:
 *
 *   node --import tsx tools/proof/embla-row-proof.ts [--engine embla|own] [--out <dir>] [--only wheel,feed,drag,keys,resize]
 *
 * wheel  a trackpad-style stream (page.mouse.wheel, one event per ~16 ms, 2.5 s) at three speeds over narrow, wide and mixed rows:
 *        row px per input px while input flows, frames that stood still while it moved, the rest on the slot grid.
 * feed   the same stream handed in through feedRowWheel (a webview's script), plus its return values (sideways true, vertical
 *        false, Option false) and that an Option gesture moves nothing.
 * drag   a mouse drag on the row's own surface (the gap between two panels): the row follows the pointer 1:1, then rests on the grid;
 *        a drag that starts on a panel moves nothing.
 * keys   ArrowRight three times, ArrowLeft once: three slots, then two.
 * resize the window 1800 > 1400 > 2300 > 1800 > 1000 at rest: the panel at the window's left edge stays there, no one-slot panel is
 *        cut in any frame, and each rest is on the grid.
 *
 * Every check is in the JSON it prints, with `failed` listing what broke. Exits 1 when a check failed and 2 when a run recorded no
 * frames or no motion, so a run that proved nothing never reads as a pass. Screenshots go to --out; look at them.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../test/support/chromium.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const arg = (name: string): string | undefined => {
  const k = process.argv.indexOf(`--${name}`);
  return k < 0 ? undefined : process.argv[k + 1];
};
const ENGINE = arg('engine') === 'own' ? 'own' : 'embla';
const OUT = arg('out') ?? join(tmpdir(), 'embla-row-proof');
const ONLY = new Set((arg('only') ?? 'wheel,feed,drag,keys,resize').split(','));
mkdirSync(OUT, { recursive: true });

// biome-ignore lint/suspicious/noExplicitAny: the slice of Playwright's Page this script uses, typed loosely as the other proofs do
type Page = any;
const launched = await launchChromium<Page>({ skip: () => {} }, 'embla-row-proof');
if (launched === undefined) process.exit(2);
const browser = launched;
const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'embla-row-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/embla-row-entry.tsx.txt'), 'utf8'));
await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const server = createServer((req, res) => {
  const js = req.url?.startsWith('/out.js') === true;
  res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  res.end(js ? readFileSync(join(dir, 'out.js')) : html);
}).listen(0);
const port = (server.address() as { port: number }).port;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ROWS: Record<string, string> = { narrow: Array(24).fill(1).join(','), wide: '3,2,3,2,3,2,3,2,3,2', mixed: '1,3,1,2,1,3,1,2,1,3,1,2' };
const failed: string[] = [];
const empty: string[] = [];
const out: Record<string, unknown> = { engine: ENGINE, failed, empty };

async function open(slots: string, width = 1800, height = 900): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?engine=${ENGINE}&slots=${slots}`);
  await page.waitForFunction(() => (window as any).__g?.ready(), undefined, { timeout: 15000 });
  await sleep(600);
  return { page, errors, close: () => ctx.close() };
}
const g = (page: Page, fn: string, ...args: unknown[]): Promise<any> => page.evaluate(([f, a]: [string, unknown[]]) => (window as any).__g[f](...a), [fn, args]);
const onGrid = (p: number, pitch: number, max: number): boolean => Math.abs(p - max) <= 0.5 || Math.abs(p / pitch - Math.round(p / pitch)) * pitch <= 0.5;
// A one-slot panel drawn partly inside the window breaks the row's first rule; a wider one may be cut at an edge.
function cutNarrow(f: any, phone: number): string[] {
  const cut: string[] = [];
  for (const [id, { x, w }] of Object.entries(f.panels as Record<string, { x: number; w: number }>)) {
    if (w > phone + 1) continue;
    const inside = x > -w + 1 && x < f.winW - 1;
    const whole = x >= -1 && x + w <= f.winW + 1;
    if (inside && !whole) cut.push(id);
  }
  return cut;
}
// Still frames while the row moves: frames with no motion between the first and the last frame that moved.
function stillWhileMoving(fr: any[]): { moving: number; still: number; maxFramePx: number } {
  const moves = fr.slice(1).map((f, k) => Math.abs(f.pos - fr[k].pos));
  const a = moves.findIndex((m) => m > 0.01);
  if (a < 0) return { moving: 0, still: 0, maxFramePx: 0 };
  const b = moves.length - 1 - [...moves].reverse().findIndex((m) => m > 0.01);
  const span = moves.slice(a, b + 1);
  return { moving: span.length, still: span.filter((m) => m <= 0.01).length, maxFramePx: +Math.max(...span).toFixed(1) };
}

async function stream(name: string, slots: string, D: number, send: (page: Page) => Promise<number>): Promise<Record<string, unknown>> {
  const { page, errors, close } = await open(slots);
  await page.mouse.move(900, 400);
  const { pitch, phone } = await page.evaluate(() => ({ pitch: (window as any).__g.PITCH, phone: (window as any).__g.PHONE }));
  const start = await g(page, 'pos');
  await g(page, 'record');
  const input = await send(page);
  const atInputEnd = await g(page, 'pos');
  const during = await g(page, 'stop');
  await g(page, 'record');
  await sleep(1500);
  const after = await g(page, 'stop');
  const max = await g(page, 'max');
  const rest = after.length > 0 ? after[after.length - 1].pos : Number.NaN;
  const s = stillWhileMoving(during);
  const restCut = after.length > 0 ? cutNarrow(after[after.length - 1], phone) : [];
  const row = { input, moved: +(atInputEnd - start).toFixed(1), pxPerInputPx: +((atInputEnd - start) / input).toFixed(3), framesDuringInput: during.length, framesMoving: s.moving, stillFramesWhileMoving: s.still, maxFramePx: s.maxFramePx, rest: +rest.toFixed(1), restOnGrid: onGrid(rest, pitch, max), hitEnd: atInputEnd >= max - 1, narrowCutAtRest: restCut, errors: errors.length };
  if (during.length === 0 || s.moving === 0) empty.push(`${name}: no motion`);
  if (!row.restOnGrid) failed.push(`${name}: rest ${row.rest} off the grid`);
  if (restCut.length > 0) failed.push(`${name}: narrow panel cut at rest ${restCut}`);
  if (s.still > 0) failed.push(`${name}: ${s.still} still frames while moving`);
  if (row.hitEnd) failed.push(`${name}: ran into the row's end, which caps the distance and proves nothing`);
  if (errors.length > 0) failed.push(`${name}: page errors ${errors.join(' | ')}`);
  if (name.endsWith('mixed') && D === 12) await page.screenshot({ path: join(OUT, `${ENGINE}-${name}-rest.png`) });
  await close();
  return row;
}
// Same speed over narrow, wide and mixed: each about 1:1 and within 2% of the others.
function speedCheck(label: string, rows: Record<string, any>): void {
  const v = Object.values(rows).map((r) => r.pxPerInputPx as number);
  const spread = (Math.max(...v) - Math.min(...v)) / Math.max(...v);
  (rows as any).spread = +spread.toFixed(4);
  if (spread > 0.02) failed.push(`${label}: narrow/wide/mixed spread ${(spread * 100).toFixed(1)}% > 2%`);
  for (const [k, x] of Object.entries(v)) if (Math.abs(x - 1) > 0.05) failed.push(`${label}: ${Object.keys(rows)[Number(k)]} moves ${x} px per input px, not about 1`);
}

if (ONLY.has('wheel')) {
  const wheel: Record<string, unknown> = {};
  for (const D of [6, 12, 24]) {
    const rows: Record<string, unknown> = {};
    for (const [name, slots] of Object.entries(ROWS))
      rows[name] = await stream(`wheel D${D} ${name}`, slots, D, async (page) => {
        let input = 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 2500) {
          await page.mouse.wheel(D, 0);
          input += D;
          await sleep(16);
        }
        return input;
      });
    speedCheck(`wheel D${D}`, rows);
    wheel[`D${D}`] = rows;
  }
  out.wheel = wheel;
}

if (ONLY.has('feed')) {
  const rows: Record<string, unknown> = {};
  for (const [name, slots] of Object.entries(ROWS)) rows[name] = await stream(`feed D12 ${name}`, slots, 12, (page) => g(page, 'feedStream', 12, 2500));
  speedCheck('feed D12', rows);
  const { page, close } = await open(ROWS.mixed);
  const sideways = await g(page, 'feed', { deltaX: 40 });
  await sleep(1200);
  const vertical = await g(page, 'feed', { deltaX: 0, deltaY: 40 });
  await sleep(1200);
  const before = await g(page, 'pos');
  const option = await g(page, 'feed', { deltaX: 40, altKey: true });
  for (let k = 0; k < 10; k += 1) await g(page, 'feed', { deltaX: 40, altKey: k === 0 });
  await sleep(1200);
  const optionMoved = Math.abs((await g(page, 'pos')) - before);
  out.feed = { rows, returns: { sideways, vertical, option }, optionGestureMovedPx: +optionMoved.toFixed(1) };
  if (sideways !== true || vertical !== false || option !== false) failed.push(`feed: returns sideways ${sideways}, vertical ${vertical}, option ${option}`);
  if (optionMoved > 0.5) failed.push(`feed: an Option gesture moved the row ${optionMoved} px`);
  await close();
}

if (ONLY.has('drag')) {
  const { page, close } = await open(ROWS.mixed);
  const { pitch, gap } = await page.evaluate(() => ({ pitch: (window as any).__g.PITCH, gap: (window as any).__g.GAP }));
  const win = await g(page, 'win');
  // The gap after the first two slots: the row's own surface, no panel under it.
  const x0 = win.left + 2 * pitch - gap / 2;
  const y = 450;
  const start = await g(page, 'pos');
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await g(page, 'record');
  for (let k = 1; k <= 30; k += 1) {
    await page.mouse.move(x0 - k * 20, y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  const fr = await g(page, 'stop');
  const atRelease = await g(page, 'pos');
  await page.mouse.up();
  await sleep(1500);
  const rest = await g(page, 'pos');
  const max = await g(page, 'max');
  // Past the threshold, the row moves as far as the pointer: its travel against the pointer's, frame by frame.
  const offs = fr.filter((f: any) => f.pointerX > 0 && f.pointerX < x0 - 10).map((f: any) => f.pos - start - (x0 - f.pointerX));
  const worst = offs.length === 0 ? Number.NaN : Math.max(...offs.map(Math.abs));
  // A drag that starts on a panel's body is the panel's: the row stays.
  const panelStart = await g(page, 'pos');
  await page.mouse.move(win.left + pitch / 2, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k += 1) await page.mouse.move(win.left + pitch / 2 - k * 20, y);
  await page.mouse.up();
  await sleep(800);
  const panelMoved = Math.abs((await g(page, 'pos')) - panelStart);
  out.drag = { framesWithPointer: offs.length, worstLagPx: +worst.toFixed(1), travelAtRelease: +(atRelease - start).toFixed(1), pointerTravel: 600, rest: +rest.toFixed(1), restOnGrid: onGrid(rest, pitch, max), dragOnPanelMovedPx: +panelMoved.toFixed(1) };
  if (offs.length === 0) empty.push('drag: no frames');
  // Embla's drag eases toward the pointer (its drag spring): it may trail by up to two frames of this drag's 20 px per frame, and must land the whole travel.
  if (!(worst <= 40)) failed.push(`drag: the row trails the pointer by up to ${worst} px`);
  if (Math.abs(atRelease - start - 600) > 12) failed.push(`drag: travel at release ${atRelease - start} px, not the pointer's 600`);
  if (!onGrid(rest, pitch, max)) failed.push(`drag: rest ${rest} off the grid`);
  if (panelMoved > 0.5) failed.push(`drag: a drag on a panel moved the row ${panelMoved} px`);
  await page.screenshot({ path: join(OUT, `${ENGINE}-drag-rest.png`) });
  await close();
}

if (ONLY.has('keys')) {
  const { page, close } = await open(ROWS.mixed);
  const pitch = await page.evaluate(() => (window as any).__g.PITCH);
  await page.mouse.click(5, 5);
  const seen: number[] = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await sleep(1600);
    seen.push(+(await g(page, 'pos')).toFixed(1));
  }
  out.keys = { rests: seen, want: [1, 2, 3, 2].map((k) => k * pitch) };
  if (seen.join() !== [1, 2, 3, 2].map((k) => k * pitch).join()) failed.push(`keys: rests ${seen}`);
  await close();
}

if (ONLY.has('resize')) {
  const { page, errors, close } = await open(ROWS.mixed);
  const { pitch, phone } = await page.evaluate(() => ({ pitch: (window as any).__g.PITCH, phone: (window as any).__g.PHONE }));
  await g(page, 'jumpToSlot', 5);
  await sleep(500);
  const steps: unknown[] = [];
  for (const width of [1400, 2300, 1800, 1000]) {
    const before = { left: await g(page, 'leftPanel'), pos: await g(page, 'pos') };
    await g(page, 'record');
    await page.setViewportSize({ width, height: 900 });
    await sleep(900);
    const fr = await g(page, 'stop');
    const last = fr[fr.length - 1];
    const max = await g(page, 'max');
    const cutFrames = fr.filter((f: any) => cutNarrow(f, phone).length > 0).length;
    // Where the left-edge panel is drawn in the window, every frame: 0 throughout is "no jump".
    const keptX = fr.map((f: any) => f.panels[before.left]?.x ?? Number.NaN);
    const worstX = Math.max(...keptX.map((x: number) => Math.abs(x)));
    const step = { toWidth: width, windowWidth: last?.winW, leftBefore: before.left, leftAfter: await g(page, 'leftPanel'), posBefore: +before.pos.toFixed(1), posAfter: +last.pos.toFixed(1), keptPanelWorstX: +worstX.toFixed(1), restOnGrid: onGrid(last.pos, pitch, max), framesWithNarrowCut: cutFrames, frames: fr.length, ...(process.env.DUMP ? { series: fr.map((f: any) => [Math.round(f.t), +f.pos.toFixed(1), f.winW, ...Object.entries(f.panels).map(([i, p]: any) => `${i}:${p.x}/${p.w}`)].join(' ')) } : {}) };
    steps.push(step);
    if (fr.length === 0) empty.push(`resize ${width}: no frames`);
    if (!step.restOnGrid) failed.push(`resize ${width}: rest ${step.posAfter} off the grid`);
    if (cutFrames > 0) failed.push(`resize ${width}: ${cutFrames} frames cut a one-slot panel`);
    if (step.leftAfter !== before.left || worstX > 0.5) failed.push(`resize ${width}: the left-edge panel ${before.left} moved (worst ${worstX} px, now ${step.leftAfter})`);
    await page.screenshot({ path: join(OUT, `${ENGINE}-resize-${width}.png`) });
  }
  out.resize = { steps, errors };
  if (errors.length > 0) failed.push(`resize: page errors ${errors.join(' | ')}`);
  await close();
}

await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
if (empty.length > 0) {
  console.error(`proved nothing: ${empty.join('; ')}`);
  process.exit(2);
}
process.exit(failed.length > 0 ? 1 : 0);
