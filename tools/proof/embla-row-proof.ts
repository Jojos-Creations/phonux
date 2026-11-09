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
 * change  with the row resting at slot 5: a panel left of the view resized 3 > 2 > 3 slots, moved past the view, and closed:
 *        the panel at the window's left edge stays put in every frame and no one-slot panel is cut.
 * gesture a change while a gesture or glide holds the row (the audit's cases): a re-render with no layout change while a drag pulls
 *        the row past its start leaves the drag going; a panel far right of the view closed or resized under a wheel stream moves
 *        the row back no more than the stream's own settle (control: the stream alone) and loses no motion; a panel left of the
 *        view narrowed while an arrow-key glide runs lands on the slot grid.
 * resize the window 1800 > 1400 > 2300 > 1800 > 1000 at rest: the panel at the window's left edge stays there, no one-slot panel is
 *        cut in any frame, and each rest is on the grid.
 * strip  a parking row (24 parkable panels, maxLivePanels 8): every panel has its slot (the own row, the control, parks some); a wheel
 *        stream moves it about 1:1 with no stalled frame while far panels unload and near ones load, and no panel moves along the
 *        strip in any frame; a near panel keeps its React state, a far one unloads and mounts again when it comes back; the loaded
 *        parkable panels never pass the cap; rowNearSlots 0 loads only what the window shows.
 * dots   the dot bar on the same parking row: one dot per panel, the oval over the panels in view; a fast oval drag keeps the oval
 *        within 2 px of the pointer in every frame (control: Embla's eased drag trails it); a dot press shows its panel; the pointer
 *        held past a clipped bar's end keeps the row moving every frame (control: held mid-bar, it stays).
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
const ONLY = new Set((arg('only') ?? 'wheel,feed,drag,keys,change,gesture,resize,strip,dots').split(','));
mkdirSync(OUT, { recursive: true });

// The slice of Playwright's Page this script uses, typed loosely.
type Page = any;
const launched = await launchChromium<Page>({ skip: () => {} }, 'embla-row-proof');
if (launched === undefined) process.exit(2);
const browser = launched;
const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'embla-row-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/embla-row-entry.tsx.txt'), 'utf8'));
// The dots drag control (Embla's eased drag trailing the pointer) is the page's, not the library's: the bundle routes the oval
// drag's one write through a page hook, and the build fails if that line is not found, so the control cannot silently not apply.
const OVAL_WRITE = 'const move = (px: number): void => writeEmbla(embla, px);';
const ovalHook = {
  name: 'oval-hook',
  setup(b: any): void {
    b.onLoad({ filter: /emblaDots\.ts$/ }, (a: { path: string }) => {
      const src = readFileSync(a.path, 'utf8');
      if (!src.includes(OVAL_WRITE)) throw new Error(`embla-row-proof: emblaDots.ts no longer has "${OVAL_WRITE}", so the eased-drag control cannot be applied`);
      return { contents: src.replace(OVAL_WRITE, 'const move = (px: number): void => (globalThis as any).__ovalMove(embla, px);'), loader: 'ts' };
    });
  },
};
await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], plugins: [ovalHook], logLevel: 'silent' });
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

