/** Tile capture: the policy, the bounded store, persistence across a relaunch, and the source-level rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import { createTileCapture, type TilePictureRecord, type TilePictureStorage, type TileRequest } from '../index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** An in-memory storage that survives across controllers, standing in for the host's disk. */
function memoryStorage(seed: readonly TilePictureRecord[] = []): TilePictureStorage & { readonly records: Map<string, TilePictureRecord> } {
  const records = new Map<string, TilePictureRecord>(seed.map((r) => [r.viewId, r]));
  return {
    records,
    async readAll() {
      return [...records.values()];
    },
    async write(record) {
      records.set(record.viewId, record);
    },
    async remove(viewIds) {
      for (const id of viewIds) records.delete(id);
    },
  };
}

/** A panel element whose client size is fixed, since jsdom lays nothing out. */
function panel(width = 400, height = 800): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  Object.defineProperty(el, 'scrollWidth', { value: width });
  Object.defineProperty(el, 'scrollHeight', { value: height });
  return el;
}

/** A varied picture the policy accepts, `src` tagged so tests can tell pictures apart. */
function rasteriser(calls: TileRequest[] = [], tag = 'a') {
  return async (request: TileRequest) => {
    calls.push(request);
    const pixels = new Uint8ClampedArray(request.pictureWidth * request.pictureHeight * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 7 === 0 ? 255 : 10;
    return { src: `data:image/webp;base64,${tag}${'x'.repeat(100)}`, pixels };
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('evidence 1: a picture written before a relaunch is shown after it, before any recapture', async () => {
  const storage = memoryStorage();
  const calls: TileRequest[] = [];
  const first = createTileCapture({ rasterise: rasteriser(calls), storage });
  await first.restore(['p1']);
  first.register('p1', panel(), 'viewport');
  first.capture('p1');
  await flush();
  assert.ok(first.get('p1'), 'the picture was not captured in the first session');
  const relaunchCalls: TileRequest[] = [];
  const second = createTileCapture({ rasterise: rasteriser(relaunchCalls), storage });
  await second.restore(['p1']);
  assert.equal(second.get('p1')?.src, first.get('p1')?.src);
  assert.equal(relaunchCalls.length, 0, 'showing the stored picture must not rasterise');
});

test('evidence 2: the stored count and byte caps hold across relaunches', async () => {
  const storage = memoryStorage();
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const one = createTileCapture({ rasterise: rasteriser(), storage, maxPictures: 3 });
  await one.restore(ids);
  for (const id of ids) {
    one.register(id, panel(), 'viewport');
    one.capture(id);
    await flush();
  }
  assert.ok(storage.records.size <= 3, `stored ${storage.records.size} pictures over a cap of 3`);
  const bytes = [...storage.records.values()].reduce((sum, r) => sum + r.src.length, 0);
  const relaunch = createTileCapture({ rasterise: rasteriser(), storage, maxPictures: 2, maxBytes: 150 });
  await relaunch.restore(ids);
  await flush();
  const after = [...storage.records.values()];
  assert.ok(after.length <= 1, `stored ${after.length} pictures over a byte cap of 150`);
  assert.ok(after.reduce((sum, r) => sum + r.src.length, 0) <= 150, `stored bytes exceed 150 (was ${bytes})`);
});

test('evidence 3: a picture of a panel that no longer exists is removed on load', async () => {
  const gone: TilePictureRecord = { viewId: 'gone', src: 'data:image/webp;base64,zz', width: 10, height: 10, extent: 'viewport', capturedAt: 1, touch: 1 };
  const keep: TilePictureRecord = { ...gone, viewId: 'keep', touch: 2 };
  const storage = memoryStorage([gone, keep]);
  const controller = createTileCapture({ rasterise: rasteriser(), storage });
  await controller.restore(['keep']);
  await flush();
  assert.equal(controller.get('gone'), null);
  assert.ok(controller.get('keep'));
  assert.equal(storage.records.has('gone'), false, 'the record of a removed panel stayed in storage');
  assert.equal(storage.records.has('keep'), true);
});

test('evidence 5: a faded or hidden panel is never captured, and a one-colour picture never replaces a good one', async () => {
  const calls: TileRequest[] = [];
  const controller = createTileCapture({ rasterise: rasteriser(calls) });
  await controller.restore(['faded', 'hidden', 'good']);
  const faded = panel();
  faded.style.opacity = '0.5';
  controller.register('faded', faded, 'viewport');
  controller.capture('faded');
  const hidden = panel();
  hidden.style.display = 'none';
  controller.register('hidden', hidden, 'viewport');
  controller.capture('hidden');
  await flush();
  assert.equal(calls.length, 0, 'a faded or hidden panel reached the rasteriser');
  assert.equal(controller.get('faded'), null);

  let oneColourNext = false;
  const picky = createTileCapture({
    rasterise: async (r) => {
      if (oneColourNext) return { src: 'data:image/webp;base64,blank', pixels: new Uint8ClampedArray(r.pictureWidth * r.pictureHeight * 4).fill(200) };
      return { src: 'data:image/webp;base64,good', pixels: new Uint8ClampedArray(r.pictureWidth * r.pictureHeight * 4).map((_, i) => (i % 7 === 0 ? 255 : 10)) };
    },
  });
  await picky.restore(['good']);
  picky.register('good', panel(), 'viewport');
  picky.capture('good');
  await flush();
  const kept = picky.get('good')?.src;
  assert.equal(kept, 'data:image/webp;base64,good', 'the good picture was not stored');
  oneColourNext = true;
  picky.capture('good');
  await flush();
  assert.equal(picky.get('good')?.src, kept, 'a one-colour picture replaced a good one');
});

test('a picture of a panel is removed in the same tick its panel closes', async () => {
  const storage = memoryStorage();
  const controller = createTileCapture({ rasterise: rasteriser(), storage });
  await controller.restore(['p']);
  controller.register('p', panel(), 'viewport');
  controller.capture('p');
  await flush();
  assert.ok(controller.get('p'));
  controller.evict('p');
  assert.equal(controller.get('p'), null, 'the picture survived the evict call itself');
  await flush();
  assert.equal(storage.records.has('p'), false);
});

test('the store evicts the least-recently-touched picture at the count cap', async () => {
  const controller = createTileCapture({ rasterise: rasteriser(), maxPictures: 2 });
  await controller.restore(['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c']) {
    controller.register(id, panel(), 'viewport');
    controller.capture(id);
    await flush();
  }
  assert.equal(controller.get('a'), null, 'the oldest picture was not the one dropped');
  assert.ok(controller.get('b'));
  assert.ok(controller.get('c'));
});

test('the store takes a picture of the host-set byte cap, not a fixed number', async () => {
  const controller = createTileCapture({ rasterise: rasteriser(), maxBytes: 10 });
  await controller.restore(['a']);
  controller.register('a', panel(), 'viewport');
  controller.capture('a');
  await flush();
  assert.equal(controller.get('a'), null, 'a picture larger than the host byte cap was kept');
});

test('a panel behind its placeholder keeps its last picture, and is pictured once the load ends', async () => {
  const calls: TileRequest[] = [];
  const controller = createTileCapture({ rasterise: rasteriser(calls) });
  await controller.restore(['a']);
  const el = panel();
  const loader = el.appendChild(document.createElement('div'));
  const cover = loader.appendChild(document.createElement('div'));
  cover.setAttribute('data-panel-loading', '');
  controller.register('a', el, 'viewport');
  controller.capture('a');
  await flush();
  assert.equal(calls.length, 0, 'the placeholder was pictured');
  assert.equal(controller.get('a'), null);
  cover.remove();
  loader.dispatchEvent(new Event('phonux-panel-loaded', { bubbles: true }));
  await flush();
  assert.equal(calls.length, 1, 'the loaded panel was not pictured');
  assert.ok(controller.get('a'));
  loader.dispatchEvent(new Event('phonux-panel-loaded', { bubbles: true }));
  await flush();
  assert.equal(calls.length, 1, 'a load nobody asked to picture was pictured');
});

test('a panel showing a failed load is not pictured', async () => {
  const calls: TileRequest[] = [];
  const controller = createTileCapture({ rasterise: rasteriser(calls) });
  await controller.restore(['a']);
  const el = panel();
  el.appendChild(document.createElement('div')).setAttribute('data-panel-load-failed', 'error');
  controller.register('a', el, 'viewport');
  controller.capture('a');
  await flush();
  assert.equal(calls.length, 0);
});

test('evidence 7 and 4: the library imports no DOM capture package and names no storage location', () => {
  const files = ['captureTiles.ts', 'capturePolicy.ts', 'captureRecapture.ts'];
  for (const file of files) {
    const src = readFileSync(`${ROOT}/${file}`, 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
    for (const spec of imports) assert.ok(spec.startsWith('.') || spec === 'react', `${file} imports ${spec}`);
    assert.doesNotMatch(src, /html2canvas|html-to-image|dom-to-image|modern-screenshot|rasterizeHTML|localStorage|sessionStorage|indexedDB|IndexedDB|userData|electron/i, `${file} names a capture package or storage location`);
  }
});
