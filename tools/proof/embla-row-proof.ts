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
 * settle (runs with gesture, or alone with --only settle) a mouse wheel's fast bursts with 80/150/300/600 ms pauses, one spin and a
 *        spin resumed mid-coast, a trackpad swipe with its momentum tail (flagged and not), and slow notches stopping just past and
 *        just before a stop: per frame, no move against the scroll, no reversal, the rest on the first stop ahead of the wheel's travel
 *        and its coast; a fast spin coasts past a stop, slow notches and a trackpad do not coast and slow notches move SLOW_SPEED px
 *        a wheel px; a burst that resumes mid-coast takes the glide's speed on (no brake, no lurch); settled within 1.8 s.
 *        The ends (settle.end*, settle.midHand): from mid-strip on a row of 25, notch bursts into the start or the end and on past it,
 *        by real (trusted) wheels with the hand's 1 px pointer moves or handed in; per frame the drawn row, Embla's location and
 *        target: the row rests at the end it was scrolled into, stops flat there (owner ruling 2026-11-09: no stretch past it, no
 *        spring back) and never moves back into the strip against the scroll. The family (settle.fam*): each trusted input a person
 *        makes during and right after a wheel burst (a mouse move of 0 px, a release, a press and a right-click away from the row, a
 *        right-click on it, a touch away from it) moves the row back 0 px and leaves it resting ahead of the scroll.
 * resize the window 1800 > 1400 > 2300 > 1800 > 1000 at rest: the panel at the window's left edge stays there, no one-slot panel is
 *        cut in any frame, and each rest is on the grid.
 * strip  a parking row (24 parkable panels, maxLivePanels 8): every panel has its slot (the own row, the control, parks some); a wheel
 *        stream moves it about 1:1 with no stalled frame while far panels unload and near ones load, and no panel moves along the
 *        strip in any frame; a near panel keeps its React state, a far one unloads and mounts again when it comes back; the loaded
 *        parkable panels never pass the cap; rowNearSlots 0 loads only what the window shows.
 * dots   the dot bar on the same parking row: one dot per panel, the oval over the panels in view; a fast oval drag keeps the oval
 *        within 2 px of the pointer in every frame (control: Embla's eased drag trails it); a dot press shows its panel; the pointer
 *        held past a clipped bar's end keeps the row moving every frame (control: held mid-bar, it stays).
 * summon the root as an ordinary page (owner ruling 2026-11-09) on a row of 25 slots: from far left and far right a summon moves it
 *        in the order next to the view (one order commit) and the glide brings it in; per frame every page in the window moves by the
 *        strip's one shift (nothing jumps or slides on its own), no frame jumps, no hole or unloaded placeholder in the window. It stays
 *        where it landed through scrolling away and back and a scrollTo; a summon with it in view does nothing; Reduce Motion lands
 *        at once; pressed mid-glide and mid-wheel it lands beside the view the row was heading for, on the grid.
 *
 * width  a row of 17 slots in a window of four: a page's width changes in view, at the window's left edge, cut by it, at the strip's
 *        end (where the view cannot keep its left edge and the right end holds instead), under an arrow-key glide and a wheel stream,
 *        beside the Workspace; per frame, pages that must stay move 0 px, the changing page's moving edge
 *        moves one way with no frame over a quarter of its travel and no end snap (largest of its last 3 frame steps against the
 *        median), its neighbors stay one gap from it, and no one-slot page is cut while the row stands on the grid. Maximize: a page
 *        grown over the row, a wheel stream and an arrow key, then the restore: nothing behind moves, the view is the one it left.
 *
 * blank  a parking row on a magenta page at maxLivePanels 8 and at 4 (what the window fits): a far dot press, a far jump, a wheel fling
 *        and a summon, every frame the compositor presents (screencast): no page in the window paints nothing (a magenta band at least
 *        100 px wide), and no unloaded placeholder is drawn in the window (the DOM, every animation frame). Control: the same runs with
 *        every page's content hidden must show blank frames, or the measure cannot see a blank page and proves nothing.
 *
 * inert  a row of 25 one-slot pages in a window of four: every slot drawn wholly outside the window is `inert` and every slot with
 *        any part inside it is not, in every presented frame (read after the frame is drawn) at rest, through a glide, a wheel stream,
 *        a mouse drag, a summon, a page moved out of view by its grab strip, and a far dot press; an inert page takes
 *        no focus; a page brought in by a dot press takes focus; a wide page cut by the edge comes in whole when it is focused.
 * open   a page opened at the strip's end with the Workspace in view: the row glides (no frame jumps a slot) to show it whole, on the
 *        grid, and carries the Workspace out; under Reduce Motion it lands at once; opened while a mouse drag holds the row, the row
 *        stays under the pointer until the release and then shows the page; opened mid-glide, it rests showing it on the grid.
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
import { FAST_SPEED, SLOW_SPEED } from '../../emblaWheelFeel.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const arg = (name: string): string | undefined => {
  const k = process.argv.indexOf(`--${name}`);
  return k < 0 ? undefined : process.argv[k + 1];
};
const ENGINE = arg('engine') === 'own' ? 'own' : 'embla';
const OUT = arg('out') ?? join(tmpdir(), 'embla-row-proof');
const ONLY = new Set((arg('only') ?? 'wheel,feed,drag,keys,change,gesture,resize,strip,dots,summon,width,blank,reorder,inert,open').split(','));
// `--cases a,b` runs only the named cases of a section (a case's name is in its `want(...)`); every case runs without it.
const CASES = arg('cases')?.split(',');
const want = (name: string): boolean => CASES === undefined || CASES.includes(name);
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

