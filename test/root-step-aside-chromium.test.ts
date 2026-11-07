/**
 * The root stepping aside in a real browser: a row that swaps never draws a panel cut off, on a press, a size pick or a window drag. jsdom
 * has no geometry, so this is the only place these rules can fail. Needs Playwright and Chromium; it skips when either is missing. The page
 * is tools/proof/gesture-entry.tsx.txt, measuring the window as the library's own mount does.
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './support/chromium.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Page {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: ((arg: A) => T) | string, arg?: A): Promise<T>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  mouse: { move(x: number, y: number): Promise<void>; click(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
}

async function rig(t: TestContext): Promise<{ open(query: string, width: number): Promise<Page> } | undefined> {
  const browser = await launchChromium<Page>(t, 'root-step-aside-chromium.test.ts');
  if (browser === undefined) return undefined;
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'root-aside-'));
  writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/gesture-entry.tsx.txt'), 'utf8'));
  await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT.replace(/\/$/, '') }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
  const html = '<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
  const server = createServer((req, res) => {
    const js = req.url?.startsWith('/out.js') === true;
    res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
    res.end(js ? readFileSync(join(dir, 'out.js')) : html);
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    server.close();
  });
  return {
    async open(query, width) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
      await page.goto(`http://localhost:${port}/?${query}&park=1&rootpark=1&flush=1`);
      await page.waitForFunction(() => (window as unknown as { __g?: { ready(): boolean } }).__g?.ready());
      await page.waitForTimeout(400);
      await page.mouse.move(500, 300);
      return page;
    },
  };
}

interface Seen {
  ids: string[];
  widths: number[];
  /** Each visible slot's id and its edges in the window. */
  slots: { id: string; left: number; right: number }[];
  window: number;
}

/** What the row draws now, read from the page: the numbers, and every slot a person can see. */
const SEEN = `(() => {
  const n = window.__g.provided().rowNumbers;
  const slots = [...document.querySelectorAll('[data-row-slot]')].filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.rowId, left: r.left, right: r.right }; });
  return { ids: [...n.ids, ...n.held.map((h) => h.id)], widths: [...n.widths], slots, window: innerWidth };
})()`;
const seen = (page: Page): Promise<Seen> => page.evaluate(SEEN) as Promise<Seen>;
const press = async (page: Page, key: 'ArrowLeft' | 'ArrowRight'): Promise<Seen> => {
  await page.keyboard.press(key);
  await page.waitForTimeout(750);
  return seen(page);
};
const sized = async (page: Page, width: number): Promise<Seen> => {
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(800);
  return seen(page);
};
const panelsOf = (s: Seen): number[] => s.ids.filter((id) => id !== 'root').map(Number).sort((a, b) => a - b);

/** One unbroken run of the list, and every panel a person can see wholly inside the window. */
function assertSettled(s: Seen, trace: string): void {
  assert.ok(s.ids.length > 0, `control: the row draws something: ${trace}`);
  const run = panelsOf(s);
  for (let k = 1; k < run.length; k += 1) assert.equal(run[k], run[k - 1]! + 1, `the run is broken at ${run.join(' ')}: ${trace}`);
  assert.deepEqual(s.slots.map((x) => x.id).sort(), [...s.ids].sort(), `the visible slots are the drawn ones: ${trace}`);
  for (const x of s.slots) assert.ok(x.left >= -0.5 && x.right <= s.window + 0.5, `panel ${x.id} is cut, ${x.left}..${x.right} in ${s.window}: ${trace}`);
}

/** The panels shown in each painted frame until stopped: read in a task after the frame's own, so a commit made ahead of the paint counts. */
const WATCH = `(() => {
  const rec = { frames: 0, cut: [], shown: new Set(), stop: false };
  window.__frames = rec;
  const read = () => {
    rec.frames += 1;
    const w = innerWidth;
    const slots = [...document.querySelectorAll('[data-row-slot]')].filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.rowId, left: Math.round(r.left), right: Math.round(r.right) }; });
    rec.shown.add(slots.map((x) => x.id).sort().join(' '));
    for (const x of slots) if (x.left < -1 || x.right > w + 1) rec.cut.push(w + ':' + x.id + ':' + x.left + '..' + x.right);
  };
  const tick = () => { if (rec.stop) return; const c = new MessageChannel(); c.port1.onmessage = read; c.port2.postMessage(0); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`;
const stopWatch = (page: Page): Promise<{ frames: number; cut: string[]; shown: string[] }> => page.evaluate('(() => { const r = window.__frames; r.stop = true; return { frames: r.frames, cut: r.cut, shown: [...r.shown] }; })()') as Promise<{ frames: number; cut: string[]; shown: string[] }>;

