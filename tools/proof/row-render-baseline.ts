/**
 * Drives the real Workspace in headless Chromium through the moves the jsdom clock cannot judge, and records what is drawn on every
 * animation frame: the strip's transform, opacity and clip, the scroll, and every slot's rect, opacity and scale. It also takes
 * screenshots and checks that what is painted is the panel the page says is there, because a panel can be in the right place and
 * blank, and no number sees that.
 *
 *   node --import tsx tools/proof/row-render-baseline.ts --out <dir> [--write <baseline.json>] [--label <text>] [--compare <baseline.json>] [--only a,b]
 *   node --import tsx tools/proof/row-render-baseline.ts --diff a.json,b.json[,c.json...] [--into a.json]   (noise floor of one tree against itself)
 *
 * --write keeps the frames and summaries (--label names the source they were taken from when it is not this checkout's HEAD); --compare re-runs and diffs each scenario's traces against a kept baseline on a 16 ms grid
 * restarted at every action, so a step-4 change shows as a number, not a feeling. Time is real, so two runs of one tree differ by
 * timing jitter; --diff of two recordings measures that floor and --into stores it in the baseline, and --compare then only flags a
 * drift past 1.5 times it. Headless only; exits 1 when it could
 * not run a scenario, found a blank panel, or --compare found a drift past --tol px (default 4).
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
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
const OUT = arg('out') ?? join(tmpdir(), 'row-render');
const TOL = Number(arg('tol') ?? 4);
const ONLY = arg('only')?.split(',');
mkdirSync(OUT, { recursive: true });

const ACTIONS = new Set(['go', 'step', 'back', 'resize', 'setHold', 'setSlots', 'scrollTo', 'toggleMax', 'far', 'jump']);

// --diff a.json,b.json[,c.json...]: recordings of one tree against each other, which is the noise floor a later --compare must clear
// (the worst of every pair). --into writes the floors into the first file.
const DIFF = arg('diff');
if (DIFF !== undefined) {
  const docs = DIFF.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')));
  if (docs.length < 2) {
    console.log('proved nothing: --diff needs two recordings or more');
    process.exit(1);
  }
  const names = Object.keys(docs[0].scenarios).filter((n) => docs.every((d) => d.scenarios[n] !== undefined));
  if (names.length === 0) {
    console.log('proved nothing: the recordings share no scenario');
    process.exit(1);
  }
  const noise: Record<string, number> = {};
  for (const n of names) {
    let worst = { what: '', px: 0, atMs: 0, segment: '', structure: '' };
    for (let i = 0; i < docs.length; i += 1) {
      for (let j = i + 1; j < docs.length; j += 1) {
        const d = drift(docs[i].scenarios[n].trace, docs[j].scenarios[n].trace);
        if (d.px >= worst.px) worst = d;
      }
    }
    noise[n] = worst.px;
    console.log(`  ${n}: worst of ${(docs.length * (docs.length - 1)) / 2} pairs ${worst.px} px (${worst.what} in ${worst.segment} at ${worst.atMs} ms)${worst.structure === '' ? '' : ` ${worst.structure}`}`);
  }
  if (arg('into') !== undefined) {
    docs[0].meta.noise = noise;
    writeFileSync(arg('into')!, JSON.stringify(docs[0]));
    console.log(`wrote noise floors into ${arg('into')}`);
  }
  process.exit(0);
}

type Page = any;
interface Frame { t: number; strip: { x: number; opacity: number; clip: string }; offset: number; win: number; slots: Record<string, { l: number; r: number; t: number; b: number; o: number; v: number; sx: number }>; held: string[] }
interface Trace { frames: Frame[]; marks: { name: string; t: number }[]; writes: number }
interface Result { trace: Trace; paint: { label: string; checked: number; bad: string[] }[]; holes: { label: string; runs: [number, number][]; state?: { opacity: number[]; x: number[]; offset: number[]; seen: number } }[]; shots: string[] }

const launched = await launchChromium<Page>({ skip: () => {} }, 'row-render-baseline');
if (launched === undefined) process.exit(1);
const browser = launched;

const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'row-render-'));
writeFileSync(join(dir, 'entry.tsx'), readFileSync(join(ROOT, 'tools/proof/row-render-entry.tsx.txt'), 'utf8'));
await build({ entryPoints: [join(dir, 'entry.tsx')], bundle: true, outfile: join(dir, 'out.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, alias: { LIB: ROOT }, nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent' });
// Magenta behind the page: any magenta inside a panel's rect is a panel that was not painted.
const html = '<!doctype html><html><body style="margin:0;background:#ff00ff"><div id="root"></div><script type="module" src="out.js"></script></body></html>';
const server = createServer((req, res) => {
  const js = req.url?.startsWith('/out.js') === true;
  res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  res.end(js ? readFileSync(join(dir, 'out.js')) : html);
}).listen(0);
const port = (server.address() as { port: number }).port;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Decodes a screenshot inside the page and reads the pixels at `points`.
async function pixels(page: Page, png: Buffer, points: [number, number][]): Promise<[number, number, number][]> {
  return page.evaluate(
    async ({ b64, pts }: { b64: string; pts: [number, number][] }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)) as [number, number, number]);
    },
    { b64: png.toString('base64'), pts: points },
  );
}

class Ctx {
  paint: Result['paint'] = [];
  holes: Result['holes'] = [];
  shots: string[] = [];
  constructor(readonly page: Page, readonly name: string) {}
  mark(name: string): Promise<unknown> {
    return this.page.evaluate((n: string) => (window as any).__r.mark(n), name);
  }
  async step(): Promise<void> {
    await this.mark('step');
    await this.page.mouse.move(Math.min(500, this.page.viewportSize().width - 50), 300);
    await this.page.mouse.wheel(300, 0);
  }
  async back(): Promise<void> {
    await this.mark('back');
    await this.page.mouse.move(Math.min(500, this.page.viewportSize().width - 50), 300);
    await this.page.mouse.wheel(-300, 0);
  }
  /** Waits until nothing moves: the strip, the scroll, the fade, and every slot's rect, opacity and scale. */
  async settle(): Promise<void> {
    let last = '';
    for (let k = 0; k < 60; k += 1) {
      const key: string = await this.page.evaluate(() => {
        const n = (window as any).__r.now();
        return JSON.stringify([n.strip.x, n.strip.opacity, n.offset, Object.values(n.slots).map((s: any) => [s.l, s.r, s.o, s.sx])]);
      });
      if (key === last) return;
      last = key;
      await sleep(200);
    }
    throw new Error(`${this.name}: the row never came to rest`);
  }
  async shot(label: string): Promise<Buffer> {
    const png: Buffer = await this.page.screenshot();
    const file = join(OUT, `${this.name}-${label}.png`);
    writeFileSync(file, png);
    this.shots.push(file);
    return png;
  }
  /** At rest: every visible panel's sampled pixels are the colour of the panel on top there, and no magenta lies inside the row. */
  async checkPaint(label: string): Promise<void> {
    await this.settle();
    const png = await this.shot(label);
    const win: { w: number; h: number; pts: { x: number; y: number; id: string | null; bg: string }[]; slots: Record<string, any> } = await this.page.evaluate(() => {
      const r = (window as any).__r;
      const c = r.container() as HTMLElement;
      const cr = c.getBoundingClientRect();
      const pts: { x: number; y: number; id: string | null; bg: string }[] = [];
      const slots = r.now().slots as Record<string, { l: number; r: number; t: number; b: number }>;
      for (const s of Object.values(slots)) {
        const left = Math.max(s.l, 0);
        const right = Math.min(s.r, cr.width);
        if (right - left < 60) continue;
        for (let k = 1; k <= 5; k += 1) {
          const x = cr.left + left + ((right - left) * k) / 6;
          const y = cr.top + s.t + (s.b - s.t) * 0.9;
          const box = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-box]');
          pts.push({ x, y, id: box?.dataset.box ?? null, bg: box ? getComputedStyle(box).backgroundColor : '' });
        }
      }
      return { w: window.innerWidth, h: window.innerHeight, pts, slots };
    });
    const got = await pixels(this.page, png, win.pts.map((p) => [p.x, p.y]));
    const bad: string[] = [];
    win.pts.forEach((p, k) => {
      // Nothing under the point means the page's own magenta is what should show.
      const want = p.id === null ? [255, 0, 255] : /rgb\((\d+), (\d+), (\d+)\)/.exec(p.bg)?.slice(1, 4).map(Number);
      const have = got[k]!;
      if (want === undefined || want.some((v, i) => Math.abs(v - have[i]!) > 8)) bad.push(`${p.id ?? 'nothing'} at x=${Math.round(p.x)}: painted ${have.join(',')} wanted ${want?.join(',') ?? p.bg}`);
    });
    this.paint.push({ label, checked: win.pts.length, bad });
  }
  /** From a screenshot alone: runs of unpainted (magenta) pixels strictly inside the painted part of the row's middle line. */
  async checkHoles(label: string, png?: Buffer): Promise<void> {
    const read = (): Promise<{ o: number; x: number; off: number }> => this.page.evaluate(() => { const n = (window as any).__r.now(); return { o: n.strip.opacity, x: n.strip.x, off: n.offset }; });
    const before = await read();
    const shot = png ?? (await this.shot(label));
    const after = await read();
    const width: number = await this.page.evaluate(() => window.innerWidth);
    const y = 300;
    const px = await pixels(this.page, shot, Array.from({ length: width }, (_, k): [number, number] => [k, y]));
    const magenta = px.map(([r, g, b]) => r > 240 && g < 15 && b > 240);
    const first = magenta.findIndex((m) => !m);
    const last = first < 0 ? width - 1 : magenta.length - 1 - [...magenta].reverse().findIndex((m) => !m);
    const runs: [number, number][] = first < 0 ? [[0, width - 1]] : [];
    let from = -1;
    for (let x = Math.max(first, 0); first >= 0 && x <= last; x += 1) {
      if (magenta[x]) from = from < 0 ? x : from;
      else if (from >= 0) {
        if (x - from > 40) runs.push([from, x - 1]);
        from = -1;
      }
    }
    // A fade passes through nothing on purpose; a hole is only a hole while the strip is meant to be seen.
    const fading = Math.min(before.o, after.o) < 0.15;
    this.holes.push({ label, runs: fading ? [] : runs, state: { opacity: [before.o, after.o], x: [before.x, after.x], offset: [before.off, after.off], seen: runs.length } });
  }
}