async function open(slots: string, width = 1800, height = 900, extra = '', engine: string = ENGINE): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?engine=${engine}&slots=${slots}${extra}`);
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
// Still frames while the row moves: frames with no motion between the first and the last frame that moved. `stalled` counts only
// those a wheel event reached: a frame with no input cannot move a row that follows its input exactly, so `still` alone measures
// how often the page got no event in a frame, not the row.
function stillWhileMoving(fr: any[]): { moving: number; still: number; stalled: number; maxFramePx: number } {
  const moves = fr.slice(1).map((f, k) => ({ m: Math.abs(f.pos - fr[k].pos), wheels: f.wheels ?? 1 }));
  const a = moves.findIndex((x) => x.m > 0.01);
  if (a < 0) return { moving: 0, still: 0, stalled: 0, maxFramePx: 0 };
  const b = moves.length - 1 - [...moves].reverse().findIndex((x) => x.m > 0.01);
  const span = moves.slice(a, b + 1);
  return { moving: span.length, still: span.filter((x) => x.m <= 0.01).length, stalled: span.filter((x) => x.m <= 0.01 && x.wheels > 0).length, maxFramePx: +Math.max(...span.map((x) => x.m)).toFixed(1) };
}

async function stream(name: string, slots: string, D: number, send: (page: Page) => Promise<number>, extra = '', more?: (during: any[]) => Record<string, unknown>): Promise<Record<string, unknown>> {
  const { page, errors, close } = await open(slots, 1800, 900, extra);
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
  const row = { ...(more === undefined ? {} : more(during)), input, moved: +(atInputEnd - start).toFixed(1), pxPerInputPx: +((atInputEnd - start) / input).toFixed(3), framesDuringInput: during.length, framesMoving: s.moving, stillFramesWhileMoving: s.still, stalledFrames: s.stalled, maxFramePx: s.maxFramePx, rest: +rest.toFixed(1), restOnGrid: onGrid(rest, pitch, max), hitEnd: atInputEnd >= max - 1, narrowCutAtRest: restCut, errors: errors.length };
  if (during.length === 0 || s.moving === 0) empty.push(`${name}: no motion`);
  if (!row.restOnGrid) failed.push(`${name}: rest ${row.rest} off the grid`);
  if (restCut.length > 0) failed.push(`${name}: narrow panel cut at rest ${restCut}`);
  if (s.stalled > 0) failed.push(`${name}: ${s.stalled} frames a wheel reached stood still while the row moved`);
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

if (ONLY.has('change')) {
  const { page, errors, close } = await open(ROWS.mixed);
  const { pitch, phone } = await page.evaluate(() => ({ pitch: (window as any).__g.PITCH, phone: (window as any).__g.PHONE }));
  await g(page, 'jumpToSlot', 5);
  await sleep(500);
  // Row order: the Workspace panel, then 1,3,1,2,... slots; at slot 5 the window starts at the fourth panel.
  const ids: string[] = await g(page, 'ids');
  const cases: unknown[] = [];
  for (const [label, name, args] of [
    ['narrow the 3-slot panel left of the view to 2', 'setSlots', [ids[2], 2]],
    ['widen it back to 3', 'setSlots', [ids[2], 3]],
    ['move the panel left of the view 3 places right, past the window', 'move', [ids[1], 3]],
    ['close a panel left of the view', 'close', [ids[2]]],
  ] as const) {
    const left = await g(page, 'leftPanel');
    const posBefore = await g(page, 'pos');
    await g(page, 'record');
    await g(page, 'op', name, ...args);
    await sleep(900);
    const fr = await g(page, 'stop');
    const last = fr[fr.length - 1];
    const max = await g(page, 'max');
    const worstX = Math.max(...fr.map((f: any) => Math.abs(f.panels[left]?.x ?? Number.NaN)));
    const cutFrames = fr.filter((f: any) => cutNarrow(f, phone).length > 0).length;
    const c = { label, leftPanel: left, posBefore: +posBefore.toFixed(1), posAfter: +last.pos.toFixed(1), keptPanelWorstX: +worstX.toFixed(1), framesWithNarrowCut: cutFrames, restOnGrid: onGrid(last.pos, pitch, max), frames: fr.length };
    cases.push(c);
    if (fr.length === 0) empty.push(`change ${label}: no frames`);
    if (Math.abs(last.pos - posBefore) < 0.5) empty.push(`change ${label}: the row never had to move, so this proved nothing`);
    if (!(worstX <= 0.5)) failed.push(`change ${label}: the left-edge panel moved (worst ${worstX} px)`);
    if (cutFrames > 0) failed.push(`change ${label}: ${cutFrames} frames cut a one-slot panel`);
    if (!c.restOnGrid) failed.push(`change ${label}: rest ${c.posAfter} off the grid`);
  }
  out.change = { cases, errors };
  if (errors.length > 0) failed.push(`change: page errors ${errors.join(' | ')}`);
  await page.screenshot({ path: join(OUT, `${ENGINE}-change.png`) });
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

const PARKING = `&park=1&cap=8`;
const nextFrame = (page: Page): Promise<void> => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
// Each panel's place along the strip, frame by frame (drawn left in the window plus the drawn scroll): a load or unload that jumped
// the row would move it. Worst move over the run, and how often the unloaded count changed.
function stripDrift(fr: any[]): { worstPx: number; unloadChanges: number; maxLoaded: number } {
  const first = new Map<string, number>();
  let worst = 0;
  let changes = 0;
  for (const [k, f] of fr.entries()) {
    if (k > 0 && f.unloaded !== fr[k - 1].unloaded) changes += 1;
    for (const [id, { x }] of Object.entries(f.panels as Record<string, { x: number }>)) {
      const at = x + f.pos;
      if (!first.has(id)) first.set(id, at);
      worst = Math.max(worst, Math.abs(at - first.get(id)!));
    }
  }
  return { worstPx: +worst.toFixed(2), unloadChanges: changes, maxLoaded: Math.max(...fr.map((f) => Object.keys(f.panels).length - 1 - f.unloaded)) };
}

if (ONLY.has('gesture') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const mixed = ROWS.mixed;
  const frameMoves = (fr: any[]): number[] => fr.slice(1).map((f, k) => f.pos - fr[k].pos);
  // A drag pulls the row past its start; a re-render with no layout change (viewport +2 px) must leave it there and the drag going.
  {
    const { page, errors, close } = await open(mixed);
    const win = await g(page, 'win');
    const x0 = win.left + 2 * 406 - 8;
    await page.mouse.move(x0, 450);
    await page.mouse.down();
    for (let k = 1; k <= 10; k += 1) { await page.mouse.move(x0 + k * 20, 450); await nextFrame(page); }
    await sleep(100);
    const held = await g(page, 'pos');
    await page.setViewportSize({ width: 1802, height: 900 });
    await sleep(150);
    const after = await g(page, 'pos');
    for (let k = 11; k <= 20; k += 1) { await page.mouse.move(x0 + k * 20, 450); await nextFrame(page); }
    await sleep(100);
    const more = await g(page, 'pos');
    await page.mouse.up();
    await sleep(1200);
    const rest = await g(page, 'pos');
    res.overscroll = { held: +held.toFixed(1), afterRerender: +after.toFixed(1), afterMore: +more.toFixed(1), rest: +rest.toFixed(1) };
    if (!(held < -50)) empty.push(`gesture overscroll: the drag pulled the row only to ${held}, so the check proves nothing`);
    if (Math.abs(after - held) > 5) failed.push(`gesture overscroll: a re-render moved a pulled row from ${held.toFixed(1)} to ${after.toFixed(1)}`);
    if (!(more < held - 50)) failed.push(`gesture overscroll: the drag stopped after the re-render (${held.toFixed(1)} > ${more.toFixed(1)})`);
    if (Math.abs(rest) > 0.5) failed.push(`gesture overscroll: rest ${rest} after release, not 0`);
    if (errors.length > 0) failed.push(`gesture overscroll: page errors ${errors.join(' | ')}`);
    await close();
  }
  // A steady wheel; 1 s in, a change right of the view. The control is the stream alone: its settle steps back a few px.
  const midWheel = async (label: string, act: ((page: Page) => Promise<void>) | null): Promise<{ worstBack: number; moved: number; rest: number }> => {
    const { page, errors, close } = await open(mixed);
    await page.mouse.move(900, 400);
    await g(page, 'record');
    const t0 = Date.now();
    let acted = false;
    while (Date.now() - t0 < 2000) {
      await page.mouse.wheel(12, 0);
      if (!acted && act !== null && Date.now() - t0 > 1000) { acted = true; await act(page); }
      await sleep(16);
    }
    await sleep(1200);
    const fr = await g(page, 'stop');
    const mv = frameMoves(fr);
    const rest = fr[fr.length - 1].pos;
    const max = await g(page, 'max');
    const r = { worstBack: +Math.min(0, ...mv).toFixed(2), moved: +(rest - fr[0].pos).toFixed(1), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, 406, max) };
    res[label] = r;
    if (!r.restOnGrid) failed.push(`gesture ${label}: rest ${rest} off the grid`);
    if (errors.length > 0) failed.push(`gesture ${label}: page errors ${errors.join(' | ')}`);
    await close();
    return r;
  };
  const ctl = await midWheel('wheelControl', null);
  if (!(ctl.moved > 300)) empty.push(`gesture: the wheel stream alone moved ${ctl.moved} px, so the mid-stream checks prove nothing`);
  for (const [label, act] of [
    ['wheelCloseFarRight', async (page: Page) => { const ids: string[] = await g(page, 'ids'); await g(page, 'op', 'close', ids[ids.length - 1]); }],
    ['wheelResizeFarRight', async (page: Page) => { const ids: string[] = await g(page, 'ids'); await g(page, 'op', 'setSlots', ids[ids.length - 1], 1); }],
  ] as const) {
    const r = await midWheel(label, act);
    if (r.worstBack < Math.min(ctl.worstBack, 0) - 10) failed.push(`gesture ${label}: the row jumped back ${r.worstBack} px (the stream alone: ${ctl.worstBack})`);
    if (Math.abs(r.moved - ctl.moved) > 0.5 * 406) failed.push(`gesture ${label}: the row moved ${r.moved} px, the stream alone ${ctl.moved}: the gesture was lost`);
  }
  // From slot 5, a wheel stream; 1 s in, the 3-slot panel left of the view narrows to 2. The keep-still shift lands under the gesture:
  // a panel in view moves on screen only as the stream moves it (worst frame-to-frame move), and the gesture goes on.
  {
    const { page, errors, close } = await open(mixed);
    await g(page, 'jumpToSlot', 5);
    await sleep(500);
    const ids: string[] = await g(page, 'ids');
    await page.mouse.move(900, 400);
    await g(page, 'record');
    const t0 = Date.now();
    let acted = false;
    while (Date.now() - t0 < 2000) {
      await page.mouse.wheel(12, 0);
      if (!acted && Date.now() - t0 > 1000) { acted = true; await g(page, 'op', 'setSlots', ids[2], 2); }
      await sleep(16);
    }
    await sleep(1200);
    const fr = await g(page, 'stop');
    const watch = ids[8]!;
    let worst = 0;
    for (let k = 1; k < fr.length; k += 1) {
      const a = fr[k - 1].panels[watch];
      const b = fr[k].panels[watch];
      if (a !== undefined && b !== undefined) worst = Math.max(worst, Math.abs(b.x - a.x));
    }
    const rest = fr[fr.length - 1].pos;
    const max = await g(page, 'max');
    res.wheelNarrowLeft = { worstScreenStepPx: +worst.toFixed(1), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, 406, max) };
    if (worst > 40) failed.push(`gesture wheelNarrowLeft: a panel in view jumped ${worst.toFixed(1)} px in one frame when a panel left of the view narrowed mid-stream`);
    if (!onGrid(rest, 406, max)) failed.push(`gesture wheelNarrowLeft: rest ${rest} off the grid`);
    if (errors.length > 0) failed.push(`gesture wheelNarrowLeft: page errors ${errors.join(' | ')}`);
    await close();
  }
  // ArrowRight from slot 5, and 120 ms into the glide narrow the 3-slot panel left of the view: the glide lands on the grid.
  {
    const { page, errors, close } = await open(mixed);
    await g(page, 'jumpToSlot', 5);
    await sleep(500);
    const ids: string[] = await g(page, 'ids');
    await page.mouse.click(5, 5);
    const before = await g(page, 'pos');
    await page.keyboard.press('ArrowRight');
    await sleep(120);
    const mid = await g(page, 'pos');
    await g(page, 'op', 'setSlots', ids[2], 2);
    await sleep(1500);
    const rest = await g(page, 'pos');
    const max = await g(page, 'max');
    res.midGlide = { before: +before.toFixed(1), atChange: +mid.toFixed(1), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, 406, max) };
    if (!(Math.abs(mid - before) > 5 && Math.abs(mid - before) < 400)) empty.push(`gesture midGlide: the change came at ${mid} from ${before}, not mid-glide`);
    if (!onGrid(rest, 406, max)) failed.push(`gesture midGlide: rest ${rest} off the grid after a change mid-glide`);
    if (errors.length > 0) failed.push(`gesture midGlide: page errors ${errors.join(' | ')}`);
    await close();
  }
  out.gesture = res;
}

if (ONLY.has('strip') && ENGINE === 'embla') {
  const narrow = ROWS.narrow;
  const res: Record<string, unknown> = {};
  // Control: the same parking row on the own row parks the panels that do not fit, so "every panel has a slot" can fail.
  {
    const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
    const page: Page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/?engine=own&slots=${narrow}${PARKING}`);
    await page.waitForFunction(() => (window as any).__g !== undefined && document.querySelectorAll('[data-row-slot]').length > 0, undefined, { timeout: 15000 });
    await sleep(800);
    res.ownRowSlots = await g(page, 'slotCount');
    await ctx.close();
  }
  const { page, errors, close } = await open(narrow, 1800, 900, PARKING);
  const statuses: string[] = await g(page, 'statuses');
  res.emblaRowSlots = await g(page, 'slotCount');
  res.parkedOnEmbla = statuses.filter((x) => x.endsWith(':parked'));
  if (!((res.ownRowSlots as number) < 25)) empty.push(`strip: the own row's control shows ${res.ownRowSlots} slots, so the parking row parked nothing and the check proves nothing`);
  if (res.emblaRowSlots !== 25) failed.push(`strip: the Embla row shows ${res.emblaRowSlots} of 25 slots`);
  if ((res.parkedOnEmbla as string[]).length > 0) failed.push(`strip: parked on Embla: ${res.parkedOnEmbla}`);
  // State: p2 is in view at slot 0; four slots on it is one slot from the view (near), twelve is far.
  const pitch = await page.evaluate(() => (window as any).__g.PITCH);
  await g(page, 'setCount', 'p2', 7);
  await sleep(200);
  const states: unknown[] = [];
  for (const slot of [4, 12, 0]) {
    await g(page, 'record');
    await page.evaluate((s: number) => (window as any).__g.glideToSlot(s), slot);
    await sleep(1500);
    const fr = await g(page, 'stop');
    const loaded: string[] = await g(page, 'loadedIds');
    const st = { slot, pos: +(await g(page, 'pos')).toFixed(1), p2Loaded: loaded.includes('p2'), p2Count: await g(page, 'count', 'p2'), p2Mounts: (await g(page, 'mounts')).p2 ?? 0, loaded: loaded.length, unloaded: (await g(page, 'unloadedIds')).length, drift: stripDrift(fr) };
    states.push(st);
    if (!(st.loaded <= 8)) failed.push(`strip: ${st.loaded} parkable panels loaded at slot ${slot}, more than the cap 8`);
    if (st.drift.worstPx > 0.5) failed.push(`strip: a panel moved ${st.drift.worstPx} px along the strip on the way to slot ${slot}`);
    if (!(Math.abs(st.pos - slot * pitch) <= 0.5)) failed.push(`strip: rest ${st.pos} at slot ${slot}, not ${slot * pitch}`);
  }
  const [near, far, back] = states as any[];
  res.states = states;
  if (!(near.p2Loaded && near.p2Count === '7' && near.p2Mounts === 1)) failed.push(`strip: p2 one slot from the view lost its state (${JSON.stringify(near)})`);
  if (far.p2Loaded || far.unloaded === 0) failed.push(`strip: p2 far from the view is still loaded (${JSON.stringify(far)})`);
  if (!(back.p2Loaded && back.p2Mounts === 2)) failed.push(`strip: p2 did not load again when it came back (${JSON.stringify(back)})`);
  await page.screenshot({ path: join(OUT, `${ENGINE}-strip-slot0.png`) });
  if (errors.length > 0) failed.push(`strip: page errors ${errors.join(' | ')}`);
  await close();
  // rowNearSlots 0: only what the window shows stays loaded.
  {
    const o = await open(narrow, 1800, 900, `${PARKING}&near=0`);
    await g(o.page, 'jumpToSlot', 6);
    await sleep(600);
    res.near0Loaded = (await g(o.page, 'loadedIds')).length;
    if (res.near0Loaded !== 4) failed.push(`strip: rowNearSlots 0 leaves ${res.near0Loaded} parkable panels loaded with four in view`);
    await o.close();
  }
  // Scrolling the parking row: continuous, and nothing jumps while panels unload and load under the stream.
  res.wheel = await stream('strip wheel D12', narrow, 12, async (pg) => {
    let input = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      await pg.mouse.wheel(12, 0);
      input += 12;
      await sleep(16);
    }
    return input;
  }, PARKING, (during) => ({ drift: stripDrift(during) }));
  const w = res.wheel as any;
  if (Math.abs(w.pxPerInputPx - 1) > 0.05) failed.push(`strip wheel: ${w.pxPerInputPx} px per input px`);
  if (w.drift.unloadChanges === 0) empty.push('strip wheel: no panel loaded or unloaded during the stream, so the no-jump check proves nothing');
  if (w.drift.worstPx > 0.5) failed.push(`strip wheel: a panel moved ${w.drift.worstPx} px along the strip while panels loaded and unloaded`);
  if (w.drift.maxLoaded > 8) failed.push(`strip wheel: ${w.drift.maxLoaded} parkable panels loaded in one frame, more than the cap 8`);
  out.strip = res;
}

