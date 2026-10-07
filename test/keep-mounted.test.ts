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
import { enterStart, parkExitTarget, slotDriver } from '../PanelRowSlot.js';
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

test('differential keepMounted: kept gives 1 mount and 0 unmounts over three cycles, not kept 3 mounts and 3 unmounts, and viewState survives in both', async () => {
  const results = new Map<boolean, { mounts: number; unmounts: number; stored: number }>();
  for (const keep of [true, false]) {
    counts.clear();
    results.set(keep, await threeCycles(keep));
  }
  assert.deepEqual(results.get(true), { mounts: 1, unmounts: 0, stored: 7 });
  assert.deepEqual(results.get(false), { mounts: 3, unmounts: 3, stored: 7 });
  // The shared recorder runs a scenario synchronously, so it is handed the two results already observed.
  differential('keepMounted', (run) => {
    run(true, () => results.get(true));
    run(false, () => results.get(false));
  });
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

test('hidden state: inert during the exit slide, then display none, inert and aria-hidden once it completes, and none of the three at the revive commit', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(100);
  const during = slotOf(mounted.container, 'a');
  assert.equal(during.hasAttribute('inert'), true, 'inert from the start of the exit');
  assert.notEqual(during.style.display, 'none', 'still drawn while it slides');
  assert.equal(during.getAttribute('aria-hidden'), null);
  await advanceFrames(1000);
  assert.ok(isHidden(slotOf(mounted.container, 'a')));
  seen.layout.length = 0;
  mounted.rerender(at(true));
  assert.deepEqual(seen.layout[0], { inert: false, ariaHidden: null, display: '' }, 'the revive commit already has none of the three');
  await advanceFrames(1000);
  const shown = slotOf(mounted.container, 'a');
  assert.equal(shown.hasAttribute('inert') || shown.hasAttribute('aria-hidden') || shown.style.display === 'none', false);
});

function Lone(): React.ReactElement {
  return React.createElement('span', null, String(usePanelHidden()));
}

test('usePanelHidden: false while live, scrolled out or exiting, true only when display is none, false outside a row', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), false, 'live');
  mounted.rerender(at(false));
  await advanceFrames(100);
  assert.equal(seen.hidden.at(-1), false, 'exiting');
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), true, 'display none');
  assert.equal(isHidden(slotOf(mounted.container, 'a')), true);
  mounted.rerender(at(true));
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), false, 'shown again');
  const lone = mount(withHost(React.createElement(Lone)));
  assert.equal(lone.container.textContent, 'false', 'outside a row');
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

test('fallbacks: animated false, a zero-duration slide and reduced motion each reach display none with no frame advanced, and a real slide does not', async () => {
  assert.equal(await hiddenWithoutFrames({ animated: false }), true, 'animated false');
  assert.equal(await hiddenWithoutFrames({ tuning: { slide: { ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0 } } }), true, 'zero-duration slide');
  assert.equal(await hiddenWithoutFrames({}, true), true, 'reduced motion');
  assert.equal(await hiddenWithoutFrames({}), false, 'control: a real slide is not hidden before it ends');
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

test('parkExitTarget and enterStart return the literal targets, and a revive from the other side jumps to its enter start before it animates', async () => {
  assert.deepEqual(parkExitTarget(406, 406, 'left', false), { x: -406, opacity: 0 });
  assert.deepEqual(parkExitTarget(406, 406, 'right', false), { x: 812, opacity: 0 });
  assert.deepEqual(enterStart(406, 406, 'left'), { x: 0, opacity: 0 });
  assert.deepEqual(enterStart(406, 406, 'right'), { x: 812, opacity: 0 });
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

test('layout independence: a kept entry between two live ones changes no slot position, row width or neighbour width against the same row unmounted', async () => {
  const measure = async (keep: boolean): Promise<{ x: string[]; width: string; neighbours: string[] }> => {
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
    };
    assert.equal(mounted.container.querySelector('[data-slot="k"]') !== null, keep, 'the kept entry is mounted and the other is not');
    mounted.unmount();
    return result;
  };
  const kept = await measure(true);
  const unmounted = await measure(false);
  assert.deepEqual(kept, unmounted);
  assert.deepEqual(kept.x, ['translateX(406px)', 'translateX(812px)']);
  assert.equal(kept.width, '1202px');
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

test('capture: Panel registers while visible and unregisters while hidden, and the park capture is issued before the slot hides', async () => {
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
  assert.deepEqual(events, ['register a']);
  for (let i = 0; i < 6 && latest!.entries.find((p) => p.id === 'a')!.live; i += 1) {
    act(() => latest!.create());
    await advanceFrames(100);
  }
  assert.equal(latest!.entries.find((p) => p.id === 'a')!.live, false, 'a was parked by capacity');
  await advanceFrames(1000);
  assert.deepEqual(events, ['register a', 'capture a', 'unregister a']);
  assert.deepEqual(hiddenAtCapture, [false]);
  act(() => latest!.activate('a'));
  await advanceFrames(1000);
  assert.equal(events.at(-1), 'register a', 'registered again once shown');
});

test('C6 and fixed columns: reset-on-park beside keepMounted true unmounts at the park, and a fixed column never takes the kept path', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true, {}, { viewState: 'reset-on-park' })]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  assert.equal(mounted.container.querySelector('[data-slot="a"]'), null);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
  mounted.unmount();
  const fixed = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true, { collapsible: false })]);
  const column = mount(fixed(true));
  column.rerender(fixed(false));
  await advanceFrames(1000);
  assert.equal(column.container.querySelectorAll('[data-slot="a"]').length, 1, 'a fixed column stays drawn: a live flag never parks it');
  assert.equal(isHidden(slotOf(column.container, 'a')), false);
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
