/**
 * The step gesture on a scrolling row: one stepTarget per burst, the arrow keys, the claim and the revealOnScroll
 * rule. The lock and unlock timers are setTimeout, so lock cases run under mock timers; glides run on the virtual
 * frame clock (16 ms a frame). Rows are eleven panels at 1000 (maxScroll 3482), or a 430 px window that shows one
 * phone panel at a time (window 398, so a row of n panels has maxScroll 406n - 414).
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelWindow } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const eleven = (): PanelWindow[] => panelsOf(10);

const tick = (ms: number): void => void act(() => mock.timers.tick(ms));

test('a wheel burst of 30 events scrolls exactly one stop, and its later events do not cancel the glide it started', async () => {
  const m = mountRow(eleven(), 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 0; n < 30; n += 1) m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), 406);
  await advanceFrames(500);
  assert.equal(m.container.scrollLeft, 406);
});

test('a second burst inside the lock does nothing, and one after it moves again from the glide target', async () => {
  const m = mountRow(eleven(), 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), 406);
  tick(349);
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), 406, 'inside the lock, which each ignored event re-arms');
  tick(350);
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), 812, 'after the lock the base is the in-flight target');
  tick(350);
  m.wheel({ deltaX: -50 });
  assert.equal(m.scroller.glideTarget(), 406);
});

test('Shift+deltaY acts as horizontal and prevents the default; a plain deltaY does neither', () => {
  const m = mountRow(eleven(), 1000);
  const plain = m.wheel({ deltaY: 100 });
  assert.equal(plain.defaultPrevented, false);
  assert.equal(m.scroller.glideTarget(), null);
  const shifted = m.wheel({ deltaY: 100, shiftKey: true });
  assert.equal(shifted.defaultPrevented, true);
  assert.equal(m.scroller.glideTarget(), 406);
});

test('ten ArrowRight repeats advance ten stops from the in-flight target', () => {
  const m = mountRow(panelsOf(13), 1000);
  const seen: (number | null)[] = [];
  for (let n = 0; n < 10; n += 1) {
    m.key('ArrowRight');
    seen.push(m.scroller.glideTarget());
  }
  assert.deepEqual(seen, [406, 812, 1218, 1624, 2030, 2436, 2842, 3248, 3654, 4060]);
  m.key('ArrowLeft');
  assert.equal(m.scroller.glideTarget(), 3654);
});

test('the last step clamps to the strip end', () => {
  const m = mountRow(eleven(), 1000);
  m.container.scrollLeft = 3248;
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), 3482);
});

test('at the strip end an arrow and a swipe do nothing', () => {
  const m = mountRow(eleven(), 1000);
  m.container.scrollLeft = 3482;
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), null);
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), null);
});

test('arrows skip INPUT, TEXTAREA, SELECT and contentEditable targets and any modifier, and still step with a button focused', () => {
  const m = mountRow(eleven(), 1000);
  const stepped = (): boolean => {
    const at = m.scroller.glideTarget();
    m.scroller.stop();
    return at !== null;
  };
  for (const tag of ['input', 'textarea', 'select']) {
    const el = document.body.appendChild(document.createElement(tag));
    m.key('ArrowRight', {}, el);
    assert.equal(stepped(), false, tag);
    el.remove();
  }
  const editable = document.body.appendChild(document.createElement('div'));
  // jsdom does not implement isContentEditable, which the hook reads.
  Object.defineProperty(editable, 'isContentEditable', { value: true });
  m.key('ArrowRight', {}, editable);
  assert.equal(stepped(), false, 'contentEditable');
  const plainDiv = document.body.appendChild(document.createElement('div'));
  m.key('ArrowRight', {}, plainDiv);
  assert.equal(stepped(), true, 'control: the same press without isContentEditable steps');
  for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    m.key('ArrowRight', init);
    assert.equal(stepped(), false, JSON.stringify(init));
  }
  const button = document.body.appendChild(document.createElement('button'));
  button.focus();
  m.key('ArrowRight', {}, button);
  assert.equal(stepped(), true, 'a focused button');
});

test('a glide the gesture started stops at pointer-down in the container', () => {
  const m = mountRow(eleven(), 1000);
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), 406);
  act(() => void m.container.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  assert.equal(m.scroller.glideTarget(), null);
});

/** Counts the container's wheel and the window's keydown listeners added while `render` mounts. */
function listenersFor(rowGesture: 'step' | 'free' | 'off'): number {
  const proto = (window as unknown as { EventTarget: typeof EventTarget }).EventTarget.prototype;
  const spy = mock.method(proto, 'addEventListener');
  try {
    mountRow(eleven(), 1000, { tuning: { rowGesture } });
    return spy.mock.calls.filter((c) => {
      const target = c.this as unknown;
      const type = c.arguments[0];
      return (type === 'wheel' && target instanceof HTMLElement && target.hasAttribute('data-row-scroller')) || (type === 'keydown' && target === window);
    }).length;
  } finally {
    spy.mock.restore();
  }
}

