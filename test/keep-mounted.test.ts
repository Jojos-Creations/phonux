/**
 * keepMounted: a parked entry whose setting is true keeps its view mounted in the same slot, hidden, inert and out of
 * layout. jsdom proves structure only: that the slot has the attributes and the view stays mounted, never that the
 * browser draws or skips it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { CaptureRegistryProvider, LIBRARY_TUNING_DEFAULTS, Panel, PanelRow, registerView, resolvePanelSettings, useProvidePanels, usePanelHidden, usePanelNeighborWidths, useViewState } from '../index.js';
import type { CaptureRegistry, PanelWindow, ProvidedPanels } from '../index.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { PANEL_TRANSITION } from '../index.js';
import { enterStart, panelRowSlotMotion, parkExitTarget, slotDriver } from '../PanelRowSlot.js';
import { differential } from './support/differential.js';
import { advanceFrames, cleanup, mount, panelsInput, withHost } from './support/mount-harness.js';

const counts = new Map<string, { mounts: number; unmounts: number }>();
const countOf = (id: string): { mounts: number; unmounts: number } => {
  let c = counts.get(id);
  if (c === undefined) counts.set(id, (c = { mounts: 0, unmounts: 0 }));
  return c;
};
const seen = { hidden: [] as boolean[], layout: [] as { inert: boolean; ariaHidden: string | null; display: string }[] };
let stored = 0;
let setStored: ((n: number) => void) | undefined;
const neighbours = new Map<string, string>();

registerView('km-view', ({ panel }) => {
  React.useEffect(() => {
    countOf(panel.id).mounts += 1;
    return () => {
      countOf(panel.id).unmounts += 1;
    };
  }, []);
  const hidden = usePanelHidden();
  const [value, setValue] = useViewState('n', 0);
  neighbours.set(panel.id, JSON.stringify(usePanelNeighborWidths()));
  if (panel.id === 'a') {
    stored = value;
    setStored = setValue;
  }
  const ref = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    if (panel.id !== 'a') return;
    const slot = ref.current!.parentElement!;
    seen.layout.push({ inert: slot.hasAttribute('inert'), ariaHidden: slot.getAttribute('aria-hidden'), display: slot.style.display });
  });
  if (panel.id === 'a') seen.hidden.push(hidden);
  return React.createElement('i', { 'data-slot': panel.id, ref });
});
registerView('km-root', () => React.createElement('b'));

const base = resolvePanelSettings().value;
const entry = (id: string, live: boolean, keep: boolean, over: Partial<PanelWindow> = {}, settings: object = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id,
  live,
  locked: false,
  view: 'km-view',
  collapsible: true,
  listed: true,
  settings: { ...base, keepMounted: keep, ...settings },
  ...over,
});
const root = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'km-root', collapsible: false, listed: false });
const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], reduced = false): React.ReactElement => {
  const row = React.createElement(PanelRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE });
  return withHost(reduced ? React.createElement(MotionConfig, { reducedMotion: 'always' }, row) : row);
};
const slotOf = (container: HTMLElement, id: string): HTMLElement => {
  const view = container.querySelector(`[data-slot="${id}"]`);
  assert.ok(view, `the view of ${id} is mounted`);
  return view.parentElement!;
};
const isHidden = (slot: HTMLElement): boolean => slot.style.display === 'none' && slot.hasAttribute('inert') && slot.getAttribute('aria-hidden') === 'true';

afterEach(() => {
  cleanup();
  counts.clear();
  neighbours.clear();
  seen.hidden.length = 0;
  seen.layout.length = 0;
});

/** Three show-then-park cycles of `a` from a parked start; the view's counters and its stored value afterwards. */
async function threeCycles(keep: boolean): Promise<{ mounts: number; unmounts: number; stored: number }> {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, keep)]);
  const mounted = mount(at(false));
  for (let cycle = 0; cycle < 3; cycle += 1) {
    mounted.rerender(at(true));
    await advanceFrames(1000);
    if (cycle === 0) act(() => setStored!(7));
    mounted.rerender(at(false));
    await advanceFrames(1000);
  }
  const out = { ...countOf('a'), stored };
  mounted.unmount();
  return out;
}