/** Drags the window's edge from `from` to `to`, a few px at a time. */
async function dragWindow(page: Page, from: number, to: number, stepPx = 7): Promise<void> {
  const dir = Math.sign(to - from);
  for (let w = from; dir * (to - w) > 0; w += dir * stepPx) await page.setViewportSize({ width: w, height: 800 });
  await page.setViewportSize({ width: to, height: 800 });
  await page.waitForTimeout(150);
}

const WIDE = 'slots=1,3,1,3,1,2,1,1';

for (const hold of [null, 'left', 'both', 'right']) {
  const q = hold === null ? WIDE : `${WIDE}&hold=${hold}`;
  test(`a wide panel that cannot fit beside the root arrives whole, the root aside (hold ${hold})`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(q, 1400);
    let s = await seen(page);
    assert.ok(s.ids.includes('root'), 'control: the root starts drawn');
    for (let k = 0; k < 3; k += 1) s = await press(page, 'ArrowLeft');
    assert.deepEqual(s.ids, ['5'], `three presses left reach the wide panel alone: ${JSON.stringify(s)}`);
    assert.deepEqual(s.widths, [1202]);
    assertSettled(s, 'the wide panel');
    // Stepping away brings the root back, and stepping back steps it aside again.
    s = await press(page, 'ArrowRight');
    assert.ok(s.ids.includes('root'), `a step away returns the root: ${s.ids.join(' ')}`);
    assertSettled(s, 'away');
    s = await press(page, 'ArrowLeft');
    assert.deepEqual(s.ids, ['5'], 'a step back steps it aside again');
  });
}

test('stepping left from a wide first panel reaches the root, and stepping right returns the panel', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=3,1,1&hold=left', 1400);
  let s = await seen(page);
  for (let k = 0; k < 3 && !s.ids.includes('2'); k += 1) s = await press(page, 'ArrowLeft');
  assert.deepEqual(s.ids, ['2'], `control: the wide first panel is shown alone: ${s.ids.join(' ')}`);
  s = await press(page, 'ArrowLeft');
  assert.deepEqual(s.ids, ['root'], 'a step left reaches the root, and the panel that cannot sit beside it parks');
  assertSettled(s, 'root alone');
  await page.waitForTimeout(500);
  assert.deepEqual((await seen(page)).ids, ['root'], 'no panel comes back on its own to push the root aside again');
  s = await press(page, 'ArrowRight');
  assert.deepEqual(s.ids, ['2'], 'a step right brings it back whole');
  assertSettled(s, 'back');
});

