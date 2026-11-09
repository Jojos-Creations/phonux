/**
 * The Embla row (`Workspace rowEngine="embla"`) measured in headless Chromium, on the real Workspace and PanelRow:
 *
 *   node --import tsx tools/proof/embla-row-proof.ts [--engine embla|own] [--out <dir>] [--only wheel,feed,drag,keys,resize,width]
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
 * summon the root on a row of 25 slots, eight pages left of it: summoned from the left and from the right it comes into that edge's
 *        slot and the pages in view stay put in every frame; a dismiss restores the view; a step toward it keeps the summon; a scroll
 *        and a dot press carrying it out end the summon and return its pages out of view. The step-aside: a window narrowed under a
 *        wide page beside the root, and a size pick, show the page whole; a step back and a wider window bring the root back.
 *
 * width  a row of 17 slots in a window of four: a page's width changes in view, at the window's left edge, cut by it, at the strip's
 *        end (where the view cannot keep its left edge and the right end holds instead), under an arrow-key glide and a wheel stream,
 *        with the Workspace summoned and stepped aside; per frame, pages that must stay move 0 px, the changing page's moving edge
 *        moves one way with no frame over a quarter of its travel and no end snap (largest of its last 3 frame steps against the
 *        median), its neighbors stay one gap from it, and no one-slot page is cut while the row stands on the grid. Maximize: a page
 *        grown over the row, a wheel stream and an arrow key, then the restore: nothing behind moves, the view is the one it left.
 *
 * blank  a parking row on a magenta page at maxLivePanels 8 and at 4 (what the window fits): a far dot press, a far jump, a wheel fling
 *        and a summon, every frame the compositor presents (screencast): no page in the window paints nothing (a magenta band at least
 *        100 px wide), and no unloaded placeholder is drawn in the window (the DOM, every animation frame). Control: the same runs with
 *        every page's content hidden must show blank frames, or the measure cannot see a blank page and proves nothing.
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
const ONLY = new Set((arg('only') ?? 'wheel,feed,drag,keys,change,gesture,resize,strip,dots,summon,width,blank,reorder').split(','));
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

async function open(slots: string, width = 1800, height = 900, extra = '', engine: string = ENGINE, ctxOpts: Record<string, unknown> = {}): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, ...ctxOpts });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  const consoleErrors: string[] = [];
  page.on('console', (m: any) => { if (m.type() === 'error' && consoleErrors.length < 3) consoleErrors.push(m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${port}/?engine=${engine}&slots=${slots}${extra}`);
  await page.waitForFunction(() => (window as any).__g?.ready(), undefined, { timeout: 15000 }).catch(async (e: Error) => {
    const why = await page.evaluate(() => { const w = window as any; return w.__g === undefined ? 'no page hooks' : `slots ${w.__g.slotCount()} statuses ${w.__g.statuses().filter((s: string) => s.endsWith('parked')).length} parked, engine attr ${document.querySelector('[data-row-engine]')?.getAttribute('data-row-engine')}, embla window ${document.querySelectorAll('[data-row-embla-window]').length}, grabs ${document.querySelectorAll('[data-grab]').length}`; }).catch((x: Error) => x.message);
    throw new Error(`proof page never ready (${extra}): ${errors.join(' | ') || e.message}, ${why}, console: ${consoleErrors.join(' | ')}`);
  });
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

// The root (the Workspace panel) on a row with more pages than fit: summon from the left and from the right with pages left of it,
// dismiss, a step toward it, a scroll and a dot press carrying it out, and the step-aside on a window resize and on a size pick.
if (ONLY.has('summon') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const PITCH = 406;
  const fail = (label: string, why: string): void => void failed.push(`summon ${label}: ${why}`);
  const shown = async (page: Page): Promise<Record<string, { x: number; w: number }>> => Object.fromEntries((await g(page, 'shown')).map((x: any) => [x.id, { x: x.x, w: x.w }]));
  const visible = (m: Record<string, { x: number; w: number }>, winW: number): string[] => Object.entries(m).filter(([, v]) => v.x > -v.w + 1 && v.x < winW - 1).sort((a, b) => a[1].x - b[1].x).map(([id]) => id);
  const placeRoot = async (page: Page, n: number): Promise<boolean> => {
    for (let k = 0; k < n; k += 1) {
      await g(page, 'op', 'move', await g(page, 'idOf', 'root'), 'right');
      await sleep(80);
    }
    await sleep(600);
    return (await g(page, 'order'))[n] === 'root';
  };
  // Runs `act`, records every frame until the row settles, and checks that `stay` never moved on screen, that no one-slot panel is cut
  // at rest and that the rest is on the grid.
  let lastStep: { before: Record<string, { x: number; w: number }>; after: Record<string, { x: number; w: number }>; fr: any[]; winW: number } | null = null;
  const step = async (page: Page, label: string, act: () => Promise<unknown>, stay: string[]): Promise<any> => {
    const before = await shown(page);
    await g(page, 'record');
    const ret = await act();
    await sleep(1000);
    const fr = await g(page, 'stop');
    const after = await shown(page);
    const win = await g(page, 'win');
    const max = await g(page, 'max');
    const rest = await g(page, 'pos');
    let worst = 0;
    for (const id of stay) for (const f of fr) if (f.named[id] !== undefined && before[id] !== undefined) worst = Math.max(worst, Math.abs(f.named[id].x - before[id].x));
    const missing = stay.filter((id) => after[id] === undefined || before[id] === undefined);
    const cut = fr.length > 0 ? cutNarrow({ ...fr[fr.length - 1], panels: fr[fr.length - 1].named }, 390) : [];
    const rootXs = fr.map((f: any) => f.named.root?.x).filter((x: any) => x !== undefined);
    lastStep = { before, after, fr, winW: win.width };
    const r = { returned: ret, frames: fr.length, visibleBefore: visible(before, win.width), visibleAfter: visible(after, win.width), stayWorstPx: +worst.toFixed(1), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, PITCH, max), cutAtRest: cut, rootView: await g(page, 'rootView'), slots: await g(page, 'slotCount'), rootX: after.root?.x ?? null, rootFramesMoving: new Set(rootXs.map((x: number) => Math.round(x))).size };
    if (fr.length === 0) empty.push(`summon ${label}: no frames`);
    if (missing.length > 0) fail(label, `panels meant to stay are not drawn: ${missing}`);
    if (worst > 0.5) fail(label, `a page in view moved ${worst.toFixed(1)} px`);
    if (cut.length > 0) fail(label, `one-slot page cut at rest: ${cut}`);
    if (!r.restOnGrid) fail(label, `rest ${r.rest} off the grid`);
    return r;
  };
  // The pages a summon takes off the strip run their exit from where they were drawn (the audit saw p10, p11 drawn over p16, p17 for a
  // frame): one that was out of the window never comes into it, one in it starts its exit from its place.
  const leaving = (label: string): Record<string, unknown> => {
    if (lastStep === null) return {};
    const { before, after, fr, winW } = lastStep;
    const ids = Object.keys(before).filter((id) => after[id] === undefined);
    let worstOverlap = 0;
    let worstStart = 0;
    let drawnFrames = 0;
    for (const id of ids) {
      const b = before[id]!;
      const seen = fr.filter((f: any) => f.named[id] !== undefined);
      drawnFrames += seen.length;
      if (b.x + b.w <= 0.5 || b.x >= winW - 0.5) for (const f of seen) worstOverlap = Math.max(worstOverlap, Math.min(f.named[id].x + f.named[id].w, winW) - Math.max(f.named[id].x, 0));
      else if (seen.length > 0) worstStart = Math.max(worstStart, Math.abs(seen[0].named[id].x - b.x));
    }
    const r = { leaving: ids, drawnFrames, worstOverlapPx: +worstOverlap.toFixed(1), worstStartPx: +worstStart.toFixed(1) };
    if (ids.length === 0 || drawnFrames === 0) empty.push(`summon ${label} leaving: no page left the strip in a recorded frame, so the check proves nothing`);
    if (worstOverlap > 1) fail(label, `a page leaving from out of view was drawn ${r.worstOverlapPx} px into the window`);
    if (worstStart > PITCH / 4) fail(label, `a page leaving from the view started its exit ${r.worstStartPx} px from where it was drawn`);
    return r;
  };
  const row = Array(24).fill(1).join(',');
  {
    // Summon from the left, eight pages left of the root, the view at p14..p17.
    const { page, errors, close } = await open(row);
    if (!(await placeRoot(page, 8))) empty.push('summon: the root could not be placed with pages left of it');
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    const awayBefore = await g(page, 'rootView');
    const s1 = await step(page, 'fromLeft', async () => {
      const r = await g(page, 'summon');
      await sleep(90);
      await page.screenshot({ path: join(OUT, 'summon-left-mid.png') });
      return r;
    }, ['p15', 'p16', 'p17']);
    await page.screenshot({ path: join(OUT, 'summon-left.png') });
    if (awayBefore !== 'away') empty.push(`summon fromLeft: the root was ${awayBefore} before, so the check proves nothing`);
    const savedLeft = await g(page, 'saved');
    if (savedLeft.length > 0) fail('fromLeft', `the summon parked ${savedLeft.length} panels in the list, which is saved`);
    if (s1.rootView !== 'summoned' || s1.rootX !== 0) fail('fromLeft', `root ${s1.rootView} at x ${s1.rootX}, not summoned at 0`);
    if (s1.visibleAfter.join() !== 'root,p15,p16,p17') fail('fromLeft', `view ${s1.visibleAfter}, not root,p15,p16,p17`);
    if (s1.rootFramesMoving < 3) fail('fromLeft', `the root did not glide in (${s1.rootFramesMoving} places drawn)`);
    s1.leaving = leaving('fromLeft');
    const d1 = await step(page, 'dismissLeft', () => g(page, 'dismiss'), ['p15', 'p16', 'p17']);
    if (d1.visibleAfter.join() !== 'p14,p15,p16,p17' || d1.rootView !== 'away' || d1.slots !== 25) fail('dismissLeft', `view ${d1.visibleAfter}, root ${d1.rootView}, ${d1.slots} slots; not as before the summon`);
    if ((await g(page, 'order')).join() !== ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'root', ...Array.from({ length: 16 }, (_, k) => `p${k + 9}`)].join()) fail('dismissLeft', 'the list order changed');
    await g(page, 'summon');
    await sleep(900);
    const t1 = await step(page, 'stepToward', () => page.keyboard.press('ArrowLeft'), []);
    if (t1.rootView !== 'summoned' || Math.abs(t1.rootX - PITCH) > 1 || t1.visibleAfter.join() !== 'p8,root,p15,p16') fail('stepToward', `root ${t1.rootView} at ${t1.rootX}, view ${t1.visibleAfter}: the summon did not stand`);
    // A scroll carrying the root out to the left: the pages it took off come back beside it, out of view, and the view stays.
    await g(page, 'record');
    await g(page, 'glideToSlot', 13);
    await sleep(2500);
    const fr = await g(page, 'stop');
    const win = await g(page, 'win');
    const after = await shown(page);
    const leftAfter = visible(after, win.width);
    const target = leftAfter[0];
    // The row only glides: once the root has gone, no page in view jumps between two frames by more than the glide's largest step before it.
    const xs = fr.map((f: any) => f.named[target]?.x).filter((x: any) => x !== undefined);
    const steps = xs.slice(1).map((x: number, k: number) => Math.abs(x - xs[k]));
    const rest = await g(page, 'pos');
    const sc = { logical: await g(page, 'logical'), view: leftAfter, rootView: await g(page, 'rootView'), slots: await g(page, 'slotCount'), worstFramePx: +Math.max(0, ...steps).toFixed(1), rest, restOnGrid: onGrid(rest, PITCH, await g(page, 'max')) };
    res.scrollOut = sc;
    if (sc.rootView !== 'away' || sc.slots !== 25) fail('scrollOut', `root ${sc.rootView}, ${sc.slots} slots: the summon did not end and return its pages`);
    // Slot 13 of the summoned strip (p1..p8, root, p15..) is p19's.
    if (leftAfter.join() !== 'p19,p20,p21,p22') fail('scrollOut', `view ${leftAfter}, not p19..p22 where the scroll went`);
    if (sc.worstFramePx > PITCH) fail('scrollOut', `a page in view jumped ${sc.worstFramePx} px in one frame`);
    if (!sc.restOnGrid) fail('scrollOut', `rest ${rest} off the grid`);
    res.fromLeft = s1;
    res.dismissLeft = d1;
    res.stepToward = t1;
    if (errors.length > 0) fail('left', `page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    // Summon from the right with the view at the start, then a dot press carrying the root out.
    const { page, errors, close } = await open(row, 1800, 900, '&bar=0');
    if (!(await placeRoot(page, 8))) empty.push('summon: the root could not be placed');
    await g(page, 'jumpToSlot', 0);
    await sleep(500);
    const s2 = await step(page, 'fromRight', () => g(page, 'summon'), ['p1', 'p2', 'p3']);
    await page.screenshot({ path: join(OUT, 'summon-right.png') });
    const savedRight = await g(page, 'saved');
    if (savedRight.length > 0) fail('fromRight', `the summon parked ${savedRight.length} panels in the list, which is saved`);
    if (s2.rootView !== 'summoned' || s2.rootX !== 3 * PITCH || s2.visibleAfter.join() !== 'p1,p2,p3,root') fail('fromRight', `root ${s2.rootView} at ${s2.rootX}, view ${s2.visibleAfter}`);
    if (s2.rootFramesMoving < 3) fail('fromRight', `the root did not glide in (${s2.rootFramesMoving} places drawn)`);
    s2.leaving = leaving('fromRight');
    const d2 = await step(page, 'dismissRight', async () => {
      const r = await g(page, 'dismiss');
      await sleep(90);
      await page.screenshot({ path: join(OUT, 'dismiss-right-mid.png') });
      return r;
    }, ['p1', 'p2', 'p3']);
    if (d2.visibleAfter.join() !== 'p1,p2,p3,p4' || d2.rootView !== 'away' || d2.slots !== 25) fail('dismissRight', `view ${d2.visibleAfter}, root ${d2.rootView}, ${d2.slots} slots`);
    await g(page, 'summon');
    await sleep(900);
    await page.click(`[data-dot="${await g(page, 'idOf', 'p20')}"]`);
    await sleep(1500);
    const win = await g(page, 'win');
    const m = await shown(page);
    const dot = { view: visible(m, win.width), rootView: await g(page, 'rootView'), slots: await g(page, 'slotCount'), p20: m.p20 };
    res.dotOut = dot;
    if (dot.rootView !== 'away' || dot.slots !== 25) fail('dotOut', `root ${dot.rootView}, ${dot.slots} slots: the summon did not end`);
    if (dot.p20 === undefined || dot.p20.x < -0.5 || dot.p20.x + dot.p20.w > win.width + 0.5) fail('dotOut', `p20 not in view after its dot (${JSON.stringify(dot.p20)})`);
    res.fromRight = s2;
    res.dismissRight = d2;
    if (errors.length > 0) fail('right', `page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    // Step-aside on a window resize: the root beside a three-slot page; the window narrows from four slots to three.
    const { page, errors, close } = await open('3,1,1,1,1,1,1,1');
    const a = await step(page, 'asideResize', () => page.setViewportSize({ width: 1400, height: 900 }), []);
    await page.screenshot({ path: join(OUT, 'aside-resize.png') });
    const m = await shown(page);
    if (m.root !== undefined || m.p1?.x !== 0 || a.rootView !== 'away') fail('asideResize', `root ${m.root === undefined ? 'off the strip' : `at ${m.root.x}`}, p1 at ${m.p1?.x}, ${a.rootView}: the wide page is not whole`);
    const back = await step(page, 'stepBack', () => page.keyboard.press('ArrowLeft'), []);
    const mb = await shown(page);
    if (m.root !== undefined) fail('stepBack', 'the root never stepped aside, so there was nothing to step back from');
    if (mb.root?.x !== 0 || back.rootView !== 'shown') fail('stepBack', `root at ${mb.root?.x}, ${back.rootView}: stepping back did not return it`);
    await page.setViewportSize({ width: 1800, height: 900 });
    await sleep(900);
    await page.setViewportSize({ width: 1400, height: 900 });
    await sleep(900);
    if ((await shown(page)).root !== undefined) fail('widenBack', 'the root never stepped aside at 1400, so there was nothing to bring back');
    const w = await step(page, 'widenBack', () => page.setViewportSize({ width: 1800, height: 900 }), []);
    const mw = await shown(page);
    if (mw.root?.x !== 0 || mw.p1?.x !== PITCH) fail('widenBack', `root at ${mw.root?.x}, p1 at ${mw.p1?.x}: widening did not bring the root back beside it`);
    res.asideResize = a;
    res.stepBack = back;
    res.widenBack = w;
    if (errors.length > 0) fail('asideResize', `page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    // Step-aside on a size pick: the page beside the root picked four slots wide in a four-slot window; a summon, then a dismiss.
    const { page, errors, close } = await open('2,1,1,1,1,1,1,1');
    const a = await step(page, 'asideSize', async () => g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 4), []);
    await page.screenshot({ path: join(OUT, 'aside-size.png') });
    const m = await shown(page);
    if (m.root !== undefined || m.p1?.x !== 0 || m.p1?.w !== 4 * PITCH - 16) fail('asideSize', `root ${m.root === undefined ? 'off the strip' : `at ${m.root.x}`}, p1 at ${m.p1?.x} ${m.p1?.w} wide: the wide page is not whole`);
    const s = await step(page, 'summonAside', () => g(page, 'summon'), []);
    const ms = await shown(page);
    if (m.root !== undefined) fail('summonAside', 'the root never stepped aside, so the summon brought nothing back');
    if (ms.root?.x !== 0 || s.rootView !== 'summoned' || ms.p1?.x !== PITCH) fail('summonAside', `root at ${ms.root?.x}, ${s.rootView}, p1 at ${ms.p1?.x}`);
    const d = await step(page, 'dismissAside', () => g(page, 'dismiss'), []);
    const md = await shown(page);
    if (md.root !== undefined || md.p1?.x !== 0 || d.rootView !== 'away') fail('dismissAside', `root ${md.root === undefined ? 'off' : md.root.x}, p1 at ${md.p1?.x}, ${d.rootView}: the dismiss did not step it aside again`);
    res.asideSize = a;
    res.summonAside = s;
    res.dismissAside = d;
    if (errors.length > 0) fail('asideSize', `page errors ${errors.join(' | ')}`);
    await close();
  }
  // A summon or a dismiss pressed while the row glides, and while a mouse drag holds it: the view rests where the press asks, from where
  // the row is going (the audit: a summon mid-glide rested at slot 21 with the root never shown, or put the root at the wrong edge).
  for (const [label, to, expectView] of [['midGlideAway', 18, 'root,p19,p20,p21'], ['midGlideToward', 10, 'root,p11,p12,p13']] as const) {
    const { page, errors, close } = await open(row);
    if (!(await placeRoot(page, 8))) empty.push(`summon ${label}: the root could not be placed`);
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    await g(page, 'glideToSlot', to);
    await sleep(70);
    const mid = await g(page, 'pos');
    const r = await step(page, label, async () => {
      const ret = await g(page, 'summon');
      await sleep(800);
      return ret;
    }, []);
    r.midPos = +mid.toFixed(1);
    res[label] = r;
    if (Math.abs(mid - 14 * PITCH) < 20 || Math.abs(mid - to * PITCH) < 20) empty.push(`summon ${label}: the press came at ${mid}, not mid-glide`);
    if (r.returned !== true || r.rootView !== 'summoned' || r.rootX !== 0 || r.visibleAfter.join() !== expectView) fail(label, `returned ${r.returned}, root ${r.rootView} at ${r.rootX}, view ${r.visibleAfter}; not summoned at 0 with ${expectView}`);
    if (errors.length > 0) fail(label, `page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    const { page, errors, close } = await open(row);
    if (!(await placeRoot(page, 8))) empty.push('summon dismissMidGlide: the root could not be placed');
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    await g(page, 'summon');
    await sleep(1000);
    await g(page, 'glideToSlot', 6);
    await sleep(70);
    const mid = await g(page, 'pos');
    const r = await step(page, 'dismissMidGlide', async () => {
      const ret = await g(page, 'dismiss');
      await sleep(800);
      return ret;
    }, []);
    r.midPos = +mid.toFixed(1);
    res.dismissMidGlide = r;
    if (Math.abs(mid - 8 * PITCH) < 20 || Math.abs(mid - 6 * PITCH) < 20) empty.push(`summon dismissMidGlide: the press came at ${mid}, not mid-glide`);
    if (r.returned !== true || r.rootView !== 'away' || r.visibleAfter.join() !== 'p14,p15,p16,p17' || r.slots !== 25) fail('dismissMidGlide', `returned ${r.returned}, root ${r.rootView}, view ${r.visibleAfter}, ${r.slots} slots; not p14..p17 as before the summon`);
    if (errors.length > 0) fail('dismissMidGlide', `page errors ${errors.join(' | ')}`);
    await close();
  }
  for (const label of ['summonDrag', 'dismissDrag'] as const) {
    const { page, errors, close } = await open(row, 1800, 900, '&bar=0');
    if (!(await placeRoot(page, 8))) empty.push(`summon ${label}: the root could not be placed`);
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    if (label === 'dismissDrag') {
      await g(page, 'summon');
      await sleep(1000);
    }
    const win = await g(page, 'win');
    // A press on the gap between the second and third slot: the row's own surface, where a mouse drag starts.
    const x0 = win.left + 2 * PITCH - 8;
    const dir = label === 'summonDrag' ? 1 : -1;
    await page.mouse.move(x0, 450);
    await page.mouse.down();
    for (let k = 1; k <= 6; k += 1) {
      await page.mouse.move(x0 + dir * k * 10, 450);
      await sleep(16);
    }
    const held = await g(page, 'pos');
    const ret = await g(page, label === 'summonDrag' ? 'summon' : 'dismiss');
    await sleep(100);
    for (let k = 7; k <= 9; k += 1) {
      await page.mouse.move(x0 + dir * k * 10, 450);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(1500);
    const m = await shown(page);
    const rest = await g(page, 'pos');
    const r = { held: +held.toFixed(1), returned: ret, rootView: await g(page, 'rootView'), view: visible(m, win.width), rest: +rest.toFixed(1), restOnGrid: onGrid(rest, PITCH, await g(page, 'max')), slots: await g(page, 'slotCount') };
    res[label] = r;
    if (Math.abs(held - 14 * PITCH) < 20 && label === 'summonDrag') empty.push(`summon ${label}: the drag moved the row only to ${held}`);
    // The drag moved the row 60 px toward the root first, so p13 is cut at the left edge: it stays and moves over (a cut page is not
    // in the edge slot), as at rest.
    const want = label === 'summonDrag' ? 'root,p13,p14,p15' : 'p14,p15,p16,p17';
    if (r.returned !== true || r.rootView !== (label === 'summonDrag' ? 'summoned' : 'away') || r.view.join() !== want || !r.restOnGrid) fail(label, `returned ${r.returned}, root ${r.rootView}, view ${r.view}, rest ${r.rest}; not ${want} on the grid`);
    if (errors.length > 0) fail(label, `page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    // Under Reduce Motion the summon, the dismiss, an arrow key and a step-aside land at once (at most two places drawn per page),
    // still keep-still and on the grid (the `step` checks).
    const places = (fr: any[], id: string): number => new Set(fr.map((f: any) => f.named[id]?.x).filter((x: any) => x !== undefined).map((x: number) => Math.round(x))).size;
    const { page, errors, close } = await open(row, 1800, 900, '&bar=0', ENGINE, { reducedMotion: 'reduce' });
    if (!(await placeRoot(page, 8))) empty.push('summon reduced: the root could not be placed');
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    const s = await step(page, 'reducedSummon', () => g(page, 'summon'), ['p15', 'p16', 'p17']);
    s.rootPlaces = places(lastStep!.fr, 'root');
    const d = await step(page, 'reducedDismiss', () => g(page, 'dismiss'), ['p15', 'p16', 'p17']);
    d.rootPlaces = places(lastStep!.fr, 'root');
    await page.mouse.click(5, 5);
    const k = await step(page, 'reducedArrow', () => page.keyboard.press('ArrowRight'), []);
    k.p16Places = places(lastStep!.fr, 'p16');
    if (s.rootView !== 'summoned' || s.rootX !== 0 || d.rootView !== 'away' || d.visibleAfter.join() !== 'p14,p15,p16,p17') fail('reduced', `summon ${s.rootView} at ${s.rootX}, dismiss ${d.rootView} view ${d.visibleAfter}`);
    if (s.rootPlaces > 2 || d.rootPlaces > 2) fail('reduced', `the root glided under Reduce Motion (${s.rootPlaces} places on the summon, ${d.rootPlaces} on the dismiss)`);
    if (k.p16Places > 2 || Math.abs(k.rest - 15 * PITCH) > 0.5) fail('reduced', `an arrow key glided under Reduce Motion (p16 at ${k.p16Places} places), rest ${k.rest}`);
    if (s.frames < 10 || k.frames < 10) empty.push('summon reduced: too few frames recorded');
    res.reduced = { summon: s, dismiss: d, arrow: k };
    if (errors.length > 0) fail('reduced', `page errors ${errors.join(' | ')}`);
    await close();
    const a = await open('3,1,1,1,1,1,1,1', 1800, 900, '', ENGINE, { reducedMotion: 'reduce' });
    const ar = await step(a.page, 'reducedAside', () => a.page.setViewportSize({ width: 1400, height: 900 }), []);
    ar.p1Places = places(lastStep!.fr, 'p1');
    const ma = await shown(a.page);
    if (ma.root !== undefined || ma.p1?.x !== 0) empty.push('summon reducedAside: the root did not step aside, so this proved nothing');
    if (ar.p1Places > 2) fail('reducedAside', `the step-aside glided under Reduce Motion (p1 at ${ar.p1Places} places)`);
    res.reducedAside = ar;
    if (a.errors.length > 0) fail('reducedAside', `page errors ${a.errors.join(' | ')}`);
    await a.close();
  }
  {
    // A root brought back by a wheel toward it stays when a far page closes: only a window, size or neighbor change steps it aside.
    const { page, errors, close } = await open('3,1,1,1,1,1,1,1');
    await page.setViewportSize({ width: 1400, height: 900 });
    await sleep(1000);
    await page.mouse.move(700, 400);
    for (let k = 0; k < 30; k += 1) {
      await page.mouse.wheel(-12, 0);
      await sleep(16);
    }
    await sleep(1500);
    const back = await shown(page);
    if (back.root?.x !== 0) empty.push(`summon unrelatedClose: the wheel did not bring the root back (root at ${back.root?.x}), so this proved nothing`);
    const r = await step(page, 'unrelatedClose', async () => g(page, 'op', 'close', await g(page, 'idOf', 'p8')), ['root', 'p1']);
    res.unrelatedClose = r;
    if (r.rootView !== 'shown' || r.rootX !== 0) fail('unrelatedClose', `root ${r.rootView} at ${r.rootX}: a far page closing stepped the root aside again`);
    if (errors.length > 0) fail('unrelatedClose', `page errors ${errors.join(' | ')}`);
    await close();
  }
  out.summon = res;
}

// Width changes and maximize on a row with more pages than fit (step 5): a page's width eases on the slide and Embla hears of it once.
if (ONLY.has('width') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const ROW = '1,1,2,1,3,1,1,2,1,1,1,1';
  const fail = (label: string, why: string): void => void failed.push(`width ${label}: ${why}`);
  const visibleAt = (f: any): string[] => Object.entries(f.drawn as Record<string, { x: number; w: number }>).filter(([, v]) => v.x > -v.w + 1 && v.x < f.winW - 1).sort((a, b) => a[1].x - b[1].x).map(([id]) => id);
  // One width change, measured per frame: `still` are pages that must not move on screen, `page` the one changing, `edge` the edge of it
  // that moves; pages after it in view must stay one gap from its drawn right edge (no blank, no overlap).
  const measure = (label: string, fr: any[], o: { still: string[]; page: string; edge: 'left' | 'right' | null; followers: string[]; pitch: number; max: number; restAt?: number }): Record<string, unknown> => {
    const first = fr[0];
    const last = fr[fr.length - 1];
    const worstStill = Math.max(0, ...o.still.flatMap((id) => fr.map((f: any) => Math.abs((f.drawn[id]?.x ?? Number.NaN) - first.drawn[id].x))));
    // The changing page's drawn width when the row itself moves (a glide or a wheel under the change), else the edge of it that moves.
    const edgeOf = (f: any): number => (o.edge === null ? f.drawn[o.page].w : o.edge === 'left' ? f.drawn[o.page].x : f.drawn[o.page].x + f.drawn[o.page].w);
    const edges = fr.map(edgeOf);
    const steps = edges.slice(1).map((e: number, k: number) => e - edges[k]!);
    const dir = Math.sign(edges[edges.length - 1]! - edges[0]!);
    const backSteps = steps.filter((d: number) => d * dir < -0.5).length;
    const moving = steps.map(Math.abs).filter((d: number) => d > 0.05);
    const k1 = steps.length - 1 - [...steps].reverse().findIndex((d: number) => Math.abs(d) > 0.05);
    const tail = steps.slice(Math.max(0, k1 - 2), k1 + 1).map(Math.abs);
    const median = moving.length === 0 ? 0 : [...moving].sort((a, b) => a - b)[Math.floor(moving.length / 2)]!;
    const endJump = tail.length === 0 ? 0 : Math.max(...tail);
    // A follower right of the page keeps one gap from its drawn right edge, one left of it from its drawn left edge.
    const gapOf = (f: any, id: string): number => (f.drawn[id].x > f.drawn[o.page].x ? f.drawn[id].x - (f.drawn[o.page].x + f.drawn[o.page].w) : f.drawn[o.page].x - (f.drawn[id].x + f.drawn[id].w)) - 16;
    // A follower off the strip in a frame (the root before it comes back) has no gap there; one never drawn proves nothing.
    for (const id of o.followers) if (!fr.some((f: any) => f.drawn[id] !== undefined)) empty.push(`width ${label}: follower ${id} never drawn`);
    const worstGap = Math.max(0, ...o.followers.flatMap((id) => fr.filter((f: any) => f.drawn[id] !== undefined).map((f: any) => Math.abs(gapOf(f, id)))));
    // A one-slot page cut by the window while the row stands on the grid and the page stands still (one gliding across the edge is
    // the glide itself; a wheel or a glide between rests cuts pages by nature), or at the rest.
    const cut = fr.filter((f: any, k: number) => {
      if (k < fr.length - 1 && !onGrid(f.pos, o.pitch, o.max)) return false;
      const still = Object.fromEntries(Object.entries(f.drawn as Record<string, { x: number; w: number }>).filter(([id, v]) => k === fr.length - 1 || (k > 0 && Math.abs(v.x - (fr[k - 1].drawn[id]?.x ?? Number.NaN)) <= 0.5)));
      return cutNarrow({ panels: still, winW: f.winW }, 390).length > 0;
    }).length;
    const r = { frames: fr.length, posBefore: +first.pos.toFixed(1), posAfter: +last.pos.toFixed(1), restOnGrid: onGrid(last.pos, o.pitch, o.max), worstStillPx: +worstStill.toFixed(2), edgeTravel: +(edges[edges.length - 1]! - edges[0]!).toFixed(1), edgeBackSteps: backSteps, edgeKind: o.edge ?? 'width', edgeMedianStep: +median.toFixed(2), edgeEndJump: +endJump.toFixed(2), worstFollowerGapPx: +worstGap.toFixed(2), framesWithNarrowCut: cut, viewBefore: visibleAt(first).join(','), viewAfter: visibleAt(last).join(','), ...(process.env.DUMP ? { series: fr.map((f: any) => [Math.round(f.t), +f.pos.toFixed(1), ...Object.entries(f.drawn).filter(([, v]: any) => v.x > -v.w && v.x < f.winW).map(([i, v]: any) => `${i}:${v.x}/${v.w}`)].join(' ')) } : {}) };
    // Under a glide or a wheel the row moves one way only: a frame stepping back is the row thrown back.
    const posSteps = fr.slice(1).map((f: any, k: number) => f.pos - fr[k].pos);
    const posDir = Math.sign(last.pos - first.pos);
    const posBack = o.edge === null ? Math.min(0, ...posSteps.map((d: number) => d * posDir)) : 0;
    Object.assign(r, { posWorstBack: +posBack.toFixed(2) });
    if (posBack < -1) fail(label, `the row stepped back ${posBack.toFixed(1)} px under the change`);
    if (o.restAt !== undefined && Math.abs(last.pos - o.restAt) > 0.5) fail(label, `rests at ${last.pos.toFixed(1)}, not ${o.restAt}`);
    if (fr.length < 20) empty.push(`width ${label}: ${fr.length} frames`);
    if (Math.abs(r.edgeTravel) < 100) empty.push(`width ${label}: the page's ${o.edge ?? 'width'} moved ${r.edgeTravel} px, so this proved nothing`);
    if (worstStill > 0.5) fail(label, `a page in view that is not changing moved ${worstStill.toFixed(1)} px`);
    if (backSteps > 0) fail(label, `the changing page's ${o.edge ?? 'width'} stepped back in ${backSteps} frames`);
    const worstStep = Math.max(0, ...steps.map(Math.abs));
    Object.assign(r, { edgeWorstStep: +worstStep.toFixed(2) });
    if (worstStep > Math.abs(r.edgeTravel) / 4) fail(label, `the changing page's ${o.edge ?? 'width'} jumped ${worstStep.toFixed(1)} px in one frame of ${Math.abs(r.edgeTravel)}`);
    if (endJump > Math.max(3 * median, 4)) fail(label, `the changing page snapped at the end: ${endJump.toFixed(1)} px in one of its last 3 frames, median ${median.toFixed(1)}`);
    if (worstGap > 1) fail(label, `a page after it left a blank or overlapped it by ${worstGap.toFixed(1)} px`);
    if (cut > 0) fail(label, `${cut} frames cut a one-slot page`);
    if (!r.restOnGrid) fail(label, `rest ${r.posAfter} off the grid`);
    return r;
  };
  const run = async (label: string, slot: number, act: (page: Page, id: (n: string) => Promise<string>) => Promise<void>, o: Omit<Parameters<typeof measure>[2], 'pitch' | 'max'> & { row?: string; before?: (page: Page) => Promise<void> }): Promise<void> => {
    const { page, errors, close } = await open(o.row ?? ROW);
    if (o.before !== undefined) await o.before(page);
    else {
      await g(page, 'jumpToSlot', slot);
      await sleep(500);
    }
    await g(page, 'record');
    await nextFrame(page);
    await nextFrame(page);
    await act(page, (n) => g(page, 'idOf', n));
    await sleep(250);
    await page.screenshot({ path: join(OUT, `width-${label}-mid.png`) });
    await sleep(1000);
    const fr = await g(page, 'stop');
    res[label] = measure(label, fr, { ...o, pitch: 406, max: await g(page, 'max') });
    await page.screenshot({ path: join(OUT, `width-${label}-rest.png`) });
    if (errors.length > 0) fail(label, `page errors ${errors.join(' | ')}`);
    await close();
  };
  // Strip: root, p1 (1), p2 (1), p3 (2), p4 (1), p5 (3), p6 (1), p7 (1), p8 (2), p9..p12 (1); a window of four slots.
  // At slot 2 the view is p2, p3, p4.
  await run('growInView', 2, async (page, id) => g(page, 'op', 'setSlots', await id('p4'), 2), { still: ['p2', 'p3'], page: 'p4', edge: 'right', followers: [] });
  await run('shrinkInView', 2, async (page, id) => g(page, 'op', 'setSlots', await id('p3'), 1), { still: ['p2'], page: 'p3', edge: 'right', followers: ['p4'] });
  await run('growLeftEdge', 2, async (page, id) => g(page, 'op', 'setSlots', await id('p2'), 2), { still: [], page: 'p2', edge: 'right', followers: ['p3'] });
  // At the strip's end (17 slots, rest 13: p9..p12) the strip cannot keep the left edge: a shrink in view holds the right end, the
  // page's left edge eases right and the pages left of it with it. Rest 12 shows p8 (2), p9, p10.
  // A two-slot page cut by the window's left edge (rest 12: half of p8, p9, p10, p11) narrows: its left edge holds, so it leaves
  // the view and the pages after it slide over, one gap behind its right edge.
  await run('shrinkCutLeftEdge', 12, async (page, id) => g(page, 'op', 'setSlots', await id('p8'), 1), { still: [], page: 'p8', edge: 'right', followers: ['p9'] });
  // Rows ending in the view's pages, resting at the strip's end: a narrower page there shortens the strip under the view, so the
  // view cannot keep its left edge. The right end holds: pages right of the page stay, its left edge eases right, pages left of it
  // follow one gap behind. End rest of '1,1,2,1,3,1,1,2,1,1' is 11 (p8 (2), p9, p10); of '...,1,2,1' it is 12 (p10, p11 (2), p12).
  await run('shrinkLeftEdgeAtEnd', 11, async (page, id) => g(page, 'op', 'setSlots', await id('p8'), 1), { still: ['p9', 'p10'], page: 'p8', edge: 'left', followers: ['p7'], row: '1,1,2,1,3,1,1,2,1,1' });
  await run('shrinkMiddleAtEnd', 13, async (page, id) => g(page, 'op', 'setSlots', await id('p11'), 1), { still: ['p12'], page: 'p11', edge: 'left', followers: ['p10'], row: '1,1,2,1,3,1,1,1,1,1,2,1' });
  // Mid-glide: ArrowRight from rest 2 glides to 3; 150 ms in, a page in view grows. The glide goes on to the grid, nothing in view is thrown back.
  await run('growMidGlide', 2, async (page, id) => {
    await page.mouse.click(5, 5);
    await page.keyboard.press('ArrowRight');
    await sleep(150);
    await g(page, 'op', 'setSlots', await id('p4'), 2);
  }, { still: [], page: 'p4', edge: null, followers: ['p5'], restAt: 3 * 406 });
  // Mid-wheel: a steady wheel stream from rest 0; 0.6 s in, a page in view grows. The gesture goes on and nothing throws the row back.
  await run('growMidWheel', 0, async (page, id) => {
    await page.mouse.move(900, 400);
    const t0 = Date.now();
    let acted = false;
    while (Date.now() - t0 < 1400) {
      await page.mouse.wheel(12, 0);
      if (!acted && Date.now() - t0 > 600) {
        acted = true;
        await g(page, 'op', 'setSlots', await id('p3'), 3);
      }
      await sleep(16);
    }
  }, { still: [], page: 'p3', edge: null, followers: ['p4'] });
  // With the Workspace summoned (rest 9: p6, p7, p8 (2); the summon puts the root in p6's slot), a page in view grows: the root and
  // the page before it stay, the summon stands.
  await run('growSummoned', 9, async (page, id) => g(page, 'op', 'setSlots', await id('p7'), 2), {
    still: ['root'], page: 'p7', edge: 'right', followers: ['p8'],
    before: async (page) => {
      await g(page, 'jumpToSlot', 9);
      await sleep(500);
      await g(page, 'summon');
      await sleep(1200);
    },
  });
  // With the Workspace stepped aside (p1 picked four slots wide in a window of four), p1 narrows to two: its left edge holds and
  // the pages after it follow; the root does not jump in over it.
  await run('shrinkAside', 0, async (page, id) => g(page, 'op', 'setSlots', await id('p1'), 2), {
    still: [], page: 'p1', edge: 'right', followers: ['p2', 'root'], row: '2,1,1,1,1,1,1,1',
    before: async (page) => {
      await g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 4);
      await sleep(1200);
    },
  });
  // Maximize p3 in view (rest 2: p2, p3 (2), p4), a wheel stream and an arrow key while it fills the window, then restore: nothing
  // behind it moves, the restore lands in its slot with no snap, and the view is the one it left.
  {
    const { page, errors, close } = await open(ROW);
    await g(page, 'jumpToSlot', 2);
    await sleep(500);
    const before = { pos: await g(page, 'pos'), shown: await g(page, 'shown') };
    await g(page, 'record');
    await nextFrame(page);
    const grew = await g(page, 'toggleMax', 'p3');
    await sleep(200);
    await page.screenshot({ path: join(OUT, 'width-maximize-mid.png') });
    await sleep(700);
    const phaseGrown = await g(page, 'maxPhase', 'p3');
    await page.mouse.move(900, 400);
    for (let k = 0; k < 40; k += 1) {
      await page.mouse.wheel(12, 0);
      await sleep(16);
    }
    await page.keyboard.press('ArrowRight');
    await sleep(900);
    const posMaximized = await g(page, 'pos');
    await g(page, 'toggleMax', 'p3');
    await sleep(200);
    await page.screenshot({ path: join(OUT, 'width-restore-mid.png') });
    await sleep(1000);
    const fr = await g(page, 'stop');
    const after = { pos: await g(page, 'pos'), shown: await g(page, 'shown'), phase: await g(page, 'maxPhase', 'p3') };
    await page.screenshot({ path: join(OUT, 'width-restore-rest.png') });
    // The lifted panel's right edge on screen, frame by frame, and then its slot's: one series from grown to home.
    const k0 = fr.findIndex((f: any) => f.lifted === null && fr.indexOf(f) > 0 && fr[fr.indexOf(f) - 1].lifted !== null);
    const shrink = fr.slice(fr.findIndex((f: any, k: number) => k > 0 && f.lifted !== null && fr[k - 1].lifted !== null && f.lifted.w < fr[k - 1].lifted.w - 0.5) - 1);
    const rightOf = (f: any): number => (f.lifted !== null ? f.lifted.x + f.lifted.w - f.winLeft : f.drawn.p3.x + f.drawn.p3.w);
    const edges = shrink.map(rightOf);
    const steps = edges.slice(1).map((e: number, k: number) => e - edges[k]!);
    const moving = steps.map(Math.abs).filter((d: number) => d > 0.05);
    const median = moving.length === 0 ? 0 : [...moving].sort((a, b) => a - b)[Math.floor(moving.length / 2)]!;
    const k1 = steps.length - 1 - [...steps].reverse().findIndex((d: number) => Math.abs(d) > 0.05);
    const endJump = Math.max(0, ...steps.slice(Math.max(0, k1 - 2), k1 + 1).map(Math.abs));
    const behind = ['p2', 'p4'].flatMap((id) => fr.map((f: any) => Math.abs(f.drawn[id].x - fr[0].drawn[id].x)));
    const worstBehind = Math.max(0, ...behind);
    const r = { grew, phaseGrown, posBefore: before.pos, posMaximized: +posMaximized.toFixed(1), posAfter: +after.pos.toFixed(1), phaseAfter: after.phase, sameView: JSON.stringify(before.shown) === JSON.stringify(after.shown), worstBehindPx: +worstBehind.toFixed(2), shrinkFrames: edges.length, edgeMedianStep: +median.toFixed(2), edgeEndJump: +endJump.toFixed(2), landedAt: k0 };
    res.maximize = r;
    if (!grew || phaseGrown !== 'maximized') empty.push(`width maximize: p3 never filled the window (${grew}, ${phaseGrown})`);
    if (edges.length < 10) empty.push(`width maximize: ${edges.length} frames of the restore`);
    if (worstBehind > 0.5) fail('maximize', `a page behind the maximized one moved ${worstBehind.toFixed(1)} px`);
    if (Math.abs(posMaximized - before.pos) > 0.5) fail('maximize', `a wheel or a key moved the row behind the maximized page (${before.pos} > ${posMaximized.toFixed(1)})`);
    if (!r.sameView || Math.abs(after.pos - before.pos) > 0.5 || after.phase !== 'home') fail('maximize', `the restore did not return to the view it left (${before.pos} > ${after.pos.toFixed(1)}, ${after.phase})`);
    if (endJump > Math.max(3 * median, 4)) fail('maximize', `the restore snapped at the end: ${endJump.toFixed(1)} px in one of its last 3 frames, median ${median.toFixed(1)}`);
    if (errors.length > 0) fail('maximize', `page errors ${errors.join(' | ')}`);
    await close();
  }
  out.width = res;
}

// Blank pages in view on a parking row (the audit: at maxLivePanels equal to the window's fit, a far dot press drew an unloaded
// placeholder in the window in 4 of 91 frames). Pixels of every presented frame, and the DOM of every animation frame.
if (ONLY.has('blank') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const decoder = await (await browser.newContext({ viewport: { width: 200, height: 200 } })).newPage();
  await decoder.goto('about:blank');
  // The widest band of window columns, in CSS px, where at least 90% of the sampled rows are page magenta.
  const widestBlank = (png: string, viewW: number, box: { left: number; width: number; top: number; bottom: number }): Promise<number> =>
    decoder.evaluate(async ([b64, vw, b]: [string, number, { left: number; width: number; top: number; bottom: number }]) => {
      const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bm.width, bm.height);
      const x = c.getContext('2d')!;
      x.drawImage(bm, 0, 0);
      const d = x.getImageData(0, 0, bm.width, bm.height).data;
      const k = bm.width / vw;
      let run = 0;
      let best = 0;
      for (let cx = b.left + 2; cx < b.left + b.width - 2; cx += 4) {
        let mag = 0;
        let n = 0;
        for (let cy = b.top + 30; cy < b.bottom - 30; cy += 20) {
          const i = (Math.round(cy * k) * bm.width + Math.round(cx * k)) * 4;
          n += 1;
          if (d[i]! > 240 && d[i + 1]! < 15 && d[i + 2]! > 240) mag += 1;
        }
        run = n > 0 && mag / n >= 0.9 ? run + 4 : 0;
        best = Math.max(best, run);
      }
      return best;
    }, [png, viewW, box] as [string, number, { left: number; width: number; top: number; bottom: number }]);
  const acts: Record<string, (page: Page) => Promise<void>> = {
    dotFar: async (page) => {
      await page.click(`[data-dot="${await g(page, 'idOf', 'p20')}"]`);
      await sleep(1500);
    },
    jumpFar: async (page) => {
      await g(page, 'jumpToSlot', 18);
      await sleep(700);
      await g(page, 'jumpToSlot', 2);
      await sleep(700);
    },
    wheelFling: async (page) => {
      await page.mouse.move(900, 400);
      for (let k = 0; k < 20; k += 1) {
        await page.mouse.wheel(60, 0);
        await sleep(16);
      }
      await sleep(1500);
    },
    summon: async (page) => {
      await g(page, 'summon');
      await sleep(1200);
    },
  };
  let controlSeen = 0;
  for (const cap of [8, 4]) {
    // The defect showed in one or two frames of a glide, so the far dot press runs three times at the cap that fits the window.
    const runs = [...Object.entries(acts), ...(cap === 4 ? [['dotFar2', acts.dotFar!], ['dotFar3', acts.dotFar!]] : [])] as [string, (page: Page) => Promise<void>][];
    for (const [name, act] of runs) {
      for (const cond of ['row', 'hidden'] as const) {
        // The control: every slot hidden, a row known to be blank, which the pixel measure must see.
        if (cond === 'hidden' && (cap !== 8 || name !== 'dotFar')) continue;
        const { page, errors, close } = await open(Array(24).fill(1).join(','), 1800, 900, `&park=1&cap=${cap}&bar=0&bg=1`);
        if (name === 'summon') {
          for (let k = 0; k < 8; k += 1) {
            await g(page, 'op', 'move', await g(page, 'idOf', 'root'), 'right');
            await sleep(80);
          }
          await g(page, 'jumpToSlot', 14);
          await sleep(900);
        }
        if (cond === 'hidden') await page.addStyleTag({ content: '[data-row-slot]{visibility:hidden !important}' });
        const win = await g(page, 'win');
        const slot = await page.evaluate(() => { const r = document.querySelector('[data-row-slot]')!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
        const box = { left: win.left, width: win.width, top: slot.top, bottom: slot.bottom };
        const cdp = await page.context().newCDPSession(page);
        const shots: string[] = [];
        cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
          shots.push(f.data);
          void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        });
        await g(page, 'record');
        await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        await act(page);
        await cdp.send('Page.stopScreencast');
        const fr = await g(page, 'stop');
        const widths: number[] = [];
        for (const png of shots) widths.push(await widestBlank(png, 1800, box));
        const blankShots = widths.filter((w) => w >= 100).length;
        const domBlank = fr.filter((f: any) => f.blankIn.length > 0);
        const moved = new Set(fr.map((f: any) => Math.round(f.pos))).size;
        const r = { shots: shots.length, blankShots, widestBlankPx: Math.max(0, ...widths), frames: fr.length, domBlankFrames: domBlank.length, domBlankIds: [...new Set(domBlank.flatMap((f: any) => f.blankIn))].slice(0, 8), positions: moved, unloadedAtEnd: fr.length > 0 ? fr[fr.length - 1].unloaded : 0 };
        res[`${name}-cap${cap}-${cond}`] = r;
        // A jump presents a frame or two; a summon lands the row at once and glides the slots.
        if (shots.length < (name === 'jumpFar' ? 2 : 10) || fr.length < 10 || (moved < 2 && name !== 'summon')) empty.push(`blank ${name} cap ${cap} ${cond}: ${shots.length} presented frames, ${fr.length} animation frames, ${moved} row positions`);
        if (cond === 'hidden') {
          if (blankShots > 0) controlSeen += 1;
          else empty.push(`blank control ${name}: every page's content hidden and no presented frame read blank, so the measure cannot see a blank page`);
        } else {
          // A summon's edge page fades out while the root slides in from outside the window, which leaves a band of the page showing for
          // about 11 frames (e71796f and now alike): recorded, not failed, since no page there is unloaded (the DOM check below).
          if (blankShots > 0 && name !== 'summon') failed.push(`blank ${name} cap ${cap}: ${blankShots} of ${shots.length} presented frames show a page in the window painting nothing (widest ${r.widestBlankPx} px)`);
          if (domBlank.length > 0) failed.push(`blank ${name} cap ${cap}: an unloaded placeholder was drawn in the window in ${domBlank.length} of ${fr.length} frames (${r.domBlankIds})`);
        }
        if (errors.length > 0) failed.push(`blank ${name} cap ${cap}: page errors ${errors.join(' | ')}`);
        if (name === 'dotFar' && cond === 'row') await page.screenshot({ path: join(OUT, `blank-dotFar-cap${cap}.png`) });
        await close();
      }
    }
  }
  res.controlsThatSawBlank = controlSeen;
  out.blank = res;
}

if (ONLY.has('reorder') && ENGINE === 'embla') {
  const res: Record<string, any> = {};
  const PITCH = 406;
  const SLOTS24 = Array(24).fill(1).join(',');
  // 24 parkable one-slot pages after the root (25 slots), a window of four, cap 8: pages far from the view are unloaded placeholders.
  const QUERY = '&park=1&cap=8&grab=1';
  const stripXs = (f: any): Record<string, number> => Object.fromEntries(Object.entries(f.drawn as Record<string, { x: number }>).map(([n, d]) => [n, d.x + f.pos]));
  // Per frame: how far page `name` is drawn from where the pointer holds it (the pointer's offset into the page at the press).
  const driftOf = (fr: any[], name: string, offset: number): number => Math.max(0, ...fr.filter((f) => f.boxX?.[name] !== undefined).map((f) => Math.abs(f.pointerX - f.winLeft - offset - f.boxX[name])));
  const travelOf = (fr: any[]): number => (fr.length < 2 ? 0 : +(fr[fr.length - 1].pos - fr[0].pos).toFixed(1));
  const stillOf = (fr: any[]): number => fr.slice(1).filter((f, k) => Math.abs(f.pos - fr[k].pos) <= 0.01).length;
  // Along the strip, per page: the largest move between two frames. A page the drag neither carries nor crosses moves 0 px.
  const stripJumps = (fr: any[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let k = 1; k < fr.length; k += 1) {
      const a = stripXs(fr[k - 1]);
      const b = stripXs(fr[k]);
      for (const n of Object.keys(b)) if (a[n] !== undefined) out[n] = Math.max(out[n] ?? 0, +Math.abs(b[n]! - a[n]!).toFixed(2));
    }
    return out;
  };
  const press = async (page: Page, name: string): Promise<{ x: number; y: number; offset: number }> => {
    const at = await g(page, 'grabRect', name);
    const left = await g(page, 'boxLeft', name);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    return { ...at, offset: at.x - left };
  };
  const glideMouse = async (page: Page, from: { x: number; y: number }, toX: number, n = 12): Promise<void> => {
    for (let k = 1; k <= n; k += 1) {
      await page.mouse.move(from.x + ((toX - from.x) * k) / n, from.y);
      await sleep(16);
    }
  };
  // The order after `name` lands at strip index `k`, every other page in its old order.
  const orderWith = (order: string[], name: string, k: number): string[] => {
    const rest = order.filter((n) => n !== name);
    rest.splice(k, 0, name);
    return rest;
  };

  // 1. Held at the right edge for 1 s with no mouse motion, then held mid-row for 1 s (the control), then dropped.
  {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    const win = await g(page, 'win');
    const order0: string[] = await g(page, 'order');
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    const at = await press(page, 'p2');
    await glideMouse(page, at, win.left + win.width - 6);
    await sleep(120);
    const h0 = await g(page, 'mark');
    await sleep(500);
    await page.screenshot({ path: join(OUT, 'reorder-hold-mid.png') });
    await sleep(500);
    const h1 = await g(page, 'mark');
    await glideMouse(page, { x: win.left + win.width - 6, y: at.y }, win.left + win.width / 2 + 20, 6);
    await sleep(150);
    const m0 = await g(page, 'mark');
    await sleep(1000);
    const m1 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(1200);
    const fr = await g(page, 'stop');
    const hold = fr.slice(h0, h1);
    const mid = fr.slice(m0, m1);
    const released = fr[m1 - 1];
    const last = fr[fr.length - 1];
    const order1: string[] = await g(page, 'order');
    const max = await g(page, 'max');
    // Where the dragged page was drawn at the release, along the strip, gives the slot it must land in.
    const releasedStrip = released.boxX.p2 + released.pos;
    const landStrip = last.drawn.p2.x + last.pos;
    const expected = orderWith(order0, 'p2', Math.round(landStrip / PITCH));
    const involved = new Set(order0.slice(Math.min(order0.indexOf('p2'), order1.indexOf('p2')), Math.max(order0.indexOf('p2'), order1.indexOf('p2')) + 1));
    const jumps = stripJumps(fr);
    const uninvolved = Object.entries(jumps).filter(([n]) => !involved.has(n));
    const crossed = Object.entries(jumps).filter(([n]) => involved.has(n) && n !== 'p2');
    const r = {
      hold: { frames: hold.length, travelPx: travelOf(hold), stillFrames: stillOf(hold), worstDriftPx: +driftOf(hold, 'p2', at.offset).toFixed(2) },
      midControl: { frames: mid.length, travelPx: travelOf(mid), worstDriftPx: +driftOf(mid, 'p2', at.offset).toFixed(2) },
      uninvolvedMaxMovePx: Math.max(0, ...uninvolved.map(([, v]) => v)),
      crossed: crossed.length,
      crossedMaxFramePx: Math.max(0, ...crossed.map(([, v]) => v)),
      blankFrames: fr.filter((f: any) => f.blankIn.length > 0).length,
      blankIds: [...new Set(fr.flatMap((f: any) => f.blankIn))].slice(0, 6),
      emblaPressFrames: fr.filter((f: any) => f.emblaPress).length,
      emblaPointerDowns: (await g(page, 'emblaEvents')).pointerDown,
      rest: +last.pos.toFixed(1),
      restOnGrid: onGrid(last.pos, PITCH, max),
      releasedStripPx: +releasedStrip.toFixed(1),
      landedStripPx: +landStrip.toFixed(1),
      orderChanges: (await g(page, 'orderChanges')) - commits0,
      order: order1.slice(0, 12).join(','),
      orderAsLanded: order1.join(',') === expected.join(','),
      frames: fr.length,
    };
    res.edgeHold = r;
    if (r.hold.frames < 30 || r.midControl.frames < 30) empty.push(`reorder edgeHold: ${r.hold.frames} hold frames, ${r.midControl.frames} control frames`);
    if (r.midControl.travelPx !== 0) empty.push(`reorder edgeHold control: held mid-row the row moved ${r.midControl.travelPx} px, so travel at the edge says nothing`);
    if (!(r.hold.travelPx >= 400) || r.hold.stillFrames > 1) failed.push(`reorder edgeHold: held at the edge with no mouse motion the row moved ${r.hold.travelPx} px in 1 s (${r.hold.stillFrames} still frames of ${r.hold.frames})`);
    if (!(r.hold.travelPx >= 400) || r.hold.worstDriftPx > 0.5 || r.midControl.worstDriftPx > 0.5) failed.push(`reorder edgeHold: the dragged page drifts from the pointer by ${r.hold.worstDriftPx} px while the row scrolls ${r.hold.travelPx} px under it (${r.midControl.worstDriftPx} px mid-row)`);
    if (!(r.hold.travelPx >= 400) || r.uninvolvedMaxMovePx > 0.5 || r.crossed < 2 || r.crossedMaxFramePx > PITCH / 4) failed.push(`reorder edgeHold: pages not crossed moved ${r.uninvolvedMaxMovePx} px along the strip; ${r.crossed} crossed pages, worst frame ${r.crossedMaxFramePx} px`);
    if (!(r.hold.travelPx >= 400) || r.blankFrames > 0) failed.push(`reorder edgeHold: ${r.blankFrames} frames show an unloaded placeholder in the window (${r.blankIds}) over ${r.hold.travelPx} px of edge scroll`);
    if (r.emblaPressFrames > 0 || r.emblaPointerDowns > 0) failed.push(`reorder edgeHold: Embla's own drag fired during the reorder (${r.emblaPressFrames} frames pressed, ${r.emblaPointerDowns} pointerDown)`);
    if (!(r.hold.travelPx >= 400) || !r.restOnGrid || Math.abs(landStrip - releasedStrip) > PITCH / 2 || !r.orderAsLanded || r.orderChanges !== 1) failed.push(`reorder edgeHold drop: rest ${r.rest} (grid ${r.restOnGrid}), released at ${r.releasedStripPx} landed at ${r.landedStripPx}, order as landed ${r.orderAsLanded}, ${r.orderChanges} order commits`);
    if (errors.length > 0) failed.push(`reorder edgeHold: page errors ${errors.join(' | ')}`);
    await page.screenshot({ path: join(OUT, 'reorder-hold-rest.png') });
    await close();
  }

  // 2. Escape mid-drag, after the edge has scrolled the row: the order, the row and every page return to where they were.
  {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    const win = await g(page, 'win');
    const order0: string[] = await g(page, 'order');
    const pos0 = await g(page, 'pos');
    const strip0 = await g(page, 'stripLefts');
    const commits0 = await g(page, 'orderChanges');
    const at = await press(page, 'p3');
    await glideMouse(page, at, win.left + win.width - 6);
    await sleep(600);
    const movedBefore = +((await g(page, 'pos')) - pos0).toFixed(1);
    await page.screenshot({ path: join(OUT, 'reorder-cancel-mid.png') });
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.mouse.up();
    await sleep(400);
    const strip1 = await g(page, 'stripLefts');
    const back = Math.max(0, ...Object.keys(strip0).map((id) => Math.abs((strip1[id] ?? Number.NaN) - strip0[id]!)));
    const r = { movedBeforePx: movedBefore, rowAfter: +(await g(page, 'pos')).toFixed(1), rowBefore: pos0, worstPageOffPx: +back.toFixed(2), orderSame: (await g(page, 'order')).join(',') === order0.join(','), orderChanges: (await g(page, 'orderChanges')) - commits0 };
    res.cancel = r;
    if (!(r.movedBeforePx >= 200) || Math.abs(r.rowAfter - pos0) > 0.5 || !(r.worstPageOffPx <= 0.5) || !r.orderSame || r.orderChanges !== 0) failed.push(`reorder cancel: the row moved ${r.movedBeforePx} px before Escape; after it rests at ${r.rowAfter} (was ${pos0}), a page is ${r.worstPageOffPx} px off its place, order same ${r.orderSame}, ${r.orderChanges} commits`);
    if (errors.length > 0) failed.push(`reorder cancel: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 3. A drop into the window's left-edge slot, no edge scroll: the view stays where it was and the page lands where it was let go.
  {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await g(page, 'jumpToSlot', 5);
    await sleep(500);
    const win = await g(page, 'win');
    const order0: string[] = await g(page, 'order');
    const pos0 = await g(page, 'pos');
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    const at = await press(page, 'p7');
    // Two slots left, which stays out of the left band: the row must not scroll.
    await glideMouse(page, at, at.x - 2 * PITCH);
    await sleep(200);
    await page.screenshot({ path: join(OUT, 'reorder-leftEdge-mid.png') });
    const k0 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(1000);
    const fr = await g(page, 'stop');
    const drop = fr.slice(k0);
    const last = fr[fr.length - 1];
    const others = Object.entries(stripJumps(drop)).filter(([n]) => n !== 'p7');
    const r = { rowBefore: pos0, rowAfter: +last.pos.toFixed(1), rowMaxMovePx: Math.max(0, ...drop.map((f: any) => Math.abs(f.pos - pos0))), p7ScreenX: +last.drawn.p7.x.toFixed(1), othersMaxMoveAfterDropPx: Math.max(0, ...others.map(([, v]) => v)), orderAsExpected: (await g(page, 'order')).join(',') === orderWith(order0, 'p7', 5).join(','), orderChanges: (await g(page, 'orderChanges')) - commits0, winLeft: win.left };
    res.leftEdgeDrop = r;
    if (r.rowMaxMovePx > 0.5 || Math.abs(r.p7ScreenX) > 0.5 || r.othersMaxMoveAfterDropPx > 0.5 || !r.orderAsExpected || r.orderChanges !== 1) failed.push(`reorder leftEdgeDrop: the row moved ${r.rowMaxMovePx} px at the drop (${pos0} > ${r.rowAfter}), p7 rests at ${r.p7ScreenX} (want 0), other pages moved ${r.othersMaxMoveAfterDropPx} px after the drop, order ${r.orderAsExpected}, ${r.orderChanges} commits`);
    if (errors.length > 0) failed.push(`reorder leftEdgeDrop: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 4. Keys on the grab strip: ArrowRight moves the page one place and leaves the row where it is; a page moved out of view comes into it.
  {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    const order0: string[] = await g(page, 'order');
    await page.focus('[data-grab="p1"]');
    await page.keyboard.press('ArrowRight');
    await sleep(700);
    const inView = { pos: await g(page, 'pos'), order: (await g(page, 'order')).join(',') === orderWith(order0, 'p1', 2).join(',') };
    const order1: string[] = await g(page, 'order');
    // p3 is the window's right-edge page now (root, p2, p1, p3): one place right takes it out of view.
    await page.focus('[data-grab="p3"]');
    await page.keyboard.press('ArrowRight');
    await sleep(900);
    const shown = await g(page, 'shown');
    const p3 = shown.find((s: any) => s.id === 'p3');
    const win = await g(page, 'win');
    const max = await g(page, 'max');
    const pos = await g(page, 'pos');
    const r = { firstPress: { rowAfter: inView.pos, orderAsExpected: inView.order }, outOfView: { orderAsExpected: (await g(page, 'order')).join(',') === orderWith(order1, 'p3', 4).join(','), p3x: p3?.x, whole: p3 !== undefined && p3.x >= -0.5 && p3.x + p3.w <= win.width + 0.5, rowAfter: +pos.toFixed(1), onGrid: onGrid(pos, PITCH, max) } };
    res.keys = r;
    if (Math.abs(r.firstPress.rowAfter) > 0.5 || !r.firstPress.orderAsExpected) failed.push(`reorder keys: ArrowRight on p1's grab strip gave order ${r.firstPress.orderAsExpected}, row at ${r.firstPress.rowAfter} (want 0)`);
    if (!r.outOfView.orderAsExpected || !r.outOfView.whole || !r.outOfView.onGrid) failed.push(`reorder keys: p3 moved out of view: order ${r.outOfView.orderAsExpected}, drawn at ${r.outOfView.p3x} (whole ${r.outOfView.whole}), row ${r.outOfView.rowAfter} on grid ${r.outOfView.onGrid}`);
    if (errors.length > 0) failed.push(`reorder keys: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 5. The root's rules: p1 dragged a slot and a half left, over the root, lands where the own row lands it.
  {
    const orders: Record<string, string> = {};
    for (const engine of ['embla', 'own']) {
      // No parking here: the own row parks a page at the cap, and the reference must draw all 25 slots as the Embla row does.
      const { page, close } = await open(SLOTS24, 1800, 900, '&grab=1', engine);
      const at = await press(page, 'p1');
      await glideMouse(page, at, at.x - 1.5 * PITCH);
      await sleep(200);
      await page.mouse.up();
      await sleep(900);
      orders[engine] = (await g(page, 'order')).slice(0, 4).join(',');
      await close();
    }
    res.rootRule = orders;
    if (orders.embla !== orders.own) failed.push(`reorder rootRule: p1 dragged over the root lands ${orders.embla} on Embla, ${orders.own} on the own row`);
  }

  // 6. Reduce Motion: the edge hold jumps rest to rest, the page stays under the pointer, the drop lands at once on the grid.
  {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY, ENGINE, { reducedMotion: 'reduce' });
    const win = await g(page, 'win');
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    const at = await press(page, 'p2');
    await glideMouse(page, at, win.left + win.width - 6);
    await sleep(100);
    const h0 = await g(page, 'mark');
    await sleep(1200);
    const h1 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(800);
    const fr = await g(page, 'stop');
    const hold = fr.slice(h0, h1);
    const after = fr.slice(h1);
    const movesHold = hold.slice(1).filter((f: any, k: number) => Math.abs(f.pos - hold[k].pos) > 0.01).length;
    const settleFrames = after.slice(1).filter((f: any, k: number) => Math.abs(f.pos - after[k].pos) > 0.01).length;
    const last = fr[fr.length - 1];
    const r = { holdTravelPx: travelOf(hold), holdMovingFrames: movesHold, worstDriftPx: +driftOf(hold, 'p2', at.offset).toFixed(2), settleMovingFrames: settleFrames, rest: +last.pos.toFixed(1), restOnGrid: onGrid(last.pos, PITCH, await g(page, 'max')), orderChanges: (await g(page, 'orderChanges')) - commits0, blankFrames: fr.filter((f: any) => f.blankIn.length > 0).length };
    res.reduced = r;
    if (!(r.holdTravelPx >= PITCH) || r.holdMovingFrames > 3 || r.worstDriftPx > 0.5 || r.settleMovingFrames > 2 || !r.restOnGrid || r.orderChanges !== 1 || r.blankFrames > 0) failed.push(`reorder reduced: hold moved ${r.holdTravelPx} px in ${r.holdMovingFrames} frames (want jumps of a slot), drift ${r.worstDriftPx} px, ${r.settleMovingFrames} frames of settle, rest ${r.rest} grid ${r.restOnGrid}, ${r.orderChanges} commits, ${r.blankFrames} blank frames`);
    if (errors.length > 0) failed.push(`reorder reduced: page errors ${errors.join(' | ')}`);
    await close();
  }
  out.reorder = res;
}

await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
if (empty.length > 0) {
  console.error(`proved nothing: ${empty.join('; ')}`);
  process.exit(2);
}
process.exit(failed.length > 0 ? 1 : 0);
