/**
 * What the rendered side-by-side test files share: the proof page served to headless Chromium, the reads off it, and the real-key
 * Tab walks. Each file registers `rigUp` and `rigDown` as its own hooks, so every file builds, serves and closes its own browser.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, type LaunchedBrowser } from './chromium.js';

export const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));
// The slice of Playwright's Page these tests use, typed loosely: a page is only reached through functions it evaluates.
export type Page = any;

export interface Rect { left: number; right: number; top: number; bottom: number }
export interface Slot extends Rect { id: string; inert: boolean; group: 'start' | 'end' | null; topmost: boolean }
export interface Cell extends Rect { id: string; shown: boolean; current: boolean }
export interface Shown { id: string; name: string; slots: number; rowSlots: number }

export const PITCH = 390 + 16;
let browser: LaunchedBrowser<Page> | undefined;
let server: Server | undefined;
let port = 0;
let dir = '';
let built = false;

/** Registered by each rendered file as its `before` hook: the scratch directory its bundle is built into. */
export async function rigUp(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'side-rendered-'));
}
/** Registered by each rendered file as its `after` hook: closes the browser and server and removes the scratch directory. */
export async function rigDown(): Promise<void> {
  await browser?.close();
  server?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
}

/** Bundles the proof page once and serves it, then launches the browser; false (with the skip said) when there is no Chromium. */
export async function ready(t: { skip(reason: string): void }): Promise<boolean> {
  browser ??= await launchChromium<Page>(t, 'side-by-side-rendered');
  if (browser === undefined) return false;
  if (!built) {
    built = true;
    const { build } = await import('esbuild');
    writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT_DIR, 'tools/proof/side-entry.tsx.txt'), 'utf8'));
    await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT_DIR }, nodePaths: [join(ROOT_DIR, 'node_modules')], logLevel: 'silent' });
    const html = '<!doctype html><html><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
    server = createServer((req, res) => {
      const js = req.url?.startsWith('/out.js') === true;
      res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
      res.end(js ? readFileSync(join(dir, 'out.js')) : html);
    }).listen(0);
    port = (server.address() as { port: number }).port;
  }
  return true;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Opens the page at `query` in a window `width` wide, runs `body`, and closes the context. */
export async function onPage(width: number, query: string, body: (page: Page, errors: string[]) => Promise<void>): Promise<void> {
  const ctx = await browser!.newContext({ viewport: { width, height: 900 } });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  try {
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => (window as any).__s?.ready(), undefined, { timeout: 20000 });
    await sleep(500);
    await body(page, errors);
    assert.deepEqual(errors, [], 'the page threw');
  } finally {
    await ctx.close();
  }
}

export const cells = (page: Page): Promise<Cell[]> => page.evaluate(() => (window as any).__s.cells());
export const shown = (page: Page): Promise<Shown[]> => page.evaluate(() => (window as any).__s.shown());
export const slots = (page: Page, id: string): Promise<Slot[]> => page.evaluate((i: string) => (window as any).__s.slots(i), id);
export const offset = (page: Page, id: string): Promise<number> => page.evaluate((i: string) => (window as any).__s.offset(i), id);
export const stripWindow = (page: Page, id: string): Promise<Rect> => page.evaluate((i: string) => (window as any).__s.window(i), id);
export const dividers = (page: Page): Promise<(Rect & { now: string; min: string; max: string; text: string })[]> => page.evaluate(() => (window as any).__s.dividers());
export const call = (page: Page, body: string): Promise<any> => page.evaluate(`(() => { const c = window.__s.column; const ws = window.__s.column.workspaces; return ${body}; })()`);
export const named = (list: Shown[]): string => list.map((s) => `${s.name} ${s.slots}/${s.rowSlots}`).join(', ');

/** The column is measured after the page's first layout; a verb asked before then answers `not-measured`, so ask until it answers. */
export async function until(page: Page, body: string): Promise<any> {
  let last: unknown;
  for (let k = 0; k < 100; k += 1) {
    last = await call(page, body);
    if ((last as { ok?: boolean }).ok === true) return last;
    await sleep(50);
  }
  throw new Error(`${body} never answered ok: ${JSON.stringify(last)}`);
}

