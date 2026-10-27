/**
 * usePanelDots' handlers, rendered: an oval drag writes the row only while it holds the claim and releases it on end,
 * and a dot click glides, or snaps under Reduce Motion from either source.
 */
import './support/jsdom-globals.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import type { WorkspaceTuning } from '../panelSettings.js';
import { usePanelDots, type PanelDots } from '../usePanelDots.js';
import type { RowNumbers } from '../rowNumbers.js';
import { rowScrollerFor } from '../rowScroller.js';

afterEach(() => cleanup());

const numbers = {
  rowScroll: true,
  windowWidth: 600,
  stripWidth: 1202,
  rowMarginLeft: 0,
  stripStart: 0,
  stripWindow: 600,
  leftInset: 0,
  rightInset: 0,
  held: [],
  endPad: 0,
  ids: ['a', 'b', 'c'],
  widths: [390, 390, 390],
  leftOffsets: [0, 406, 812],
} as unknown as RowNumbers;
const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function probe(out: { dots?: PanelDots; el?: HTMLElement }, reduced?: 'always', tuning: WorkspaceTuning = {}) {
  const Probe = () => {
    const scroller = React.useRef<HTMLDivElement>(null);
    const dots = usePanelDots({ rowNumbers: numbers, entries, scroller, tuning: resolveWorkspaceTuning(tuning) });
    out.dots = dots;
    out.el = scroller.current ?? undefined;
    return React.createElement('div', { ref: scroller, 'data-row-scroller': '', style: { overflowX: 'auto', width: 300 } });
  };
  const tree = React.createElement(Probe);
  return React.createElement(MotionConfig, { reducedMotion: reduced ?? 'never' }, tree);
}

test('an oval drag writes the row through its claim, and end releases the claim', () => {
  const out: { dots?: PanelDots; el?: HTMLElement } = {};
  const m = mount(probe(out));
  const dots = out.dots!;
  const el = m.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  const drag = dots.startOvalDrag();
  assert.notEqual(drag, null);
  assert.equal(dots.startOvalDrag(), null, 'a second drag cannot take a held row');
  drag!.drag(50);
  assert.ok(el.scrollLeft > 0, 'the drag moved the row');
  drag!.end();
  assert.notEqual(dots.startOvalDrag(), null, 'end released the claim');
});

test('a dot click glides to the centring target when motion is on', () => {
  const out: { dots?: PanelDots; el?: HTMLElement } = {};
  const m = mount(probe(out));
  out.dots!.selectDot('b');
  const el = m.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  assert.equal(rowScrollerFor(el).glideTarget(), 406 + 195 - 300);
});

test('a dot click snaps at once under Reduce Motion', () => {
  const out: { dots?: PanelDots; el?: HTMLElement } = {};
  const m = mount(probe(out, 'always'));
  out.dots!.selectDot('b');
  const el = m.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  assert.equal(el.scrollLeft, 406 + 195 - 300);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
});

test("a dot click glides with the workspace's slide: duration and glide ease, not the library's", async () => {
  const target = 406 + 195 - 300;
  const quarter = async (tuning: WorkspaceTuning): Promise<number> => {
    const out: { dots?: PanelDots; el?: HTMLElement } = {};
    const m = mount(probe(out, undefined, tuning));
    out.dots!.selectDot('b');
    const el = m.container.querySelector<HTMLElement>('[data-row-scroller]')!;
    await advanceFrames(25 * 16);
    const at = el.scrollLeft;
    cleanup();
    return at / target;
  };
  const linear = await quarter({ slide: { durationSec: 1.6, glideEase: 'linear' } });
  assert.ok(Math.abs(linear - 0.25) < 0.02, `a quarter of a linear 1.6 s glide has covered a quarter, got ${linear}`);
  const cubic = await quarter({ slide: { durationSec: 1.6, glideEase: 'cubic-out' } });
  assert.ok(cubic > 0.5, `the same quarter along cubic-out has covered most of it, got ${cubic}`);
});

test('a bar that unmounts mid-drag releases its claim, so the row still takes steps', async () => {
  const out: { dots?: PanelDots } = {};
  const Bar = ({ scroller }: { scroller: React.RefObject<HTMLDivElement | null> }) => {
    out.dots = usePanelDots({ rowNumbers: numbers, entries, scroller, tuning: resolveWorkspaceTuning({}) });
    return null;
  };
  const Row = ({ bar }: { bar: boolean }) => {
    const scroller = React.useRef<HTMLDivElement>(null);
    return React.createElement('div', { ref: scroller, 'data-row-scroller': '', style: { overflowX: 'auto', width: 300 } }, bar ? React.createElement(Bar, { scroller }) : null);
  };
  const m = mount(React.createElement(Row, { bar: true }));
  const el = m.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  const bar = { setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0 }) };
  out.dots!.barProps.onPointerDown({ button: 0, clientX: 0, target: el, currentTarget: bar, pointerId: 1 } as never);
  out.dots!.barProps.onPointerMove({ clientX: 60, target: el, currentTarget: bar } as never);
  assert.equal(rowScrollerFor(el).claimHeld(), true, 'control: the drag holds the row');
  assert.ok(el.hasAttribute('data-row-held'), 'and the row says so');
  m.rerender(React.createElement(Row, { bar: false }));
  await advanceFrames(20);
  assert.equal(rowScrollerFor(el).claimHeld(), false, 'the unmount released it');
  assert.ok(!el.hasAttribute('data-row-held'));
});
