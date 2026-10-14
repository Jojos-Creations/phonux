/**
 * The engine's reading of the look tuning it owns: tuning.rowGap, tuning.dragToClose, tuning.slide and
 * tuning.hopFraction, through a mounted PanelRow where the behaviour is a render and through the pure function where
 * it is arithmetic. One differential per name, then the defaults, the cascade from the workspace to one panel, the
 * scope and range rules, and the interfaces a host calls. Entries are hand-built or made the way a creation path
 * makes them: appendPanel's skeleton, then applyTemplate over a resolved layer.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { act } from 'react';
import {
  DragToClose,
  LIBRARY_TUNING_DEFAULTS,
  PANEL_TRANSITION,
  Panel,
  PanelSizeBox,
  Workspace,
  PanelManagerError,
  reorderStepsForOffset,
  slideToTransition,
  useProvidePanels,
  usePanelReorderSteps,
  usePanelTuning,
} from '../index.js';
import { createWorkspace } from '../index.js';
import type { PanelSettings, PanelTuning, PanelWindow, ProvidedPanels, SlideTuning, WorkspaceTuning } from '../index.js';
import { SLOT_TRANSITION } from '../directionalTransition.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { workspaceShellStyle } from '../Workspace.js';
import { appendPanel } from '../panelWindow.js';
import { differential, differentialsCovered } from './support/differential.js';
import { drag } from './support/drag-gesture.js';
import { advanceFrames, cleanup, mount, panelsInput, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const OWNED = ['tuning.rowGap', 'tuning.dragToClose', 'tuning.slide', 'tuning.hopFraction', 'tuning.chrome', 'tuning.resizeSettleSlides'];
const ROOT = 'root';

interface Seen {
  tuning: ReturnType<typeof usePanelTuning>;
  steps: (offsetX: number) => number;
}
const seen = new Map<string, Seen>();
const closed: string[] = [];

registerTestView('tune-view', ({ panel }) => {
  seen.set(panel.id, { tuning: usePanelTuning(), steps: usePanelReorderSteps() });
  return React.createElement('i', { 'data-slot': panel.id }, panel.title);
});
registerTestView('tune-drag', ({ panel }) =>
  React.createElement(DragToClose, {
    onClose: () => closed.push(panel.id),
    children: (handle) => React.createElement('div', { 'data-slot': panel.id, 'data-handle': '', onPointerDown: handle.onPointerDown }, panel.title),
  }),
);

afterEach(() => {
  seen.clear();
  closed.length = 0;
  cleanup();
});

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'tune-view',
  collapsible: true,
  listed: true,
  ...over,
});
/** An entry as a creation path builds it, carrying resolved settings whose tuning is `tuning`. */
function made(id: string, tuning: NonNullable<PanelSettings['tuning']> = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'tune-view' }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, instance: { tuning }, ...over }, resolvePanelSettings({ template: { overflow: 'park', tuning } }).value, 'create');
}
const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], tuning?: WorkspaceTuning): React.ReactElement =>
  withHost(React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, ...(tuning === undefined ? {} : { tuning }) }));
const slotOf = (container: HTMLElement, id: string): HTMLElement => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.parentElement;
  assert.ok(slot, `slot ${id} is mounted`);
  return slot as HTMLElement;
};
const xOf = (container: HTMLElement, id: string): number => {
  const match = /translateX\((-?[\d.]+)px\)/.exec(slotOf(container, id).style.transform);
  return match === null ? 0 : Number(match[1]);
};
const seenOf = (id: string): Seen => {
  const value = seen.get(id);
  assert.ok(value, `the view of ${id} rendered`);
  return value;
};

// ---------------------------------------------------------------------------
// The four differentials
// ---------------------------------------------------------------------------

test('differential tuning.rowGap: the second slot rests one gap beyond the first column', () => {
  differential('tuning.rowGap', (run) => {
    for (const rowGap of [16, 40]) {
      run(rowGap, () => {
        const mounted = mount(rowOf([entry('a'), entry('b')], { rowGap }));
        const x = xOf(mounted.container, 'b');
        mounted.unmount();
        return x;
      });
    }
  });
});