/** Two spaces side by side: Research, then Trip food taking half of its room, then an even split of the row slots. */
export async function twoSides(page: Page, rows: [number, number] = [2, 2]): Promise<void> {
  await until(page, 'c.showSide(ws[1])');
  assert.deepEqual(await call(page, `c.setSplit([${rows.join(',')}])`), { ok: true });
  await sleep(700);
}

/** Waits until every cell's strip has stopped: its drawn scroll holds for 300 ms. */
export async function atRest(page: Page, ids: string[]): Promise<void> {
  let last = '';
  let still = 0;
  for (let k = 0; k < 200; k += 1) {
    const now = (await Promise.all(ids.map((id) => offset(page, id)))).join(',');
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 6) return;
    await sleep(50);
  }
  throw new Error('the rows never came to rest');
}

/** Strip pages a cell draws in sight that its window cuts or does not hold: none at rest. */
export async function cutPages(page: Page, id: string): Promise<string[]> {
  const [all, win] = await Promise.all([slots(page, id), stripWindow(page, id)]);
  return all.filter((x) => x.group === null && !x.inert && (x.left < win.left - 0.5 || x.right > win.right + 0.5)).map((x) => x.id);
}

/** Records `read()` on every frame for `ms` while `act` runs, so a panel that moves for a single frame is seen. */
export async function frames<T>(page: Page, ms: number, read: string, act: () => Promise<void>): Promise<T[]> {
  const pending = page.evaluate(({ span, body }: { span: number; body: string }) => (window as any).__s.sample(span, new Function(`return (${body})`)()), { span: ms, body: `() => { const s = window.__s; return ${read}; }` });
  await sleep(120);
  await act();
  return pending as Promise<T[]>;
}
export const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

export const wholeSlots = (width: number): boolean => Math.abs(((width - 16) / PITCH) - Math.round((width - 16) / PITCH)) < 0.002;


// Tab and Shift+Tab, pressed for real
// ---------------------------------------------------------------------------
// A synthetic keydown has no default action, so only a real press shows where the browser's own step goes after the column's
// handlers ran. Every walk below is read off `document.activeElement` after `page.keyboard.press`.

/** Where focus is: `BODY` when the page holds none, `before` / `after`, `div<k>`, or `<workspace id>:<what>`. */
export const WHERE = `(() => {
  const a = document.activeElement;
  if (a === null || a === document.body) return 'BODY';
  if (a.id === 'before' || a.id === 'after') return a.id;
  if (a.getAttribute('role') === 'separator') return 'div' + a.getAttribute('data-column-divider');
  const cell = a.closest('[data-workspace-cell]');
  const c = cell ? cell.dataset.workspaceId : '?';
  if (a.tagName === 'IFRAME') return c + ':frame>' + (a.contentDocument?.activeElement?.id || 'doc');
  return c + ':' + (a.getAttribute('data-tab') ?? a.getAttribute('data-workspace-neighbour') ?? (a.hasAttribute('data-column-sentinel') ? 'column-' + a.getAttribute('data-column-sentinel') : null) ?? (a.hasAttribute('data-row-sentinel') ? 'row-' + a.getAttribute('data-row-sentinel') : null) ?? (a.hasAttribute('data-workspace-cell') ? 'CELL' : a.tagName));
})()`;

/**
 * The stops a walk must make, worked out here and not by the column: for each shown space left to right, every button, input, frame and
 * element with a tab index of its cell that is neither inert nor a sentinel, then the divider after that space. Inside a cell they go
 * as the cell holds them, but the panels of its row left to right as they are drawn, which a reorder makes unlike the DOM's order.
 */