test('free and off install no gesture listener; step installs two', () => {
  assert.equal(listenersFor('step'), 2, 'positive control');
  cleanup();
  assert.equal(listenersFor('free'), 0);
  cleanup();
  assert.equal(listenersFor('off'), 0);
});

test('the gesture does nothing while a claim is held, and steps again after the release', () => {
  const m = mountRow(eleven(), 1000);
  const claim = m.scroller.claim()!;
  claim.setMaxScroll(3482);
  for (let n = 0; n < 3; n += 1) m.key('ArrowRight');
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), null);
  assert.equal(m.container.scrollLeft, 0);
  claim.release();
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), 406);
});

test('the gesture shows no hidden panel while a claim is held', () => {
  const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: 'any' }, { live: false }), made('c')), 430);
  mock.timers.enable({ apis: ['setTimeout'] });
  const claim = m.scroller.claim()!;
  m.wheel({ deltaX: 50 });
  assert.equal(m.live().includes('b'), false);
  claim.release();
  tick(400);
  m.wheel({ deltaX: 50 });
  assert.equal(m.live().includes('b'), true, 'control: the same swipe after the release shows it');
});

// --- revealOnScroll ------------------------------------------------------------------------------------------

const narrow = 430;
const swipe = async (m: MountedRow, deltaX: number): Promise<void> => {
  m.wheel({ deltaX });
  await advanceFrames(500);
  tick(400);
};

test('a held panel after the last panel in view is reached only once no live panel lies between the window and it', async () => {
  for (const policy of ['edges', 'any', 'never'] as const) {
    const m = mountRow(row(rootEntry(), made('c')), narrow, { workspaceDefaults: { startVisibility: 'parked', overflow: 'park', revealOnScroll: policy } });
    mock.timers.enable({ apis: ['setTimeout'] });
    act(() => m.latest().create({ view: 'scroll-row-view' }));
    const heldId = m.latest().entries[m.latest().entries.length - 1]!.id;
    await advanceFrames(500);
    assert.equal(m.container.scrollLeft, 0, `${policy}: a hidden create scrolls nothing`);
    assert.deepEqual(m.live(), ['c']);
    await swipe(m, 50);
    assert.equal(m.container.scrollLeft, 398, `${policy}: c lies between the window and the held panel, so the swipe steps to it`);
    assert.ok(!m.live().includes(heldId), policy);
    await swipe(m, 50);
    if (policy === 'never') {
      assert.ok(!m.live().includes(heldId), 'never: skipped');
    } else {
      assert.ok(m.live().includes(heldId), `${policy}: a held panel is revealed from the strip end`);
    }
    mock.timers.reset();
    cleanup();
  }
});

test('a swipe toward a held panel past three live panels steps over each and reveals it only from the last: 406, 812, 1210, then it shows', async () => {
  const m = mountRow(row(rootEntry(), made('l1'), made('l2'), made('l3')), narrow, { workspaceDefaults: { startVisibility: 'parked', overflow: 'park' } });
  mock.timers.enable({ apis: ['setTimeout'] });
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  const heldId = m.latest().entries[m.latest().entries.length - 1]!.id;
  const stops: number[] = [];
  for (let n = 0; n < 3; n += 1) {
    await swipe(m, 50);
    stops.push(m.container.scrollLeft);
    assert.ok(!m.live().includes(heldId), `step ${n}: not skipped to`);
  }
  assert.deepEqual(stops, [406, 812, 1210]);
  await swipe(m, 50);
  assert.ok(m.live().includes(heldId));
});

test('an engine-parked panel between the live ones: edges and never step past it, any reaches it, in both directions', async () => {
  for (const [policy, reached] of [['edges', false], ['any', true], ['never', false]] as const) {
    for (const direction of ['right', 'left'] as const) {
      const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: policy }, { live: false }), made('c')), narrow);
      mock.timers.enable({ apis: ['setTimeout'] });
      if (direction === 'left') m.container.scrollLeft = 398;
      await swipe(m, direction === 'right' ? 50 : -50);
      assert.equal(m.live().includes('b'), reached, `${policy} ${direction}`);
      if (!reached) assert.equal(m.container.scrollLeft, direction === 'right' ? 398 : 0, `${policy} ${direction}: it stepped instead`);
      mock.timers.reset();
      cleanup();
    }
  }
});

test('a History click (activate) brings a parked panel back under all three revealOnScroll values', () => {
  for (const policy of ['edges', 'any', 'never'] as const) {
    const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: policy }, { live: false }), made('c')), narrow);
    act(() => m.latest().activate('b'));
    assert.ok(m.live().includes('b'), policy);
    cleanup();
  }
});