async function open(query: string, width: number, height = 800): Promise<Page> {
  const page: Page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => (window as any).__r?.ready());
  await sleep(700);
  return page;
}

async function record(page: Page, run: (c: Ctx) => Promise<void>, name: string): Promise<Result> {
  const c = new Ctx(page, name);
  await page.evaluate(() => (window as any).__r.start());
  await c.mark('go');
  await run(c);
  await sleep(120);
  const trace: Trace = await page.evaluate(() => (window as any).__r.stop());
  return { trace, paint: c.paint, holes: c.holes, shots: c.shots };
}

type Scenario = { name: string; run: () => Promise<Result> };
const scenarios: Scenario[] = [];
const scenario = (name: string, query: string, width: number, body: (c: Ctx) => Promise<void>): void => {
  scenarios.push({
    name,
    run: async () => {
      const page = await open(query, width);
      try {
        return await record(page, body, name);
      } finally {
        await page.context().close();
      }
    },
  });
};
const resize = async (c: Ctx, widths: number[], every: number): Promise<void> => {
  for (const w of widths) {
    await c.mark('resize');
    await c.page.setViewportSize({ width: w, height: 800 });
    await sleep(every);
  }
};

const SIX = 'slots=1,1,1,1,1,1';

scenario('recenter-glide', SIX, 1280, async (c) => {
  await c.checkPaint('start');
  await resize(c, [1100], 100);
  await c.shot('mid-glide');
  await c.settle();
  await c.checkPaint('after-1100');
  await c.step();
  await sleep(90);
  await resize(c, [900], 100);
  await c.shot('mid-glide-and-step');
  await c.settle();
  await c.checkPaint('after-900-step');
});