export const stopsScript = (numbered: boolean): string => `(() => {
  const out = [];
  const tag = (el) => (${numbered} ? '#' + window.__number(el) : '');
  const shown = window.__s.shown();
  shown.forEach((s, k) => {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const found = [];
    let inRow = false;
    for (const el of cell.querySelectorAll('button,input,iframe,summary,[tabindex]')) {
      if (el.closest('[inert]') !== null || el.tabIndex < 0 || !el.checkVisibility() || el.hasAttribute('data-column-sentinel') || el.hasAttribute('data-row-sentinel')) continue;
      const slot = el.closest('[data-row-slot]');
      inRow = inRow || slot !== null;
      const x = slot !== null ? slot.getBoundingClientRect().left : inRow ? Infinity : -Infinity;
      found.push({ x, at: found.length, name: s.id + ':' + (el.tagName === 'IFRAME' ? 'frame>inner' : el.getAttribute('data-tab') ?? el.getAttribute('data-workspace-neighbour') ?? el.tagName) + tag(el) });
    }
    found.sort((a, b) => (a.x === b.x ? a.at - b.at : a.x < b.x ? -1 : 1));
    out.push(...found.map((f) => f.name));
    if (k < shown.length - 1) out.push('div' + k + tag(document.querySelector('[data-column-divider="' + k + '"]')));
  });
  return out;
})()`;
export const STOPS = stopsScript(false);

/** A button in every panel of every cell, the ones the row keeps out of sight too; answers how many of them sit in an inert slot of a shown cell. */
export const PLANT_BUTTONS = `(() => {
  let inert = 0;
  for (const cell of document.querySelectorAll('[data-workspace-cell]')) {
    for (const box of cell.querySelectorAll('[data-box]')) {
      const b = document.createElement('button');
      b.setAttribute('data-tab', box.getAttribute('data-box'));
      b.textContent = box.getAttribute('data-box');
      box.appendChild(b);
      if (!cell.hasAttribute('inert') && b.closest('[inert]') !== null) inert += 1;
    }
  }
  return inert;
})()`;

/** A real button first and last in the page, outside the column. */
export const PLANT_OUTSIDE = `(() => {
  const b = document.createElement('button'); b.id = 'before'; document.body.prepend(b);
  const a = document.createElement('button'); a.id = 'after'; document.body.append(a);
})()`;

/** A frame holding one button as the last thing in the last panel in sight of each shown space, so a cell's last stop is inside a frame. */
export const PLANT_FRAMES = `(async () => {
  const loaded = [];
  for (const s of window.__s.shown()) {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]'));
    const f = document.createElement('iframe');
    f.srcdoc = '<button id="inner">inner</button>';
    f.style.cssText = 'width:100px;height:40px';
    loaded.push(new Promise((r) => f.addEventListener('load', r)));
    boxes[boxes.length - 1].appendChild(f);
  }
  await Promise.all(loaded);
})()`;

export async function tabWalk(page: Page, n: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  for (let k = 0; k < n; k += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(80);
    out.push(await page.evaluate(WHERE));
  }
  return out;
}

/** A frame is one stop however many presses the row spends in and around it. */
export const frameAsOne = (walk: string[]): string[] => walk.map((x) => x.replace(/:frame>.*/, ':frame')).filter((x, k, all) => !(x.endsWith(':frame') && all[k - 1] === x));

/** Presses until focus is on `target`, giving up after `most` presses; the walk with a frame as one stop. */
export async function tabUntil(page: Page, target: string, most: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  while (out[out.length - 1] !== target && out.length < most) out.push(...(await tabWalk(page, 1, shift)));
  return frameAsOne(out);
}

/**
 * A walk that goes out of the page and comes in again at its other end. What a browser does between the two is its own: the headless
 * shell rests on the page's body for one press, the full browser sometimes does and sometimes comes straight back in. So `OUT` stands
 * for the step out, whether or not it took a press of its own, and anything else the walk rests on outside the stops fails the comparison.
 * `n` counts the stops reached, a frame as one.
 */