if (ONLY.has('dots') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const narrow = ROWS.narrow;
  const fastDrag = async (eased: boolean): Promise<Record<string, unknown>> => {
    const { page, errors, close } = await open(narrow, 1800, 900, `${PARKING}&bar=0`);
    await g(page, 'easedOval', eased);
    const b = await g(page, 'bar');
    const x0 = b.oval.left + b.oval.width / 2;
    const y = b.oval.top + b.oval.height / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await g(page, 'record');
    // 6 px a frame for 60 frames: 360 track px, about twelve slots.
    for (let k = 1; k <= 60; k += 1) {
      await page.mouse.move(x0 + k * 6, y);
      await nextFrame(page);
    }
    for (let k = 0; k < 10; k += 1) await nextFrame(page);
    const fr = await g(page, 'stop');
    await page.mouse.up();
    await sleep(1500);
    const rest = await g(page, 'pos');
    const { pitch, max } = { pitch: await page.evaluate(() => (window as any).__g.PITCH), max: await g(page, 'max') };
    const grab = b.oval.left - x0;
    const moving = fr.filter((f: any) => f.pointerX > x0 + 5);
    const offs = moving.map((f: any) => f.ovalScreen - f.pointerX - grab);
    const worst = offs.length === 0 ? Number.NaN : Math.max(...offs.map(Math.abs));
    const travel = fr.length === 0 ? 0 : fr[fr.length - 1].pos - fr[0].pos;
    const r = { eased, frames: moving.length, worstOvalToPointerPx: +worst.toFixed(2), medianOvalToPointerPx: offs.length === 0 ? null : +[...offs.map(Math.abs)].sort((a, c) => a - c)[Math.floor(offs.length / 2)].toFixed(2), stripTravelPx: +travel.toFixed(1), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, pitch, max), errors };
    await close();
    return r;
  };
  {
    const { page, errors, close } = await open(narrow, 1800, 900, `${PARKING}&bar=0`);
    const b = await g(page, 'bar');
    res.dotCount = b.dots;
    if (b.dots !== 25) failed.push(`dots: ${b.dots} dots for 25 panels`);
    // The oval spans the dots of the panels in view: at rest at slot 0 and at slot 7 its ends meet the first and last of them.
    const spans: unknown[] = [];
    for (const slot of [0, 7]) {
      await g(page, 'jumpToSlot', slot);
      await sleep(400);
      const ids: string[] = await g(page, 'ids');
      const shown = ids.slice(slot, slot + 4);
      const first = await g(page, 'dotRect', shown[0]);
      const last = await g(page, 'dotRect', shown[3]);
      const o = (await g(page, 'bar')).oval;
      const sp = { slot, shown, ovalLeftToFirstDot: +(o.left - first.left).toFixed(2), ovalRightToLastDot: +(o.left + o.width - (last.left + last.width)).toFixed(2) };
      spans.push(sp);
      if (Math.abs(sp.ovalLeftToFirstDot) > 1 || Math.abs(sp.ovalRightToLastDot) > 1) failed.push(`dots: at slot ${slot} the oval does not span the dots in view (${JSON.stringify(sp)})`);
    }
    res.ovalSpans = spans;
    // A dot press shows its panel: p20 (the strip's 21st), far right of the view.
    await g(page, 'jumpToSlot', 0);
    await sleep(400);
    const p20 = (await g(page, 'ids'))[20];
    const d = await g(page, 'dotRect', p20);
    await page.mouse.click(d.left + d.width / 2, d.top + 2);
    await sleep(1500);
    const win = await g(page, 'win');
    const lefts = await g(page, 'stripLefts');
    const at = await g(page, 'pos');
    res.dotPress = { p20Left: lefts[p20], pos: +at.toFixed(1), windowWidth: win.width };
    if (!(lefts[p20] >= at - 0.5 && lefts[p20] + 390 <= at + win.width + 0.5)) failed.push(`dots: pressing p20's dot left it out of view (${JSON.stringify(res.dotPress)})`);
    if (errors.length > 0) failed.push(`dots: page errors ${errors.join(' | ')}`);
    await close();
  }
  res.drag = await fastDrag(false);
  res.dragEasedControl = await fastDrag(true);
  const dr = res.drag as any;
  const ctl = res.dragEasedControl as any;
  if (dr.frames === 0 || dr.stripTravelPx < 1000) empty.push(`dots drag: ${dr.frames} frames, the strip moved ${dr.stripTravelPx} px`);
  if (!(dr.worstOvalToPointerPx <= 2)) failed.push(`dots drag: the oval was up to ${dr.worstOvalToPointerPx} px from the pointer`);
  if (!dr.restOnGrid) failed.push(`dots drag: rest ${dr.rest} off the grid`);
  if (!(ctl.worstOvalToPointerPx > 2)) empty.push(`dots drag control: Embla's eased drag kept the oval within ${ctl.worstOvalToPointerPx} px, so the check cannot fail and proves nothing`);
  // The pointer held still past the end of a bar clipped to 300 px: the row keeps moving, every frame, until its end. Control: held mid-bar.
  const hold = async (past: boolean): Promise<Record<string, unknown>> => {
    const { page, errors, close } = await open(narrow, 1800, 900, `${PARKING}&bar=300`);
    const b = await g(page, 'bar');
    const x0 = b.oval.left + b.oval.width / 2;
    const y = b.oval.top + b.oval.height / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    const to = past ? b.frame.left + b.frame.width + 20 : x0 + 40;
    for (let k = 1; k <= 20; k += 1) {
      await page.mouse.move(x0 + ((to - x0) * k) / 20, y);
      await nextFrame(page);
    }
    await sleep(100);
    await g(page, 'record');
    await sleep(1000);
    const fr = await g(page, 'stop');
    await page.mouse.up();
    const max = await g(page, 'max');
    const moves = fr.slice(1).map((f: any, k: number) => f.pos - fr[k].pos);
    const beforeEnd = moves.filter((_: number, k: number) => fr[k].pos < max - 0.5);
    const r = { past, frames: fr.length, movedPx: fr.length === 0 ? 0 : +(fr[fr.length - 1].pos - fr[0].pos).toFixed(1), framesStillBeforeEnd: beforeEnd.filter((m: number) => m <= 0.01).length, framesBeforeEnd: beforeEnd.length, pointerPastFramePx: +(to - (b.frame.left + b.frame.width)).toFixed(1), errors };
    await close();
    return r;
  };
  res.holdPastEnd = await hold(true);
  res.holdMidBarControl = await hold(false);
  const h = res.holdPastEnd as any;
  const hc = res.holdMidBarControl as any;
  if (h.frames === 0) empty.push('dots hold: no frames');
  if (!(h.movedPx > 200)) failed.push(`dots hold: held past the bar's end, the row moved ${h.movedPx} px in a second`);
  if (h.framesStillBeforeEnd > 0) failed.push(`dots hold: ${h.framesStillBeforeEnd} of ${h.framesBeforeEnd} frames stood still while held past the end`);
  if (Math.abs(hc.movedPx) > 0.5) empty.push(`dots hold control: held mid-bar the row moved ${hc.movedPx} px, so the hold check cannot tell holding at the end from holding anywhere`);
  out.dots = res;
}

await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
if (empty.length > 0) {
  console.error(`proved nothing: ${empty.join('; ')}`);
  process.exit(2);
}
process.exit(failed.length > 0 ? 1 : 0);
