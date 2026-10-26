/**
 * The engine's reading of the look tuning it owns: tuning.rowGap, tuning.dragToClose, tuning.slide and
 * tuning.hopFraction, through a mounted PanelRow where the behaviour is a render and through the pure function where
 * it is arithmetic. One differential per name, then the defaults, the workspace-only scope, the range rules, and the
 * interfaces a host calls.
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
import type { PanelWindow, ProvidedPanels, SlideTuning, WorkspaceHandle, WorkspaceTuning } from '../index.js';
import { SLOT_TRANSITION } from '../directionalTransition.js';
import { SLIDE_DURATION_SEC, SLIDE_EASE } from '../rowConstants.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { checkTuningLeaf, resolvePanelSettings } from '../panelSettings.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { workspaceShellStyle } from '../Workspace.js';
import { differential, differentialsCovered } from './support/differential.js';
import { drag } from './support/drag-gesture.js';
import { advanceFrames, cleanup, mount, panelsInput, withHost, StaticRow, seededWorkspace } from './support/mount-harness.js';
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
  view: 'tune-view',
  collapsible: true,
  listed: true,
  ...over,
});
const NONE: ReadonlySet<string> = new Set();
/**
 * A seeded workspace that reports its restore as settled. A row holds its slots' moves until the restore settles, and a workspace
 * that was never attached does not, so without this the timing tests would see every move snap.
 */
