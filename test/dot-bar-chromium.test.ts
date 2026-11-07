/**
 * The dot bar against the row as drawn in a real browser: the oval's place is checked against a panel's box on screen, not against the
 * number the bar was given, at rest, on every frame of a glide and under a dragged pointer. jsdom has no geometry, so this is the only place
 * these rules can fail. Needs Playwright and Chromium; it skips when either is missing. The page is tools/proof/gesture-entry.tsx.txt.
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
  evaluate<T>(fn: string): Promise<T>;
  mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
}

async function rig(t: TestContext): Promise<{ open(query: string, width: number): Promise<Page> } | undefined> {
  const browser = await launchChromium<Page>(t, 'dot-bar-chromium.test.ts');
  if (browser === undefined) return undefined;
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'dot-bar-'));
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
      await page.goto(`http://localhost:${port}/?${query}&flush=1`);
      await page.waitForFunction(() => (window as unknown as { __g?: { ready(): boolean } }).__g?.ready());
      await page.waitForTimeout(500);
      await page.mouse.move(500, 300);
      return page;
    },
  };
}

interface Sample {
  /** The oval's left edge in the bar, read from its box. */
  oval: number;
  /** Each panel's left on screen, for those the row has drawn. */
  at: Record<string, number>;
  /** Each dot's left in the bar, read from its box. */
  dots: Record<string, number>;
  riding: string[];
  scale: number;
}

// Reads boxes only, apart from the ids and which dot rides. The track px per screen px is one dot slot over one row slot.
const SAMPLE = `window.__sample = () => {
  const bar = document.querySelector('[data-dot-bar]').getBoundingClientRect();
  const d = window.__g.dots();
  const at = {};
  for (const el of document.querySelectorAll('[data-row-slot]')) at[el.dataset.rowId] = el.getBoundingClientRect().left;
  const dots = {};
  for (const el of document.querySelectorAll('[data-dot]')) dots[el.dataset.dot] = el.getBoundingClientRect().left - bar.left;
  return { oval: document.querySelector('[data-oval]').getBoundingClientRect().left - bar.left, at, dots, riding: d.dots.filter((x) => x.riding).map((x) => x.id), scale: 30 / (390 + 16) };
}; 0`;

const sample = (page: Page): Promise<Sample> => page.evaluate<Sample>('window.__sample()');

/** Where the window is on the ruler, in bar px, read from a panel's box: `origin` is that panel's dot with the row at its first rest. */
function windowAt(s: Sample, calm: Sample, id: string): number {
  return calm.oval + (calm.at[id]! - s.at[id]!) * s.scale;
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(900);
}

const ROWS = [
  ['phones', 'slots=1,1,1,1,1,1,1,1&scrollrow=1'],
  ['a wide panel', 'slots=1,3,1,2,1,1,1&scrollrow=1'],
  ['the root held at the left', 'slots=1,1,2,1,1,1,1,1&scrollrow=1&hold=left'],
] as const;