// Presented frames: every frame the compositor hands out (CDP screencast), which can differ from what the main thread lays out.
type Box = { left: number; width: number; top: number; bottom: number };
let pixelPage: Page | undefined;
// Each run of window columns (CSS px, 1 px apart) where at least 90% of the sampled rows are page magenta (`bg=1`): `at` from box.left.
const magentaRuns = async (png: string, viewW: number, box: Box): Promise<{ at: number; w: number }[]> => {
  if (pixelPage === undefined) {
    pixelPage = await (await browser.newContext({ viewport: { width: 200, height: 200 } })).newPage();
    await pixelPage.goto('about:blank');
  }
  return pixelPage.evaluate(async ([b64, vw, b]: [string, number, Box]) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const x = c.getContext('2d')!;
    x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, bm.height).data;
    const k = bm.width / vw;
    const runs: { at: number; w: number }[] = [];
    let start = -1;
    for (let cx = Math.ceil(b.left); cx <= b.left + b.width; cx += 1) {
      let mag = 0;
      let n = 0;
      for (let cy = b.top + 30; cy < b.bottom - 30; cy += 20) {
        const i = (Math.round(cy * k) * bm.width + Math.round(cx * k)) * 4;
        n += 1;
        if (d[i]! > 240 && d[i + 1]! < 15 && d[i + 2]! > 240) mag += 1;
      }
      const on = cx < b.left + b.width && n > 0 && mag / n >= 0.9;
      if (on && start < 0) start = cx;
      if (!on && start >= 0) {
        runs.push({ at: start - b.left, w: cx - start });
        start = -1;
      }
    }
    return runs;
  }, [png, viewW, box] as [string, number, Box]);
};
const castFrames = async (page: Page): Promise<{ shots: string[]; stop: () => Promise<void> }> => {
  const cdp = await page.context().newCDPSession(page);
  const shots: string[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    shots.push(f.data);
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return { shots, stop: async () => void (await cdp.send('Page.stopScreencast')) };
};
// The window's box, the slots' height (the rows a band is sampled over).
const slotBand = async (page: Page): Promise<Box> => {
  const win = await g(page, 'win');
  const slot = await page.evaluate(() => { const r = document.querySelector('[data-row-slot]')!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  return { left: win.left, width: win.width, top: slot.top, bottom: slot.bottom };
};

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
// Same speed over narrow, wide and mixed, and within the wheel's speed curve (SLOW_SPEED to FAST_SPEED row px per wheel px,
// emblaWheelFeel.ts): within 2% of each other at the curve's flat ends, 5% on its ramp, where each run's own wheel timing sets the
// rate (page.mouse.wheel lands about every 49 ms, two wheels in the rate's 100 ms).
function speedCheck(label: string, rows: Record<string, any>): void {
  const v = Object.values(rows).map((r) => r.pxPerInputPx as number);
  const spread = (Math.max(...v) - Math.min(...v)) / Math.max(...v);
  (rows as any).spread = +spread.toFixed(4);
  const flat = v.every((x) => Math.abs(x - SLOW_SPEED) <= 0.01 || Math.abs(x - FAST_SPEED) <= 0.01);
  if (spread > (flat ? 0.02 : 0.05)) failed.push(`${label}: narrow/wide/mixed spread ${(spread * 100).toFixed(1)}% > ${flat ? 2 : 5}%`);
  for (const [k, x] of Object.entries(v)) if (x < SLOW_SPEED - 0.03 || x > FAST_SPEED + 0.03) failed.push(`${label}: ${Object.keys(rows)[Number(k)]} moves ${x} px per input px, outside ${SLOW_SPEED}-${FAST_SPEED}`);
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
  // A faster wheel moves the row no less per wheel px (the speed curve: D6 and D12 both sit at its slow end), and D24, on its ramp,
  // further, on every row.
  for (const name of Object.keys(ROWS)) {
    const at = (D: number): number => (wheel[`D${D}`] as any)[name].pxPerInputPx;
    if (!(at(12) >= at(6) - 0.01 && at(24) >= at(12) - 0.01 && at(24) > at(6) + 0.02)) failed.push(`wheel ${name}: px per input px ${at(6)}, ${at(12)}, ${at(24)} at D6, D12, D24 does not rise with the wheel's speed`);
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
  if (want('keys.edgeFocus')) {
    // A bare arrow while the panel in use is out of view focuses the panel at the view's far edge and leaves the row where it is, as on
    // the own row (the app's "plain ArrowLeft/Right" hotkeys). The panel in use is p2, clicked, then scrolled out of view.
    const r: Record<string, unknown> = {};
    // Left lands on the rightmost panel in view and Right on the leftmost (`edgeSlotInView`, shared with the own row).
    for (const [key, edge] of [['ArrowRight', 'left'], ['ArrowLeft', 'right']] as const) {
      const { page, close } = await open(ROWS.narrow);
      const at = await page.evaluate(() => { const b = document.querySelector('[data-box="p2"]')!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.mouse.click(at.x, at.y);
      await g(page, 'jumpToSlot', 10);
      await sleep(900);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const pos0 = await g(page, 'pos');
      await page.keyboard.press(key);
      await sleep(900);
      const pos1 = await g(page, 'pos');
      const name = await page.evaluate(() => (document.activeElement?.closest('[data-row-slot]')?.querySelector('[data-box]') as HTMLElement | null)?.dataset.box ?? null);
      const shown: any[] = await g(page, 'shown');
      const win = await g(page, 'win');
      const inView = shown.filter((x) => x.x >= -1 && x.x + x.w <= win.width + 1).sort((a, b) => a.x - b.x).map((x) => x.id);
      const want = edge === 'right' ? inView[inView.length - 1] : inView[0];
      r[key] = { pos0: +pos0.toFixed(1), pos1: +pos1.toFixed(1), focused: name, want, inView: inView.join(), win: win.width, xs: shown.map((x) => `${x.id}@${Math.round(x.x)}`).slice(8, 16).join(" ") };
      if (Math.abs(pos1 - pos0) > 0.5 || name !== want) failed.push(`keys edgeFocus ${key}: row ${pos0.toFixed(1)} > ${pos1.toFixed(1)}, focus on ${name}, want ${want} at the ${edge} edge and the row still`);
      await close();
    }
    out.keysEdgeFocus = r;
  }
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
    await sleep(2200);
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
    await sleep(2200);
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

// A wheel or trackpad gesture that pauses or stops: realistic streams handed in on their own timers (a mouse wheel's 40 px notches,
// bursts with a finger lifted to reposition between them, a trackpad swipe with a momentum tail, a short scroll that stops just past
// or just before a stop). Per frame: the row never moves against the scroll (0 px backward past 0.5 px of subpixel noise, 0
// reversals), each burst moves the row as far as its input (1:1 while input flows), and the rest lands on the grid, ahead of the
// furthest point the wheel carried the row, within a bounded time after the last wheel.
if ((ONLY.has('gesture') || ONLY.has('settle')) && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const NOTCH = 40;
  const notches = (n: number, from: number, gap = 30): [number, number, boolean?][] => Array.from({ length: n }, (_, k) => [from + k * gap, NOTCH] as [number, number]);
  // Bursts of six notches 30 ms apart (one finger stroke, 240 px), then `pause` ms with the finger lifted, five times: the bursts end
  // 240, 480, 720, 960 and 1200 px in, on both sides of the stops at 406, 812 and 1218.
  const bursts = (pause: number): [number, number, boolean?][][] => Array.from({ length: 5 }, (_, b) => notches(6, b * (150 + pause)));
  // A trackpad: a slow swipe the finger stops before lifting (ramp, plateau, ease out), 150 ms to reposition, then a swipe lifted while
  // moving, whose momentum tail decays by 0.9 a frame (the plugin's momentum range) to under half a px.
  // `flagged`: the tail's events carry WheelEvent.momentum true, as Chromium marks a trackpad's momentum; without it the plugin must
  // guess the tail from its deceleration.
  type Wheel = [number, number, boolean?];
  const trackpad = (flagged: boolean): Wheel[][] => {
    const f = 16;
    const a: number[] = [2, 4, 6, 8, 10, 10, 10, 10, 10, 10, 10, 10, 8, 6, 4, 2, 1];
    const b: number[] = [3, 6, 10, 14, 18, 18, 18, 18, 18, 18];
    const tail: number[] = [];
    for (let d = 18 * 0.9; d >= 0.5; d *= 0.9) tail.push(+d.toFixed(2));
    const startB = a.length * f + 150;
    return [
      a.map((d, k): Wheel => [k * f, d]),
      [...b.map((d, k): Wheel => [startB + k * f, d]), ...tail.map((d, k): Wheel => (flagged ? [startB + (b.length + k) * f, d, true] : [startB + (b.length + k) * f, d]))],
    ];
  };
  // `fast`: a spin (a notch every 30 ms or faster), which coasts on once the wheel stops; between bursts (80 ms and longer) the next
  // burst resumes the gesture mid-coast. `slow`: a notch every 150 ms, which moves the row SLOW_SPEED px per wheel px and rests on the
  // first stop ahead of exactly that travel. `trackpad`: the browser's momentum is the coast, and none is added.
  type Kind = 'fast' | 'slow' | 'trackpad';
  const CASES_SETTLE: [string, Wheel[][], Kind][] = [
    ['notch80', bursts(80), 'fast'],
    ['notch150', bursts(150), 'fast'],
    ['notch300', bursts(300), 'fast'],
    ['notch600', bursts(600), 'fast'],
    ['spin', [notches(12, 0, 16)], 'fast'],
    ['spinResumed', [notches(10, 0, 16), notches(10, 144 + 150, 16)], 'fast'],
    ['trackpad', trackpad(true), 'trackpad'],
    ['trackpadGuessed', trackpad(false), 'trackpad'],
    // 21 and 19 slow notches: 420 and 380 px of travel, just past and just before the stop at 406.
    ['justPast', [notches(21, 0, 150)], 'slow'],
    ['justBefore', [notches(19, 0, 150)], 'slow'],
    // Two runs of slow notches with the finger lifted 400 ms between them (inside the 500 ms wait): one gesture, 400 px.
    ['slowPaused', [notches(10, 0, 150), notches(10, 1350 + 400, 150)], 'slow'],
  ];
  for (const [label, groups, kind] of CASES_SETTLE) {
    if (!want(`settle.${label}`)) continue;
    const { page, errors, close } = await open(ROWS.narrow);
    const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
    const events = groups.flat();
    const input = events.reduce((n, [, d]) => n + d, 0);
    await g(page, 'record');
    await sleep(100);
    const sent: { t0: number; sent: number[] } = await g(page, 'feedTimed', events, label.startsWith('trackpad'));
    await sleep(2500);
    const fr = await g(page, 'stop');
    const max = await g(page, 'max');
    const landing: { travel: number; coast: number } | null = await g(page, 'landing');
    writeFileSync(join(OUT, `settle-${label}-frames.json`), JSON.stringify({ events, sent, landing, frames: fr.map((f: any) => ({ t: +f.t.toFixed(1), pos: +f.pos.toFixed(2), tgt: f.tgt === null ? null : +f.tgt.toFixed(2), held: f.held, wheels: f.wheels, pd: f.pd, pm: f.pm, pu: f.pu, press: f.emblaPress })) }));
    const start = fr[0].pos;
    const moves = fr.slice(1).map((f: any, k: number) => f.pos - fr[k].pos);
    const back = moves.filter((m: number) => m < -0.5);
    let reversals = 0;
    let sign = 0;
    for (const m of moves) {
      if (Math.abs(m) <= 0.5) continue;
      if (sign !== 0 && Math.sign(m) !== sign) reversals += 1;
      sign = Math.sign(m);
    }
    // Each burst: the row's move from the last frame before its first wheel to the first frame 80 ms after its last, against its input.
    // A burst that starts while the settle glides (a pause longer than the hold) carries up to a frame of that glide; it is reported,
    // and checked only for moving one way.
    // A burst that starts while the row still moves (a coast) must take it on without a jump: the row's speed over the three frames
    // after the burst's first wheel against the three before (three, as Embla's fixed steps land 0 or 2 in some frames). A stop where drawn drops
    // it to what one wheel gives from rest; a lurch to the coast's target trebles it.
    let k0 = 0;
    const ratios: number[] = [];
    const fromGlide: number[] = [];
    const resumed: [number, number][] = [];
    for (const grp of groups) {
      const first = sent.sent[k0]!;
      const last = sent.sent[k0 + grp.length - 1]!;
      k0 += grp.length;
      const before = [...fr].reverse().find((f: any) => f.t < first);
      const after = fr.find((f: any) => f.t >= last + 80);
      if (before === undefined || after === undefined) continue;
      const k = fr.indexOf(before);
      if (k > 0 && Math.abs(before.pos - fr[k - 1].pos) > 0.5) {
        fromGlide.push(ratios.length);
        if (k > 2 && fr[k + 3] !== undefined) resumed.push([+((before.pos - fr[k - 3].pos) / 3).toFixed(1), +((fr[k + 3].pos - before.pos) / 3).toFixed(1)]);
      }
      ratios.push(+((after.pos - before.pos) / grp.reduce((n, [, d]) => n + d, 0)).toFixed(3));
    }
    const rest = fr[fr.length - 1].pos;
    const furthest = Math.max(...fr.map((f: any) => f.pos));
    const lastSent = sent.sent[sent.sent.length - 1]!;
    const unsettled = [...fr].reverse().find((f: any) => Math.abs(f.pos - rest) > 0.5);
    const r = {
      input: +input.toFixed(1),
      moved: +(rest - start).toFixed(1),
      backFrames: back.length,
      backPx: +(-back.reduce((n: number, m: number) => n + m, 0)).toFixed(1),
      worstBackPx: +(-Math.min(0, ...moves)).toFixed(2),
      reversals,
      burstPxPerInputPx: ratios,
      burstsFromGlide: fromGlide,
      rest: +rest.toFixed(1),
      furthest: +furthest.toFixed(1),
      restOnGrid: onGrid(rest, PITCH, max),
      settleMs: unsettled === undefined ? 0 : Math.max(0, Math.round(unsettled.t - lastSent)),
      kind,
      travel: landing === null ? null : +landing.travel.toFixed(1),
      coast: landing === null ? null : +landing.coast.toFixed(1),
      resumedStepPx: resumed,
    };
    res[label] = r;
    // The first stop at or past where the gesture's travel and its coast end (the row's ends clamp it).
    const aim = landing === null ? Number.NaN : Math.min(Math.max(0, landing.travel + landing.coast), max);
    const firstAhead = Math.min(max, Math.ceil((aim - 0.5) / PITCH) * PITCH);
    if (landing === null) empty.push(`settle ${label}: no wheel gesture landed`);
    else if (Math.abs(rest - firstAhead) > 0.5) failed.push(`settle ${label}: rests at ${r.rest}, not on ${firstAhead}, the first stop ahead of the travel ${r.travel} and its coast ${r.coast}`);
    if (kind === 'fast' && landing !== null && landing.coast < 200) failed.push(`settle ${label}: a fast spin coasted ${r.coast} px past its last wheel (under 200)`);
    // On the frames alone: a coast longer than a page rests at least a stop past the one the wheel's own travel would rest on.
    const wheelOnly = landing === null ? Number.NaN : Math.min(max, Math.ceil((landing.travel - 0.5) / PITCH) * PITCH);
    if (kind === 'fast' && wheelOnly < max && rest < wheelOnly + PITCH - 0.5) failed.push(`settle ${label}: rests at ${r.rest}, on the stop the wheel's travel ${r.travel} rests on without a coast (${wheelOnly})`);
    if (kind !== 'fast' && landing !== null && landing.coast !== 0) failed.push(`settle ${label}: a ${kind} gesture coasted ${r.coast} px (a coast of its own)`);
    if (kind === 'slow') {
      const travel = start + SLOW_SPEED * input;
      if (landing !== null && Math.abs(landing.travel - travel) > 0.5) failed.push(`settle ${label}: slow notches travelled to ${r.travel}, not ${travel} (${SLOW_SPEED} px per wheel px)`);
      for (const x of ratios) if (Math.abs(x - SLOW_SPEED) > 0.03) failed.push(`settle ${label}: slow notches moved ${x} px per wheel px (${ratios.join(', ')}), not ${SLOW_SPEED}`);
    }
    // No brake (the glide's speed dropped to what one wheel gives from rest) and no lurch (past the coast's speed and the spin's own).
    const heldStep = Math.max(0, ...fr.slice(1).map((f: any, k: number) => (f.held && fr[k].held ? f.pos - fr[k].pos : 0)));
    for (const [b, a] of resumed) if (a > Math.max(1.5 * b + 12, heldStep) || a < 0.6 * b - 3) failed.push(`settle ${label}: a burst resumed the gesture mid-glide with a jump: ${b} px a frame before its first wheel, ${a} px after (three-frame means)`);
    if (label === 'spinResumed' && resumed.length === 0) empty.push(`settle ${label}: the second spin did not start during the coast`);
    if (fr.length < 30 || Math.abs(rest - start) < 100) empty.push(`settle ${label}: the stream moved the row ${r.moved} px in ${fr.length} frames, so the checks prove nothing`);
    if (ratios.length !== groups.length) empty.push(`settle ${label}: ${ratios.length} of ${groups.length} bursts were measured`);
    if (r.worstBackPx > 0.5) failed.push(`settle ${label}: the row moved against the scroll in ${r.backFrames} frames, ${r.backPx} px in all (worst ${r.worstBackPx} px in one frame)`);
    if (reversals > 0) failed.push(`settle ${label}: the row reversed ${reversals} times`);
    if (!r.restOnGrid) failed.push(`settle ${label}: rest ${r.rest} off the grid`);
    if (rest < furthest - 0.5) failed.push(`settle ${label}: rests at ${r.rest}, behind ${r.furthest} where the scroll carried the row`);
    if (r.settleMs > 1800) failed.push(`settle ${label}: still moving ${r.settleMs} ms after the last wheel`);
    if (errors.length > 0) failed.push(`settle ${label}: page errors ${errors.join(' | ')}`);
    await close();
  }
  // The row's ends (the owner's report: wheeled left to the strip's first dot, stopped, and the row jumped about ten dots back to the
  // right). A row of 25 one-slot pages, from mid-strip, bursts of six notches with the finger lifted 80-600 ms between them, on past
  // the end (the row is already at it for the last bursts), then the wheel stops. `mouse`: a real mouse's wheel (trusted wheels at the
  // pointer) and the hand on it: the pointer moves 1 px in each pause and 200 ms after the last notch, as a hand on a mouse does.
  // Without it the wheels are handed in (feedRowWheel) and no pointer moves. `root`: where the Workspace stands (0: the strip's first
  // page, as it opens; 'far': moved to the other end). Per frame: the drawn row, Embla's location and target. The check: the row rests
  // at the end the scroll carried it into, and never moves back against the scroll.
  // `pauses` in turn between bursts: under 500 ms the whole scroll is one held gesture; 600 ms settles it between bursts.
  const ONE = [80, 300, 150, 450];
  const SOME = [80, 300, 150, 600];
  // `act`: the hand's action, a 1 px move unless said: 'move0' a move with no travel, 'up' a bare mouse button release (a button held
  // on a panel since before the wheel), 'downOut' a click away from the row, 'menuIn' / 'menuOut' a right-click on the row (a panel)
  // or away from it, 'touchOut' a touch moving away from the row. `late`: one more 700 ms after the last notch, while the row settles.
  type Act = 'move1' | 'move0' | 'up' | 'downOut' | 'menuIn' | 'menuOut' | 'touchOut';
  // `fling`: one spin that stops short of the end; its coast carries the row on into the end, where it stops flat.
  type EndCase = { dir: 1 | -1; from: number; bursts: number; pauses: number[]; mouse: boolean; inPauses: boolean; rootFar?: boolean; act?: Act; late?: boolean; fling?: boolean };
  // The trusted event each action must be seen to deliver, or the case proves nothing.
  const ACT_EVENT: Record<Act, string> = { move1: 'mousemove', move0: 'mousemove', up: 'mouseup', downOut: 'mousedown', menuIn: 'contextmenu', menuOut: 'contextmenu', touchOut: 'touchmove' };
  const FAMILY = (act: Act): EndCase => ({ dir: -1, from: 16, bursts: 4, pauses: SOME, mouse: true, inPauses: true, act, late: true });
  const CASES_END: [string, EndCase][] = [
    ['endLeftFeed', { dir: -1, from: 8, bursts: 18, pauses: SOME, mouse: false, inPauses: false }],
    ['endRightFeed', { dir: 1, from: -8, bursts: 18, pauses: SOME, mouse: false, inPauses: false }],
    ['endLeft', { dir: -1, from: 8, bursts: 18, pauses: ONE, mouse: true, inPauses: false }],
    ['endRight', { dir: 1, from: -8, bursts: 18, pauses: ONE, mouse: true, inPauses: false }],
    ['endLeftHand', { dir: -1, from: 8, bursts: 18, pauses: SOME, mouse: true, inPauses: true }],
    ['endLeftRootFar', { dir: -1, from: 8, bursts: 18, pauses: ONE, mouse: true, inPauses: false, rootFar: true }],
    // Ground on past the end long enough for the plugin's own rubber band (it damps its pointer back, then ends its gesture).
    ['endLeftLong', { dir: -1, from: 2, bursts: 30, pauses: [0], mouse: true, inPauses: false }],
    ['endFling', { dir: -1, from: 1, bursts: 1, pauses: [0], mouse: false, inPauses: false, fling: true }],
    ['endFlingRight', { dir: 1, from: -1, bursts: 1, pauses: [0], mouse: false, inPauses: false, fling: true }],
    ['midHand', { dir: -1, from: 16, bursts: 4, pauses: SOME, mouse: true, inPauses: true }],
    ['midUp', { dir: -1, from: 16, bursts: 4, pauses: SOME, mouse: true, inPauses: true, act: 'up' }],
    ['famMove0', FAMILY('move0')],
    ['famMove1', FAMILY('move1')],
    ['famUp', FAMILY('up')],
    ['famDownOut', FAMILY('downOut')],
    ['famMenuIn', FAMILY('menuIn')],
    ['famMenuOut', FAMILY('menuOut')],
    ['famTouchOut', FAMILY('touchOut')],
  ];
  for (const [label, c] of CASES_END) {
    if (!want(`settle.${label}`)) continue;
    const { page, errors, close } = await open(Array(24).fill(1).join(','));
    const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
    if (c.rootFar === true) {
      for (let k = 0; k < 24; k += 1) {
        await g(page, 'op', 'move', await g(page, 'idOf', 'root'), 'right');
        await sleep(60);
      }
      await sleep(600);
    }
    const order: string[] = await g(page, 'order');
    const max = await g(page, 'max');
    const startPx = c.from >= 0 ? c.from * PITCH : Math.min(max, Math.round((max + c.from * PITCH) / PITCH) * PITCH);
    await g(page, 'writeAt', startPx);
    await sleep(300);
    const end = c.dir < 0 ? 0 : max;
    const win = await g(page, 'win');
    const hand = { x: Math.round(win.left + win.width / 2), y: 300 };
    if (c.mouse) await page.mouse.move(hand.x, hand.y);
    await sleep(200);
    await g(page, 'record');
    await sleep(100);
    // The schedule, ms from the first notch: six notches 30 ms apart a burst, then the pause; the hand's 1 px moves.
    const wheels: [number, number][] = [];
    const handMoves: number[] = [];
    let at = 0;
    for (let b = 0; b < c.bursts; b += 1) {
      for (let k = 0; k < 6; k += 1) wheels.push([at + k * 30, c.dir * NOTCH]);
      at += 150;
      if (b === c.bursts - 1) break;
      const pause = c.pauses[b % c.pauses.length]!;
      if (c.inPauses) handMoves.push(at + pause / 2);
      at += pause;
    }
    if (c.mouse) handMoves.push(at + 200);
    if (c.late === true) handMoves.push(at + 700);
    const input = wheels.length * NOTCH;
    const act: Act = c.act ?? 'move1';
    const out: { x: number; y: number } | null = await g(page, 'outside');
    if ((act === 'downOut' || act === 'menuOut' || act === 'touchOut') && out === null) empty.push(`settle ${label}: no point away from the row to press`);
    const input0: Record<string, number> = await g(page, 'personInput');
    if (c.mouse) {
      // Trusted input through the DevTools protocol, each on its own node timer (an awaited page.mouse call takes a frame or more).
      const cdp = await page.context().newCDPSession(page);
      const sends: Promise<unknown>[] = [];
      await new Promise<void>((done) => {
        let left = wheels.length + handMoves.length;
        const fire = (ms: number, f: () => Promise<unknown>): void => void setTimeout(() => { sends.push(f()); if (--left === 0) done(); }, ms);
        for (const [ms, dx] of wheels) fire(ms, () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: hand.x, y: hand.y, deltaX: dx, deltaY: 0 }));
        const mouse = (type: string, p: { x: number; y: number }, button = 'left'): Promise<unknown> => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, clickCount: 1 });
        const click = async (p: { x: number; y: number }, button: string): Promise<void> => {
          await mouse('mousePressed', p, button);
          await mouse('mouseReleased', p, button);
        };
        const o = out ?? { x: 4, y: 4 };
        const touch = async (): Promise<void> => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: o.x + 30, y: o.y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        for (const ms of handMoves) fire(ms, () => {
          if (act === 'up') return mouse('mouseReleased', hand);
          if (act === 'downOut') return click(o, 'left');
          if (act === 'menuIn') return click(hand, 'right');
          if (act === 'menuOut') return click(o, 'right');
          if (act === 'touchOut') return touch();
          if (act === 'move1') hand.x += 1;
          return mouse('mouseMoved', hand, 'none');
        });
      });
      await Promise.all(sends);
    } else await g(page, 'feedTimed', wheels);
    await sleep(2500);
    const fr = await g(page, 'stop');
    const landing: { travel: number; coast: number } | null = await g(page, 'landing');
    const input1: Record<string, number> = await g(page, 'personInput');
    const delivered = (input1[ACT_EVENT[act]] ?? 0) - (input0[ACT_EVENT[act]] ?? 0);
    writeFileSync(join(OUT, `settle-${label}-frames.json`), JSON.stringify({ order, max, startPx, end, delivered, frames: fr.map((f: any) => ({ t: +f.t.toFixed(1), pos: +f.pos.toFixed(2), loc: f.loc === null ? null : +f.loc.toFixed(2), tgt: f.tgt === null ? null : +f.tgt.toFixed(2), wheels: f.wheels, pd: f.pd, pm: f.pm, pu: f.pu, press: f.emblaPress })) }));
    // A frame moving back against the scroll that lands inside the strip. The wheel stops flat at an end, so a frame drawn past it
    // fails on its own (`drawnPastEndPx`).
    const inside = (p: number): boolean => (end - p) * c.dir > 0.5;
    const moves = fr.slice(1).map((f: any, k: number) => (inside(f.pos) ? (f.pos - fr[k].pos) * c.dir : 0));
    const back = moves.filter((m: number) => m < -0.5);
    // The first frame drawn at the end or past it (an overscroll passes it between two frames).
    const atEnd = fr.findIndex((f: any) => (f.pos - end) * c.dir >= -0.5);
    const rest = fr[fr.length - 1].pos;
    const span = (key: string): [number, number] => [+Math.min(...fr.map((f: any) => f[key])).toFixed(1), +Math.max(...fr.map((f: any) => f[key])).toFixed(1)];
    const r = {
      order0: order[0],
      startPx,
      end: +end.toFixed(1),
      input,
      pastEndPx: +(input - Math.abs(end - startPx)).toFixed(1),
      firstAtEndFrame: atEnd,
      frames: fr.length,
      drawn: span('pos'),
      location: span('loc'),
      target: span('tgt'),
      backFrames: back.length,
      backPx: +(-back.reduce((n: number, m: number) => n + m, 0)).toFixed(1),
      worstBackPx: +(-Math.min(0, ...moves)).toFixed(2),
      rest: +rest.toFixed(1),
      restFromEndPx: +Math.abs(rest - end).toFixed(1),
      drawnPastEndPx: +Math.max(0, ...fr.map((f: any) => (f.pos - end) * c.dir)).toFixed(1),
      // Embla's target's largest step against the scroll in one frame while the wheel gesture holds the row (a pull back to the end or a
      // jump to the gesture's start is hundreds).
      heldTargetBackPx: +Math.max(0, ...fr.slice(1).map((f: any, k: number) => (f.held && fr[k].held ? (fr[k].tgt - f.tgt) * c.dir : 0))).toFixed(1),
      heldFrames: fr.filter((f: any) => f.held).length,
      act,
      delivered,
      // Embla's target's largest step back against the scroll in one frame, and where it went.
      targetJump: fr.slice(1).reduce((w: [number, number], f: any, k: number) => ((fr[k].tgt - f.tgt) * c.dir < w[0] ? [+((fr[k].tgt - f.tgt) * c.dir).toFixed(1), +f.tgt.toFixed(1)] : w), [0, startPx] as [number, number]),
      // Embla's target's largest step, either way, in a frame no wheel arrived in while the wheel gesture holds the row: only a wheel
      // moves it then (a stray release snapping it to a stop is a page's worth).
      heldStrayTargetPx: +Math.max(0, ...fr.slice(1).map((f: any, k: number) => (f.held && fr[k].held && f.wheels === 0 ? Math.abs(f.tgt - fr[k].tgt) : 0))).toFixed(1),
      travel: landing === null ? null : +landing.travel.toFixed(1),
      coast: landing === null ? null : +landing.coast.toFixed(1),
    };
    res[label] = r;
    if (fr.length < 30 || atEnd < 0 && label.startsWith('end')) empty.push(`settle ${label}: the row never reached its end (${r.drawn}), so the check proves nothing`);
    if (label.startsWith('end') && c.fling !== true && r.pastEndPx < 600) empty.push(`settle ${label}: only ${r.pastEndPx} px of wheel past the end`);
    if (c.fling === true && (landing === null || Math.abs(landing.travel - end) < 50)) empty.push(`settle ${label}: the wheel's own travel (${r.travel}) reached the end, so the coast is not what took the row there`);
    if (c.fling === true && landing !== null && (landing.travel + landing.coast - end) * c.dir < 50) empty.push(`settle ${label}: the coast (${r.coast} from ${r.travel}) does not run past the end, so the clamp is not tried`);
    if (r.heldStrayTargetPx > 0.5) failed.push(`settle ${label}: while the wheel held the row, Embla's target moved ${r.heldStrayTargetPx} px in a frame with no wheel`);
    if (label.startsWith('end') && r.restFromEndPx > 0.5) failed.push(`settle ${label}: scrolled into the end at ${r.end}, rests at ${r.rest} (${r.restFromEndPx} px from it)`);
    if (r.worstBackPx > 0.5) failed.push(`settle ${label}: the row moved back into the strip against the scroll in ${r.backFrames} frames, ${r.backPx} px in all (worst ${r.worstBackPx} px in one frame)`);
    if (r.heldTargetBackPx > 50) failed.push(`settle ${label}: while the wheel held the row, Embla's target stepped ${r.heldTargetBackPx} px against the scroll in one frame`);
    if (r.heldFrames < 10) empty.push(`settle ${label}: the wheel held the row in ${r.heldFrames} frames`);
    if (r.drawnPastEndPx > 0.5) failed.push(`settle ${label}: drawn ${r.drawnPastEndPx} px past the end (the wheel stops flat there)`);
    if (c.mouse && handMoves.length > 0 && delivered < 1) empty.push(`settle ${label}: no trusted ${ACT_EVENT[act]} arrived, so the case proves nothing`);
    if (c.late === true && rest * c.dir < Math.max(...fr.map((f: any) => f.pos * c.dir)) - 0.5) failed.push(`settle ${label}: rests at ${r.rest}, behind where the scroll carried the row`);
    // Mid-strip the wheel's travel is the whole input, so the rest is the first stop ahead of it: a stray release that set the target
    // to the stop nearest it shows here even when that stop lay ahead (the row went a page further than the scroll).
    // The travel and the coast are read from the row; a stray move of its target while held fails above, on its own.
    if (!label.startsWith('end')) {
      if (landing === null) empty.push(`settle ${label}: no wheel gesture landed`);
      else {
        const carried = Math.min(Math.max(0, landing.travel + landing.coast), max) / PITCH;
        const ahead = (Math.abs(carried - Math.round(carried)) * PITCH <= 0.5 ? Math.round(carried) : c.dir < 0 ? Math.floor(carried) : Math.ceil(carried)) * PITCH;
        if (Math.abs(rest - ahead) > 0.5) failed.push(`settle ${label}: rests at ${r.rest}, not on ${ahead}, the first stop ahead of the wheel's travel to ${r.travel} and its coast ${r.coast}`);
      }
    }
    if (c.rootFar === true && order[0] === 'root') empty.push(`settle ${label}: the Workspace is still the first page`);
    if (errors.length > 0) failed.push(`settle ${label}: page errors ${errors.join(' | ')}`);
    await close();
  }
  out.settle = res;
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
  if (w.pxPerInputPx < SLOW_SPEED - 0.03 || w.pxPerInputPx > FAST_SPEED + 0.03) failed.push(`strip wheel: ${w.pxPerInputPx} px per input px, outside ${SLOW_SPEED}-${FAST_SPEED}`);
  if (w.drift.unloadChanges === 0) empty.push('strip wheel: no panel loaded or unloaded during the stream, so the no-jump check proves nothing');
  if (w.drift.worstPx > 0.5) failed.push(`strip wheel: a panel moved ${w.drift.worstPx} px along the strip while panels loaded and unloaded`);
  if (w.drift.maxLoaded > 8) failed.push(`strip wheel: ${w.drift.maxLoaded} parkable panels loaded in one frame, more than the cap 8`);
  if (want('strip.firstCommit')) {
    // From the first commit, before the window is measured: no more parkable pages load than the cap (the app's restore loaded all
    // eight web pages for one commit, at a window drawn the whole strip wide). Every DOM change is read, not a frame.
    for (const cap of [8, 4]) {
      const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
      // A string, not a function: tsx wraps named inner functions in a helper the page does not have.
      await ctx.addInitScript(`(() => {
        window.__peakLoaded = 0; window.__peakSlots = 0;
        const read = () => {
          const all = [...document.querySelectorAll('[data-row-slot]')];
          const loaded = all.filter((el) => !el.hasAttribute('data-row-unloaded') && el.querySelector('[data-row-unloaded]') === null).length;
          window.__peakSlots = Math.max(window.__peakSlots, all.length);
          window.__peakLoaded = Math.max(window.__peakLoaded, loaded - 1);
        };
        window.__peakObserver = new MutationObserver(read);
        window.__peakObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-unloaded'] });
      })()`);
      const page: Page = await ctx.newPage();
      await page.goto(`http://localhost:${port}/?engine=embla&slots=${narrow}&park=1&cap=${cap}&late=1`);
      await page.waitForFunction(() => (window as any).__g?.ready(), undefined, { timeout: 15000 });
      await sleep(800);
      const mounts: Record<string, number> = await g(page, 'mounts');
      const parkMounts = Object.entries(mounts).filter(([n]) => n !== 'root').reduce((t, [, c]) => t + c, 0);
      const peak = { loaded: (await page.evaluate(() => (window as any).__peakLoaded)) as number, slots: (await page.evaluate(() => (window as any).__peakSlots)) as number, unloadedNow: (await page.evaluate(() => document.querySelectorAll('[data-row-unloaded]').length)) as number, mountsTotal: parkMounts, loadedNow: ((await g(page, 'loadedIds')) as string[]).filter((n) => n !== 'root').length };
      res[`firstCommitCap${cap}`] = peak;
      if (peak.slots < 25 || peak.unloadedNow === 0) empty.push(`strip firstCommit cap ${cap}: ${peak.slots} slots, ${peak.unloadedNow} unloaded at rest, so the peak proves nothing`);
      // A view mounted in a commit nobody saw (one the layout effect's measure replaced before paint) still counts: it loaded.
      if (peak.mountsTotal > cap) failed.push(`strip firstCommit: cap ${cap}, ${peak.mountsTotal} parkable views mounted on the way to ${peak.loadedNow} loaded at rest`);
      if (peak.loaded > cap) failed.push(`strip firstCommit: cap ${cap}, but ${peak.loaded} parkable pages were loaded at once (before the window was measured)`);
      await ctx.close();
    }
  }
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

// The root (the Workspace panel) as an ordinary page (owner ruling 2026-11-09), on a row with more pages than fit: a summon moves it in
// the page order to the slot just outside the view on the side it lies on, as a person's move (the order commits once), and the row's
// glide brings it in; it then stays where it landed. Scrolling to it only scrolls; a summon with it in view does nothing.
if (ONLY.has('summon') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const PITCH = 406;
  const GAP = 16;
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
  const pages = (n: number): string[] => Array.from({ length: n }, (_, k) => `p${k + 1}`);
  /** The order with the root at index `k` among p1..p24. */
  const orderWith = (k: number): string => {
    const o = pages(24);
    o.splice(k, 0, 'root');
    return o.join();
  };
  // Runs `act` and reads every frame until the row settles. Per frame, over the pages drawn in the window or one gap past its edges in
  // either of two frames: all move by one shift (the strip's; a page off it by more than 0.5 px moved on its own, a snap or a slide);
  // that shift keeps one direction (`oneWay`) and no frame moves it more than half a slot (no jump: these glides of one or two slots
  // peak near 125 px a frame, and a summon that put the root inside the view first jumped 270; `jumps` allows Reduce Motion's); the
  // largest change of speed between frames is reported (`worstKickPx`, a glide's start included); the window has
  // no run wider than a gap that no page covers (no hole) and no unloaded placeholder in it (no blank). The rest is on the grid.
  const run = async (page: Page, label: string, act: () => Promise<unknown>, opts: { jumps?: boolean; oneWay?: boolean; settleMs?: number } = {}): Promise<any> => {
    const changes0 = await g(page, 'orderChanges');
    const before = await shown(page);
    await g(page, 'record');
    const ret = await act();
    await sleep(opts.settleMs ?? 1600);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, `summon-${label}-frames.json`), JSON.stringify(fr.map((f: any) => ({ t: f.t, pos: f.pos, named: f.named }))));
    const after = await shown(page);
    const win = await g(page, 'win');
    const max = await g(page, 'max');
    const rest = await g(page, 'pos');
    const W = win.width;
    const near = (v: { x: number; w: number } | undefined): boolean => v !== undefined && v.x + v.w > -GAP + 0.5 && v.x < W + GAP - 0.5;
    let worstOwn = 0;
    let worstOwnAt = '';
    let worstStep = 0;
    let dir = 0;
    let backFrames = 0;
    let worstHole = 0;
    let blankFrames = 0;
    let moving = 0;
    const rootPlaces = new Set<number>();
    const shifts: { s: number; dt: number }[] = [];
    for (let k = 0; k < fr.length; k += 1) {
      const f = fr[k];
      if (f.named.root !== undefined && f.named.root.x + f.named.root.w > 0.5 && f.named.root.x < W - 0.5) rootPlaces.add(Math.round(f.named.root.x));
      if ((f.blankIn ?? []).length > 0) blankFrames += 1;
      const spans = Object.values(f.named as Record<string, { x: number; w: number }>).filter((v) => v.w > 1 && v.x + v.w > 0 && v.x < W).map((v) => [Math.max(0, v.x), Math.min(W, v.x + v.w)] as const).sort((a, b) => a[0] - b[0]);
      let reach = 0;
      for (const [l, r] of spans) {
        worstHole = Math.max(worstHole, l - reach);
        reach = Math.max(reach, r);
      }
      worstHole = Math.max(worstHole, W - reach);
      if (k === 0) continue;
      const p = fr[k - 1];
      const ids = Object.keys(f.named).filter((id) => p.named[id] !== undefined && (near(f.named[id]) || near(p.named[id])));
      const dxs = ids.map((id) => f.named[id].x - p.named[id].x).sort((a, b) => a - b);
      if (dxs.length === 0) continue;
      const shift = dxs[Math.floor(dxs.length / 2)]!;
      for (const id of ids) {
        const own = Math.abs(f.named[id].x - p.named[id].x - shift);
        if (own > worstOwn) {
          worstOwn = own;
          worstOwnAt = `${id} frame ${k}`;
        }
      }
      if (Math.abs(shift) > 0.5) moving += 1;
      shifts.push({ s: shift, dt: Math.max(1, f.t - p.t) });
      if (Math.abs(shift) > 0.5) {
        if (dir === 0) dir = Math.sign(shift);
        else if (Math.sign(shift) !== dir) backFrames += 1;
      }
    }
    for (let k = 1; k + 1 < shifts.length; k += 1) {
      const v = (q: { s: number; dt: number }): number => q.s / q.dt;
      worstStep = Math.max(worstStep, Math.abs(v(shifts[k]!) - (v(shifts[k - 1]!) + v(shifts[k + 1]!)) / 2) * shifts[k]!.dt);
    }
    const r = {
      returned: ret,
      frames: fr.length,
      moving,
      fastestPx: +Math.max(0, ...shifts.map((q) => Math.abs(q.s))).toFixed(1),
      order: (await g(page, 'order')).join(),
      orderCommits: (await g(page, 'orderChanges')) - changes0,
      visibleBefore: visible(before, W),
      visibleAfter: visible(after, W),
      rootX: after.root?.x ?? null,
      rootView: await g(page, 'rootView'),
      rootPlaces: rootPlaces.size,
      rest: +rest.toFixed(1),
      restOnGrid: onGrid(rest, PITCH, max),
      worstOwnPx: +worstOwn.toFixed(1),
      worstOwnAt,
      worstKickPx: +worstStep.toFixed(1),
      backFrames,
      worstHolePx: +worstHole.toFixed(1),
      blankFrames,
    };
    if (fr.length < 10) empty.push(`summon ${label}: ${fr.length} frames recorded`);
    if (worstOwn > 0.5) fail(label, `a page in the window moved ${r.worstOwnPx} px off the strip's own shift (${worstOwnAt}): it jumped or slid on its own`);
    if (!opts.jumps && r.fastestPx > PITCH / 2) fail(label, `the strip jumped ${r.fastestPx} px in one frame`);
    if (opts.oneWay !== false && backFrames > 0) fail(label, `${backFrames} frames moved against the glide`);
    if (worstHole > GAP + 1) fail(label, `a run of the window ${r.worstHolePx} px wide that no page covers`);
    if (blankFrames > 0) fail(label, `${blankFrames} frames draw an unloaded placeholder in the window`);
    if (!r.restOnGrid) fail(label, `rest ${r.rest} off the grid`);
    return r;
  };
  const row = Array(24).fill(1).join(',');
  // A summon of a root `rootAt` places from the start, with the view resting at slot `viewAt`, that must leave it at `wantIndex` in the
  // order, the view `wantView` resting at slot `wantRest`, and the order committed once.
  const summonCase = async (label: string, rootAt: number, viewAt: number, wantIndex: number, wantView: string, wantRest: number, reduce = false): Promise<any> => {
    const { page, errors, close } = await open(row, 1800, 900, '', ENGINE, reduce ? { reducedMotion: 'reduce' } : {});
    if (rootAt > 0 && !(await placeRoot(page, rootAt))) empty.push(`summon ${label}: the root could not be placed at ${rootAt}`);
    await g(page, 'jumpToSlot', viewAt);
    await sleep(600);
    const was = await g(page, 'rootView');
    const r = await run(page, label, async () => {
      const ret = await g(page, 'summon');
      await sleep(reduce ? 60 : 200);
      await page.screenshot({ path: join(OUT, `summon-${label}-mid.png`) });
      return ret;
    }, { jumps: reduce });
    await page.screenshot({ path: join(OUT, `summon-${label}.png`) });
    r.rootViewBefore = was;
    r.saved = await g(page, 'saved');
    if (was !== 'away') empty.push(`summon ${label}: the root was ${was} before, so the check proves nothing`);
    if (r.returned !== true) fail(label, `summonRoot answered ${r.returned}`);
    if (r.order !== orderWith(wantIndex)) fail(label, `order ${r.order}, want the root at ${wantIndex}`);
    if (r.orderCommits !== 1) fail(label, `${r.orderCommits} order commits, want 1`);
    if (r.visibleAfter.join() !== wantView || Math.abs(r.rest - wantRest * PITCH) > 0.5) fail(label, `view ${r.visibleAfter} at ${r.rest}, want ${wantView} at ${wantRest * PITCH}`);
    if (r.rootView !== 'shown') fail(label, `rootView ${r.rootView} after, want shown`);
    if (r.saved.length > 0) fail(label, `${r.saved.length} pages parked`);
    if (reduce ? r.rootPlaces > 2 : r.rootPlaces < 3) fail(label, `the root was drawn at ${r.rootPlaces} places in the window coming in (${reduce ? 'Reduce Motion lands it at once' : 'a glide passes through several'})`);
    if (errors.length > 0) fail(label, `page errors ${errors.join(' | ')}`);
    return { r, page, errors, close };
  };
  if (want('summon.fromLeft')) {
    // From far left: the root two places from the start, the view at p14..p17. It goes next to p14 (place 13), the pages between move
    // over out of view, and the glide brings it in at the left edge.
    const { r, page, errors, close } = await summonCase('fromLeft', 2, 14, 13, 'root,p14,p15,p16', 13);
    res.fromLeft = r;
    if (want('summon.stays')) {
      // It stays where it landed: a glide away and back, and a host's scrollTo of it from far off, only scroll.
      const c0 = await g(page, 'orderChanges');
      await g(page, 'glideToSlot', 20);
      await sleep(1600);
      const away = { view: visible(await shown(page), (await g(page, 'win')).width), rootView: await g(page, 'rootView') };
      await g(page, 'glideToSlot', 13);
      await sleep(1600);
      const back = await shown(page);
      await g(page, 'glideToSlot', 20);
      await sleep(1600);
      const answer = await g(page, 'scrollTo', 'root');
      await sleep(1600);
      const to = await shown(page);
      const s = { away, backRootX: back.root?.x ?? null, scrollToAnswer: answer, scrollToRootX: to.root?.x ?? null, rest: await g(page, 'pos'), order: (await g(page, 'order')).join(), orderCommits: (await g(page, 'orderChanges')) - c0 };
      res.stays = s;
      if (away.rootView !== 'away' || away.view.includes('root')) empty.push(`summon stays: the glide away left the root ${away.rootView}, so this proved nothing`);
      if (s.order !== orderWith(13) || s.orderCommits !== 0) fail('stays', `order ${s.order} after ${s.orderCommits} commits: scrolling moved the root`);
      if (s.backRootX !== 0) fail('stays', `back at slot 13 the root is at ${s.backRootX}, not 0`);
      if (s.scrollToRootX === null || s.scrollToRootX < -0.5 || s.scrollToRootX > 3 * PITCH + 0.5) fail('stays', `scrollTo(root) left it at ${s.scrollToRootX}`);
    }
    if (want('summon.inView')) {
      // With the root wholly in view the button does nothing: no move, no order commit; dismissRoot is nothing special either.
      await g(page, 'jumpToSlot', 12);
      await sleep(600);
      const c0 = await g(page, 'orderChanges');
      const pos0 = await g(page, 'pos');
      await g(page, 'record');
      const ret = await g(page, 'summon');
      const dis = await g(page, 'dismiss');
      await sleep(1000);
      const fr = await g(page, 'stop');
      const iv = { rootView: await g(page, 'rootView'), returned: ret, dismissed: dis, frames: fr.length, moved: +Math.max(0, ...fr.map((f: any) => Math.abs(f.pos - pos0))).toFixed(1), orderCommits: (await g(page, 'orderChanges')) - c0, order: (await g(page, 'order')).join() };
      res.inView = iv;
      if (iv.frames < 10) empty.push('summon inView: too few frames recorded');
      if (iv.rootView !== 'shown') empty.push(`summon inView: the root was ${iv.rootView}, so this proved nothing`);
      if (iv.returned !== false || iv.dismissed !== false || iv.moved > 0.5 || iv.orderCommits !== 0 || iv.order !== orderWith(13)) fail('inView', `summon ${iv.returned}, dismiss ${iv.dismissed}, the row moved ${iv.moved} px, ${iv.orderCommits} order commits`);
    }
    if (errors.length > 0) fail('fromLeft', `page errors ${errors.join(' | ')}`);
    await close();
  }
  if (want('summon.fromRight')) {
    // From far right: the root at place 20, the view at p3..p6. It goes next to p6 (place 6) and the glide brings it in at the right.
    const { r, close } = await summonCase('fromRight', 20, 2, 6, 'p4,p5,p6,root', 3);
    res.fromRight = r;
    await close();
  }
  if (want('summon.reduced')) {
    // Reduce Motion: the same summon from the left lands at once, still keep-still, on the grid, one order commit.
    const { r, close } = await summonCase('reduced', 2, 14, 13, 'root,p14,p15,p16', 13, true);
    res.reduced = r;
    await close();
  }
  if (want('summon.midGlide')) {
    // Pressed while the row glides from slot 14 to 18: the root goes next to the view drawn at that moment (left of p14 or p15, out of
    // the window, never inside it) and the glide turns back to bring it in at the left edge (so not one way).
    const { page, errors, close } = await open(row);
    if (!(await placeRoot(page, 2))) empty.push('summon midGlide: the root could not be placed');
    await g(page, 'jumpToSlot', 14);
    await sleep(600);
    await g(page, 'glideToSlot', 18);
    await sleep(90);
    const mid = await g(page, 'pos');
    const r = await run(page, 'midGlide', () => g(page, 'summon'), { oneWay: false, settleMs: 2200 });
    r.midPos = +mid.toFixed(1);
    res.midGlide = r;
    if (Math.abs(mid - 14 * PITCH) < 20 || Math.abs(mid - 18 * PITCH) < 20) empty.push(`summon midGlide: the press came at ${mid}, not mid-glide`);
    const k = r.order.split(',').indexOf('root');
    if (r.returned !== true || (k !== 13 && k !== 14) || r.order !== orderWith(k) || r.orderCommits !== 1 || r.visibleAfter[0] !== 'root' || Math.abs(r.rest - k * PITCH) > 0.5) fail('midGlide', `answered ${r.returned}, order ${r.order} (${r.orderCommits} commits), view ${r.visibleAfter} at ${r.rest}; want the root at 13 or 14 (next to the drawn view), at the left edge, 1 commit`);
    if (errors.length > 0) fail('midGlide', `page errors ${errors.join(' | ')}`);
    await close();
  }
  if (want('summon.midWheel')) {
    // Pressed while a wheel gesture holds the row (300 px right from slot 14, p14 cut at the left edge): the hold ends where the row is
    // drawn, the root goes next to p14 (the first page in view), and the glide brings it in (against the wheel, so not one way).
    const { page, errors, close } = await open(row);
    if (!(await placeRoot(page, 2))) empty.push('summon midWheel: the root could not be placed');
    await g(page, 'jumpToSlot', 14);
    await sleep(600);
    const win = await g(page, 'win');
    await page.mouse.move(win.left + win.width / 2, 450);
    let held = false;
    const r = await run(page, 'midWheel', async () => {
      for (let k = 0; k < 10; k += 1) {
        await page.mouse.wheel(30, 0);
        await sleep(16);
      }
      held = await page.evaluate(() => (window as any).__g.stop().at(-1)?.held === true || false);
      await g(page, 'record');
      return g(page, 'summon');
    }, { oneWay: false, settleMs: 2200 });
    r.heldAtPress = held;
    res.midWheel = r;
    if (!held) empty.push('summon midWheel: the wheel did not hold the row when the summon came, so this proved nothing');
    if (r.returned !== true || r.order !== orderWith(13) || r.orderCommits !== 1 || r.visibleAfter.join() !== 'root,p14,p15,p16' || Math.abs(r.rest - 13 * PITCH) > 0.5) fail('midWheel', `answered ${r.returned}, order ${r.order} (${r.orderCommits} commits), view ${r.visibleAfter} at ${r.rest}; want the root at 13, root,p14,p15,p16 at ${13 * PITCH}, 1 commit`);
    if (errors.length > 0) fail('midWheel', `page errors ${errors.join(' | ')}`);
    await close();
  }
  if (want('summon.api')) {
    // Step 8's API loose ends on a strip. A host's panel.scrollTo() answers whether the row moves, read against where the Embla row is
    // heading (the old scroller reads 0 on a strip); a view's presence reads 'scrolledAway' exactly for the pages whose slot is inert.
    const NARROW24 = Array(24).fill(1).join(',');
    const { page, errors, close } = await open(NARROW24, 1800, 900, '&bar=0');
    await g(page, 'jumpToSlot', 10);
    await sleep(700);
    const inert0 = await g(page, 'inertViews');
    const away0 = await g(page, 'awayViews');
    const farAnswer = await g(page, 'scrollTo', 'p2');
    await sleep(1800);
    const farRest = await g(page, 'pos');
    const inViewAnswer = await g(page, 'scrollTo', 'p3');
    await sleep(900);
    const inViewRest = await g(page, 'pos');
    const inert1 = await g(page, 'inertViews');
    const away1 = await g(page, 'awayViews');
    const r: any = { inert0, away0, farAnswer, farRest, inViewAnswer, inViewRest, inert1, away1 };
    if (inert0.length < 10) empty.push(`summon api: ${inert0.length} inert pages at slot 10, so the presence check proves nothing`);
    if (away0.join() !== inert0.join() || away1.join() !== inert1.join()) fail('api', `views reading scrolledAway ${away0.length}/${away1.length} vs inert ${inert0.length}/${inert1.length} (at slot 10 / after the scroll)`);
    if (farAnswer?.ok !== true || farAnswer.changed !== true || Math.abs(farRest - 2 * PITCH) > 0.5) fail('api', `scrollTo p2 from slot 10 answered ${JSON.stringify(farAnswer)} and rested ${farRest}; want changed true and the row at ${2 * PITCH}`);
    if (inViewAnswer?.ok !== true || inViewAnswer.changed !== false || Math.abs(inViewRest - farRest) > 0.5) fail('api', `scrollTo p3 in view answered ${JSON.stringify(inViewAnswer)} and rested ${inViewRest}; want changed false and no move`);
    if (errors.length > 0) fail('api', `page errors ${errors.join(' | ')}`);
    await close();
    res.api = r;
  }
  if (want('summon.reducedRelease')) {
    // Reduce Motion on the row's own moves (Embla's, not the slots'): a mouse drag's release, a wheel gesture's release with a strip
    // change waiting for it (`moveEmbla`'s rebuild after the release) and a focus reveal each land at once. Read as the frames the row
    // moves after the input ends: a glide takes 20 or more. Each run without Reduce Motion first is the control that the input glides.
    const moving = (fr: any[]): number => fr.slice(1).filter((f: any, k: number) => Math.abs(f.pos - fr[k].pos) > 0.01).length;
    const releaseOf = (fr: any[]): number => fr.findIndex((f: any, k: number) => k > 0 && fr[k - 1].held && !f.held);
    const rr: any = {};
    for (const reduce of [false, true]) {
      const key = reduce ? 'reduced' : 'control';
      const { page, errors, close } = await open(Array(24).fill(1).join(','), 1800, 900, '&bar=0', ENGINE, reduce ? { reducedMotion: 'reduce' } : {});
      await g(page, 'jumpToSlot', 2);
      await sleep(400);
      // A mouse drag on the gap after the first panel drawn past x 100, 300 px left, released mid-slot.
      const gapX = await page.evaluate(() => {
        const r = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => el.getBoundingClientRect()).filter((b) => b.left > 100).sort((a, b) => a.left - b.left);
        return (r[0]!.right + r[1]!.left) / 2;
      });
      await page.mouse.move(gapX, 450);
      await page.mouse.down();
      for (let k = 1; k <= 15; k += 1) {
        await page.mouse.move(gapX - 20 * k, 450);
        await sleep(16);
      }
      await sleep(200);
      await g(page, 'record');
      await page.mouse.up();
      await sleep(1200);
      const dragFr = await g(page, 'stop');
      // A wheel stream, the last page closed 300 ms in: the rebuild waits for the gesture's release.
      await g(page, 'jumpToSlot', 6);
      await sleep(400);
      await page.mouse.move(900, 450);
      for (let k = 0; k < 10; k += 1) {
        await page.mouse.wheel(17, 0);
        await sleep(16);
        if (k === 6) await g(page, 'op', 'close', await g(page, 'idOf', 'p24'));
      }
      await g(page, 'record');
      await sleep(1500);
      const wheelFr = await g(page, 'stop');
      // A focus reveal: the three-slot-wide reveal is not on a one-slot row, so a page cut by a row off the grid: written 200 px past
      // a stop, then the page cut at the right edge focused.
      await g(page, 'jumpToSlot', 3);
      await sleep(300);
      await page.evaluate(() => (window as any).__g.writeAt((window as any).__g.pos() + 200));
      await sleep(200);
      const cut = await page.evaluate(() => {
        const win = document.querySelector('[data-row-embla-window]')!.getBoundingClientRect();
        const el = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].find((x) => { const b = x.getBoundingClientRect(); return b.left < win.right - 1 && b.right > win.right + 1; });
        return el?.querySelector<HTMLElement>('[data-box]')?.dataset.box ?? null;
      });
      await g(page, 'record');
      if (cut !== null) await page.focus(`[data-box="${cut}"]`);
      await sleep(1200);
      const focusFr = await g(page, 'stop');
      const max = await g(page, 'max');
      rr[key] = {
        drag: { moved: +(dragFr.at(-1).pos - dragFr[0].pos).toFixed(1), movingFrames: moving(dragFr), rest: dragFr.at(-1).pos, grid: onGrid(dragFr.at(-1).pos, PITCH, max) },
        // From the gesture's release (the first frame after one the wheel held that it does not): before it the row follows the wheel.
        wheel: { moved: +(wheelFr.at(-1).pos - wheelFr[0].pos).toFixed(1), releaseFrame: releaseOf(wheelFr), movingFrames: moving(wheelFr.slice(Math.max(0, releaseOf(wheelFr)))), rest: wheelFr.at(-1).pos, grid: onGrid(wheelFr.at(-1).pos, PITCH, max) },
        focus: { cut, moved: +(focusFr.at(-1).pos - focusFr[0].pos).toFixed(1), movingFrames: moving(focusFr), rest: focusFr.at(-1).pos, grid: onGrid(focusFr.at(-1).pos, PITCH, max) },
      };
      if (errors.length > 0) fail('reducedRelease', `page errors ${errors.join(' | ')}`);
      await close();
    }
    res.reducedRelease = rr;
    for (const what of ['drag', 'wheel', 'focus']) {
      const c = rr.control[what];
      const r = rr.reduced[what];
      if (what === 'wheel' && (c.releaseFrame < 0 || r.releaseFrame < 0)) empty.push(`summon reducedRelease wheel: no release recorded (${c.releaseFrame}, ${r.releaseFrame})`);
      if (c.movingFrames < 10 || Math.abs(c.moved) < 20) empty.push(`summon reducedRelease ${what}: the control moved ${c.moved} px in ${c.movingFrames} frames, so no glide was there to cut`);
      if (r.movingFrames > 2 || !r.grid || Math.abs(r.moved) < 20) fail('reducedRelease', `${what} under Reduce Motion: moved ${r.moved} px in ${r.movingFrames} frames (want at most 2), rest ${r.rest} on the grid ${r.grid}`);
    }
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
    if (!want(`width.${label}`)) return;
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
  // p1 beside the root picked four slots wide in a window of four (cut by the right edge: the root no longer steps aside), then
  // narrowed to two: the root and p1's left edge hold and the pages after it follow.
  await run('shrinkBesideRoot', 0, async (page, id) => g(page, 'op', 'setSlots', await id('p1'), 2), {
    still: ['root'], page: 'p1', edge: 'right', followers: ['p2'], row: '2,1,1,1,1,1,1,1',
    before: async (page) => {
      await g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 4);
      await sleep(1200);
    },
  });
  // The same shrink, on presented frames (a magenta page): the size box and its neighbors' glides ease on one clock, so no painted
  // frame shows a band between two pages wider than one gap (16 px) and a little. The run at rest is the control: it must see the gap.
  if (want('width.shrinkPresented')) {
    const { page, errors, close } = await open('2,1,1,1,1,1,1,1', 1800, 900, '&bg=1');
    await g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 4);
    await sleep(1200);
    const box = await slotBand(page);
    const cast = await castFrames(page);
    await g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 2);
    await sleep(1300);
    await cast.stop();
    const widest: { k: number; at: number; w: number }[] = [];
    for (const [k, png] of cast.shots.entries()) {
      const runs = await magentaRuns(png, 1800, box);
      const top = runs.reduce((a, b) => (b.w > a.w ? b : a), { at: -1, w: 0 });
      widest.push({ k, ...top });
    }
    const worst = widest.reduce((a, b) => (b.w > a.w ? b : a), { k: -1, at: -1, w: 0 });
    if (worst.k >= 0) writeFileSync(join(OUT, 'width-shrink-presented-widest.png'), Buffer.from(cast.shots[worst.k]!, 'base64'));
    const restGap = widest[widest.length - 1]?.w ?? 0;
    const r = { shots: cast.shots.length, widestBandPx: worst.w, widestAt: worst.at, widestShot: worst.k, restGapPx: restGap, seq: widest.map((x) => x.w).join(' ') };
    res.shrinkPresented = r;
    if (r.shots < 10 || !(restGap >= 12 && restGap <= 20)) empty.push(`width shrinkPresented: ${r.shots} presented frames, the band at rest reads ${restGap} px (want the 16 px gap), so the pixels prove nothing`);
    if (r.widestBandPx > 16 + 8) fail('shrinkPresented', `a presented frame shows a band of page ${r.widestBandPx} px wide at ${r.widestAt} (frame ${r.widestShot}), want one gap (16 px) and at most 8 px more`);
    if (errors.length > 0) fail('shrinkPresented', `page errors ${errors.join(' | ')}`);
    await close();
  }
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
  if (want('blank.lead')) {
    // The loader's look-ahead: a page the glide carries into the window is loaded some frames before it enters (a web view gets
    // that long to draw), not only in the frame it enters. Far dot press at cap 4 (the window's fit, so nothing past the window is
    // loaded for being near): every page entering mid-glide must have been loaded 2 or more frames before its first frame in view.
    const { page, errors, close } = await open(Array(24).fill(1).join(','), 1800, 900, '&park=1&cap=4&bar=0');
    await g(page, 'record');
    await acts.dotFar!(page);
    const fr = await g(page, 'stop');
    const inView = (v: [number, number, number] | undefined, w: number): boolean => v !== undefined && v[1] > 0.5 && v[0] < w - 0.5 && v[0] + v[1] > 0.5;
    const leads: Record<string, number> = {};
    for (let k = 1; k < fr.length; k += 1) {
      for (const [id, v] of Object.entries(fr[k].byId as Record<string, [number, number, number]>)) {
        if (!inView(v, fr[k].winW) || inView(fr[k - 1].byId[id], fr[k - 1].winW) || id in leads) continue;
        let j = k - 1;
        while (j >= 0 && fr[j].byId[id] !== undefined && fr[j].byId[id][2] === 0) j -= 1;
        // Loaded since the record began: a page near the start, not one the look-ahead had to reach.
        if (j < 0) continue;
        leads[id] = k - j - 1;
      }
    }
    const worst = Object.entries(leads).sort((a, b) => a[1] - b[1]);
    res.lead = { entered: Object.keys(leads).length, worst: worst.slice(0, 4).map(([id, n]) => `${id}:${n}`).join(','), leads, frames: fr.length };
    if (Object.keys(leads).length < 5) empty.push(`blank lead: ${Object.keys(leads).length} pages entered the window unloaded before, so the look-ahead was not needed`);
    else {
      // The glide starts slow, so the first page or two to enter have little lead; at speed every page has some.
      const ns = Object.values(leads).sort((a, b) => a - b);
      const zeros = ns.filter((n) => n === 0).length;
      const median = ns[Math.floor(ns.length / 2)]!;
      res.lead.zeros = zeros;
      res.lead.median = median;
      if (zeros > 2 || median < 2) failed.push(`blank lead: ${zeros} of ${ns.length} pages entered the window in the frame they loaded, median lead ${median} frames (${res.lead.worst}); want at most 2 and a median of 2 or more`);
    }
    if (errors.length > 0) failed.push(`blank lead: page errors ${errors.join(' | ')}`);
    await close();
  }
  let controlSeen = 0;
  for (const cap of [8, 4]) {
    // The defect showed in one or two frames of a glide, so the far dot press runs three times at the cap that fits the window.
    const runs = [...Object.entries(acts), ...(cap === 4 ? [['dotFar2', acts.dotFar!], ['dotFar3', acts.dotFar!]] : [])] as [string, (page: Page) => Promise<void>][];
    for (const [name, act] of runs) {
      if (!want(`blank.${name}`)) continue;
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
        // A jump presents a frame or two.
        if (shots.length < (name === 'jumpFar' ? 2 : 10) || fr.length < 10 || moved < 2) empty.push(`blank ${name} cap ${cap} ${cond}: ${shots.length} presented frames, ${fr.length} animation frames, ${moved} row positions`);
        if (cond === 'hidden') {
          if (blankShots > 0) controlSeen += 1;
          else empty.push(`blank control ${name}: every page's content hidden and no presented frame read blank, so the measure cannot see a blank page`);
        } else {
          // A summon glides the root in beside the page at the window's edge as any page comes in: no presented frame shows a band of
          // the page wider than one gap (16 px) and a little.
          if (name === 'summon' && r.widestBlankPx > 16 + 8) failed.push(`blank summon cap ${cap}: a presented frame shows a band of the page ${r.widestBlankPx} px wide in the window (${widths.filter((w) => w > 24).length} of ${shots.length} frames), want one gap and at most 8 px more`);
          if (blankShots > 0) failed.push(`blank ${name} cap ${cap}: ${blankShots} of ${shots.length} presented frames show a page in the window painting nothing (widest ${r.widestBlankPx} px)`);
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
  // The worst frame of a preview hop measured 30.8-33.8 px (an eased 406 px glide); about twice that is the limit for one frame.
  const HOP_FRAME_PX = 70;
  // An unloaded page is recorded under its engine id (it has no content to carry its name): `named` maps the ids back, per row opened.
  let idNames: Record<string, string> = {};
  const nameIds = async (page: Page): Promise<void> => {
    const names: string[] = await g(page, 'order');
    idNames = Object.fromEntries(await Promise.all(names.map(async (n) => [String(await g(page, 'idOf', n)), n])));
  };
  const named = (n: string): string => idNames[n] ?? n;
  const stripXs = (f: any): Record<string, number> => Object.fromEntries(Object.entries(f.drawn as Record<string, { x: number }>).map(([n, d]) => [named(n), d.x + f.pos]));
  const widthOf = (f: any, name: string): number => Object.entries(f.drawn as Record<string, { w: number }>).find(([n]) => named(n) === name)![1].w;
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
  if (want('reorder.edgeHold')) {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
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
    writeFileSync(join(OUT, 'reorder-hold-frames.json'), JSON.stringify({ h0, h1, m0, m1, frames: fr }));
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
    // The pages the drag may move: every page whose slot the dragged page's box passed over (a preview hop moves it one slot, and it
    // glides back if the pointer leaves it again), and the pages between its start and its landing. Any other page moves 0 px.
    // Held frames only: the frame recorded at the release can still read p2 as grabbed with its box already at the landing.
    const grabbed = fr.slice(0, m1).filter((f: any) => f.grabbing === 'p2' && f.boxX.p2 !== undefined);
    const boxW = fr[0].drawn.p2.w;
    const sweptLo = Math.min(...grabbed.map((f: any) => f.boxX.p2 + f.pos));
    const sweptHi = Math.max(...grabbed.map((f: any) => f.boxX.p2 + f.pos)) + boxW;
    const rest0 = stripXs(fr[0]);
    // A page counts as passed over only when the box covered more than half of it (a preview hop needs that much).
    const passedOver = Object.keys(rest0).filter((n) => n !== 'p2' && Math.min(sweptHi, rest0[n]! + widthOf(fr[0], n)) - Math.max(sweptLo, rest0[n]!) > widthOf(fr[0], n) / 2);
    const involved = new Set([...order0.slice(Math.min(order0.indexOf('p2'), order1.indexOf('p2')), Math.max(order0.indexOf('p2'), order1.indexOf('p2')) + 1), ...passedOver]);
    const jumps = stripJumps(fr);
    const uninvolved = Object.entries(jumps).filter(([n]) => !involved.has(n));
    const crossed = Object.entries(jumps).filter(([n]) => involved.has(n) && n !== 'p2');
    const r = {
      hold: { frames: hold.length, travelPx: travelOf(hold), stillFrames: stillOf(hold), worstDriftPx: +driftOf(hold, 'p2', at.offset).toFixed(2) },
      midControl: { frames: mid.length, travelPx: travelOf(mid), worstDriftPx: +driftOf(mid, 'p2', at.offset).toFixed(2) },
      uninvolvedMaxMovePx: Math.max(0, ...uninvolved.map(([, v]) => v)),
      uninvolvedWorst: uninvolved.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => `${n}:${v}`).join(','),
      sweptStripPx: [+sweptLo.toFixed(1), +sweptHi.toFixed(1)],
      passedOver: passedOver.join(','),
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
    if (grabbed.length < 30 || r.passedOver === '') empty.push(`reorder edgeHold: ${grabbed.length} frames with p2 grabbed, passed over [${r.passedOver}]: no swept range to judge the other pages by`);
    if (r.hold.frames < 30 || r.midControl.frames < 30) empty.push(`reorder edgeHold: ${r.hold.frames} hold frames, ${r.midControl.frames} control frames`);
    if (r.midControl.travelPx !== 0) empty.push(`reorder edgeHold control: held mid-row the row moved ${r.midControl.travelPx} px, so travel at the edge says nothing`);
    if (!(r.hold.travelPx >= 400) || r.hold.stillFrames > 1) failed.push(`reorder edgeHold: held at the edge with no mouse motion the row moved ${r.hold.travelPx} px in 1 s (${r.hold.stillFrames} still frames of ${r.hold.frames})`);
    if (!(r.hold.travelPx >= 400) || r.hold.worstDriftPx > 0.5 || r.midControl.worstDriftPx > 0.5) failed.push(`reorder edgeHold: the dragged page drifts from the pointer by ${r.hold.worstDriftPx} px while the row scrolls ${r.hold.travelPx} px under it (${r.midControl.worstDriftPx} px mid-row)`);
    if (!(r.hold.travelPx >= 400) || r.uninvolvedMaxMovePx > 0.5 || r.crossed < 2 || r.crossedMaxFramePx > HOP_FRAME_PX) failed.push(`reorder edgeHold: pages not crossed moved ${r.uninvolvedMaxMovePx} px along the strip; ${r.crossed} crossed pages, worst frame ${r.crossedMaxFramePx} px`);
    if (!(r.hold.travelPx >= 400) || r.blankFrames > 0) failed.push(`reorder edgeHold: ${r.blankFrames} frames show an unloaded placeholder in the window (${r.blankIds}) over ${r.hold.travelPx} px of edge scroll`);
    if (r.emblaPressFrames > 0 || r.emblaPointerDowns > 0) failed.push(`reorder edgeHold: Embla's own drag fired during the reorder (${r.emblaPressFrames} frames pressed, ${r.emblaPointerDowns} pointerDown)`);
    if (!(r.hold.travelPx >= 400) || !r.restOnGrid || Math.abs(landStrip - releasedStrip) > PITCH / 2 || !r.orderAsLanded || r.orderChanges !== 1) failed.push(`reorder edgeHold drop: rest ${r.rest} (grid ${r.restOnGrid}), released at ${r.releasedStripPx} landed at ${r.landedStripPx}, order as landed ${r.orderAsLanded}, ${r.orderChanges} order commits`);
    if (errors.length > 0) failed.push(`reorder edgeHold: page errors ${errors.join(' | ')}`);
    await page.screenshot({ path: join(OUT, 'reorder-hold-rest.png') });
    await close();
  }

  // 2. Escape mid-drag, after the edge has scrolled the row: the order, the row and every page return to where they were.
  if (want('reorder.cancel')) {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
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

  // 3. A drop into the window's left-edge slot from slot 5. (a) The pointer stops outside the left band (the hop rule takes a page
  // more than half over): the view stays where it was and p7 lands at the edge. (b) The pointer goes into the band, so the row
  // scrolls while it is held: the release settles on the stop nearest where it was let go, and p7 lands whole where it was dropped.
  for (const into of ['outside', 'band'] as const) {
    if (!want(`reorder.leftEdge.${into}`)) continue;
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
    await g(page, 'jumpToSlot', 5);
    await sleep(500);
    const win = await g(page, 'win');
    const order0: string[] = await g(page, 'order');
    const pos0 = await g(page, 'pos');
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    const at = await press(page, 'p7');
    const toX = into === 'outside' ? at.x - 2 * PITCH + 120 : at.x - 2 * PITCH;
    await glideMouse(page, at, toX);
    await sleep(200);
    const pointerInWin = toX - win.left;
    await page.screenshot({ path: join(OUT, `reorder-leftEdge-${into}-mid.png`) });
    const k0 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(1500);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, `reorder-leftEdge-${into}-frames.json`), JSON.stringify({ k0, frames: fr }));
    const held = fr.slice(0, k0);
    const drop = fr.slice(k0);
    const released = fr[k0 - 1];
    const last = fr[fr.length - 1];
    const max = await g(page, 'max');
    // The pages the drag may move: those whose slot p7's box passed over (see edgeHold). Any other page stays put along the strip.
    const boxW = fr[0].drawn.p7.w;
    const grabbed = held.filter((f: any) => f.grabbing === 'p7' && f.boxX.p7 !== undefined);
    const sweptLo = Math.min(...grabbed.map((f: any) => f.boxX.p7 + f.pos));
    const sweptHi = Math.max(...grabbed.map((f: any) => f.boxX.p7 + f.pos)) + boxW;
    const rest0 = stripXs(fr[0]);
    const passedOver = new Set(Object.keys(rest0).filter((n) => n !== 'p7' && Math.min(sweptHi, rest0[n]! + widthOf(fr[0], n)) - Math.max(sweptLo, rest0[n]!) > widthOf(fr[0], n) / 2));
    const jumpsAll = stripJumps(fr);
    const others = Object.entries(jumpsAll).filter(([n]) => n !== 'p7' && !passedOver.has(n));
    const passedJumps = Object.entries(jumpsAll).filter(([n]) => passedOver.has(n));
    const releasedStrip = released.boxX.p7 + released.pos;
    const landStrip = last.drawn.p7.x + last.pos;
    const nearest = Math.min(max, Math.round(released.pos / PITCH) * PITCH);
    const order1: string[] = await g(page, 'order');
    const r = {
      pointerInWindowPx: +pointerInWin.toFixed(1),
      rowBefore: pos0,
      rowAtRelease: +released.pos.toFixed(1),
      rowAfter: +last.pos.toFixed(1),
      rowMaxMoveHeldPx: +Math.max(0, ...held.map((f: any) => Math.abs(f.pos - pos0))).toFixed(2),
      rowMaxMoveAfterDropPx: +Math.max(0, ...drop.map((f: any) => Math.abs(f.pos - released.pos))).toFixed(2),
      restOnGrid: onGrid(last.pos, PITCH, max),
      nearestStop: nearest,
      p7ScreenX: +last.drawn.p7.x.toFixed(1),
      p7LandStripPx: +landStrip.toFixed(1),
      passedOver: [...passedOver].join(','),
      othersMaxMovePx: Math.max(0, ...others.map(([, v]) => v)),
      passedMaxFramePx: Math.max(0, ...passedJumps.map(([, v]) => v)),
      releasedStripPx: +releasedStrip.toFixed(1),
      othersWorst: others.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => `${n}:${v}`).join(','),
      order: order1.slice(4, 10).join(','),
      orderAsExpected: order1.join(',') === orderWith(order0, 'p7', into === 'outside' ? 5 : Math.round(landStrip / PITCH)).join(','),
      orderChanges: (await g(page, 'orderChanges')) - commits0,
    };
    res[`leftEdgeDrop_${into}`] = r;
    if (grabbed.length < 10) empty.push(`reorder leftEdgeDrop ${into}: ${grabbed.length} frames with p7 grabbed`);
    // Pages the held box passed over hop on the slide's glide: no frame moves one further than about twice the measured hop step.
    if (r.passedMaxFramePx > HOP_FRAME_PX) failed.push(`reorder leftEdgeDrop ${into}: a page passed over moved ${r.passedMaxFramePx} px in one frame (passed over ${r.passedOver}); limit ${HOP_FRAME_PX}`);
    if (into === 'band' && Math.abs(landStrip - releasedStrip) > PITCH / 2) failed.push(`reorder leftEdgeDrop band: p7 was let go at strip ${r.releasedStripPx} and lands at ${r.p7LandStripPx}, more than half a slot away`);
    if (into === 'outside') {
      if (r.pointerInWindowPx <= 48 || r.rowMaxMoveHeldPx > 0.5 || r.rowMaxMoveAfterDropPx > 0.5 || Math.abs(r.p7ScreenX) > 0.5 || r.othersMaxMovePx > 0.5 || !r.orderAsExpected || r.orderChanges !== 1)
        failed.push(`reorder leftEdgeDrop outside: pointer ${r.pointerInWindowPx} px into the window; the row moved ${r.rowMaxMoveHeldPx} px held and ${r.rowMaxMoveAfterDropPx} px after the drop (${pos0} > ${r.rowAfter}), p7 rests at ${r.p7ScreenX} (want 0), pages not passed over moved ${r.othersMaxMovePx} px (${r.othersWorst}), order ${r.orderAsExpected}, ${r.orderChanges} commits`);
    } else {
      if (!(r.rowMaxMoveHeldPx >= 50) || Math.abs(r.rowAfter - nearest) > 0.5 || !r.restOnGrid || Math.abs(r.p7ScreenX - (Math.round(landStrip / PITCH) * PITCH - last.pos)) > 0.5 || r.othersMaxMovePx > 0.5 || !r.orderAsExpected || r.orderChanges !== 1)
        failed.push(`reorder leftEdgeDrop band: the row moved ${r.rowMaxMoveHeldPx} px while held, released at ${r.rowAtRelease}, rests at ${r.rowAfter} (nearest stop ${nearest}, grid ${r.restOnGrid}); p7 lands at strip ${r.p7LandStripPx}, pages not passed over moved ${r.othersMaxMovePx} px (${r.othersWorst}), order ${r.orderAsExpected}, ${r.orderChanges} commits`);
    }
    if (errors.length > 0) failed.push(`reorder leftEdgeDrop ${into}: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 4. Keys on the grab strip: ArrowRight moves the page one place and leaves the row where it is; a page moved out of view comes into it.
  if (want('reorder.keys')) {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
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
    const posAt900 = await g(page, 'pos');
    // Embla's glide ends on a long tail (0.5 px left at 900 ms, measured): judge the rest once the row stands still for 10 frames.
    const t0 = Date.now();
    for (let still = 0, was = posAt900; still < 10 && Date.now() - t0 < 4000; ) {
      await nextFrame(page);
      const now = await g(page, 'pos');
      still = Math.abs(now - was) < 0.01 ? still + 1 : 0;
      was = now;
    }
    const settledMs = 900 + Date.now() - t0;
    const shown = await g(page, 'shown');
    const p3 = shown.find((s: any) => s.id === 'p3');
    const win = await g(page, 'win');
    const max = await g(page, 'max');
    const pos = await g(page, 'pos');
    const r = { posAt900: +posAt900.toFixed(2), settledMs, firstPress: { rowAfter: inView.pos, orderAsExpected: inView.order }, outOfView: { orderAsExpected: (await g(page, 'order')).join(',') === orderWith(order1, 'p3', 4).join(','), p3x: p3?.x, whole: p3 !== undefined && p3.x >= -0.5 && p3.x + p3.w <= win.width + 0.5, rowAfter: +pos.toFixed(1), onGrid: onGrid(pos, PITCH, max) } };
    res.keys = r;
    if (Math.abs(r.firstPress.rowAfter) > 0.5 || !r.firstPress.orderAsExpected) failed.push(`reorder keys: ArrowRight on p1's grab strip gave order ${r.firstPress.orderAsExpected}, row at ${r.firstPress.rowAfter} (want 0)`);
    if (!r.outOfView.orderAsExpected || !r.outOfView.whole || !r.outOfView.onGrid) failed.push(`reorder keys: p3 moved out of view: order ${r.outOfView.orderAsExpected}, drawn at ${r.outOfView.p3x} (whole ${r.outOfView.whole}), row ${r.outOfView.rowAfter} on grid ${r.outOfView.onGrid}`);
    if (errors.length > 0) failed.push(`reorder keys: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 5. The root's rules: p1 dragged a slot and a half left, over the root, lands where the own row lands it.
  if (want('reorder.rootRule')) {
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
  if (want('reorder.reduced')) {
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
    // The dropped page under Reduce Motion lands at once: the frames after the release in which it is drawn somewhere new on the strip.
    // The content (the drag box), not the size box: the slot stands at its preview rest while the content follows the pointer.
    const p2Strip = after.filter((f: any) => f.boxX.p2 !== undefined).map((f: any) => f.boxX.p2 + f.pos);
    const dropMovingFrames = p2Strip.slice(1).filter((x: number, k: number) => Math.abs(x - p2Strip[k]) > 0.5).length;
    const heldFrames = hold.filter((f: any) => f.boxX.p2 !== undefined).length;
    const r = { dropTrace: [p2Strip.length, ...p2Strip.filter((x: number, k: number) => k === 0 || Math.abs(x - p2Strip[k - 1]) > 0.01).slice(0, 6).map((x: number) => +x.toFixed(1))], heldFrames, dropMovingFrames, holdTravelPx: travelOf(hold), holdMovingFrames: movesHold, worstDriftPx: +driftOf(hold, 'p2', at.offset).toFixed(2), settleMovingFrames: settleFrames, rest: +last.pos.toFixed(1), restOnGrid: onGrid(last.pos, PITCH, await g(page, 'max')), orderChanges: (await g(page, 'orderChanges')) - commits0, blankFrames: fr.filter((f: any) => f.blankIn.length > 0).length };
    res.reduced = r;
    if (r.heldFrames < 30) empty.push(`reorder reduced: p2's content drawn in ${r.heldFrames} hold frames, so the drift says nothing`);
    if (r.dropMovingFrames > 2) failed.push(`reorder reduced: the dropped page moved along the strip in ${r.dropMovingFrames} frames after the release (want at once)`);
    if (!(r.holdTravelPx >= PITCH) || r.holdMovingFrames > 3 || r.worstDriftPx > 0.5 || r.settleMovingFrames > 2 || !r.restOnGrid || r.orderChanges !== 1 || r.blankFrames > 0) failed.push(`reorder reduced: hold moved ${r.holdTravelPx} px in ${r.holdMovingFrames} frames (want jumps of a slot), drift ${r.worstDriftPx} px, ${r.settleMovingFrames} frames of settle, rest ${r.rest} grid ${r.restOnGrid}, ${r.orderChanges} commits, ${r.blankFrames} blank frames`);
    if (errors.length > 0) failed.push(`reorder reduced: page errors ${errors.join(' | ')}`);
    await close();
  }

  // 7. A wheel during a reorder drag: the own row refuses every step while a drag holds it (`glideTo` is false under a claim), so the
  // wheel is ignored here too. p3 held 200 px right of its press, mid-row, then 40 sideways wheels of 12 px: the row stays where it
  // is, Embla's own drag never engages, the page stays under the pointer, and the drop lands on the stop nearest the release. The
  // same stream after the drop must move the row (the control: the wheels did reach the row).
  if (want('reorder.wheelBefore')) {
    // A wheel gesture already running when the hold starts: the wheel stream stops at the press, and its tail (Embla's release of the
    // wheel's drag and any glide after it) must not move the row under the held page. Held mid-row, out of the edge bands.
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
    const at0 = await g(page, 'grabRect', 'p3');
    await page.mouse.move(at0.x, at0.y);
    await g(page, 'record');
    for (let k = 0; k < 12; k += 1) {
      await page.mouse.wheel(14, 0);
      await sleep(16);
    }
    const wheelHeld = await page.evaluate(() => (window as any).__g.last()?.held === true || false);
    const at = await press(page, 'p3');
    // A frame recorded before the press may be read before Embla drew that frame: the references are read 50 ms after it.
    await sleep(50);
    const h0 = await g(page, 'mark');
    await glideMouse(page, at, at.x + 120, 6);
    // The dragged box follows a pointer move a frame late, so the drift is read once the pointer stands still.
    const hs = await g(page, 'mark');
    await sleep(900);
    const h1 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(1500);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, 'reorder-wheelBefore-frames.json'), JSON.stringify({ h0, hs, h1, offset: at.offset, frames: fr }));
    const held = fr.slice(h0, h1);
    const posAt = fr[h0 - 1]?.pos ?? held[0].pos;
    const r = {
      wheelHeldAtPress: wheelHeld,
      wheelTravelPx: +(posAt - fr[0].pos).toFixed(1),
      heldFrames: held.length,
      rowMoveHeldPx: +Math.max(0, ...held.map((f: any) => Math.abs(f.pos - posAt))).toFixed(2),
      emblaPressFramesHeld: held.filter((f: any) => f.emblaPress).length,
      // Off the grab point read in the first frame recorded after the press, not the box read before it: the row was still moving then.
      worstDriftPx: +driftOf(fr.slice(hs + 2, h1).filter((f: any) => f.grabbing === 'p3'), 'p3', fr[h0 - 1].pointerX - fr[h0 - 1].winLeft - fr[h0 - 1].boxX.p3).toFixed(2),
      rest: +fr[fr.length - 1].pos.toFixed(1),
      restOnGrid: onGrid(fr[fr.length - 1].pos, PITCH, await g(page, 'max')),
    };
    res.wheelBefore = r;
    if (!r.wheelHeldAtPress || Math.abs(r.wheelTravelPx) < 20) empty.push(`reorder wheelBefore: the wheel moved the row ${r.wheelTravelPx} px (held at the press: ${r.wheelHeldAtPress}), so no gesture was running at the press`);
    if (r.heldFrames < 30) empty.push(`reorder wheelBefore: ${r.heldFrames} held frames`);
    if (r.rowMoveHeldPx > 0.5 || r.emblaPressFramesHeld > 0 || r.worstDriftPx > 0.5 || !r.restOnGrid) failed.push(`reorder wheelBefore: under the hold the row moved ${r.rowMoveHeldPx} px, Embla's drag pressed in ${r.emblaPressFramesHeld} frames, the page drifted ${r.worstDriftPx} px off the pointer; rest ${r.rest} on the grid ${r.restOnGrid}`);
    if (errors.length > 0) failed.push(`reorder wheelBefore: page errors ${errors.join(' | ')}`);
    await close();
  }
  if (want('reorder.wheelClick')) {
    // A press and release with no drag during a wheel gesture's tail: the row stops where it is drawn at the press and the release
    // settles it on a stop (no reorder hold took it, so nothing else would).
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
    const at0 = await g(page, 'grabRect', 'p3');
    await page.mouse.move(at0.x, at0.y);
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    for (let k = 0; k < 12; k += 1) {
      await page.mouse.wheel(14, 0);
      await sleep(16);
    }
    await page.mouse.down();
    await sleep(50);
    const p0 = await g(page, 'mark');
    await sleep(600);
    const p1 = await g(page, 'mark');
    await page.mouse.up();
    await sleep(1500);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, 'reorder-wheelClick-frames.json'), JSON.stringify({ p0, p1, frames: fr }));
    const pressed = fr.slice(p0, p1);
    const posAt = fr[p0 - 1].pos;
    const r = {
      wheelTravelPx: +(posAt - fr[0].pos).toFixed(1),
      pressedFrames: pressed.length,
      rowMovePressedPx: +Math.max(0, ...pressed.map((f: any) => Math.abs(f.pos - posAt))).toFixed(2),
      rest: +fr[fr.length - 1].pos.toFixed(1),
      restOnGrid: onGrid(fr[fr.length - 1].pos, PITCH, await g(page, 'max')),
      orderChanges: (await g(page, 'orderChanges')) - commits0,
    };
    res.wheelClick = r;
    if (Math.abs(r.wheelTravelPx) < 20) empty.push(`reorder wheelClick: the wheel moved the row ${r.wheelTravelPx} px, so no gesture was running at the press`);
    if (r.pressedFrames < 4) empty.push(`reorder wheelClick: ${r.pressedFrames} pressed frames`);
    if (r.rowMovePressedPx > 0.5 || !r.restOnGrid || r.orderChanges !== 0) failed.push(`reorder wheelClick: the row moved ${r.rowMovePressedPx} px under the press; rest ${r.rest} on the grid ${r.restOnGrid}; ${r.orderChanges} order commits`);
    if (errors.length > 0) failed.push(`reorder wheelClick: page errors ${errors.join(' | ')}`);
    await close();
  }

  if (want('reorder.wheel')) {
    const { page, errors, close } = await open(SLOTS24, 1800, 900, QUERY);
    await nameIds(page);
    const order0: string[] = await g(page, 'order');
    await g(page, 'record');
    const commits0 = await g(page, 'orderChanges');
    const downs0 = (await g(page, 'emblaEvents')).pointerDown;
    const at = await press(page, 'p3');
    await glideMouse(page, at, at.x + 200);
    await sleep(150);
    const w0 = await g(page, 'mark');
    for (let k = 0; k < 40; k += 1) {
      await page.mouse.wheel(12, 0);
      await sleep(16);
    }
    await sleep(300);
    const w1 = await g(page, 'mark');
    const downsHeld = (await g(page, 'emblaEvents')).pointerDown - downs0;
    await page.mouse.up();
    await sleep(1500);
    const d1 = await g(page, 'mark');
    for (let k = 0; k < 40; k += 1) {
      await page.mouse.wheel(12, 0);
      await sleep(16);
    }
    await sleep(1500);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, 'reorder-wheel-frames.json'), JSON.stringify({ w0, w1, d1, offset: at.offset, frames: fr }));
    const held = fr.slice(0, w1);
    const wheeling = fr.slice(w0, w1);
    const released = fr[w1 - 1];
    const landed = fr[d1 - 1];
    const max = await g(page, 'max');
    const pos0 = fr[0].pos;
    const order1: string[] = await g(page, 'order');
    const landStrip = landed.drawn.p3.x + landed.pos;
    const releasedStrip = released.boxX.p3 + released.pos;
    const nearest = Math.min(max, Math.round(released.pos / PITCH) * PITCH);
    const r = {
      wheelFrames: wheeling.length,
      wheelsSeen: wheeling.reduce((n: number, f: any) => n + (f.wheels ?? 0), 0),
      rowMaxMoveHeldPx: +Math.max(0, ...held.map((f: any) => Math.abs(f.pos - pos0))).toFixed(2),
      emblaPressFramesHeld: held.filter((f: any) => f.emblaPress).length,
      emblaPointerDownsHeld: downsHeld,
      worstDriftWheelPx: +driftOf(wheeling, 'p3', at.offset).toFixed(2),
      rowAtRelease: +released.pos.toFixed(1),
      rowAfterDrop: +landed.pos.toFixed(1),
      nearestStop: nearest,
      releasedStripPx: +releasedStrip.toFixed(1),
      landedStripPx: +landStrip.toFixed(1),
      orderAsLanded: order1.join(',') === orderWith(order0, 'p3', Math.round(landStrip / PITCH)).join(','),
      orderChanges: (await g(page, 'orderChanges')) - commits0,
      controlTravelPx: +Math.max(0, ...fr.slice(d1).map((f: any) => Math.abs(f.pos - landed.pos))).toFixed(1),
    };
    res.wheelDuring = r;
    if (r.wheelFrames < 20) empty.push(`reorder wheelDuring: ${r.wheelFrames} frames over the wheel stream`);
    if (!(r.controlTravelPx >= 100)) empty.push(`reorder wheelDuring control: the same wheel stream after the drop moved the row at most ${r.controlTravelPx} px, so the wheels never reached it`);
    if (r.rowMaxMoveHeldPx > 0.5 || r.emblaPressFramesHeld > 0 || r.emblaPointerDownsHeld > 0) failed.push(`reorder wheelDuring: a wheel during the drag moved the row ${r.rowMaxMoveHeldPx} px (want 0, as the own row), Embla's own drag pressed in ${r.emblaPressFramesHeld} frames, ${r.emblaPointerDownsHeld} pointerDown`);
    if (r.worstDriftWheelPx > 0.5) failed.push(`reorder wheelDuring: the dragged page drifts ${r.worstDriftWheelPx} px from the pointer while the wheel runs`);
    if (Math.abs(r.rowAfterDrop - nearest) > 0.5 || !onGrid(landed.pos, PITCH, max) || Math.abs(landStrip - releasedStrip) > PITCH / 2 || !r.orderAsLanded || r.orderChanges > 1) failed.push(`reorder wheelDuring drop: released at ${r.rowAtRelease}, rests at ${r.rowAfterDrop} (nearest stop ${nearest}); p3 released at strip ${r.releasedStripPx}, landed ${r.landedStripPx}; order as landed ${r.orderAsLanded}, ${r.orderChanges} commits`);
    if (errors.length > 0) failed.push(`reorder wheelDuring: page errors ${errors.join(' | ')}`);
    await close();
  }
  out.reorder = res;
}