let cycleResults: Map<boolean, { mounts: number; unmounts: number; stored: number }> | undefined;
async function cyclesBoth(): Promise<Map<boolean, { mounts: number; unmounts: number; stored: number }>> {
  if (cycleResults === undefined) {
    cycleResults = new Map();
    for (const keep of [true, false]) {
      counts.clear();
      cycleResults.set(keep, await threeCycles(keep));
    }
  }
  return cycleResults;
}

test('differential keepMounted: the two values give different mount and unmount counts over the same three cycles', async () => {
  const results = await cyclesBoth();
  // The shared recorder runs a scenario synchronously, so it is handed the two results already observed.
  differential('keepMounted', (run) => {
    run(true, () => results.get(true));
    run(false, () => results.get(false));
  });
});

test('keepMounted true: three show-and-park cycles from a parked start give 1 mount and 0 unmounts', async () => {
  const kept = (await cyclesBoth()).get(true)!;
  assert.deepEqual([kept.mounts, kept.unmounts], [1, 0]);
});

test('keepMounted false: the same three cycles give 3 mounts and 3 unmounts', async () => {
  const unkept = (await cyclesBoth()).get(false)!;
  assert.deepEqual([unkept.mounts, unkept.unmounts], [3, 3]);
});

test('viewState survives the three cycles whether the view is kept or not', async () => {
  const results = await cyclesBoth();
  assert.equal(results.get(true)!.stored, 7);
  assert.equal(results.get(false)!.stored, 7);
});

test('latch (a): live then parked with keepMounted false unmounts; turning it on later changes nothing until the next show, whose park then keeps the view', async () => {
  const at = (live: boolean, keep: boolean): React.ReactElement => rowOf([root(), entry('a', live, keep)]);
  const mounted = mount(at(true, false));
  mounted.rerender(at(false, false));
  await advanceFrames(1000);
  assert.equal(mounted.container.querySelector('[data-slot="a"]'), null);
  mounted.rerender(at(false, true));
  await advanceFrames(1000);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 }, 'the setting turned on while parked reaches no mount');
  mounted.rerender(at(true, true));
  await advanceFrames(1000);
  mounted.rerender(at(false, true));
  await advanceFrames(1000);
  assert.deepEqual(countOf('a'), { mounts: 2, unmounts: 1 }, 'its next park keeps the view');
  assert.ok(isHidden(slotOf(mounted.container, 'a')));
});