/** The x of a slot `frames` frames into its entrance, under a slide of `durationSec`. */
async function entranceX(durationSec: number, frames: number): Promise<number> {
  const mounted = mount(rowOf([entry('a')], { slide: { durationSec } }));
  mounted.rerender(rowOf([entry('a'), entry('b')], { slide: { durationSec } }));
  await advanceFrames(frames * 16);
  const x = xOf(mounted.container, 'b');
  mounted.unmount();
  return x;
}

test('differential tuning.slide: a longer slide has covered less of its entrance after the same frames', async () => {
  const outputs = [await entranceX(0.4, 8), await entranceX(0.8, 8)];
  differential('tuning.slide', (run) => {
    [0.4, 0.8].forEach((durationSec, i) => run(durationSec, () => outputs[i]));
  });
  assert.ok(outputs[0]! < outputs[1]!, `the 0.4 s slide (${outputs[0]}) is nearer its rest than the 0.8 s one (${outputs[1]}); rest is 406 and it starts 796 away`);
});

/** The steps a 150 px drag right of `a` asks for, with one 390 px neighbour on its right. */
function stepsFor(hopFraction: number): number {
  const mounted = mount(rowOf([entry('a'), entry('b')], { hopFraction }));
  const steps = seenOf('a').steps(150);
  mounted.unmount();
  return steps;
}

test('differential tuning.hopFraction: 150 px crosses a 406 px span at a quarter of it and not at a half', () => {
  differential('tuning.hopFraction', (run) => {
    run(0.5, () => stepsFor(0.5));
    run(0.25, () => stepsFor(0.25));
  });
});