// Per presented frame (read in a task after the frame's callbacks, so the marks and the boxes are the ones that frame drew): each slot's
// drawn place in the window, whether it is inert, the drawn scroll and the focused slot.
// tsx names the functions a callback declares (`__name`), which the page does not have: a string evaluate gives it one first.
const shimNames = (page: Page): Promise<void> => page.evaluate('window.__name = window.__name || ((f) => f)');
const startTrace = async (page: Page): Promise<void> => {
  await shimNames(page);
  return page.evaluate(() => {
  const w = window as any;
  w.__trace = [];
  w.__tracing = true;
  const read = (): void => {
    const win = document.querySelector('[data-row-embla-window]')!.getBoundingClientRect();
    const slots = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.rowId!, x: +(r.left - win.left).toFixed(2), w: +r.width.toFixed(2), inert: el.hasAttribute('inert') };
    });
    w.__trace.push({ t: performance.now(), winW: win.width, pos: w.__g.pos(), slots, focused: document.activeElement?.closest<HTMLElement>('[data-row-slot]')?.dataset.rowId ?? null });
  };
  const tick = (): void => {
    if (!w.__tracing) return;
    setTimeout(read, 0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  });
};
const stopTrace = (page: Page): Promise<any[]> => page.evaluate(() => new Promise((done) => {
  const w = window as any;
  w.__tracing = false;
  setTimeout(() => done(w.__trace), 60);
}));
// Inert must be exactly "drawn wholly outside the window". A slot within 1 px of an edge is not judged (a sub-pixel box there could be
// read either way). `crossings` counts slots that were out and then partly in, or the reverse, so a run that crossed no edge proves nothing.
function judgeInert(frames: any[]): { frames: number; wrong: number; awaySeen: number; crossings: number; firstWrong: string[] } {
  let wrong = 0;
  let awaySeen = 0;
  let crossings = 0;
  const firstWrong: string[] = [];
  const was = new Map<string, boolean>();
  frames.forEach((f, k) => {
    for (const sl of f.slots) {
      if (sl.w <= 0.5) continue;
      const away = sl.x + sl.w <= 0.5 || sl.x >= f.winW - 0.5;
      const edge = Math.abs(sl.x + sl.w) < 1 || Math.abs(sl.x - f.winW) < 1;
      if (was.has(sl.id) && was.get(sl.id) !== away) crossings += 1;
      was.set(sl.id, away);
      if (edge) continue;
      if (away) awaySeen += 1;
      if (sl.inert !== away) {
        wrong += 1;
        if (firstWrong.length < 4) firstWrong.push(`frame ${k}: ${sl.id} at ${sl.x}..${+(sl.x + sl.w).toFixed(1)} of ${f.winW} inert ${sl.inert}`);
      }
    }
  });
  return { frames: frames.length, wrong, awaySeen, crossings, firstWrong };
}