// The first panel's hold is read by the position model; a hold on a panel further along is still the older arithmetic. Step 4 redraws both.
for (const [where, target] of [['first', -1], ['middle', 1]] as const) {
  for (const hold of ['left', 'right', 'both'] as const) {
    scenario(`hold-flip-${where}-${hold}`, SIX, 1280, async (c) => {
      await c.checkPaint('off');
      await c.page.evaluate(([k, h]: [number, string]) => (window as any).__r.setHold(k, h), [target, hold] as [number, string]);
      await sleep(100);
      await c.shot('flip-on-mid');
      await c.settle();
      await c.checkPaint('on');
      await c.step();
      await sleep(110);
      await c.shot('step-mid');
      await c.settle();
      await c.checkPaint('on-stepped');
      await c.step();
      await sleep(70);
      await c.page.evaluate((k: number) => (window as any).__r.setHold(k, 'off'), target);
      await sleep(110);
      await c.shot('flip-off-mid-glide');
      await c.settle();
      await c.checkPaint('off-again');
    });
  }
}

scenario('fade-jump', 'slots=1,1,1,1,1,1,1,1,1,1,1,1&fast=jump', 1280, async (c) => {
  await c.checkPaint('start');
  await c.page.evaluate(() => {
    const r = (window as any).__r;
    r.far(r.provided().rowNumbers.stops.at(-1));
  });
  await sleep(90);
  await c.shot('fade-out');
  await sleep(110);
  await c.shot('fade-mid');
  await c.settle();
  await c.checkPaint('far-end');
  await c.page.evaluate(() => (window as any).__r.far(0));
  await sleep(150);
  await c.shot('fade-back-mid');
  await c.settle();
  await c.checkPaint('back-start');
});

