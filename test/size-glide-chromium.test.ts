/**
 * The drawn corner radius and the drawn edge of the chrome stay what they are at rest on every frame of a size glide, per axis, in
 * real layout: the default frame, a self-framed view inside a `PanelSizeBox`, and one whose box is also lower while it is wider
 * (so the glide scales y as well as x), at 1800, 1280 and 844 with the CPU at its own rate and four times slower. Skips when
 * Playwright or Chromium is not installed (PLAYWRIGHT_DIR=<node_modules holding playwright> finds a copy elsewhere). The probe
 * is tools/proof/glide-chrome-probe.mjs, which the Mac runs in Firefox and WebKit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Kind {
  samples: number;
  worstRadiusX: number;
  worstRadiusY: number;
  worstEdge: number;
  minScaleX: number;
  maxScaleX: number;
  minScaleY: number;
  maxScaleY: number;
}
interface Summary {
  glidingSamples: number;
  endWithVars: number;
  perKind: Record<string, Kind>;
}
interface Playwright {
  chromium: { launch(): Promise<{ close(): Promise<void> }> };
}

async function loadPlaywright(): Promise<Playwright | undefined> {
  try {
    const from = process.env.PLAYWRIGHT_DIR === undefined ? undefined : createRequire(join(process.env.PLAYWRIGHT_DIR, 'x.js')).resolve('playwright');
    const ns = (await import(from === undefined ? 'playwright' : pathToFileURL(from).href)) as Playwright & { default?: Playwright };
    return ns.chromium === undefined ? ns.default : ns;
  } catch {
    return undefined;
  }
}

const CASES: Array<[frame: 'auto' | 'self' | 'selfy', width: number, cpu: number]> = [
  ['auto', 1800, 1],
  ['auto', 1280, 4],
  ['auto', 844, 1],
  ['self', 1280, 1],
  ['selfy', 1280, 1],
  ['selfy', 844, 4],
];

test('on every frame of a size glide the drawn corners and edge are what they are at rest, per axis, in the default frame and in self-framed views', async (t) => {
  const pw = await loadPlaywright();
  if (pw === undefined) return void t.skip('playwright is not installed');
  try {
    await (await pw.chromium.launch()).close();
  } catch {
    return void t.skip('chromium is not installed');
  }
  const { probe } = (await import(pathToFileURL(join(ROOT, 'tools/proof/glide-chrome-probe.mjs')).href)) as { probe(o: object): Promise<Summary> };
  for (const [frame, width, cpu] of CASES) {
    const where = `${frame} at ${width}, CPU x${cpu}`;
    const r = await probe({ pw, lib: ROOT, frame, width, cpu, slots: '1,4,1,2' });
    assert.equal(r.endWithVars, 0, `${where}: no custom property is left on a box at rest`);
    for (const kind of frame === 'auto' ? ['frame', 'header', 'grab'] : ['frame', 'header']) {
      const k = r.perKind[kind];
      assert.ok(k !== undefined && k.samples > 20, `${where}: ${kind} was sampled across the glide`);
      assert.ok(k.maxScaleX - k.minScaleX > 0.5, `${where}: ${kind} was scaled on x (${k.minScaleX} to ${k.maxScaleX})`);
      assert.ok(k.worstRadiusX < 0.5, `${where}: ${kind} radius on x drawn ${k.worstRadiusX} px off`);
      assert.ok(k.worstRadiusY < 0.5, `${where}: ${kind} radius on y drawn ${k.worstRadiusY} px off`);
      if (kind !== 'grab') assert.ok(k.worstEdge < 0.5, `${where}: ${kind} edge drawn ${k.worstEdge} px off 1 px`);
      if (frame === 'selfy') assert.ok(k.maxScaleY - k.minScaleY > 0.3, `${where}: ${kind} was scaled on y too (${k.minScaleY} to ${k.maxScaleY})`);
    }
  }
});
