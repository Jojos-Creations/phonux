/**
 * The Embla internals the row relies on (emblaRow.ts: writeEmbla, moveEmbla's shift and rebuild, nearestStop, the drawn
 * position, the wheel's target and body in wheelBy): `internalEngine()` is outside Embla's semver, so 8.6 is pinned and this test fails when an upgrade changes any of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import './support/jsdom-globals.js';
import EmblaCarousel from 'embla-carousel';
import { emblaDrawnOf, emblaScrollOf, writeEmbla } from '../emblaRow.js';

const require = createRequire(import.meta.url);

test('embla internals: the pinned version is the one the row was written against', () => {
  const pkg = JSON.parse(readFileSync(require.resolve('embla-carousel/package.json'), 'utf8')) as { version: string };
  assert.equal(pkg.version, '8.6.0');
  const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
  assert.equal(own.dependencies['embla-carousel'], '8.6.0', 'pinned exactly, not a range');
});

test('embla internals: the engine members the row reads and writes are there, with the shape it uses', () => {
  const root = document.createElement('div');
  const box = document.createElement('div');
  for (let k = 0; k < 4; k += 1) box.appendChild(document.createElement('div'));
  root.appendChild(box);
  document.body.appendChild(root);
  // jsdom has no matchMedia; Embla reads it for breakpoint options, which the row does not use.
  const win = window as unknown as { matchMedia?: unknown };
  const hadMatch = win.matchMedia;
  win.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
  // Nor IntersectionObserver, which Embla's slides-in-view watch takes.
  const g = globalThis as unknown as { IntersectionObserver?: unknown };
  const hadIO = g.IntersectionObserver;
  g.IntersectionObserver ??= class { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): [] { return []; } };
  const embla = EmblaCarousel(root, { watchResize: false, watchSlides: false });
  try {
    const e = embla.internalEngine();
    for (const name of ['location', 'previousLocation', 'offsetLocation', 'target'] as const) {
      const v = e[name];
      assert.equal(typeof v.get, 'function', `${name}.get`);
      assert.equal(typeof v.set, 'function', `${name}.set`);
      v.set(-12);
      assert.equal(v.get(), -12, `${name} keeps what it is set to`);
    }
    assert.equal(typeof e.translate.to, 'function', 'translate.to');
    for (const name of ['useDuration', 'useFriction', 'useBaseDuration', 'useBaseFriction', 'seek', 'velocity'] as const) assert.equal(typeof e.scrollBody[name], 'function', `scrollBody.${name}`);
    assert.ok(Array.isArray(e.scrollSnaps), 'scrollSnaps is an array');
    assert.equal(typeof e.dragHandler.pointerDown, 'function', 'dragHandler.pointerDown');
    assert.equal(e.dragHandler.pointerDown(), false, 'no press: pointerDown is false');
    assert.equal(typeof e.animation.start, 'function', 'animation.start');
    // The row's own reads through them.
    writeEmbla(embla, 40);
    assert.equal(emblaScrollOf(embla), 40);
    assert.equal(emblaDrawnOf(embla), 40);
    assert.equal(e.target.get(), -40);
  } finally {
    embla.destroy();
    root.remove();
    win.matchMedia = hadMatch;
    g.IntersectionObserver = hadIO;
  }
});