scenario('wide-panel-size', SIX, 1280, async (c) => {
  await c.checkPaint('start');
  await c.page.evaluate(() => (window as any).__r.setSlots(1, 3));
  await sleep(160);
  await c.shot('widening-mid');
  await c.settle();
  await c.checkPaint('wide');
  await c.page.evaluate(() => (window as any).__r.scrollTo(1, 'into-view'));
  await c.settle();
  await c.step();
  await c.settle();
  await c.checkPaint('wide-stepped');
  await c.page.evaluate(() => (window as any).__r.setSlots(1, 1));
  await sleep(160);
  await c.shot('narrowing-mid');
  await c.settle();
  await c.checkPaint('narrow-again');
});

scenario('wide-panel-size-while-gliding', SIX, 1280, async (c) => {
  await c.step();
  await sleep(60);
  await c.page.evaluate(() => (window as any).__r.setSlots(2, 3));
  await sleep(110);
  await c.shot('widening-while-gliding');
  await c.settle();
  await c.checkPaint('wide');
  await c.back();
  await sleep(60);
  await c.page.evaluate(() => (window as any).__r.setSlots(2, 1));
  await sleep(110);
  await c.shot('narrowing-while-gliding');
  await c.settle();
  await c.checkPaint('narrow-again');
});

scenario('maximize-minimize', SIX, 1280, async (c) => {
  await c.step();
  await c.settle();
  await c.checkPaint('start');
  const ok = await c.page.evaluate(() => (window as any).__r.toggleMax('p2'));
  await c.mark(`maximize-asked:${ok}`);
  await sleep(150);
  await c.shot('maximizing-mid');
  await sleep(700);
  await c.shot('maximized');
  await c.page.evaluate(() => (window as any).__r.toggleMax('p2'));
  await sleep(150);
  await c.shot('minimizing-mid');
  await c.settle();
  await sleep(500);
  await c.checkPaint('minimized');
});

scenario('resize-drag', SIX, 1280, async (c) => {
  const down = Array.from({ length: 20 }, (_, k) => 1280 - (k + 1) * 20);
  await resize(c, down, 50);
  await c.shot('drag-bottom');
  await resize(c, [...down].reverse().map((w) => w + 20), 50);
  await c.settle();
  await c.checkPaint('after-drag');
  await c.step();
  await sleep(60);
  await resize(c, [1200, 1120, 1040, 960], 50);
  await c.settle();
  await c.checkPaint('after-drag-in-glide');
});

scenario('many-panels-park-return', 'slots=1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1&filler=240', 1280, async (c) => {
  await c.checkPaint('start');
  for (let k = 0; k < 8; k += 1) {
    await c.step();
    await sleep(120);
    await c.checkHoles(`step-${k}-mid`);
  }
  await c.settle();
  await c.checkPaint('after-8-steps');
  for (const k of [35, 3, 30, 0]) {
    await c.page.evaluate((i: number) => (window as any).__r.scrollTo(i, 'into-view'), k);
    await sleep(140);
    await c.checkHoles(`scrollTo-${k}-mid`);
    await c.settle();
    await sleep(300);
    await c.checkPaint(`scrollTo-${k}`);
  }
});