for (const [name, query] of ROWS) {
  test(`the oval is the window on the ruler at every rest and on every frame of a glide: ${name}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(query, 1400);
    await page.evaluate(SAMPLE);
    const calm = await sample(page);
    const id = await page.evaluate<string>('window.__g.ids()[1]');
    assert.ok(calm.at[id] !== undefined, `control: ${id} is drawn`);
    let moved = 0;
    for (let k = 0; k < 3; k += 1) {
      await page.evaluate(`(() => { window.__frames = []; window.__on = true; const tick = () => { window.__frames.push(window.__sample()); if (window.__on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
      await page.keyboard.press('ArrowRight');
      await settle(page);
      const frames = await page.evaluate<Sample[]>('(() => { window.__on = false; return window.__frames; })()');
      const rest = frames.at(-1)!;
      assert.ok(Math.abs(rest.oval - windowAt(rest, calm, id)) < 0.5, `at rest after step ${k + 1}: oval ${rest.oval}, window ${windowAt(rest, calm, id)}`);
      frames.forEach((f, i) => {
        const want = windowAt(f, calm, id);
        if (i > 0 && Math.abs(want - windowAt(frames[i - 1]!, calm, id)) > 0.01) moved += 1;
        // React paints what an earlier frame's sample set, so the bar trails the row by a few frames' travel: a tenth of a slot, never a dot.
        assert.ok(Math.abs(f.oval - want) <= 3, `mid-glide on step ${k + 1}: oval ${f.oval}, window ${want}`);
      });
    }
    assert.ok(moved >= 6, `control: frames were sampled while the row moved (${moved})`);
  });

  test(`a dragged oval keeps its leading edge under the pointer: ${name}`, async (t) => {
    const r = await rig(t);
    if (r === undefined) return;
    const page = await r.open(query, 1400);
    await page.evaluate(SAMPLE);
    const { x, y } = await page.evaluate<{ x: number; y: number }>(`(() => { const b = document.querySelector('[data-oval]').getBoundingClientRect(); return { x: b.left + 12, y: b.top + b.height / 2 }; })()`);
    const start = await sample(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    const wander = [8, 16, 30, 45, 60, 75, 90, 104, 90, 62, 40, 25, 50, 80];
    for (const dx of wander) {
      await page.mouse.move(x + dx, y);
      await page.waitForTimeout(60);
      const s = await sample(page);
      assert.ok(Math.abs(s.oval - start.oval - dx) < 0.75, `pointer ${dx} along: the oval's edge moved ${s.oval - start.oval}`);
    }
    await page.mouse.up();
  });
}

test('with the root held, the dots hold still as the row moves and the root rides the oval over them', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,2,1,1,1,1,1&scrollrow=1&hold=left', 1400);
  await page.evaluate(SAMPLE);
  const first = await sample(page);
  assert.deepEqual(first.riding, ['root'], 'control: the root rides');
  let rode = 0;
  for (let k = 0; k < 4; k += 1) {
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const s = await sample(page);
    for (const id of Object.keys(first.dots)) if (id !== 'root') assert.ok(Math.abs(s.dots[id]! - first.dots[id]!) < 0.5, `${id}'s dot moved from ${first.dots[id]} to ${s.dots[id]}`);
    assert.ok(Math.abs(s.dots.root! - s.oval) < 0.5, `the root's dot ${s.dots.root} is at the oval's left ${s.oval}`);
    if (s.oval > first.oval + 1) rode += 1;
  }
  assert.ok(rode >= 3, 'control: the oval travelled');
});

/** Presses the oval a little inside its left edge and walks the pointer `path` px along, one sample per place. */
async function dragOval(page: Page, path: readonly number[]): Promise<{ start: Sample; moved: number[] }> {
  const { x, y } = await page.evaluate<{ x: number; y: number }>(`(() => { const b = document.querySelector('[data-oval]').getBoundingClientRect(); return { x: b.left + 12, y: b.top + b.height / 2 }; })()`);
  const start = await sample(page);
  const moved: number[] = [];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const dx of path) {
    await page.mouse.move(x + dx, y);
    await page.waitForTimeout(120);
    moved.push((await sample(page)).oval - start.oval);
  }
  await page.mouse.up();
  return { start, moved };
}

test('in a row that swaps, a dragged oval stays under the pointer both ways and the row comes to rest under it', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  for (const [sign, panels] of [[1, ['root', '7', '8']], [-1, ['root', '3', '4']]] as const) {
    const page = await r.open('slots=1,1,1,1,1,1,1,1&park=1&rootpark=1', 1400);
    await page.evaluate(SAMPLE);
    for (let k = 0; k < 3; k += 1) {
      await page.keyboard.press('ArrowLeft');
      await settle(page);
    }
    assert.deepEqual(await page.evaluate<string[]>('window.__g.ids()'), ['root', '5', '6'], 'control: the row rests mid-way, with panels waiting on both sides');
    const path = [8, 16, 30, 45, 60].map((dx) => sign * dx);
    const { moved } = await dragOval(page, path);
    moved.forEach((m, k) => assert.ok(Math.abs(m - path[k]!) < 0.75, `pointer ${path[k]} along: the oval's edge moved ${m}`));
    await settle(page);
    assert.deepEqual(await page.evaluate<string[]>('window.__g.ids()'), panels, 'the row stepped to where the oval was let go');
  }
});

test('in a row that swaps, an oval already at the bar\'s end stays there and moves off it the other way', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1,1,1&park=1&rootpark=1', 1400);
  await page.evaluate(SAMPLE);
  const { oval, width } = await page.evaluate<{ oval: { left: number; width: number }; width: number }>('(() => { const d = window.__g.dots(); return { oval: d.oval, width: d.width }; })()');
  assert.ok(Math.abs(oval.left + oval.width - width) < 0.5, `control: the oval rests at the bar's right end, ${oval.left} + ${oval.width} of ${width}`);
  const right = await dragOval(page, [8, 16, 30]);
  assert.deepEqual(right.moved.map((m) => Math.round(m)), [0, 0, 0], 'nothing lies past the end');
  await settle(page);
  const left = await dragOval(page, [-8, -16]);
  assert.ok(Math.abs(left.moved[0]! + 8) < 0.75 && Math.abs(left.moved[1]! + 16) < 0.75, `off the end the oval follows: ${left.moved.join(' ')}`);
});

test('in a row that swaps, a step moves the oval one slot and no dot', async (t) => {
  const r = await rig(t);
  if (r === undefined) return;
  const page = await r.open('slots=1,1,1,1,1,1,1,1&park=1&rootpark=1', 1400);
  await page.evaluate(SAMPLE);
  const first = await sample(page);
  const parked = await page.evaluate<number>('window.__g.provided().entries.filter((e) => e.live === false).length');
  assert.ok(parked >= 2, `control: panels are parked (${parked})`);
  await page.keyboard.press('ArrowRight');
  await settle(page);
  const stepped = await sample(page);
  assert.ok(Math.abs(stepped.oval - first.oval - 30) < 0.5, `one step is one slot: ${first.oval} to ${stepped.oval}`);
  for (const id of Object.keys(first.dots)) if (!stepped.riding.includes(id)) assert.ok(Math.abs(stepped.dots[id]! - first.dots[id]!) < 0.5, `${id}'s dot moved from ${first.dots[id]} to ${stepped.dots[id]}`);
});