if (ONLY.has('inert') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const { page, errors, close } = await open(Array(24).fill(1).join(','), 1800, 900, '&grab=1&bar=0');
  const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
  const judge = async (label: string, act: () => Promise<void>, settleMs = 1600, needCross = true): Promise<any> => {
    await startTrace(page);
    await act();
    await sleep(settleMs);
    const fr = await stopTrace(page);
    const j = judgeInert(fr);
    res[label] = j;
    if (j.frames < 5) empty.push(`inert ${label}: ${j.frames} frames`);
    if (j.awaySeen === 0) empty.push(`inert ${label}: no slot was drawn outside the window, so the check proves nothing`);
    if (needCross && j.crossings === 0) empty.push(`inert ${label}: no slot crossed the window's edge, so the per-frame check proves nothing`);
    if (j.wrong > 0) failed.push(`inert ${label}: ${j.wrong} slot-frames inert where they should not be or the reverse (${j.firstWrong.join('; ')})`);
    return fr;
  };
  await judge('rest', async () => undefined, 300, false);
  await judge('glide', async () => g(page, 'glideToSlot', 6));
  await page.mouse.move(900, 450);
  await judge('wheel', async () => {
    for (let k = 0; k < 40; k += 1) {
      await page.mouse.wheel(14, 0);
      await sleep(16);
    }
  });
  await g(page, 'jumpToSlot', 2);
  await sleep(400);
  await judge('drag', async () => {
    const gapX = await page.evaluate(() => {
      const r = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => el.getBoundingClientRect()).filter((b) => b.left > 100).sort((a, b) => a.left - b.left);
      return (r[0]!.right + r[1]!.left) / 2;
    });
    await page.mouse.move(gapX, 450);
    await page.mouse.down();
    for (let k = 1; k <= 30; k += 1) {
      await page.mouse.move(gapX - 20 * k, 450);
      await sleep(16);
    }
    await page.mouse.up();
  });
  // The summon moves the root next to the view and the glide brings it in over the left edge (p13 goes out at the right).
  await g(page, 'jumpToSlot', 10);
  await sleep(500);
  await judge('summon', async () => g(page, 'summon'));
  // A page moved out of view by its grab strip: ArrowRight on the page at the window's right edge; the row glides to show it.
  await g(page, 'jumpToSlot', 0);
  await sleep(500);
  const rightEdge = await page.evaluate(() => {
    const win = document.querySelector('[data-row-embla-window]')!.getBoundingClientRect();
    const el = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].find((e) => Math.abs(e.getBoundingClientRect().right - win.right) < 2);
    return el?.querySelector<HTMLElement>('[data-grab]')?.dataset.grab ?? null;
  });
  if (rightEdge === null) empty.push('inert reorder: no grab strip on the right-edge page');
  else {
    await page.focus(`[data-grab="${rightEdge}"]`);
    await judge('reorder', async () => page.keyboard.press('ArrowRight'));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  // A far dot press glides p20 in: it is not inert where it is drawn in the window, and takes focus when it is focused.
  await g(page, 'jumpToSlot', 0);
  await sleep(500);
  const p20 = await g(page, 'idOf', 'p20');
  const dot = await g(page, 'dotRect', p20);
  const pressFrames = await judge('dotPress', async () => page.mouse.click(dot.left + dot.width / 2, dot.top + 4));
  const shownAt = pressFrames.findIndex((f: any) => { const sl = f.slots.find((x: any) => x.id === p20); return sl !== undefined && sl.x < f.winW - 1; });
  const focusIn = await page.evaluate((id: string) => {
    const box = document.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"] [data-box]`)!;
    box.focus();
    return document.activeElement?.closest<HTMLElement>('[data-row-slot]')?.dataset.rowId === id;
  }, p20);
  res.dotPressFocus = { p20EntersAtFrame: shownAt, focusTaken: focusIn };
  if (shownAt < 0) failed.push('inert dotPress: p20 never came into the window');
  if (!focusIn) failed.push('inert dotPress: p20, brought into view by its dot, did not take focus');
  // A page wholly outside takes no focus.
  const awayFocus = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-row-slot][inert] [data-box]');
    if (el === null) return null;
    el.focus();
    return document.activeElement === el;
  });
  res.awayFocus = awayFocus;
  if (awayFocus === null) empty.push('inert focus: no inert slot to try');
  else if (awayFocus) failed.push('inert focus: a page wholly outside the window took focus');
  if (errors.length > 0) failed.push(`inert: page errors ${errors.join(' | ')}`);
  await close();
  // Focus reveal: on the mixed row at slot 0 the three-slot p2 is cut by the right edge; focused, it comes in whole, on the grid.
  {
    const m = await open(ROWS.mixed);
    const p2 = await g(m.page, 'idOf', 'p2');
    const before = await g(m.page, 'pos');
    const inertBefore = (await g(m.page, 'inertIds')).includes(p2);
    await m.page.evaluate((id: string) => document.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"] [data-box]`)!.focus(), p2);
    await sleep(1800);
    const after = await g(m.page, 'pos');
    const win = await g(m.page, 'win');
    const lefts = await g(m.page, 'stripLefts');
    const k = (await g(m.page, 'ids')).indexOf(p2);
    const w = (await g(m.page, 'widths'))[k];
    res.focusReveal = { before, after, inertBefore, p2Left: lefts[p2] ?? null, width: w };
    if (inertBefore) failed.push('inert focusReveal: p2, partly in the window, was inert');
    if (Math.abs(after - before) < 0.5) failed.push(`inert focusReveal: focusing the cut p2 left the row at ${after}`);
    if (!onGrid(after, PITCH, await g(m.page, 'max'))) failed.push(`inert focusReveal: rest ${after} off the grid`);
    if (m.errors.length > 0) failed.push(`inert focusReveal: page errors ${m.errors.join(' | ')}`);
    void win;
    await m.close();
  }
  out.inert = res;
}