// ------------------------------------------------------------------ summaries and comparison

function summarize(t: Trace): Record<string, number | string> {
  const fs = t.frames;
  let stripStep = 0;
  let slotStep = 0;
  let minOpacity = 1;
  let dtMax = 0;
  for (let k = 1; k < fs.length; k += 1) {
    stripStep = Math.max(stripStep, Math.abs(fs[k]!.strip.x - fs[k - 1]!.strip.x));
    dtMax = Math.max(dtMax, fs[k]!.t - fs[k - 1]!.t);
    for (const [id, s] of Object.entries(fs[k]!.slots)) {
      const p = fs[k - 1]!.slots[id];
      if (p !== undefined) slotStep = Math.max(slotStep, Math.abs(s.l - p.l));
    }
  }
  for (const f of fs) minOpacity = Math.min(minOpacity, f.strip.opacity);
  const last = fs.at(-1)!;
  return { frames: fs.length, longestFrameMs: +dtMax.toFixed(1), maxStripStepPx: +stripStep.toFixed(1), maxSlotStepPx: +slotStep.toFixed(1), minStripOpacity: minOpacity, styleWrites: t.writes, finalStripX: last.strip.x, finalOffset: last.offset, finalHeld: last.held.join(',') };
}

// Real time jitters, so each action (go, step, back, resize, hold and size asks) starts its own 16 ms grid: what is compared is the
// response to an action, not where the wall clock happened to be when a slow settle finished.
interface Segment { name: string; t0: number; t1: number }
function segments(t: Trace): Segment[] {
  const acts = t.marks.filter((m) => ACTIONS.has(m.name));
  const end = t.frames.at(-1)?.t ?? 0;
  return acts.map((m, k) => ({ name: m.name, t0: m.t, t1: Math.min(acts[k + 1]?.t ?? end, m.t + 2400) }));
}

function grid(t: Trace, seg: Segment, pick: (f: Frame) => number | undefined): number[] {
  const out: number[] = [];
  const fs = t.frames.filter((f) => f.t >= seg.t0 - 40);
  for (let at = 0; seg.t0 + at <= seg.t1; at += 16) {
    const time = seg.t0 + at;
    const k = fs.findIndex((f) => f.t >= time);
    if (k < 0) break;
    const a = fs[Math.max(k - 1, 0)]!;
    const b = fs[k]!;
    const va = pick(a);
    const vb = pick(b);
    if (va === undefined || vb === undefined) {
      out.push(Number.NaN);
      continue;
    }
    out.push(a === b || b.t === a.t ? vb : va + ((vb - va) * (time - a.t)) / (b.t - a.t));
  }
  return out;
}

function drift(a: Trace, b: Trace): { what: string; px: number; atMs: number; segment: string; structure: string } {
  const sa = segments(a);
  const sb = segments(b);
  const names = (x: Segment[]): string => x.map((m) => m.name).join(',');
  const worst = { what: '', px: 0, atMs: 0, segment: '', structure: names(sa) === names(sb) ? '' : `actions differ: ${names(sa)} vs ${names(sb)}` };
  const ids = new Set([...a.frames.flatMap((f) => Object.keys(f.slots)), ...b.frames.flatMap((f) => Object.keys(f.slots))]);
  const probes: [string, (f: Frame) => number | undefined][] = [['strip.x', (f) => f.strip.x], ['offset', (f) => f.offset], ['strip.opacity x100', (f) => f.strip.opacity * 100]];
  for (const id of ids) probes.push([`slot ${id}.l`, (f) => f.slots[id]?.l], [`slot ${id}.r`, (f) => f.slots[id]?.r]);
  for (let i = 0; i < Math.min(sa.length, sb.length); i += 1) {
    for (const [what, pick] of probes) {
      const ga = grid(a, sa[i]!, pick);
      const gb = grid(b, sb[i]!, pick);
      for (let k = 0; k < Math.min(ga.length, gb.length); k += 1) {
        // A frame of timing slack either way: which frame first shows an ask is a coin toss, and a jump is hundreds of px.
        const d = Math.min(...[-1, 0, 1].map((j) => Math.abs(ga[k]! - (gb[k + j] ?? Number.NaN))).filter((v) => !Number.isNaN(v)), Number.POSITIVE_INFINITY);
        if (Number.isFinite(d) && d > worst.px) Object.assign(worst, { what, px: +d.toFixed(1), atMs: k * 16, segment: `${i}:${sa[i]!.name}` });
      }
    }
  }
  return worst;
}