for (const how of ['dot', 'scrollTo'] as const) {
  test(`the root that stepped aside is reached by ${how === 'dot' ? 'its dot' : 'a host scrollTo'}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open('slots=3,1,1&hold=left', 1400);
    let s = await seen(page);
    for (let k = 0; k < 3 && !s.ids.includes('2'); k += 1) s = await press(page, 'ArrowLeft');
    assert.deepEqual(s.ids, ['2'], 'control: the root is aside');
    if (how === 'scrollTo') await page.evaluate("window.__g.provided().scrollTo('root')");
    else {
      const at = (await page.evaluate(`(() => { const d = window.__g.dots(); const dot = d.dots.find((x) => x.id === 'root'); if (!dot) return null; const bar = document.querySelector('[data-bar-host]').getBoundingClientRect(); return { x: bar.left + dot.left + dot.width / 2, y: bar.top + 15 }; })()`)) as { x: number; y: number } | null;
      assert.ok(at !== null, 'the root keeps a dot while it is aside');
      await page.mouse.click(at.x, at.y);
    }
    await page.waitForTimeout(900);
    s = await seen(page);
    assert.ok(s.ids.includes('root'), `the root is drawn: ${s.ids.join(' ')}`);
    assertSettled(s, how);
  });
}

test('a hold is set aside only with the root: the setting never changes, and the row holds as before once it is back', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  // A cap keeps two panels live whatever the window, so this row overflows and holds; at one, the wide panel alone steps the root aside.
  const page = await r.open('slots=3,3,3&hold=left&maxlive=2', 1000);
  const state = (): Promise<string> => page.evaluate("JSON.stringify([window.__g.provided().rowNumbers.held.map((h) => h.id), window.__g.provided().entries.find((e) => e.id === 'root').settings.edgeHold])") as Promise<string>;
  const before = await state();
  assert.equal(before, '[["root"],"left"]', 'control: the root is held as the row opens');
  await page.evaluate('window.__g.workspace.panels.configureTuning({ maxLivePanels: 1 })');
  await page.waitForTimeout(900);
  assert.equal(await state(), '[[],"left"]', 'aside: nothing is held, and the setting stands');
  assert.ok(!(await seen(page)).ids.includes('root'), 'control: the root is aside');
  await page.evaluate('window.__g.workspace.panels.configureTuning({ maxLivePanels: 2 })');
  await page.waitForTimeout(900);
  assert.equal(await state(), before, 'back: the hold is as it was');
});

test('the window narrowing under a wide panel steps the root aside and growing back returns it, with no cut frame between', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open(`${WIDE}&hold=left`, 1800);
  let s = await seen(page);
  for (let k = 0; k < 6 && !s.ids.includes('5'); k += 1) s = await press(page, 'ArrowLeft');
  assert.deepEqual([...s.ids].sort(), ['5', 'root'], `control: the wide panel fits beside the root: ${s.ids.join(' ')}`);
  await page.evaluate(WATCH);
  await dragWindow(page, 1800, 1400);
  s = await seen(page);
  assert.deepEqual(s.ids, ['5'], 'narrowed: the root is aside');
  assertSettled(s, 'narrowed');
  await dragWindow(page, 1400, 1800);
  s = await seen(page);
  assert.deepEqual([...s.ids].sort(), ['5', 'root'], 'grown: the root is back');
  assertSettled(s, 'grown');
  const f = await stopWatch(page);
  assert.ok(f.frames >= 20, `control: frames were sampled: ${f.frames}`);
  assert.ok(f.shown.includes('5') && f.shown.includes('5 root'), `control: both rows were painted: ${f.shown.join(' | ')}`);
  assert.deepEqual(f.cut.slice(0, 5), [], `no painted frame cuts a panel (${f.cut.length} of ${f.frames})`);
});

test('a window narrower than the panel caps it to fit, and its size comes back as the window grows, with no cut frame', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open(`${WIDE}&hold=left`, 1400);
  let s = await seen(page);
  for (let k = 0; k < 3; k += 1) s = await press(page, 'ArrowLeft');
  assert.deepEqual(s.widths, [1202], 'control: the panel is three slots');
  await page.evaluate(WATCH);
  await dragWindow(page, 1400, 900);
  s = await seen(page);
  assert.deepEqual(s.ids, ['5']);
  assert.deepEqual(s.widths, [796], 'capped to the whole slots that fit');
  assertSettled(s, 'capped');
  await dragWindow(page, 900, 1400);
  s = await seen(page);
  assert.deepEqual(s.widths, [1202], 'its own size comes back');
  assertSettled(s, 'restored');
  const f = await stopWatch(page);
  assert.ok(f.frames >= 20, `control: frames were sampled: ${f.frames}`);
  assert.deepEqual(f.cut.slice(0, 5), [], `no painted frame cuts a panel (${f.cut.length} of ${f.frames})`);
});

test('the size menu keeps every width that fits the window, and picking one too wide to sit beside the root steps it aside', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1&hold=left', 1400);
  let s = await seen(page);
  assert.ok(s.ids.includes('root') && s.ids.includes('4'), `control: ${s.ids.join(' ')}`);
  assert.equal(await page.evaluate('window.__g.provided().maxLiveWidth'), 1368, 'the menu offers what the window fits, not what fits beside the root');
  await page.evaluate('window.__g.setSlots(2, 3)');
  await page.waitForTimeout(900);
  s = await seen(page);
  assert.deepEqual(s.ids, ['4'], `the picked panel is alone: ${s.ids.join(' ')}`);
  assert.deepEqual(s.widths, [1202]);
  assertSettled(s, 'picked');
  assert.equal(await page.evaluate('window.__g.provided().maxLiveWidth'), 1368, 'and the menu reads the same with the root aside');
});

for (const [seed, hold] of [[7, 'left'], [11, null], [23, 'left']] as const) {
  test(`a seeded walk of presses and window sizes rests every time on one unbroken run, nothing cut (seed ${seed})`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(hold === null ? WIDE : `${WIDE}&hold=${hold}`, 1400);
    let x = seed;
    const next = (n: number): number => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return Math.floor(x / 65536) % n;
    };
    const widths = [900, 1100, 1400, 1650, 1800, 2300];
    let trace = '';
    const rows = new Set<string>();
    for (let k = 0; k < 30; k += 1) {
      const kind = next(3);
      let s: Seen;
      if (kind === 2) {
        const w = widths[next(widths.length)]!;
        trace += ` w${w}`;
        s = await sized(page, w);
      } else {
        trace += kind === 0 ? ' >' : ' <';
        s = await press(page, kind === 0 ? 'ArrowRight' : 'ArrowLeft');
      }
      trace += `(${s.ids.join('-')})`;
      rows.add(s.ids.join(' '));
      assertSettled(s, trace);
    }
    assert.ok(rows.size >= 4, `control: the walk moved the row: ${trace}`);
    assert.ok([...rows].some((row) => !row.includes('root')), `control: the walk stepped the root aside: ${trace}`);
  });
}

test('a row that scrolls keeps its edge rule: the root stays beside a wide panel, cut at the window edge', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=3,3&hold=left&scrollrow=1', 1400);
  const s = await seen(page);
  assert.ok(s.ids.includes('root'), `the root stays: ${s.ids.join(' ')}`);
  assert.ok(s.slots.some((x) => x.right > s.window + 1), `control: a panel is cut at the edge, as the rule allows: ${JSON.stringify(s.slots)}`);
});