if (ONLY.has('open') && ENGINE === 'embla') {
  const res: Record<string, unknown> = {};
  const NARROW = Array(24).fill(1).join(',');
  // Where the opened page is drawn in the window, the root, and the drawn scroll.
  const shown = async (page: Page): Promise<any> => {
    await shimNames(page);
    return page.evaluate(() => {
    const w = window as any;
    const win = document.querySelector('[data-row-embla-window]')!.getBoundingClientRect();
    const rect = (id: string | undefined): { x: number; r: number } | null => {
      const el = id === undefined ? null : document.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"]`);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: +(b.left - win.left).toFixed(1), r: +(b.right - win.left).toFixed(1) };
    };
    const x = w.__g.extraIds().at(-1);
    return { pos: +w.__g.pos().toFixed(1), winW: win.width, x: rect(x), root: rect(w.__g.idOf('root')), rootView: w.__g.rootView(), max: w.__g.max() };
    });
  };
  const whole = (r: { x: number; r: number } | null, winW: number): boolean => r !== null && r.x >= -0.5 && r.r <= winW + 0.5;
  const outside = (r: { x: number; r: number } | null, winW: number): boolean => r === null || r.r <= 0.5 || r.x >= winW - 0.5;
  const steps = (fr: any[]): { moved: number; worstStep: number; movingFrames: number } => {
    let worst = 0;
    let moving = 0;
    for (let k = 1; k < fr.length; k += 1) {
      const d = Math.abs(fr[k].pos - fr[k - 1].pos);
      worst = Math.max(worst, d);
      if (d > 0.01) moving += 1;
    }
    return { moved: fr.length === 0 ? 0 : +(fr.at(-1).pos - fr[0].pos).toFixed(1), worstStep: +worst.toFixed(1), movingFrames: moving };
  };
  {
    const { page, errors, close } = await open(NARROW);
    const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
    const before = await shown(page);
    await startTrace(page);
    await g(page, 'openExtra');
    await sleep(2200);
    const fr = await stopTrace(page);
    const after = await shown(page);
    const st = steps(fr);
    res.atRest = { before, after, ...st };
    if (!whole(before.root, before.winW)) empty.push('open atRest: the Workspace was not in view before, so carrying it out proves nothing');
    if (!whole(after.x, after.winW)) failed.push(`open atRest: the opened page is not whole in view (${JSON.stringify(after.x)}, row at ${after.pos})`);
    if (!outside(after.root, after.winW)) failed.push(`open atRest: the Workspace is still in view (${JSON.stringify(after.root)})`);
    if (!onGrid(after.pos, PITCH, after.max)) failed.push(`open atRest: rest ${after.pos} off the grid`);
    // A glide, not a jump: many frames, none carrying a quarter of the way (a far page makes the steps long).
    if (st.movingFrames < 8 || st.worstStep > 0.25 * Math.abs(st.moved)) failed.push(`open atRest: ${st.movingFrames} moving frames, worst ${st.worstStep} px of ${st.moved} (a jump, not a glide)`);
    if (errors.length > 0) failed.push(`open atRest: page errors ${errors.join(' | ')}`);
    // Opened mid-glide toward the start: the row rests showing the new page, on the grid.
    await g(page, 'jumpToSlot', 8);
    await sleep(500);
    await g(page, 'glideToSlot', 3);
    await sleep(80);
    await g(page, 'openExtra');
    await sleep(2200);
    const mid = await shown(page);
    res.midGlide = mid;
    if (!whole(mid.x, mid.winW) || !onGrid(mid.pos, PITCH, mid.max)) failed.push(`open midGlide: rest ${mid.pos}, the opened page at ${JSON.stringify(mid.x)} (want whole, on the grid)`);
    await close();
  }
  {
    // Opened while a mouse drag holds the row: it stays under the pointer until the release, then shows the page.
    const { page, errors, close } = await open(NARROW);
    const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
    const gapX = await page.evaluate(() => {
      const r = [...document.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => el.getBoundingClientRect()).filter((b) => b.left > 100).sort((a, b) => a.left - b.left);
      return (r[0]!.right + r[1]!.left) / 2;
    });
    await page.mouse.move(gapX, 450);
    await page.mouse.down();
    for (let k = 1; k <= 10; k += 1) {
      await page.mouse.move(gapX - 15 * k, 450);
      await sleep(16);
    }
    const held0 = await g(page, 'pos');
    await g(page, 'openExtra');
    await sleep(700);
    const held1 = await g(page, 'pos');
    await page.mouse.up();
    await sleep(2200);
    const after = await shown(page);
    res.underDrag = { held0, held1, after };
    if (!(held0 > 50)) empty.push(`open underDrag: the drag moved the row only ${held0} px, so holding proves nothing`);
    // The pointer is 150 px from where it pressed: the row stays there (Embla's drag spring may still be catching up at held0).
    if (Math.abs(held1 - 150) > 5) failed.push(`open underDrag: the row is at ${held1} under a drag held 150 px from its press (it was at ${held0})`);
    if (!whole(after.x, after.winW) || !onGrid(after.pos, PITCH, after.max)) failed.push(`open underDrag: after the release the row rests at ${after.pos}, the opened page at ${JSON.stringify(after.x)} (want whole, on the grid)`);
    if (errors.length > 0) failed.push(`open underDrag: page errors ${errors.join(' | ')}`);
    await close();
  }
  {
    const { page, errors, close } = await open(NARROW, 1800, 900, '', ENGINE, { reducedMotion: 'reduce' });
    const PITCH = await page.evaluate(() => (window as any).__g.PITCH);
    await startTrace(page);
    await g(page, 'openExtra');
    await sleep(1500);
    const fr = await stopTrace(page);
    const after = await shown(page);
    const st = steps(fr);
    res.reduced = { after, ...st };
    if (!whole(after.x, after.winW) || !onGrid(after.pos, PITCH, after.max)) failed.push(`open reduced: rest ${after.pos}, the opened page at ${JSON.stringify(after.x)} (want whole, on the grid)`);
    if (st.movingFrames > 2) failed.push(`open reduced: the row moved in ${st.movingFrames} frames (want at once)`);
    if (errors.length > 0) failed.push(`open reduced: page errors ${errors.join(' | ')}`);
    await close();
  }
  out.open = res;
}

await browser.close();
server.close();
console.log(JSON.stringify(out, null, 1));
if (empty.length > 0) {
  console.error(`proved nothing: ${empty.join('; ')}`);
  process.exit(2);
}
process.exit(failed.length > 0 ? 1 : 0);