// ------------------------------------------------------------------ run

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
const dirty = execFileSync('git', ['status', '--short', '--', '*.ts', '*.tsx'], { cwd: ROOT }).toString().trim() !== '';
const results: Record<string, Result> = {};
let failed = 0;
for (const s of scenarios) {
  if (ONLY !== undefined && !ONLY.includes(s.name)) continue;
  try {
    results[s.name] = await s.run();
    const r = results[s.name]!;
    const sum = summarize(r.trace);
    const bad = r.paint.flatMap((p) => p.bad.map((b) => `${p.label}: ${b}`));
    const holes = r.holes.filter((h) => h.runs.length > 0);
    console.log(`${s.name}: ${sum.frames} frames, longest ${sum.longestFrameMs} ms, strip step <= ${sum.maxStripStepPx} px, slot step <= ${sum.maxSlotStepPx} px, min opacity ${sum.minStripOpacity}, style writes ${sum.styleWrites}, paint checks ${r.paint.reduce((n, p) => n + p.checked, 0)}, blank ${bad.length}, holes ${holes.length}`);
    for (const b of bad.slice(0, 6)) console.log(`   BLANK ${b}`);
    for (const h of holes.slice(0, 6)) console.log(`   HOLE ${h.label}: ${JSON.stringify(h.runs)}`);
    failed += bad.length + holes.length;
  } catch (e) {
    failed += 1;
    console.log(`${s.name}: DID NOT RUN: ${(e as Error).message.split('\n')[0]}`);
  }
}
const ran = Object.keys(results).length;
if (ran === 0) {
  console.log('proved nothing: no scenario ran');
  process.exit(1);
}

const writeTo = arg('write');
if (writeTo !== undefined) {
  const doc = { meta: { commit, dirty, label: arg('label') ?? null, chromium: (browser as any).version(), when: new Date().toISOString(), tol: TOL }, scenarios: Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { trace: r.trace, summary: summarize(r.trace), paint: r.paint.map((p) => ({ label: p.label, checked: p.checked, blank: p.bad.length })), holes: r.holes.filter((h) => h.runs.length > 0) }])) };
  writeFileSync(writeTo, JSON.stringify(doc));
  console.log(`wrote ${writeTo} (${ran} scenarios, commit ${commit}${dirty ? '+dirty' : ''})`);
}
const compareTo = arg('compare');
if (compareTo !== undefined) {
  const base = JSON.parse(readFileSync(compareTo, 'utf8'));
  console.log(`compare against ${compareTo} (baseline ${base.meta.label ?? base.meta.commit}, tolerance ${TOL} px):`);
  for (const [name, r] of Object.entries(results)) {
    const b = base.scenarios[name];
    if (b === undefined) {
      console.log(`  ${name}: NOT IN BASELINE`);
      failed += 1;
      continue;
    }
    const d = drift(b.trace, r.trace);
    const bs = b.summary;
    const ns = summarize(r.trace);
    const limit = Math.max(TOL, 1.5 * (base.meta.noise?.[name] ?? 0));
    const flag = d.px > limit || d.structure !== '' ? 'DRIFT' : 'ok';
    if (flag === 'DRIFT') failed += 1;
    console.log(`  ${name}: ${flag} worst ${d.px} px (limit ${limit.toFixed(1)}; ${d.what} in ${d.segment} at ${d.atMs} ms)${d.structure};  final strip ${bs.finalStripX} -> ${ns.finalStripX}, offset ${bs.finalOffset} -> ${ns.finalOffset}, held ${bs.finalHeld || '-'} -> ${ns.finalHeld || '-'}, step ${bs.maxStripStepPx} -> ${ns.maxStripStepPx}`);
  }
}
await browser.close();
server.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed > 0 ? 1 : 0);