export async function tabRound(page: Page, n: number, shift = false): Promise<string[]> {
  const out: string[] = [];
  let was: string = await page.evaluate(WHERE);
  await page.evaluate('window.__entered.splice(0)');
  while (frameAsOne(out).filter((x) => x !== 'OUT').length < n) {
    assert.ok(out.length < 3 * n + 3, `the walk never came round: ${out.join(' ')}`);
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(80);
    const now: string = await page.evaluate(WHERE);
    const entered: number = await page.evaluate('window.__entered.splice(0).length');
    if (now === 'BODY') out.push('OUT');
    else {
      // A step out of a frame has no source either, and stays in the page.
      if (was !== 'BODY' && !was.includes(':frame') && entered > 0) out.push('OUT');
      out.push(now);
    }
    was = now;
  }
  return out;
}

/** Counts focus that reaches the page with no element it came from: from the browser itself, when the page held focus just before. */
export const WATCH_ENTRY = `(() => {
  window.__entered = [];
  document.addEventListener('focusin', (e) => { if (e.relatedTarget === null) window.__entered.push(1); }, true);
})()`;

export const START = '?:column-start';
export const END = '?:column-end';

/**
 * The stops with the column's own ends among them. Where the space drawn first (last) is not the first (last) shown one in the DOM,
 * the browser's step into or out of the column lands on the column's start (end) and rests there for one press; where the two orders
 * agree the column has no stop of its own at that end. Worked out here from the cells and not from the sentinels.
 */