test('latch (b): flipped on during the park exit, the exiting view still unmounts', async () => {
  const at = (live: boolean, keep: boolean): React.ReactElement => rowOf([root(), entry('a', live, keep)]);
  const mounted = mount(at(true, false));
  await advanceFrames(1000);
  mounted.rerender(at(false, false));
  await advanceFrames(100);
  mounted.rerender(at(false, true));
  await advanceFrames(1000);
  assert.equal(mounted.container.querySelector('[data-slot="a"]'), null);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('latch (c): latched kept then flipped off, the view unmounts at once, with no slide left to wait for', async () => {
  const at = (live: boolean, keep: boolean): React.ReactElement => rowOf([root(), entry('a', live, keep)]);
  const mounted = mount(at(true, true));
  await advanceFrames(1000);
  mounted.rerender(at(false, true));
  await advanceFrames(1000);
  assert.ok(isHidden(slotOf(mounted.container, 'a')));
  mounted.rerender(at(false, false));
  await advanceFrames(32);
  assert.equal(mounted.container.querySelector('[data-slot="a"]'), null);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('latch (d): reset-on-park flipped after a park drops no cell, and set before the park drops it at that park', async () => {
  const withState = (live: boolean, viewState: 'keep' | 'reset-on-park'): React.ReactElement => rowOf([root(), entry('a', live, false, {}, { viewState })]);
  const mounted = mount(withState(true, 'keep'));
  await advanceFrames(1000);
  act(() => setStored!(5));
  mounted.rerender(withState(false, 'keep'));
  await advanceFrames(1000);
  mounted.rerender(withState(false, 'reset-on-park'));
  await advanceFrames(1000);
  mounted.rerender(withState(true, 'reset-on-park'));
  await advanceFrames(1000);
  assert.equal(stored, 5, 'the flip after the park released nothing');
  mounted.rerender(withState(false, 'reset-on-park'));
  await advanceFrames(1000);
  mounted.rerender(withState(true, 'reset-on-park'));
  await advanceFrames(1000);
  assert.equal(stored, 0, 'the park under reset-on-park dropped the cell');
});

/** `a` live and settled, then parked; `frames` later, the row. */
async function parkedFor(frames: number): Promise<{ mounted: ReturnType<typeof mount>; at: (live: boolean) => React.ReactElement }> {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(frames);
  return { mounted, at };
}

test('hidden state: during the exit slide the slot is inert and still drawn', async () => {
  const { mounted } = await parkedFor(100);
  const slot = slotOf(mounted.container, 'a');
  assert.equal(slot.hasAttribute('inert'), true);
  assert.notEqual(slot.style.display, 'none');
  assert.equal(slot.getAttribute('aria-hidden'), null);
});

test('hidden state: once the exit completes the slot is display none, inert and aria-hidden', async () => {
  const { mounted } = await parkedFor(1000);
  assert.ok(isHidden(slotOf(mounted.container, 'a')));
});

test('hidden state: the revive commit has none of the three at its first layout effect', async () => {
  const { mounted, at } = await parkedFor(1000);
  seen.layout.length = 0;
  mounted.rerender(at(true));
  assert.deepEqual(seen.layout[0], { inert: false, ariaHidden: null, display: '' });
});

test('hidden state: a revived slot ends with none of the three', async () => {
  const { mounted, at } = await parkedFor(1000);
  mounted.rerender(at(true));
  await advanceFrames(1000);
  const shown = slotOf(mounted.container, 'a');
  assert.equal(shown.hasAttribute('inert') || shown.hasAttribute('aria-hidden') || shown.style.display === 'none', false);
});

function Lone(): React.ReactElement {
  return React.createElement('span', null, String(usePanelHidden()));
}

test('usePanelHidden is false while the panel is live', async () => {
  mount(rowOf([root(), entry('a', true, true)]));
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), false);
});

test('usePanelHidden is false while the panel slides out', async () => {
  await parkedFor(100);
  assert.equal(seen.hidden.at(-1), false);
});

test('usePanelHidden is true once the slot is display none', async () => {
  const { mounted } = await parkedFor(1000);
  assert.equal(seen.hidden.at(-1), true);
  assert.equal(isHidden(slotOf(mounted.container, 'a')), true);
});

test('usePanelHidden is false again once the panel is shown', async () => {
  const { mounted, at } = await parkedFor(1000);
  mounted.rerender(at(true));
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), false);
});

test('usePanelHidden is false outside a row', () => {
  const lone = mount(withHost(React.createElement(Lone)));
  assert.equal(lone.container.textContent, 'false');
});

/** `a` live under `settings` then parked, with no frame advanced after the park: whether its slot is hidden. */
async function hiddenWithoutFrames(settings: object, reduced = false): Promise<boolean> {
  const rows = (live: boolean): PanelWindow[] => [root(), entry('a', live, true, {}, settings)];
  const mounted = mount(rowOf(rows(true), reduced));
  await advanceFrames(1000);
  mounted.rerender(rowOf(rows(false), reduced));
  await act(async () => {});
  const hidden = isHidden(slotOf(mounted.container, 'a'));
  mounted.unmount();
  return hidden;
}