function settledWorkspace(entries: readonly PanelWindow[], tuning?: WorkspaceTuning): WorkspaceHandle {
  const workspace = seededWorkspace(entries, { rootId: ROOT, ...(tuning === undefined ? {} : { tuning }) });
  const panels = workspace.panels as { getSnapshot: () => { status: string } };
  const real = panels.getSnapshot.bind(panels);
  panels.getSnapshot = () => ({ ...real(), status: 'ready' });
  return workspace;
}
/** Holds one settled workspace for the life of a mount, so a rerender with other entries is the same workspace. */
function SettledRow(props: { entries: PanelWindow[]; tuning?: WorkspaceTuning }): React.ReactElement {
  const [workspace] = React.useState(() => settledWorkspace(props.entries, props.tuning));
  return React.createElement(StaticRow, { entries: props.entries, workspace, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE });
}
const rowOf = (entries: PanelWindow[], tuning?: WorkspaceTuning): React.ReactElement =>
  withHost(React.createElement(SettledRow, { entries, ...(tuning === undefined ? {} : { tuning }) }));
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
  const workspace = createWorkspace({ mount: false, tuning: { resizeSettleSlides } });
  const at = (liveWidths: number[], width: number): React.ReactElement =>
    withHost(
      React.createElement(Workspace, {
        overflowContainerRef: React.createRef<HTMLDivElement>(),
        rowRef: React.createRef<HTMLDivElement>(),
        containerWidth: width,
        phoneWidth: 390,
        fixedColumnCount: 1,
        liveWidths,
        workspace,
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

test('differential tuning.resizeSettleSlides: 1.5 slides after a width change the row glides at 1 slide and still snaps at 2', async () => {
  const waitMs = 1.5 * SLIDE_DURATION_SEC * 1000;
  const short = await glidesAfterResize(waitMs, 1);
  const long = await glidesAfterResize(waitMs, 2);
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
    rowTop: null,
    phoneHeight: 'fit',
    dragToClose: { distanceFraction: 0.25, minDistancePx: 80, flickMinDistancePx: 40, flickVelocity: 700, cancelVelocity: -300 },
    slide: { durationSec: 0.6, ease: [0.4, 0, 0.2, 1], closeExitSeconds: 0.18, closeExitEase: 'easeIn', glideEase: 'cubic-out' },
    hopFraction: 0.5,
    edgeScroll: { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 },
    saveQuietMs: 500,
    gestureLockMs: 30,
    gestureQuietMs: 150,
    resizeSettleSlides: 1.25,
    returnTieBreak: 'latest-first',
    dropTieBreak: 'leftmost',
    rowGesture: 'step',
    initialScroll: 'start',
    chrome: { mode: 'always', fadeMs: 120, fadeEase: 'easeOut' },
    maxLivePanels: null,
    phoneFit: 'off',
    phoneFitMin: 0.82,
    phoneFitMax: 1.13,
    defaultEnterFrom: 'expand',
    defaultExitTo: 'shrink',
    shrinkUnfocused: false,
  });
});

test('slideToTransition: the default slide is SLOT_TRANSITION itself, any other duration or ease a fresh object with its own ease array', () => {
  assert.equal(slideToTransition(LIBRARY_TUNING_DEFAULTS.slide), SLOT_TRANSITION);
  assert.equal(PANEL_TRANSITION, SLOT_TRANSITION);
  const slow: SlideTuning = { ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0.8 };
  const slowed = slideToTransition(slow);
  assert.notEqual(slowed, SLOT_TRANSITION);
  assert.deepEqual(slowed, { duration: 0.8, ease: [...SLIDE_EASE] });
  assert.notEqual(slowed.ease, slow.ease, 'the ease is copied: the tuning holds a read-only tuple');
  assert.equal(slideToTransition({ ...LIBRARY_TUNING_DEFAULTS.slide, closeExitSeconds: 0.3 }), SLOT_TRANSITION, 'the close exit is not part of a transition');
});

test('slideToTransition: each of the four ease numbers alone makes the transition its own, carrying that number', () => {
  const one = (ease: readonly [number, number, number, number]) => slideToTransition({ ...LIBRARY_TUNING_DEFAULTS.slide, ease });
  const [x1, y1, x2, y2] = SLIDE_EASE;
  const first = [x1 + 0.1, y1, x2, y2] as const;
  const second = [x1, y1 + 0.1, x2, y2] as const;
  const third = [x1, y1, x2 + 0.1, y2] as const;
  const fourth = [x1, y1, x2, y2 - 0.1] as const;
  assert.deepEqual(one(first), { duration: SLIDE_DURATION_SEC, ease: [...first] }, 'the first');
  assert.deepEqual(one(second), { duration: SLIDE_DURATION_SEC, ease: [...second] }, 'the second');
  assert.deepEqual(one(third), { duration: SLIDE_DURATION_SEC, ease: [...third] }, 'the third');
  assert.deepEqual(one(fourth), { duration: SLIDE_DURATION_SEC, ease: [...fourth] }, 'the fourth');
  for (const ease of [first, second, third, fourth] as const) assert.notEqual(one(ease), SLOT_TRANSITION, `${ease.join(',')} is not the shared transition`);
});

// ---------------------------------------------------------------------------
// slide
// ---------------------------------------------------------------------------

test('slide: the slot enters and leaves over durationSec, the down exit takes closeExitSeconds', () => {
  const slow: SlideTuning = { durationSec: 0.8, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.3, closeExitEase: 'easeIn', glideEase: 'cubic-out' };
  const base = panelRowSlotMotion(0, 390, 700, 'right', 'down');
  assert.equal(base.transition.duration, SLIDE_DURATION_SEC);
  assert.equal((base.exit as { transition: { duration: number } }).transition.duration, 0.18);
  const tuned = panelRowSlotMotion(0, 390, 700, 'right', 'down', 16, slow);
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
  while (box.style.width !== '780px' && frames < 200) {
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
  near(await sizeGlideMs(() => React.createElement(PanelSizeBox, { width: boxWidth, height: 700, children: React.createElement('i') })), PANEL_TRANSITION.duration, 'outside a slot, the shared transition');
});

test('PanelSizeBox snaps under Reduce Motion and glides otherwise', async () => {
  const slide = { slide: { durationSec: 0.8 } };
  assert.ok((await sizeGlideMs(() => rowOf([entry('a', { view: 'snap-size' })], slide))) > 500, 'positive control: the resize glides');
  assert.equal(await sizeGlideMs(() => React.createElement(MotionConfig, { reducedMotion: 'always' }, rowOf([entry('a', { view: 'snap-size-r' })], slide))), 0, 'Reduce Motion snaps');
});

/** A Workspace shell over one PanelRow, both reading one workspace made with `tuning`. */
function inWorkspace(tuning: WorkspaceTuning, entries: PanelWindow[], rowRef: React.RefObject<HTMLDivElement | null>, liveWidths: number[] = []): React.ReactElement {
  const workspace = settledWorkspace(entries, tuning);
  return withHost(
    React.createElement(Workspace, {
      overflowContainerRef: { current: null } as React.RefObject<HTMLDivElement | null>,
      rowRef,
      containerWidth: 2400,
      rowResizeSettled: true,
      phoneWidth: 390,
      fixedColumnCount: 1,
      liveWidths,
      workspace,
      children: React.createElement(StaticRow, { entries, workspace, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
    }),
  );
}

test('slide: the Workspace hands its resolved slide to the shell glide', () => {
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  mount(inWorkspace({ slide: { durationSec: 0.8 } }, [entry('a')], rowRef, [768, 390]));
  assert.deepEqual(motionPropsOf(rowRef.current!, 'animate').transition, { duration: 0.8, ease: [...SLIDE_EASE] });
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

test('usePanelTuning: exactly the five row keys, the library defaults outside a row and the workspace value inside one', () => {
  let outside: ReturnType<typeof usePanelTuning> | undefined;
  function Probe(): React.ReactElement {
    outside = usePanelTuning();
    return React.createElement('i');
  }
  mount(React.createElement(Probe));
  assert.deepEqual(Object.keys(outside!), ['rowGap', 'dragToClose', 'slide', 'hopFraction', 'edgeScroll']);
  assert.deepEqual(outside, {
    rowGap: 16,
    dragToClose: LIBRARY_TUNING_DEFAULTS.dragToClose,
    slide: LIBRARY_TUNING_DEFAULTS.slide,
    hopFraction: 0.5,
    edgeScroll: { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 },
  });
  const inRow = mount(rowOf([entry('a')], { rowGap: 24, hopFraction: 0.3, edgeScroll: { zonePx: 60 } }));
  const tuning = seenOf('a').tuning;
  assert.deepEqual(Object.keys(tuning), ['rowGap', 'dragToClose', 'slide', 'hopFraction', 'edgeScroll']);
  assert.equal(tuning.rowGap, 24);
  assert.equal(tuning.hopFraction, 0.3);
  assert.deepEqual(tuning.edgeScroll, { zonePx: 60, maxPxPerSec: 900, reducedStepMs: 500 }, 'a leaf given in part keeps the default for the rest');
  inRow.unmount();
});

test('every panel in a row reads the same workspace rowGap, dragToClose, slide, hopFraction and edgeScroll', () => {
  const workspace: WorkspaceTuning = { rowGap: 24, dragToClose: { minDistancePx: 100 }, slide: { durationSec: 0.5 }, hopFraction: 0.3, edgeScroll: { zonePx: 60 } };
  const mounted = mount(rowOf([entry('one'), entry('two')], workspace));
  const one = seenOf('one').tuning;
  assert.deepEqual([one.rowGap, one.dragToClose.minDistancePx, one.slide.durationSec, one.hopFraction, one.edgeScroll.zonePx], [24, 100, 0.5, 0.3, 60]);
  assert.deepEqual(seenOf('two').tuning, one);
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

test('scope: a tuning key in a template throws invalid-settings naming template.tuning, and a panel resolves none', () => {
  const thrown = refusal({ template: { tuning: { rowGap: 20 } } as never });
  assert.equal(thrown.code, 'invalid-settings');
  assert.match(thrown.message, /template\.tuning/);
  assert.ok(!('tuning' in resolvePanelSettings().value), 'a panel carries no tuning');
});

/** Each tuning member, its two floors and its two ceilings: [path, value, accepted]. */
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
const layerWith = (path: string, value: unknown): WorkspaceTuning => {
  const [leaf, member] = path.split('.') as [string, string | undefined];
  return { [leaf]: member === undefined ? value : { [member]: value } } as WorkspaceTuning;
};

test('ranges: the table has both sides of every floor and ceiling', () => {
  assert.ok(RANGES.filter(([, , accepted]) => accepted).length >= 19 && RANGES.filter(([, , accepted]) => !accepted).length >= 21);
});

for (const [path, value, accepted] of RANGES) {
  test(`ranges: the tuning check ${accepted ? 'accepts' : 'refuses'} tuning.${path} = ${JSON.stringify(value)}${accepted ? '' : ' naming the leaf'}`, () => {
    const [leaf, member] = path.split('.') as [Parameters<typeof checkTuningLeaf>[0], string | undefined];
    const checked = checkTuningLeaf(leaf, member === undefined ? value : { [member]: value });
    if (accepted) {
      assert.deepEqual(checked.problems, []);
      return;
    }
    assert.deepEqual(checked.problems.map((q) => q.key), [`tuning.${path}`]);
  });
}

const WORKSPACE_RANGES: readonly [string, unknown, boolean][] = [['rowGap', 0, true], ['rowGap', 200, true], ['rowGap', -1, false], ['rowGap', 201, false], ['rowGap', 16.5, false], ['rowGesture', 'step', true], ['rowGesture', 'off', true], ['rowGesture', 'free', false], ...RANGES];

for (const [path, value, accepted] of WORKSPACE_RANGES) {
  test(`ranges: ${path} = ${JSON.stringify(value)} in the workspace tuning, a Workspace or a PanelRow ${accepted ? 'is kept' : 'takes its default and nothing throws'}`, () => {
    const resolved = resolveWorkspaceTuning(layerWith(path, value));
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

test('Workspace and its rows read the workspace handle tuning, and ProvidedPanels.tuning is the workspace tuning over the library defaults', () => {
  const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const handle = settledWorkspace([entry('a')], { rowGap: 32, hopFraction: 0.25 });
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
        workspace: handle,
        children: React.createElement(StaticRow, { workspace: handle, entries: [entry('a')], rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
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