export async function withEnds(page: Page, stops: string[]): Promise<string[]> {
  const [start, end]: [boolean, boolean] = await page.evaluate(() => {
    const dom = [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')].map((c) => c.dataset.workspaceId);
    const screen = (window as any).__s.shown().map((x: { id: string }) => x.id);
    return [dom[0] !== screen[0], dom[dom.length - 1] !== screen[screen.length - 1]] as [boolean, boolean];
  });
  return [...(start ? [START] : []), ...stops, ...(end ? [END] : [])];
}

/** What a walk round the page from `from` passes, ending on `from` again: every stop of `all`, and the step out of the page between its two ends. */
export function ring(all: string[], from: string, back = false): string[] {
  const seq = back ? [...all].reverse() : all;
  // Two stops can share a name (a summary at each end of a cell): `from` is the first of them in screen order.
  const at = back ? seq.lastIndexOf(from) : seq.indexOf(from);
  return [...seq.slice(at + 1), 'OUT', ...seq.slice(0, at + 1)];
}

export const focusStop = (page: Page, stop: string): Promise<void> =>
  page.evaluate((s: string) => {
    const [id, what] = s.split(':') as [string, string];
    const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${id}"]`)!;
    (cell.querySelector<HTMLElement>(`[data-tab="${what}"]`) ?? cell.querySelector<HTMLElement>(`[data-workspace-neighbour="${what}"]`) ?? cell.querySelector<HTMLElement>(what))!.focus();
  }, stop);

export type Order = 'list' | 'stepped' | 'placed-first';

/** Two spaces side by side in the screen order asked for; answers the names left to right. */
export async function inOrder(page: Page, order: Order): Promise<string[]> {
  if (order === 'placed-first') await until(page, 'c.showSide(ws[1], { at: 0 })');
  else await until(page, 'c.showSide(ws[1])');
  await sleep(700);
  if (order === 'stepped') {
    assert.equal(await call(page, 'c.step("down")'), true);
    await sleep(900);
  }
  return (await shown(page)).map((s) => s.name);
}
export const ON_SCREEN: Record<Order, string[]> = { list: ['Research', 'Trip food'], stepped: ['Notes', 'Trip food'], 'placed-first': ['Trip food', 'Research'] };


// ---------------------------------------------------------------------------
// No walk is a loop
// ---------------------------------------------------------------------------
// A walk that names its stops by what they are cannot tell one page's buttons from the next page's, and a loop between two pages reads
// as a walk. So every element focus rests on is numbered, and a walk from outside the page must come out of it again without resting
// on any element twice.

/** Numbers every element it is asked about, the same element always the same. */
export const NUMBER = `(() => {
  const numbers = new Map();
  window.__number = (el) => {
    if (!numbers.has(el)) numbers.set(el, numbers.size);
    return numbers.get(el);
  };
})()`;
export const WHERE_NUMBERED = `(() => { const at = ${WHERE}; return at === 'BODY' ? at : at + '#' + window.__number(document.activeElement); })()`;
export const isColumnEnd = (stop: string): boolean => /:column-(start|end)#/.test(stop);
/** A walk as the stops it made: without the rests on the column's ends and on a row's own sentinels, and a frame as one stop. */
export const asStops = (walk: string[]): string[] => frameAsOne(walk.filter((x) => !isColumnEnd(x) && !/:row-(start|end)#/.test(x)).map((x) => x.replace(/:frame>.*#/, ':frame>#')));

/** A frame holding one button as the last thing in the panel drawn last of each shown space, which a reorder makes other than its last in the DOM. */
export const PLANT_FRAMES_LAST_DRAWN = `(async () => {
  const loaded = [];
  for (const s of window.__s.shown()) {
    const cell = document.querySelector('[data-workspace-cell][data-workspace-id="' + s.id + '"]');
    const slots = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const f = document.createElement('iframe');
    f.srcdoc = '<button id="inner">inner</button>';
    f.style.cssText = 'width:100px;height:40px';
    loaded.push(new Promise((r) => f.addEventListener('load', r)));
    slots[slots.length - 1].querySelector('[data-box]').appendChild(f);
  }
  await Promise.all(loaded);
  return loaded.length;
})()`;

/**
 * Presses Tab from outside the page until focus has left the page again, and answers every element it rested on. Fails on an element
 * rested on twice, and when `most` presses have not left the page. Leaving is the body holding focus, or focus coming in with no
 * element it came from (the browser went out and straight back in).
 * The walk starts where a button at the page's start (Shift+Tab: end) was focused and then removed: the page then holds no focus,
 * and the browser's next step starts from that place, as it does coming in from its own interface.
 */
export async function walkOut(page: Page, most: number, shift = false): Promise<string[]> {
  await page.evaluate((atEnd: boolean) => {
    const from = document.createElement('button');
    if (atEnd) document.body.append(from);
    else document.body.prepend(from);
    from.focus();
    from.remove();
  }, shift);
  assert.equal(await page.evaluate(WHERE), 'BODY');
  await page.evaluate('window.__entered.splice(0)');
  const seen: string[] = [];
  for (let k = 0; k < most; k += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    await sleep(60);
    const now: string = await page.evaluate(WHERE_NUMBERED);
    const entered: number = await page.evaluate('window.__entered.splice(0).length');
    // A step out of a frame has no source either, and stays in the page.
    if (now === 'BODY' || (seen.length > 0 && entered > 0 && !seen[seen.length - 1]!.includes(':frame>'))) return seen;
    // Inside a frame the presses are the frame's own, and the row sends the first step out of one back into it: a frame is one stop
    // however many presses it holds focus, as long as focus does not come back to it from elsewhere.
    const frame = (x: string): string => x.replace(/:frame>.*#/, ':frame>#');
    const stillInFrame = now.includes(':frame>') && seen.length > 0 && frame(seen[seen.length - 1]!) === frame(now);
    assert.ok(stillInFrame || !seen.map(frame).includes(frame(now)), `${shift ? 'Shift+Tab' : 'Tab'} came back to ${now} without leaving the page: ${[...seen, now].join(' ')}`);
    seen.push(now);
  }
  assert.fail(`${most} presses of ${shift ? 'Shift+Tab' : 'Tab'} never left the page: ${seen.join(' ')}`);
}

/**
 * Both walks through the page as it stands, Tab and Shift+Tab: each passes every stop once in screen order and leaves the page. The
 * column's own start and end may be rested on only where the screen and the DOM disagree at that end. Answers how many stops there are.
 */
export async function walkedBothWays(page: Page): Promise<number> {
  const stops: string[] = await page.evaluate(stopsScript(true));
  const ends = (await withEnds(page, [])).map((x) => x.slice(2));
  for (const shift of [false, true]) {
    const walk = await walkOut(page, 3 * stops.length + 6, shift);
    assert.deepEqual(asStops(walk), shift ? [...asStops(stops)].reverse() : asStops(stops), `${shift ? 'Shift+Tab' : 'Tab'} walks the stops in screen order: ${walk.join(' ')}`);
    for (const rest of walk.filter(isColumnEnd)) assert.ok(ends.some((end) => rest.includes(`:${end}#`)), `${rest} is rested on where the two orders agree: ${walk.join(' ')}`);
  }
  return stops.length;
}

/** Whether some shown space's row draws its panels in an order its DOM does not have. */
export const rowsReordered = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')].some((cell) => {
      const lefts = [...cell.querySelectorAll<HTMLElement>('[data-row-slot]')].filter((x) => x.closest('[inert]') === cell || x.closest('[inert]') === null).map((x) => x.getBoundingClientRect().left);
      return lefts.some((x, k) => k > 0 && x < lefts[k - 1]!);
    }),
  );



export type Arrangement = { spaces: 1 | 2 | 3; order: Order };
export const ARRANGEMENTS: Arrangement[] = [
  { spaces: 1, order: 'list' },
  { spaces: 1, order: 'stepped' },
  ...(['list', 'stepped', 'placed-first'] as const).flatMap((order) => ([2, 3] as const).map((spaces) => ({ spaces, order }))),
];

/** Shows `spaces` spaces in the screen order asked for; answers the ids left to right. */
export async function arrange(page: Page, { spaces, order }: Arrangement): Promise<string[]> {
  if (spaces >= 2) await until(page, order === 'placed-first' && spaces === 2 ? 'c.showSide(ws[1], { at: 0 })' : 'c.showSide(ws[1])');
  if (spaces === 3) await until(page, `c.showSide(ws[2], { at: ${order === 'placed-first' ? 0 : 2} })`);
  await sleep(700);
  if (order === 'stepped') {
    assert.equal(await call(page, 'c.step("down")'), true);
    await sleep(900);
  }
  const ids = (await shown(page)).map((s) => s.id);
  assert.equal(ids.length, spaces);
  return ids;
}


/** One cell of the no-Tab-loop matrix: the walks of `arrangement` with its rows as opened or reordered and the bands as asked. */
export async function noTabLoop(t: { skip(reason: string): void }, arrangement: Arrangement, reorder: boolean, bands: string): Promise<void> {
  const { spaces, order } = arrangement;
    if (!(await ready(t))) return;
    await onPage(spaces === 3 ? 3800 : 2560, `n=4&slots=1,1${bands}`, async (page) => {
      const ids = await arrange(page, arrangement);
      if (reorder) {
        assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true, true]);
        await sleep(900);
      }
      assert.equal(await rowsReordered(page), reorder);
      const ends = await withEnds(page, []);
      assert.equal(ends.length, spaces === 1 || order === 'list' ? 0 : 2, `the screen and the DOM disagree at both ends only when drawn out of list order: ${ids.join(' ')}`);
      await page.evaluate(NUMBER);
      await page.evaluate(WATCH_ENTRY);
      // The library's own controls alone, then a button in every panel as well, which gives the root panel a stop.
      const inSight: number = await page.evaluate(() => [...document.querySelectorAll('[data-workspace-cell]:not([inert]) [data-row-slot]')].filter((x) => x.closest('[inert]') === null).length);
      assert.ok(inSight >= spaces * 3 - 1, `at most one panel of the three a space has is out of sight: ${inSight}, ${named(await shown(page))}`);
      const own = await walkedBothWays(page);
      assert.ok(own >= (inSight - spaces) * 2 + (spaces - 1), `every page in sight has its two controls and every divider is a stop: ${own}`);
      await page.evaluate(PLANT_BUTTONS);
      assert.equal(await walkedBothWays(page), own + inSight, 'and one more stop for every panel in sight');
      // A Tab pressed inside a frame is not the page's to hear: the row acts only once the browser's step has come out of it.
      assert.equal(await page.evaluate(PLANT_FRAMES_LAST_DRAWN), spaces);
      await sleep(300);
      assert.equal(await walkedBothWays(page), own + inSight + spaces, 'and a frame at the end of every space');
    });
}