test('fallback: animated false reaches display none with no frame advanced', async () => {
  assert.equal(await hiddenWithoutFrames({ animated: false }), true);
});

test('fallback: a zero-duration slide reaches display none with no frame advanced', async () => {
  assert.equal(await hiddenWithoutFrames({ tuning: { slide: { ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0 } } }), true);
});

test('fallback: reduced motion reaches display none with no frame advanced', async () => {
  assert.equal(await hiddenWithoutFrames({}, true), true);
});

test('control: a real slide is not hidden before it ends', async () => {
  assert.equal(await hiddenWithoutFrames({}), false);
});

test('fallback: a park whose target is where the slot already stands reaches display none with no frame advanced', async () => {
  // The only entry, so its rest is 0; entering and leaving on the left makes the enter start equal the park target.
  const at = (live: boolean): React.ReactElement => rowOf([entry('a', live, true, {}, { enterFrom: 'left', exitTo: 'left' })]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  mounted.rerender(at(true));
  mounted.rerender(at(false));
  await act(async () => {});
  assert.equal(isHidden(slotOf(mounted.container, 'a')), true);
});

test('parkExitTarget returns the literal left and right targets of a kept park exit', () => {
  assert.deepEqual(parkExitTarget(406, 406, 'left', false), { x: -406, opacity: 0 });
  assert.deepEqual(parkExitTarget(406, 406, 'right', false), { x: 812, opacity: 0 });
  assert.deepEqual(parkExitTarget(0, 390, 'right', false), { x: 390, opacity: 0 });
});

test('enterStart returns the literal enter start for left and right', () => {
  assert.deepEqual(enterStart(406, 406, 'left'), { x: 0, opacity: 0 });
  assert.deepEqual(enterStart(406, 406, 'right'), { x: 812, opacity: 0 });
  assert.deepEqual(enterStart(0, 390, 'left'), { x: -390, opacity: 0 });
});

test('panelRowSlotMotion keeps its five-argument form and its default transition', () => {
  const motion = panelRowSlotMotion(406, 390, 700, 'right', 'left');
  assert.deepEqual(motion.exit, { x: -406, opacity: 0 });
  assert.equal(motion.transition, PANEL_TRANSITION);
});

test('slotDriver.read answers nothing for an element no motion component owns', () => {
  assert.equal(slotDriver.read(document.createElement('div')), undefined);
});

test('a revive from the other side sets x and opacity to the enter start before it animates', async () => {
  const calls: string[] = [];
  const { set, animate } = slotDriver;
  slotDriver.set = (el, values) => {
    calls.push(`set ${values.x} ${values.opacity}`);
    set(el, values);
  };
  slotDriver.animate = (el, values, transition) => {
    calls.push(`animate ${values.x} ${values.opacity}`);
    return animate(el, values, transition);
  };
  try {
    const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true, {}, { exitTo: 'left', enterFrom: 'right' })]);
    const mounted = mount(at(true));
    await advanceFrames(1000);
    mounted.rerender(at(false));
    await advanceFrames(1000);
    calls.length = 0;
    mounted.rerender(at(true));
    await advanceFrames(1000);
    assert.deepEqual(calls, ['set 812 0', 'animate 406 1']);
    assert.equal(slotOf(mounted.container, 'a').style.transform, 'translateX(406px)');
  } finally {
    slotDriver.set = set;
    slotDriver.animate = animate;
  }
});

/** The row root, p and q live, and a k between them parked after a live start; what it measures. */
async function measureRow(keep: boolean): Promise<{ x: string[]; width: string; neighbours: string[]; kMounted: boolean }> {
  neighbours.clear();
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('p', true, false), entry('k', live, keep), entry('q', true, false)]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  const result = {
    x: ['p', 'q'].map((id) => slotOf(mounted.container, id).style.transform),
    width: getComputedStyle(mounted.container.firstElementChild!).width,
    neighbours: ['p', 'q'].map((id) => neighbours.get(id)!),
    kMounted: mounted.container.querySelector('[data-slot="k"]') !== null,
  };
  mounted.unmount();
  return result;
}