/** Whether a 100 px drag down of the panel's handle closed it, under `minDistancePx`. */
async function closesAt(minDistancePx: number): Promise<boolean> {
  const mounted = mount(rowOf([entry('a', { view: 'tune-drag' })], { dragToClose: { minDistancePx } }));
  await drag(mounted.container.querySelector('[data-handle]')!, { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  const didClose = closed.includes('a');
  mounted.unmount();
  closed.length = 0;
  return didClose;
}

test('differential tuning.dragToClose: a 100 px drag closes under an 80 px minimum and not under a 120 px one', async () => {
  const outputs = [await closesAt(80), await closesAt(120)];
  differential('tuning.dragToClose', (run) => {
    [80, 120].forEach((minDistancePx, i) => run(minDistancePx, () => outputs[i]));
  });
  assert.deepEqual(outputs, [true, false]);
});

registerTestView('tune-chrome', ({ panel }) => React.createElement(Panel, { title: panel.title, children: React.createElement('i', { 'data-slot': panel.id }) }));

/** The inline opacity of a panel's header under a chrome mode, with nothing hovered or active. */
function headerOpacityUnder(mode: 'always' | 'hover-or-active'): string {
  const mounted = mount(rowOf([entry('a', { view: 'tune-chrome' })], { chrome: { mode, fadeMs: 0 } }));
  const opacity = mounted.container.querySelector<HTMLElement>('[data-panel-chrome-part="header"]')!.style.opacity;
  mounted.unmount();
  return opacity;
}

test('differential tuning.chrome: an idle panel keeps its header drawn under always and transparent under hover-or-active', () => {
  differential('tuning.chrome', (run) => {
    run('always', () => headerOpacityUnder('always'));
    run('hover-or-active', () => headerOpacityUnder('hover-or-active'));
  });
});

/** Whether the row's centring margin glides when a panel joins, `waitMs` after the width changed, under the given leaf. */
async function glidesAfterResize(waitMs: number, resizeSettleSlides: number): Promise<boolean> {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const at = (liveWidths: number[], width: number): React.ReactElement =>
    withHost(
      React.createElement(Workspace, {
        overflowContainerRef: React.createRef<HTMLDivElement>(),
        rowRef: React.createRef<HTMLDivElement>(),
        containerWidth: width,
        phoneWidth: 390,
        fixedColumnCount: 1,
        liveWidths,
        tuning: { resizeSettleSlides },
        children: React.createElement('i'),
      } as never),
    );
  const margin = (m: ReturnType<typeof mount>): number => Number.parseFloat((m.container.querySelector('[data-row-strip]') as HTMLElement).style.marginLeft);
  const m = mount(at([], 1000));
  m.rerender(at([], 1200));
  act(() => mock.timers.tick(waitMs));
  await advanceFrames(2000);
  const start = margin(m);
  m.rerender(at([390], 1200));
  await advanceFrames(32);
  const mid = margin(m);
  await advanceFrames(2000);
  const end = margin(m);
  m.unmount();
  mock.timers.reset();
  assert.notEqual(start, end, 'control: the margin does move when a panel joins');
  return mid !== start && mid !== end;
}

test('differential tuning.resizeSettleSlides: 600 ms after a width change the row glides at 1 slide (400 ms) and still snaps at 2 (800 ms)', async () => {
  const short = await glidesAfterResize(600, 1);
  const long = await glidesAfterResize(600, 2);
  differential('tuning.resizeSettleSlides', (run) => {
    run(1, () => short);
    run(2, () => long);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('the library tuning defaults are exactly these numbers, by key name', () => {
  assert.deepEqual(LIBRARY_TUNING_DEFAULTS, {
    rowGap: 16,
    dragToClose: { distanceFraction: 0.25, minDistancePx: 80, flickMinDistancePx: 40, flickVelocity: 700, cancelVelocity: -300, directionLockPx: 8, restMs: 50, velocityWindowMs: 100, snapBack: { stiffness: 520, damping: 42 } },
    slide: { durationSec: 0.4, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.18, closeExitEase: 'easeIn', glideEase: 'cubic-out' },
    hopFraction: 0.5,
    edgeScroll: { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 },
    saveQuietMs: 500,
    gestureLockMs: 60,
    gestureQuietMs: 150,
    resizeSettleSlides: 1.25,
    returnTieBreak: 'latest-first',
    dropTieBreak: 'leftmost',
    rowGesture: 'step',
    initialScroll: 'start',
    chrome: { mode: 'always', fadeMs: 120, fadeEase: 'easeOut', slideMs: 140, slidePx: 8, graceMs: 250 },
    maxLivePanels: null,
    shrinkOutOfView: 'off',
    phoneFit: 'off',
    phoneFitMin: 0.82,
    phoneFitMax: 1.13,
  });
});

test('slideToTransition: the default slide is SLOT_TRANSITION itself, any other duration or ease a fresh object with its own ease array', () => {
  assert.equal(slideToTransition(LIBRARY_TUNING_DEFAULTS.slide), SLOT_TRANSITION);
  assert.equal(PANEL_TRANSITION, SLOT_TRANSITION);
  const slow: SlideTuning = { ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0.8 };
  const slowed = slideToTransition(slow);
  assert.notEqual(slowed, SLOT_TRANSITION);
  assert.deepEqual(slowed, { duration: 0.8, ease: [0.2, 0, 0, 1] });
  assert.notEqual(slowed.ease, slow.ease, 'the ease is copied: the tuning holds a read-only tuple');
  assert.equal(slideToTransition({ ...LIBRARY_TUNING_DEFAULTS.slide, closeExitSeconds: 0.3 }), SLOT_TRANSITION, 'the close exit is not part of a transition');
});

test('slideToTransition: each of the four ease numbers alone makes the transition its own, carrying that number', () => {
  const one = (ease: readonly [number, number, number, number]) => slideToTransition({ ...LIBRARY_TUNING_DEFAULTS.slide, ease });
  assert.deepEqual(one([0.3, 0, 0, 1]), { duration: 0.4, ease: [0.3, 0, 0, 1] }, 'the first');
  assert.deepEqual(one([0.2, 0.1, 0, 1]), { duration: 0.4, ease: [0.2, 0.1, 0, 1] }, 'the second');
  assert.deepEqual(one([0.2, 0, 0.1, 1]), { duration: 0.4, ease: [0.2, 0, 0.1, 1] }, 'the third');
  assert.deepEqual(one([0.2, 0, 0, 0.9]), { duration: 0.4, ease: [0.2, 0, 0, 0.9] }, 'the fourth');
  for (const ease of [[0.3, 0, 0, 1], [0.2, 0.1, 0, 1], [0.2, 0, 0.1, 1], [0.2, 0, 0, 0.9]] as const) assert.notEqual(one(ease), SLOT_TRANSITION, `${ease.join(',')} is not the shared transition`);
});

// ---------------------------------------------------------------------------
// slide
// ---------------------------------------------------------------------------

test('slide: the slot enters and leaves over durationSec, the down exit takes closeExitSeconds', () => {
  const slow: SlideTuning = { durationSec: 0.8, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.3, closeExitEase: 'easeIn', glideEase: 'cubic-out' };
  const base = panelRowSlotMotion(0, 390, 700, 'right', 'down');
  assert.equal(base.transition.duration, 0.4);
  assert.equal((base.exit as { transition: { duration: number } }).transition.duration, 0.18);
  const tuned = panelRowSlotMotion(0, 390, 700, 'right', 'down', true, 16, slow);
  assert.equal(tuned.transition.duration, 0.8);
  assert.equal((tuned.exit as { transition: { duration: number } }).transition.duration, 0.3);
});

test('slide: the shell glides with the resolved slide once settled, and snaps before', () => {
  const input = { containerWidth: 1300, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [] };
  const slide: SlideTuning = { durationSec: 0.8, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.18, closeExitEase: 'easeIn', glideEase: 'cubic-out' };
  assert.deepEqual(workspaceShellStyle({ ...input, rowResizeSettled: true, slide }).transition, { duration: 0.8, ease: [0.2, 0, 0, 1] });
  assert.equal(workspaceShellStyle({ ...input, rowResizeSettled: true }).transition, PANEL_TRANSITION);
  assert.deepEqual(workspaceShellStyle({ ...input, rowResizeSettled: false, slide }).transition, { duration: 0 });
});

/** The props of the nearest motion component above `el` that carries `key`: a DOM node never holds them itself. */
function motionPropsOf(el: Element, key: string): Record<string, unknown> {
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  assert.ok(fiberKey, 'the node has a React fiber');
  for (let fiber = (el as unknown as Record<string, { return: unknown; memoizedProps?: Record<string, unknown> }>)[fiberKey]!; fiber; fiber = fiber.return as typeof fiber) {
    if (fiber.memoizedProps !== undefined && key in fiber.memoizedProps) return fiber.memoizedProps;
  }
  assert.fail(`no motion component above the node carries ${key}`);
}

/** The width the views that draw a PanelSizeBox below read; a test sets it before it renders again. */
let boxWidth = 390;
for (const name of ['tune-size', 'tune-size-own', 'snap-size', 'snap-size-r']) registerTestView(name, () => React.createElement(PanelSizeBox, { width: boxWidth, height: 700, children: React.createElement('i') }));

/** How long, in ms, the PanelSizeBox in what `render` draws takes to reach its new width after `boxWidth` grows from 390 to 780. */
async function sizeGlideMs(render: () => React.ReactElement): Promise<number> {
  boxWidth = 390;
  const mounted = mount(render());
  boxWidth = 780;
  mounted.rerender(render());
  const box = mounted.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  let frames = 0;
  while (box.style.transform !== '' && frames < 200) {
    await advanceFrames(16);
    frames += 1;
  }
  mounted.unmount();
  boxWidth = 390;
  return frames * 16;
}

test("slide: PanelSizeBox's glide is the panel's resolved slide inside a slot and the shared one outside", async () => {
  const near = (actual: number, seconds: number, what: string): void => assert.ok(Math.abs(actual - seconds * 1000) <= 48, `${what}: ${actual} ms for ${seconds} s`);
  near(await sizeGlideMs(() => rowOf([entry('a', { view: 'tune-size' })], { slide: { durationSec: 0.8 } })), 0.8, "the workspace's slide");
  near(await sizeGlideMs(() => rowOf([made('a', { slide: { durationSec: 0.6 } }, { view: 'tune-size-own' })], { slide: { durationSec: 0.8 } })), 0.6, "the panel's own slide beats the workspace's");
  near(await sizeGlideMs(() => React.createElement(PanelSizeBox, { width: boxWidth, height: 700, children: React.createElement('i') })), PANEL_TRANSITION.duration, 'outside a slot, the shared transition');
});

test('PanelSizeBox snaps under Reduce Motion and glides otherwise', async () => {
  const slide = { slide: { durationSec: 0.8 } };
  assert.ok((await sizeGlideMs(() => rowOf([entry('a', { view: 'snap-size' })], slide))) > 500, 'positive control: the resize glides');
  assert.equal(await sizeGlideMs(() => React.createElement(MotionConfig, { reducedMotion: 'always' }, rowOf([entry('a', { view: 'snap-size-r' })], slide))), 0, 'Reduce Motion snaps');
});

/** A Workspace over one PanelRow: `workspace` is the Workspace's tuning, `row` the PanelRow's own prop. */
function inWorkspace(workspace: WorkspaceTuning, entries: PanelWindow[], rowRef: React.RefObject<HTMLDivElement | null>, liveWidths: number[] = []): React.ReactElement {
  return withHost(
    React.createElement(Workspace, {
      overflowContainerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      rowRef,
      containerWidth: 2400,
      rowResizeSettled: true,
      phoneWidth: 390,
      fixedColumnCount: 1,
      liveWidths,
      tuning: workspace,
      children: React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
    }),
  );
}

/** x of slot b `frames` frames after it joined a row holding only a. */
async function joinedX(second: PanelWindow, frames: number): Promise<number> {
  const mounted = mount(rowOf([entry('a')]));
  mounted.rerender(rowOf([entry('a'), second]));
  await advanceFrames(frames * 16);
  const x = xOf(mounted.container, 'b');
  mounted.unmount();
  return x;
}

test("slide: a panel's own slide, not the workspace's, times that panel's own entrance", async () => {
  const plain = await joinedX(entry('b'), 8);
  const slow = await joinedX(made('b', { slide: { durationSec: 0.9 } }), 8);
  assert.ok(slow > plain, `the panel with its own 0.9 s slide (${slow}) is further from rest than the default 0.4 s one (${plain})`);
});

test('slide: the Workspace hands its resolved slide to the shell glide', () => {
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  mount(inWorkspace({ slide: { durationSec: 0.8 } }, [entry('a')], rowRef, [768, 390]));
  assert.deepEqual(motionPropsOf(rowRef.current!, 'animate').transition, { duration: 0.8, ease: [0.2, 0, 0, 1] });
});

// ---------------------------------------------------------------------------
// hopFraction
// ---------------------------------------------------------------------------

test('hopFraction: over [phone, tablet] a quarter, a half and three quarters of each span give these literal step counts', () => {
  const neighbors = { left: [], right: [390, 768] };
  const at = (offset: number, hop?: number): number => reorderStepsForOffset(offset, neighbors, 16, hop);
  // The spans are 406 and 784: the first hop is at 406 x f and the second at 406 + 784 x f.
  for (const [hop, first, second] of [[0.25, 101.5, 602], [0.5, 203, 798], [0.75, 304.5, 994]] as const) {
    assert.equal(at(first - 0.5, hop), 0, `just short of the first hop at ${hop}`);
    assert.equal(at(first, hop), 1, `the first hop at ${hop}`);
    assert.equal(at(second - 1, hop), 1, `just short of the second hop at ${hop}`);
    assert.equal(at(second, hop), 2, `the second hop at ${hop}`);
  }
  for (const offset of [0, 100, 203, 300, 798, 1000, -203]) assert.equal(at(offset), at(offset, 0.5), `with no argument it is the half rule at ${offset}`);
});

test('usePanelReorderSteps: in a slot, steps(offsetX) uses the row gap and the hop fraction of the slot without the view passing either', () => {
  // One neighbour of 390 on the right: the hop is at (390 + gap) x fraction.
  const table: readonly [number, number, number, number, number][] = [
    // offset, gap 16 / 0.5 (203), gap 16 / 0.25 (101.5), gap 40 / 0.5 (215), gap 40 / 0.25 (107.5)
    [105, 0, 1, 0, 0],
    [205, 1, 1, 0, 1],
    [220, 1, 1, 1, 1],
    [-220, 0, 0, 0, 0],
  ];
  const settings: readonly [number, number][] = [[16, 0.5], [16, 0.25], [40, 0.5], [40, 0.25]];
  settings.forEach(([rowGap, hopFraction], column) => {
    const mounted = mount(rowOf([entry('a'), entry('b')], { rowGap, hopFraction }));
    for (const row of table) assert.equal(seenOf('a').steps(row[0]), row[column + 1], `offset ${row[0]} at gap ${rowGap} and hop ${hopFraction}`);
    mounted.unmount();
    seen.clear();
  });
});

test('usePanelReorderSteps: outside a row there are no neighbours, so every offset is 0', () => {
  let steps: ((offsetX: number) => number) | undefined;
  function Probe(): React.ReactElement {
    steps = usePanelReorderSteps();
    return React.createElement('i');
  }
  mount(React.createElement(Probe));
  for (const offset of [0, 1, 500, -500, 5000]) assert.equal(steps!(offset), 0);
});

// ---------------------------------------------------------------------------
// The cascade, the scope and the ranges
// ---------------------------------------------------------------------------

test('usePanelTuning: exactly the six keys, the library defaults outside a row and the workspace value inside one', () => {
  let outside: ReturnType<typeof usePanelTuning> | undefined;
  function Probe(): React.ReactElement {
    outside = usePanelTuning();
    return React.createElement('i');
  }
  mount(React.createElement(Probe));
  assert.deepEqual(Object.keys(outside!), ['rowGap', 'chrome', 'dragToClose', 'slide', 'hopFraction', 'edgeScroll']);
  assert.deepEqual(outside, {
    rowGap: 16,
    chrome: { mode: 'always', fadeMs: 120, fadeEase: 'easeOut', slideMs: 140, slidePx: 8, graceMs: 250 },
    dragToClose: LIBRARY_TUNING_DEFAULTS.dragToClose,
    slide: LIBRARY_TUNING_DEFAULTS.slide,
    hopFraction: 0.5,
    edgeScroll: { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 },
  });
  const inRow = mount(rowOf([entry('a')], { rowGap: 24, hopFraction: 0.3, edgeScroll: { zonePx: 60 } }));
  const tuning = seenOf('a').tuning;
  assert.deepEqual(Object.keys(tuning), ['rowGap', 'chrome', 'dragToClose', 'slide', 'hopFraction', 'edgeScroll']);
  assert.equal(tuning.rowGap, 24);
  assert.equal(tuning.hopFraction, 0.3);
  assert.deepEqual(tuning.edgeScroll, { zonePx: 60, maxPxPerSec: 900, reducedStepMs: 500 }, 'a leaf given in part keeps the default for the rest');
  inRow.unmount();
});

test("cascade: a panel's own dragToClose, slide and hopFraction beat the workspace's for that panel only, and its rowGap is always the workspace's", () => {
  const workspace: WorkspaceTuning = { rowGap: 24, dragToClose: { minDistancePx: 100 }, slide: { durationSec: 0.5 }, hopFraction: 0.3, edgeScroll: { zonePx: 60 } };
  const own = { dragToClose: { minDistancePx: 200 }, slide: { durationSec: 0.9 }, hopFraction: 0.7, edgeScroll: { zonePx: 90 } };
  const mounted = mount(rowOf([entry('plain'), made('own', own)], workspace));
  const plain = seenOf('plain').tuning;
  const mine = seenOf('own').tuning;
  assert.equal(plain.dragToClose.minDistancePx, 100);
  assert.equal(plain.slide.durationSec, 0.5);
  assert.equal(plain.hopFraction, 0.3);
  assert.equal(plain.edgeScroll.zonePx, 60);
  assert.equal(mine.dragToClose.minDistancePx, 200);
  assert.equal(mine.slide.durationSec, 0.9);
  assert.equal(mine.hopFraction, 0.7);
  assert.equal(mine.edgeScroll.zonePx, 90);
  assert.equal(plain.rowGap, 24);
  assert.equal(mine.rowGap, 24);
  mounted.unmount();
});

const refusal = (layers: Parameters<typeof resolvePanelSettings>[0]): PanelManagerError => {
  try {
    resolvePanelSettings(layers);
  } catch (error) {
    assert.ok(error instanceof PanelManagerError, 'the refusal is a PanelManagerError');
    return error;
  }
  return assert.fail('the layer was accepted');
};

test('scope: rowGap at the template layer throws invalid-settings naming template.tuning.rowGap, and at the instance layer is a wrong-scope conflict that applies nothing', () => {
  const thrown = refusal({ template: { tuning: { rowGap: 20 } as PanelTuning } });
  assert.equal(thrown.code, 'invalid-settings');
  assert.match(thrown.message, /template\.tuning\.rowGap/);
  const res = resolvePanelSettings({ instance: { tuning: { rowGap: 20 } as PanelTuning } });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.layer, c.kind]), [['tuning.rowGap', 'instance', 'wrong-scope']]);
  assert.equal(res.value.tuning.dragToClose.minDistancePx, 80);
  assert.ok(!('rowGap' in res.value.tuning), 'a panel carries no rowGap of its own');
});

/** Each per-panel tuning member, its two floors and its two ceilings: [path, value, accepted]. */
const RANGES: readonly [string, unknown, boolean][] = [
  ['dragToClose.distanceFraction', 0.05, true],
  ['dragToClose.distanceFraction', 0.049, false],
  ['dragToClose.distanceFraction', 1, true],
  ['dragToClose.distanceFraction', 1.01, false],
  ['dragToClose.minDistancePx', 8, true],
  ['dragToClose.minDistancePx', 7.9, false],
  ['dragToClose.flickMinDistancePx', 8, true],
  ['dragToClose.flickMinDistancePx', 7.9, false],
  ['dragToClose.flickVelocity', 100, true],
  ['dragToClose.flickVelocity', 99, false],
  ['dragToClose.cancelVelocity', -50, true],
  ['dragToClose.cancelVelocity', -49, false],
  ['dragToClose.directionLockPx', 2, true],
  ['dragToClose.directionLockPx', 1, false],
  ['dragToClose.directionLockPx', 64, true],
  ['dragToClose.directionLockPx', 65, false],
  ['dragToClose.directionLockPx', 8.5, false],
  ['dragToClose.snapBack', { stiffness: 50, damping: 5 }, true],
  ['dragToClose.snapBack', { stiffness: 49, damping: 5 }, false],
  ['dragToClose.snapBack', { stiffness: 2000, damping: 200 }, true],
  ['dragToClose.snapBack', { stiffness: 2001, damping: 200 }, false],
  ['dragToClose.snapBack', { stiffness: 50, damping: 4 }, false],
  ['dragToClose.snapBack', { stiffness: 50, damping: 201 }, false],
  ['slide.durationSec', 0, true],
  ['slide.durationSec', -0.1, false],
  ['slide.durationSec', 10, true],
  ['slide.durationSec', 10.1, false],
  ['slide.ease', [0, 0.5, 1, 2], true],
  ['slide.ease', [-0.1, 0, 0, 1], false],
  ['slide.ease', [0, 0, 1.1, 1], false],
  ['slide.ease', [0, 0, 1], false],
  ['slide.closeExitSeconds', 0, true],
  ['slide.closeExitSeconds', -0.1, false],
  ['slide.closeExitSeconds', 5, true],
  ['slide.closeExitSeconds', 5.1, false],
  ['hopFraction', 1, true],
  ['hopFraction', 0.001, true],
  ['hopFraction', 0, false],
  ['hopFraction', 1.01, false],
  ['edgeScroll.zonePx', 8, true],
  ['edgeScroll.zonePx', 7, false],
  ['edgeScroll.zonePx', 200, true],
  ['edgeScroll.zonePx', 201, false],
  ['edgeScroll.maxPxPerSec', 100, true],
  ['edgeScroll.maxPxPerSec', 99, false],
  ['edgeScroll.maxPxPerSec', 5000, true],
  ['edgeScroll.maxPxPerSec', 5001, false],
  ['edgeScroll.reducedStepMs', 100, true],
  ['edgeScroll.reducedStepMs', 99, false],
  ['edgeScroll.reducedStepMs', 5000, true],
  ['edgeScroll.reducedStepMs', 5001, false],
];
const layerWith = (path: string, value: unknown): PanelSettings => {
  const [leaf, member] = path.split('.') as [string, string | undefined];
  return { tuning: { [leaf]: member === undefined ? value : { [member]: value } } } as PanelSettings;
};

test('ranges: the table has both sides of every floor and ceiling', () => {
  assert.ok(RANGES.filter(([, , accepted]) => accepted).length >= 20 && RANGES.filter(([, , accepted]) => !accepted).length >= 25);
});

for (const [path, value, accepted] of RANGES) {
  const shown = JSON.stringify(value);
  test(`ranges: a template layer ${accepted ? 'accepts' : 'refuses'} tuning.${path} = ${shown}${accepted ? '' : ' with invalid-settings naming the leaf'}`, () => {
    if (accepted) {
      assert.doesNotThrow(() => resolvePanelSettings({ template: layerWith(path, value) }));
      return;
    }
    const thrown = refusal({ template: layerWith(path, value) });
    assert.equal(thrown.code, 'invalid-settings');
    assert.ok(thrown.message.includes(`tuning.${path}`), `${thrown.message} names tuning.${path}`);
  });
}

const WORKSPACE_RANGES: readonly [string, unknown, boolean][] = [['rowGap', 0, true], ['rowGap', 200, true], ['rowGap', -1, false], ['rowGap', 201, false], ['rowGap', 16.5, false], ...RANGES];

for (const [path, value, accepted] of WORKSPACE_RANGES) {
  test(`ranges: ${path} = ${JSON.stringify(value)} in the workspace tuning, a Workspace or a PanelRow ${accepted ? 'is kept' : 'takes its default and nothing throws'}`, () => {
    const resolved = resolveWorkspaceTuning(layerWith(path, value).tuning as WorkspaceTuning);
    const [leaf, member] = path.split('.') as [keyof typeof LIBRARY_TUNING_DEFAULTS, string | undefined];
    const got = member === undefined ? resolved[leaf] : (resolved[leaf] as Record<string, unknown>)[member];
    const base = member === undefined ? LIBRARY_TUNING_DEFAULTS[leaf] : (LIBRARY_TUNING_DEFAULTS[leaf] as Record<string, unknown>)[member];
    assert.deepEqual(got, accepted ? value : base);
  });
}

test('ranges: a refused member keeps its default beside an accepted sibling, and a resolved value resolves to itself', () => {
  const mixed = resolveWorkspaceTuning({ dragToClose: { minDistancePx: 3, flickVelocity: 900 }, rowGap: 12 });
  assert.equal(mixed.dragToClose.minDistancePx, 80, 'the refused member keeps its default');
  assert.equal(mixed.dragToClose.flickVelocity, 900, 'and its accepted sibling is kept');
  assert.equal(mixed.rowGap, 12);
  assert.equal(resolveWorkspaceTuning(undefined), LIBRARY_TUNING_DEFAULTS);
  assert.equal(resolveWorkspaceTuning(mixed), mixed);
});

// ---------------------------------------------------------------------------
// Where the resolved value goes
// ---------------------------------------------------------------------------

test('Workspace provides its tuning to the rows below it, and ProvidedPanels.tuning is the workspace tuning over the library defaults', () => {
  const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const mounted = mount(
    withHost(
      React.createElement(Workspace, {
        overflowContainerRef: containerRef,
        rowRef,
        containerWidth: 1300,
        rowResizeSettled: true,
        phoneWidth: 390,
        fixedColumnCount: 1,
        liveWidths: [],
        tuning: { rowGap: 32, hopFraction: 0.25 },
        children: React.createElement(StaticRow, { seed: { tuning: { rowGap: 32, hopFraction: 0.25 } }, entries: [entry('a')], rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
      }),
    ),
  );
  assert.equal(seenOf('a').tuning.rowGap, 32);
  assert.equal(seenOf('a').tuning.hopFraction, 0.25);
  assert.equal(seenOf('a').tuning.dragToClose.minDistancePx, 80);
  mounted.unmount();

  let provided: ProvidedPanels | undefined;
  const workspace = createWorkspace({ mount: false, tuning: { rowGap: 8, slide: { durationSec: 1 }, saveQuietMs: 900 } });
  function Probe(): React.ReactElement {
    provided = useProvidePanels(panelsInput({ workspace }));
    return React.createElement('i');
  }
  mount(React.createElement(Probe));
  assert.equal(provided!.tuning.rowGap, 8);
  assert.equal(provided!.tuning.slide.durationSec, 1);
  assert.equal(provided!.tuning.slide.closeExitSeconds, 0.18);
  assert.equal(provided!.tuning.saveQuietMs, 900);
  assert.equal(provided!.tuning.dropTieBreak, 'leftmost');
  assert.deepEqual(provided!.tuning.edgeScroll, { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 });
});

test('the slot context carries the tuning, edgeScroll included, to a view', () => {
  let slot: PanelSlotValue | undefined;
  registerTestView('tune-ctx', () => {
    slot = React.useContext(PanelSlotContext);
    return React.createElement('i');
  });
  const mounted = mount(rowOf([entry('a', { view: 'tune-ctx' })], { edgeScroll: { maxPxPerSec: 1200 } }));
  assert.deepEqual(slot!.tuning.edgeScroll, { zonePx: 48, maxPxPerSec: 1200, reducedStepMs: 500 });
  mounted.unmount();
});

test('every tuning name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
