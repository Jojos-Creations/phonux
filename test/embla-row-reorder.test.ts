/**
 * A reorder drag's hold on an Embla row (`holdEmbla`): one writer at a time, writes clamped to the strip, nothing after release.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import EmblaCarousel, { type EmblaCarouselType } from 'embla-carousel';
import { emblaDrawnOf, holdEmbla, writeEmbla } from '../emblaRow.js';

function withEmbla(run: (embla: EmblaCarouselType) => void): void {
  const root = document.createElement('div');
  const box = document.createElement('div');
  for (let k = 0; k < 4; k += 1) box.appendChild(document.createElement('div'));
  root.appendChild(box);
  document.body.appendChild(root);
  // jsdom has neither matchMedia nor IntersectionObserver, which Embla reads at init.
  const win = window as unknown as { matchMedia?: unknown };
  const hadMatch = win.matchMedia;
  win.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
  const g = globalThis as unknown as { IntersectionObserver?: unknown };
  const hadIO = g.IntersectionObserver;
  g.IntersectionObserver ??= class { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): [] { return []; } };
  const embla = EmblaCarousel(root, { watchResize: false, watchSlides: false });
  try {
    run(embla);
  } finally {
    embla.destroy();
    root.remove();
    win.matchMedia = hadMatch;
    g.IntersectionObserver = hadIO;
  }
}

test('holdEmbla: one drag holds the row at a time; release frees it for the next', () => {
  withEmbla((embla) => {
    const first = holdEmbla(embla);
    assert.ok(first !== null);
    assert.equal(holdEmbla(embla), null, 'a second drag gets no hold while the first holds the row');
    first.release();
    const second = holdEmbla(embla);
    assert.ok(second !== null, 'released: the next drag may hold it');
    second.release();
  });
});

test('holdEmbla: writes are drawn at once, clamped to [0, the bound], and return how far the row moved', () => {
  withEmbla((embla) => {
    // jsdom lays nothing out, so Embla has no drawn position until one is written.
    writeEmbla(embla, 0);
    const h = holdEmbla(embla)!;
    h.setMaxScroll(500);
    assert.equal(h.write(120), 120);
    assert.equal(emblaDrawnOf(embla), 120);
    assert.equal(h.write(900), 380, 'past the bound: clamped to 500');
    assert.equal(emblaDrawnOf(embla), 500);
    assert.equal(h.write(500), 0, 'no move: 0');
    assert.equal(h.write(-40), -500, 'before the start: clamped to 0');
    assert.equal(emblaDrawnOf(embla), 0);
    h.release();
    assert.equal(h.write(200), 0, 'a released hold writes nothing');
    assert.equal(emblaDrawnOf(embla), 0);
  });
});