test('layout independence: the kept entry is mounted and the unkept one is not, in rows that otherwise agree', async () => {
  assert.equal((await measureRow(true)).kMounted, true);
  assert.equal((await measureRow(false)).kMounted, false);
});

test('layout independence: a kept entry between two live ones changes no slot position', async () => {
  const kept = await measureRow(true);
  assert.deepEqual(kept.x, (await measureRow(false)).x);
  assert.deepEqual(kept.x, ['translateX(406px)', 'translateX(812px)']);
});

test('layout independence: a kept entry changes no row width', async () => {
  const kept = await measureRow(true);
  assert.equal(kept.width, (await measureRow(false)).width);
  assert.equal(kept.width, '1202px');
});

test('layout independence: a kept entry changes no neighbour width a drag may cross', async () => {
  const kept = await measureRow(true);
  assert.deepEqual(kept.neighbours, (await measureRow(false)).neighbours);
  assert.deepEqual(kept.neighbours, ['{"left":[390],"right":[390]}', '{"left":[390,390],"right":[]}']);
});

/** `useProvidePanels` over a seeded list and a row of it: how a test drives capacity without a host. */
function Driver(props: { initial: PanelWindow[]; capture?: CaptureTrigger; expose: (p: ProvidedPanels) => void; containerWidth: number }): React.ReactElement {
  const provided = useProvidePanels(panelsInput({ initialEntries: props.initial, containerWidth: props.containerWidth, capture: props.capture }));
  props.expose(provided);
  return React.createElement(PanelRow, {
    entries: provided.entries,
    rootId: 'root',
    closingIds: provided.closingIds,
    enteringViaAnchorIds: provided.enteringViaAnchorIds,
    exitRightIds: provided.exitRightIds,
    enterSideById: provided.enterSideById,
    maxLiveWidth: provided.maxLiveWidth,
  });
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('capacity: over 200 seeded sequences the live flags and liveWidths are identical with keepMounted true and false', () => {
  const run = (seed: number, keep: boolean): string[] => {
    const random = seeded(seed);
    let latest: ProvidedPanels | undefined;
    const initial = [root(), ...['a', 'b', 'c'].map((id) => entry(id, true, keep, { view: 'km-root' }))];
    const containerWidth = 1300 + Math.floor(random() * 800);
    const mounted = mount(withHost(React.createElement(Driver, { initial, containerWidth, expose: (p) => (latest = p) })));
    const trace: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      const pick = random();
      const ids = latest!.entries.filter((p) => p.collapsible).map((p) => p.id);
      const target = ids[Math.floor(random() * ids.length)]!;
      act(() => {
        if (pick < 0.4 || ids.length === 0) latest!.create();
        else if (pick < 0.7) latest!.activate(target);
        else if (pick < 0.9) latest!.close(target);
        else latest!.undoClose();
      });
      trace.push(`${latest!.entries.map((p) => (p.live ? 1 : 0)).join('')}|${latest!.liveWidths.join(',')}`);
    }
    mounted.unmount();
    return trace;
  };
  for (let seed = 1; seed <= 200; seed += 1) assert.deepEqual(run(seed, true), run(seed, false), `seed ${seed}`);
});

