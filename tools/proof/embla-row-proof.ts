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
 * settle (runs with gesture, or alone with --only settle) a mouse wheel's notches in bursts with 80/150/300/600 ms pauses, a trackpad
 *        swipe with its momentum tail (flagged and not), and a short scroll stopping just past and just before a stop: per frame, no
 *        move against the scroll, no reversal, each burst 1:1, the rest on the grid and not behind the scroll, settled within 1.8 s.
 *        The ends (settle.end*, settle.midHand): from mid-strip on a row of 25, notch bursts into the start or the end and on past it,
 *        by real (trusted) wheels with the hand's 1 px pointer moves or handed in; per frame the drawn row, Embla's location and
 *        target: the row rests at the end it was scrolled into and never moves back into the strip against the scroll (the stretch
 *        past an end and its spring back are reported, not failed: the step-aside's way back reads it).
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
 *        On presented frames (screencast), the root slides in beside the page leaving its slot, cut back from its side, from either
 *        edge: never under it nor over it (summon.clip).
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
 * inert  a row of 25 one-slot pages in a window of four: every slot drawn wholly outside the window is `inert` and every slot with
 *        any part inside it is not, in every presented frame (read after the frame is drawn) at rest, through a glide, a wheel stream,
 *        a mouse drag, a summon and its dismiss, a page moved out of view by its grab strip, and a far dot press; an inert page takes
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
// Each window column (CSS px, `step` apart) of a presented frame read as R (the root's #243 fill), M (page magenta, `bg=1`), P (a page's
// gradient: neither), at least 90% of the sampled rows, else '?'. Column k is `box.left + k * step`.
const columnKinds = async (png: string, viewW: number, box: Box, step: number): Promise<string> => {
  if (pixelPage === undefined) {
    pixelPage = await (await browser.newContext({ viewport: { width: 200, height: 200 } })).newPage();
    await pixelPage.goto('about:blank');
  }
  return pixelPage.evaluate(async ([b64, vw, b, st]: [string, number, Box, number]) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const x = c.getContext('2d')!;
    x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, bm.height).data;
    const k = bm.width / vw;
    let out = '';
    for (let cx = Math.ceil(b.left); cx < b.left + b.width; cx += st) {
      let r = 0;
      let m = 0;
      let p = 0;
      let n = 0;
      // Below the root's label (24 px type at the top), so the root reads as its fill.
      for (let cy = b.top + 60; cy < b.bottom - 30; cy += 20) {
        const i = (Math.round(cy * k) * bm.width + Math.round(cx * k)) * 4;
        const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
        n += 1;
        if (Math.abs(R - 0x22) <= 10 && Math.abs(G - 0x44) <= 10 && Math.abs(B - 0x33) <= 10) r += 1;
        else if (R > 240 && G < 15 && B > 240) m += 1;
        else p += 1;
      }
      out += n === 0 ? '?' : r / n >= 0.9 ? 'R' : m / n >= 0.9 ? 'M' : p / n >= 0.9 ? 'P' : '?';
    }
    return out;
  }, [png, viewW, box, step] as [string, number, Box, number]);
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
  const CASES_SETTLE: [string, Wheel[][]][] = [
    ['notch80', bursts(80)],
    ['notch150', bursts(150)],
    ['notch300', bursts(300)],
    ['notch600', bursts(600)],
    ['trackpad', trackpad(true)],
    ['trackpadGuessed', trackpad(false)],
    ['justPast', [notches(11, 0)]],
    ['justBefore', [notches(9, 0)]],
  ];
  for (const [label, groups] of CASES_SETTLE) {
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
    writeFileSync(join(OUT, `settle-${label}-frames.json`), JSON.stringify({ events, sent, frames: fr.map((f: any) => ({ t: +f.t.toFixed(1), pos: +f.pos.toFixed(2), wheels: f.wheels, pd: f.pd, pm: f.pm, pu: f.pu, press: f.emblaPress })) }));
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
    let k0 = 0;
    const ratios: number[] = [];
    const fromGlide: number[] = [];
    for (const grp of groups) {
      const first = sent.sent[k0]!;
      const last = sent.sent[k0 + grp.length - 1]!;
      k0 += grp.length;
      const before = [...fr].reverse().find((f: any) => f.t < first);
      const after = fr.find((f: any) => f.t >= last + 80);
      if (before === undefined || after === undefined) continue;
      const k = fr.indexOf(before);
      if (k > 0 && Math.abs(before.pos - fr[k - 1].pos) > 0.5) fromGlide.push(ratios.length);
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
    };
    res[label] = r;
    if (fr.length < 30 || Math.abs(rest - start) < 100) empty.push(`settle ${label}: the stream moved the row ${r.moved} px in ${fr.length} frames, so the checks prove nothing`);
    if (ratios.length !== groups.length) empty.push(`settle ${label}: ${ratios.length} of ${groups.length} bursts were measured`);
    if (r.worstBackPx > 0.5) failed.push(`settle ${label}: the row moved against the scroll in ${r.backFrames} frames, ${r.backPx} px in all (worst ${r.worstBackPx} px in one frame)`);
    if (reversals > 0) failed.push(`settle ${label}: the row reversed ${reversals} times`);
    for (const [j, x] of ratios.entries()) if (!fromGlide.includes(j) && Math.abs(x - 1) > 0.05) failed.push(`settle ${label}: a burst moved the row ${x} px per input px (${ratios.join(', ')}), not 1:1`);
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
  type EndCase = { dir: 1 | -1; from: number; bursts: number; pauses: number[]; mouse: boolean; inPauses: boolean; rootFar?: boolean };
  const CASES_END: [string, EndCase][] = [
    ['endLeftFeed', { dir: -1, from: 8, bursts: 18, pauses: SOME, mouse: false, inPauses: false }],
    ['endRightFeed', { dir: 1, from: -8, bursts: 18, pauses: SOME, mouse: false, inPauses: false }],
    ['endLeft', { dir: -1, from: 8, bursts: 18, pauses: ONE, mouse: true, inPauses: false }],
    ['endRight', { dir: 1, from: -8, bursts: 18, pauses: ONE, mouse: true, inPauses: false }],
    ['endLeftHand', { dir: -1, from: 8, bursts: 18, pauses: SOME, mouse: true, inPauses: true }],
    ['endLeftRootFar', { dir: -1, from: 8, bursts: 18, pauses: ONE, mouse: true, inPauses: false, rootFar: true }],
    // Ground on past the end long enough for the plugin's own rubber band (it damps its pointer back, then ends its gesture).
    ['endLeftLong', { dir: -1, from: 2, bursts: 30, pauses: [0], mouse: true, inPauses: false }],
    ['midHand', { dir: -1, from: 16, bursts: 4, pauses: SOME, mouse: true, inPauses: true }],
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
    const input = wheels.length * NOTCH;
    if (c.mouse) {
      // Trusted input through the DevTools protocol, each on its own node timer (an awaited page.mouse call takes a frame or more).
      const cdp = await page.context().newCDPSession(page);
      const sends: Promise<unknown>[] = [];
      await new Promise<void>((done) => {
        let left = wheels.length + handMoves.length;
        const fire = (ms: number, f: () => Promise<unknown>): void => void setTimeout(() => { sends.push(f()); if (--left === 0) done(); }, ms);
        for (const [ms, dx] of wheels) fire(ms, () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: hand.x, y: hand.y, deltaX: dx, deltaY: 0 }));
        for (const ms of handMoves) fire(ms, () => { hand.x += 1; return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hand.x, y: hand.y }); });
      });
      await Promise.all(sends);
    } else await g(page, 'feedTimed', wheels);
    await sleep(2500);
    const fr = await g(page, 'stop');
    writeFileSync(join(OUT, `settle-${label}-frames.json`), JSON.stringify({ order, max, startPx, end, frames: fr.map((f: any) => ({ t: +f.t.toFixed(1), pos: +f.pos.toFixed(2), loc: f.loc === null ? null : +f.loc.toFixed(2), tgt: f.tgt === null ? null : +f.tgt.toFixed(2), wheels: f.wheels, pd: f.pd, pm: f.pm, pu: f.pu, press: f.emblaPress })) }));
    // A frame moving back against the scroll that lands inside the strip. Embla's drag stretches the row past an end and springs it
    // back to the end (the step-aside reads that stretch toward the root as the way back), so a move back that ends at the end or
    // past it is the stretch, reported as `pastEndPx`, and not counted.
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
      // Embla's target's largest step back against the scroll in one frame, and where it went.
      targetJump: fr.slice(1).reduce((w: [number, number], f: any, k: number) => ((fr[k].tgt - f.tgt) * c.dir < w[0] ? [+((fr[k].tgt - f.tgt) * c.dir).toFixed(1), +f.tgt.toFixed(1)] : w), [0, startPx] as [number, number]),
    };
    res[label] = r;
    if (fr.length < 30 || atEnd < 0 && label.startsWith('end')) empty.push(`settle ${label}: the row never reached its end (${r.drawn}), so the check proves nothing`);
    if (label.startsWith('end') && r.pastEndPx < 600) empty.push(`settle ${label}: only ${r.pastEndPx} px of wheel past the end`);
    if (label.startsWith('end') && r.restFromEndPx > 0.5) failed.push(`settle ${label}: scrolled into the end at ${r.end}, rests at ${r.rest} (${r.restFromEndPx} px from it)`);
    if (r.worstBackPx > 0.5) failed.push(`settle ${label}: the row moved back into the strip against the scroll in ${r.backFrames} frames, ${r.backPx} px in all (worst ${r.worstBackPx} px in one frame)`);
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
  if (Math.abs(w.pxPerInputPx - 1) > 0.05) failed.push(`strip wheel: ${w.pxPerInputPx} px per input px`);
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
  if (want('summon.fromLeft')) {
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
  if (want('summon.arrowAway')) {
    // An arrow key after a summon: a step away from the root returns the row (the dismiss, the pages in view standing still), and the
    // next step goes one stop from where the row rests, not from Embla's selected index, which the summon's and the dismiss's direct
    // writes leave behind. From the left (view p14..p17) and from the right (view p1..p4).
    const { page, errors, close } = await open(row, 1800, 900, '&bar=0');
    if (!(await placeRoot(page, 8))) empty.push('summon arrowAway: the root could not be placed');
    await g(page, 'jumpToSlot', 14);
    await sleep(500);
    await g(page, 'summon');
    await sleep(900);
    if ((await g(page, 'rootView')) !== 'summoned') empty.push('summon arrowAway: the summon from the left did not stand, so this proved nothing');
    const a1 = await step(page, 'arrowAwayLeft', () => page.keyboard.press('ArrowRight'), ['p15', 'p16', 'p17']);
    if (a1.rootView !== 'away' || a1.slots !== 25 || a1.visibleAfter.join() !== 'p14,p15,p16,p17' || Math.abs(a1.rest - 14 * PITCH) > 0.5) fail('arrowAwayLeft', `after ArrowRight: root ${a1.rootView}, ${a1.slots} slots, view ${a1.visibleAfter}, rest ${a1.rest}; want the summon returned, p14..p17 at ${14 * PITCH}`);
    const a2 = await step(page, 'arrowNextLeft', () => page.keyboard.press('ArrowRight'), []);
    if (Math.abs(a2.rest - 15 * PITCH) > 0.5 || a2.visibleAfter.join() !== 'p15,p16,p17,p18') fail('arrowNextLeft', `the next ArrowRight rests ${a2.rest}, view ${a2.visibleAfter}; want one stop on, ${15 * PITCH}, p15..p18`);
    await g(page, 'jumpToSlot', 0);
    await sleep(900);
    await g(page, 'summon');
    await sleep(900);
    if ((await g(page, 'rootView')) !== 'summoned') empty.push('summon arrowAway: the summon from the right did not stand, so this proved nothing');
    const b1 = await step(page, 'arrowAwayRight', () => page.keyboard.press('ArrowLeft'), ['p1', 'p2', 'p3']);
    if (b1.rootView !== 'away' || b1.slots !== 25 || b1.visibleAfter.join() !== 'p1,p2,p3,p4' || Math.abs(b1.rest) > 0.5) fail('arrowAwayRight', `after ArrowLeft: root ${b1.rootView}, ${b1.slots} slots, view ${b1.visibleAfter}, rest ${b1.rest}; want the summon returned, p1..p4 at 0`);
    const b2 = await step(page, 'arrowNextRight', () => page.keyboard.press('ArrowRight'), []);
    if (Math.abs(b2.rest - PITCH) > 0.5 || b2.visibleAfter.join() !== 'p2,p3,p4,p5') fail('arrowNextRight', `the next ArrowRight rests ${b2.rest}, view ${b2.visibleAfter}; want one stop on, ${PITCH}, p2..p5`);
    res.arrowAway = { a1, a2, b1, b2 };
    if (errors.length > 0) fail('arrowAway', `page errors ${errors.join(' | ')}`);
    await close();
  }
  if (want('summon.api')) {
    // Step 8's API loose ends on a strip. A host's panel.scrollTo() answers whether the row moves, read against where the Embla row is
    // heading (the old scroller reads 0 on a strip); a view's presence reads 'scrolledAway' exactly for the pages whose slot is inert;
    // a scrollTo of the Workspace while it is stepped aside brings it back into view (the old row's showRoot).
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
    // The Workspace stepped aside for a three-slot page (1800 > 1400), then a host's scrollTo of it.
    const a = await open('3,1,1,1,1,1,1,1', 1800, 900, '&bar=0');
    await a.page.setViewportSize({ width: 1400, height: 900 });
    await sleep(1200);
    const asideView = await g(a.page, 'rootView');
    const asideSlots = await g(a.page, 'slotCount');
    const rootAnswer = await g(a.page, 'scrollTo', 'root');
    await sleep(1500);
    const after = await shown(a.page);
    const win = await g(a.page, 'win');
    r.aside = { asideView, asideSlots, rootAnswer, rootView: await g(a.page, 'rootView'), root: after.root ?? null, rest: await g(a.page, 'pos') };
    if (asideView !== 'away' || after === undefined) empty.push(`summon api: the root was ${asideView} before the scrollTo, not stepped aside`);
    if ((rootAnswer !== true && rootAnswer?.ok !== true) || r.aside.rootView === 'away' || after.root === undefined || after.root.x < -0.5 || after.root.x + after.root.w > win.width + 0.5) fail('apiAside', `scrollTo of the stepped-aside Workspace answered ${JSON.stringify(rootAnswer)}; root ${r.aside.rootView} at ${JSON.stringify(after.root)}; want it whole in view`);
    if (a.errors.length > 0) fail('apiAside', `page errors ${a.errors.join(' | ')}`);
    await a.close();
    res.api = r;
  }
  if (want('summon.fromRight')) {
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
  if (want('summon.asideResize')) {
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
  if (want('summon.asideSize')) {
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
  if (want('summon.asideCut')) {
    // The same step-aside, then a step away so the four-slot page is cut by the left edge: a summon and its dismiss give that view back
    // (the app's "wide returns": the dismiss rested on the page's left edge instead).
    const { page, errors, close } = await open('2,1,1,1,1,1,1,1');
    await g(page, 'op', 'setSlots', await g(page, 'idOf', 'p1'), 4);
    await sleep(1200);
    await page.keyboard.press('ArrowRight');
    await sleep(1200);
    const m = await shown(page);
    const was = visible(m, (await g(page, 'win')).width).map((id) => `${id}@${Math.round(m[id]!.x)}`).join(' ');
    if (m.root !== undefined || m.p1 === undefined || Math.abs(m.p1.x + PITCH) > 1) empty.push(`summon asideCut: setup is not the root aside with p1 cut one slot (${was})`);
    const s = await step(page, 'asideCutSummon', () => g(page, 'summon'), []);
    const ms = await shown(page);
    if (ms.root?.x !== 0 || s.rootView !== 'summoned') fail('asideCutSummon', `root at ${ms.root?.x}, ${s.rootView}`);
    const d = await step(page, 'asideCutDismiss', () => g(page, 'dismiss'), []);
    const md = await shown(page);
    const now = visible(md, (await g(page, 'win')).width).map((id) => `${id}@${Math.round(md[id]!.x)}`).join(' ');
    if (md.root !== undefined || d.rootView !== 'away' || now !== was) fail('asideCutDismiss', `view ${now} (root ${md.root === undefined ? 'off' : md.root.x}, ${d.rootView}); was ${was}`);
    res.asideCut = { was, summoned: s.visibleAfter, now };
    if (errors.length > 0) fail('asideCut', `page errors ${errors.join(' | ')}`);
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
  if (want('summon.pressDuring')) {
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
  if (want('summon.reduced')) {
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
  if (want('summon.reducedRelease')) {
    // Reduce Motion on the row's own moves (Embla's, not the slots'): a mouse drag's release, a wheel gesture's release with a strip
    // change waiting for it (`moveEmbla`'s rebuild after the release) and a focus reveal each land at once. Read as the frames the row
    // moves after the input ends: a glide takes 20 or more. Each run without Reduce Motion first is the control that the input glides.
    const moving = (fr: any[]): number => fr.slice(1).filter((f: any, k: number) => Math.abs(f.pos - fr[k].pos) > 0.01).length;
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
        // From the gesture's release (the plugin's mouseup): before it the row follows the wheel's drag.
        wheel: { moved: +(wheelFr.at(-1).pos - wheelFr[0].pos).toFixed(1), releaseFrame: wheelFr.findIndex((f: any) => f.pu > 0), movingFrames: moving(wheelFr.slice(Math.max(0, wheelFr.findIndex((f: any) => f.pu > 0)))), rest: wheelFr.at(-1).pos, grid: onGrid(wheelFr.at(-1).pos, PITCH, max) },
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
  if (want('summon.unrelatedClose')) {
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
  if (want('summon.clip')) {
    // The page leaving the slot a summoned root glides into is cut back from the root's side as it comes (PanelRow's arriveAndLeave
    // clip-path), so the root slides in beside it. Read on presented frames (screencast) over that slot, from the side the root enters:
    // the root's run, then the page background between them, then the page. Without the cut, the root came in under the page from
    // the left (no root in the slot until the page left) and over it from the right (root against page, no background between).
    const STEP = 2;
    const clip: Record<string, unknown> = {};
    for (const edge of ['left', 'right'] as const) {
      const label = `clip ${edge}`;
      const { page, errors, close } = await open(row, 1800, 900, '&bar=0&bg=1');
      if (!(await placeRoot(page, 8))) empty.push(`summon ${label}: the root could not be placed`);
      await g(page, 'jumpToSlot', edge === 'left' ? 14 : 0);
      await sleep(900);
      const band = await slotBand(page);
      const cast = await castFrames(page);
      await g(page, 'summon');
      await sleep(1200);
      await cast.stop();
      const root = (await shown(page)).root;
      if (root === undefined || root.w < 100) {
        empty.push(`summon ${label}: the root was not drawn after the summon`);
        await close();
        continue;
      }
      // The slot the root lands in, a few px inside its edges (the window's edge and the frame's rounding read as neither).
      const box = { left: band.left + root.x + 4, width: root.w - 8, top: band.top, bottom: band.bottom };
      let partial = 0;
      let early = 0;
      const over: number[] = [];
      let cols = 0;
      for (const png of cast.shots) {
        const read = await columnKinds(png, 1800, box, STEP);
        const k = edge === 'left' ? read : [...read].reverse().join('');
        cols = k.length;
        const r = /^R*/.exec(k)![0].length;
        if (r < 2 || r > cols - 3) continue;
        partial += 1;
        // While the root has come less than 40% of the way, the cut keeps background (magenta) between it and the page: the gap
        // closes only as the root lands. One column of the root's antialiased edge may read as neither.
        if (r > cols * 0.4) continue;
        early += 1;
        if (!k.slice(r, r + 4).includes('M')) over.push(r * STEP);
      }
      clip[edge] = { shots: cast.shots.length, cols, partialFrames: partial, earlyFrames: early, overFrames: over.length, rootX: root.x };
      if (cast.shots.length < 10) empty.push(`summon ${label}: ${cast.shots.length} presented frames`);
      if (partial < 5) fail(label, `the root was seen partly in its slot in ${partial} of ${cast.shots.length} presented frames: it came in under the page leaving the slot, not beside it`);
      else if (early < 3) empty.push(`summon ${label}: only ${early} presented frames early in the glide, so the gap was not read`);
      if (over.length > 0) fail(label, `in ${over.length} of ${early} presented frames early in the glide the root touched the page with no background between them (root ${over.slice(0, 4).join(', ')} px in): it slid over the page, not beside it`);
      if (errors.length > 0) fail(label, `page errors ${errors.join(' | ')}`);
      await close();
    }
    res.clip = clip;
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
  // The same shrink, on presented frames (a magenta page): the size box and its neighbors' glides ease on one clock, so no painted
  // frame shows a band between two pages wider than one gap (16 px) and a little. The run at rest is the control: it must see the gap.
  if (want('width.shrinkAsidePresented')) {
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
    if (worst.k >= 0) writeFileSync(join(OUT, 'width-shrinkAside-presented-widest.png'), Buffer.from(cast.shots[worst.k]!, 'base64'));
    const restGap = widest[widest.length - 1]?.w ?? 0;
    const r = { shots: cast.shots.length, widestBandPx: worst.w, widestAt: worst.at, widestShot: worst.k, restGapPx: restGap, seq: widest.map((x) => x.w).join(' ') };
    res.shrinkAsidePresented = r;
    if (r.shots < 10 || !(restGap >= 12 && restGap <= 20)) empty.push(`width shrinkAsidePresented: ${r.shots} presented frames, the band at rest reads ${restGap} px (want the 16 px gap), so the pixels prove nothing`);
    if (r.widestBandPx > 16 + 8) fail('shrinkAsidePresented', `a presented frame shows a band of page ${r.widestBandPx} px wide at ${r.widestAt} (frame ${r.widestShot}), want one gap (16 px) and at most 8 px more`);
    if (errors.length > 0) fail('shrinkAsidePresented', `page errors ${errors.join(' | ')}`);
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
        // A jump presents a frame or two; a summon lands the row at once and glides the slots.
        if (shots.length < (name === 'jumpFar' ? 2 : 10) || fr.length < 10 || (moved < 2 && name !== 'summon')) empty.push(`blank ${name} cap ${cap} ${cond}: ${shots.length} presented frames, ${fr.length} animation frames, ${moved} row positions`);
        if (cond === 'hidden') {
          if (blankShots > 0) controlSeen += 1;
          else empty.push(`blank control ${name}: every page's content hidden and no presented frame read blank, so the measure cannot see a blank page`);
        } else {
          // A summon's root slides in over the edge slot while the page leaving it is cut back from the root's side: no presented frame
          // shows a band of the page between them wider than one gap (16 px) and a little (it was about 220 px for 11 frames at 2c8d40b).
          if (name === 'summon' && r.widestBlankPx > 16 + 8) failed.push(`blank summon cap ${cap}: a presented frame shows a band of the page ${r.widestBlankPx} px wide in the window (${widths.filter((w) => w > 24).length} of ${shots.length} frames), want one gap and at most 8 px more`);
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
    const downs0 = (await g(page, 'emblaEvents')).pointerDown;
    for (let k = 0; k < 12; k += 1) {
      await page.mouse.wheel(14, 0);
      await sleep(16);
    }
    const wheelDowns = (await g(page, 'emblaEvents')).pointerDown - downs0;
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
      wheelPointerDowns: wheelDowns,
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
    if (r.wheelPointerDowns < 1 || Math.abs(r.wheelTravelPx) < 20) empty.push(`reorder wheelBefore: the wheel moved the row ${r.wheelTravelPx} px (${r.wheelPointerDowns} gestures), so no gesture was running at the press`);
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
  // The summon brings the root in over the left edge while the page in that slot leaves; the dismiss takes it back out.
  await g(page, 'jumpToSlot', 10);
  await sleep(500);
  await judge('summon', async () => g(page, 'summon'));
  await judge('dismiss', async () => g(page, 'dismiss'));
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