/** A kept `a` that registers a picture, parked by capacity; what the registry and the trigger saw, in order. */
async function captureRun(): Promise<{ events: string[]; hiddenAtCapture: boolean[]; activate: () => Promise<void> }> {
  const events: string[] = [];
  const registry: CaptureRegistry = {
    register(viewId) {
      events.push(`register ${viewId}`);
      return () => events.push(`unregister ${viewId}`);
    },
  };
  registerView('km-capture', ({ panel }) => React.createElement(Panel, { viewId: panel.id, children: React.createElement('i', { 'data-slot': panel.id }) }));
  const hiddenAtCapture: boolean[] = [];
  let container: HTMLElement | undefined;
  const trigger: CaptureTrigger = {
    ...noopCaptureTrigger,
    capture(id: string) {
      if (id !== 'a') return;
      events.push(`capture ${id}`);
      hiddenAtCapture.push(isHidden(slotOf(container!, id)));
    },
  };
  let latest: ProvidedPanels | undefined;
  const initial = [root(), entry('a', true, true, { view: 'km-capture' }, { snapshot: 'park' })];
  const mounted = mount(React.createElement(CaptureRegistryProvider, { registry, children: withHost(React.createElement(Driver, { initial, containerWidth: 1000, capture: trigger, expose: (p) => (latest = p) })) }));
  container = mounted.container;
  await advanceFrames(1000);
  for (let i = 0; i < 6 && latest!.entries.find((p) => p.id === 'a')!.live; i += 1) {
    act(() => latest!.create());
    await advanceFrames(100);
  }
  assert.equal(latest!.entries.find((p) => p.id === 'a')!.live, false, 'a was parked by capacity');
  await advanceFrames(1000);
  return {
    events,
    hiddenAtCapture,
    activate: async () => {
      act(() => latest!.activate('a'));
      await advanceFrames(1000);
    },
  };
}

test('capture: Panel registers while visible and unregisters once its slot is hidden', async () => {
  const { events } = await captureRun();
  assert.deepEqual(events, ['register a', 'capture a', 'unregister a']);
});

test('capture: the trigger sees one capture at the park commit, before the slot is hidden', async () => {
  const { events, hiddenAtCapture } = await captureRun();
  assert.equal(events.filter((e) => e === 'capture a').length, 1);
  assert.deepEqual(hiddenAtCapture, [false]);
});

test('capture: Panel registers again once its slot is shown', async () => {
  const run = await captureRun();
  await run.activate();
  assert.equal(run.events.at(-1), 'register a');
});

test('C6: reset-on-park beside keepMounted true unmounts the view at the park', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true, {}, { viewState: 'reset-on-park' })]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  assert.equal(mounted.container.querySelector('[data-slot="a"]'), null);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('C1: a fixed column never takes the kept path', async () => {
  const fixed = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true, { collapsible: false })]);
  const column = mount(fixed(true));
  column.rerender(fixed(false));
  await advanceFrames(1000);
  assert.equal(column.container.querySelectorAll('[data-slot="a"]').length, 1, 'a fixed column stays drawn: a live flag never parks it');
  assert.equal(isHidden(slotOf(column.container, 'a')), false);
});

test('default path: an entry whose keepMounted is false renders the same markup as one with no settings', async () => {
  const markup = async (over: Partial<PanelWindow>): Promise<string> => {
    const at = (live: boolean): React.ReactElement => rowOf([root(), { ...entry('a', live, false), ...over }]);
    const mounted = mount(at(true));
    await advanceFrames(1000);
    mounted.rerender(at(false));
    await advanceFrames(1000);
    const html = mounted.container.innerHTML.replace(/css-[a-z0-9]+/g, 'css-x');
    mounted.unmount();
    return html;
  };
  assert.equal(await markup({}), await markup({ settings: undefined }));
});

test('StrictMode: every mount of a kept view is matched by an unmount, so no effect or latch entry leaks past the row', async () => {
  const at = (live: boolean): React.ReactElement => React.createElement(React.StrictMode, null, rowOf([root(), entry('a', live, true)]));
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  assert.ok(isHidden(slotOf(mounted.container, 'a')));
  mounted.unmount();
  const c = countOf('a');
  assert.equal(c.mounts, c.unmounts);
  assert.equal(c.mounts > 0, true);
});
