/**
 * Behaviour of the raw mutators pinned before the operations entry gives them a gate. A pin states what the code does
 * today; the ones that describe a limit of the raw API are named LIMIT so a change has to rename the pin it fixes.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels, type PanelWindow, type ProvidedPanels } from '../index.js';
import { usePanelClosing } from '../panels/usePanelClosing.js';
import { usePanelManager, type UsePanelManagerResult } from '../panels/usePanelManager.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'web',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false });
const label = (p: PanelWindow): string => (p.live ? p.id : `${p.id}*`);
const row = (panels: readonly PanelWindow[]): string => panels.map(label).join(' ');

afterEach(() => cleanup());

function mountProvider(initialEntries: PanelWindow[]): { latest: () => ProvidedPanels } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return { latest: () => latest! };
}

test('PIN two raw setFormFactor calls on one id in one handler both apply in call order', () => {
  const provider = mountProvider([root(), entry('a'), entry('b')]);
  act(() => {
    const stale = provider.latest();
    stale.setFormFactor('a', 'tablet');
    stale.setFormFactor('a', 'desktop');
  });
  assert.equal(provider.latest().entries.find((p) => p.id === 'a')?.formFactor, 'desktop', 'the second call won: the first was applied before it');
  act(() => {
    const stale = provider.latest();
    stale.setFormFactor('a', 'phone');
    stale.setFormFactor('a', 'tablet');
  });
  assert.equal(provider.latest().entries.find((p) => p.id === 'a')?.formFactor, 'tablet', 'the order reversed gives the other end');
});

test('PIN a raw close then a raw setFormFactor on one id: the close removes the panel and the resize changes nothing', () => {
  const provider = mountProvider([root(), entry('a'), entry('b')]);
  act(() => {
    const stale = provider.latest();
    stale.close('a');
    stale.setFormFactor('a', 'tablet');
  });
  assert.equal(row(provider.latest().entries), 'root b', 'literal result [H, B] for [H, A, B]');
  assert.equal(provider.latest().entries.find((p) => p.id === 'b')?.formFactor, undefined, 'the resize did not land on a neighbour');
});

/** What a probe renders with: the row after each render, so a test can tell when a commit happened. */
interface Trace {
  rows: string[];
  manager: () => UsePanelManagerResult;
  closing: () => ReturnType<typeof usePanelClosing>;
  /** Arms the passive-effect trigger. */
  go: () => void;
}

/** A row [H, A, B, C] over usePanelManager and usePanelClosing, composed as useProvidePanels composes them. */
function mountComposed(run: (t: Pick<Trace, 'manager' | 'closing'>) => void, trigger: 'handler' | 'effect' | 'idle'): Trace {
  const rows: string[] = [];
  let manager: UsePanelManagerResult | undefined;
  let closing: ReturnType<typeof usePanelClosing> | undefined;
  let fire: (() => void) | undefined;
  function Probe(): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(() => [root(), entry('a'), entry('b'), entry('c')]);
    const [armed, setArmed] = React.useState(false);
    manager = usePanelManager(panels, setPanels, 390, 0, 1, 'root');
    const m = manager;
    closing = usePanelClosing(panels, setPanels, m.revealPanelProactively, 'root', (id, remaining) => {
      m.forgetCollapsed(id);
      m.releaseHold(id);
      m.revealMostRecentlyCollapsed(remaining);
    });
    rows.push(row(panels));
    React.useEffect(() => {
      if (armed && trigger === 'effect') run({ manager: () => manager!, closing: () => closing! });
    }, [armed]);
    fire = () => setArmed(true);
    return React.createElement('button', { onClick: trigger === 'handler' ? () => run({ manager: () => manager!, closing: () => closing! }) : undefined }, 'go');
  }
  mount(React.createElement(Probe));
  return { rows, manager: () => manager!, closing: () => closing!, go: () => act(() => fire!()) };
}

const closeThenPark = ({ manager, closing }: Pick<Trace, 'manager' | 'closing'>): void => {
  closing().close('a');
  manager().holdPanel('c', 'sticky');
};

test('PIN the same close-then-park sequence commits [H, B, C*] from a discrete handler, a timer, a promise continuation and a passive effect; the triggers differ in how many commits it takes', async () => {
  // Every row React committed while the sequence ran. The first entry of each list is the commit of the close's own
  // closingIds mark (handler, timer, promise) or of the arming render (effect); the last is the committed [H, B, C*].
  const committed: Record<string, string[]> = {};
  const complaints: Record<string, number> = {};
  for (const trigger of ['handler', 'timer', 'promise', 'effect'] as const) {
    const t = mountComposed(closeThenPark, trigger === 'handler' ? 'handler' : trigger === 'effect' ? 'effect' : 'idle');
    const before = t.rows.length;
    const complain = mock.method(console, 'error', () => {});
    if (trigger === 'handler') {
      const button = document.querySelector('button')!;
      act(() => void button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    } else if (trigger === 'timer') {
      setTimeout(() => closeThenPark(t), 0);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    } else if (trigger === 'promise') {
      await act(async () => {
        await Promise.resolve();
        closeThenPark(t);
      });
    } else {
      t.go();
    }
    complaints[trigger] = complain.mock.calls.filter((c) => String(c.arguments[0]).startsWith('flushSync was called from inside a lifecycle method')).length;
    complain.mock.restore();
    committed[trigger] = t.rows.slice(before);
    cleanup();
  }
  for (const trigger of Object.keys(committed)) assert.equal(committed[trigger]!.at(-1), 'root b c*', `${trigger}: A closed and C parked`);
  assert.deepEqual(
    committed,
    {
      handler: ['root a b c', 'root b c', 'root b c*'],
      timer: ['root a b c', 'root b c', 'root b c*'],
      promise: ['root a b c', 'root b c', 'root b c*'],
      effect: ['root a b c', 'root b c*'],
    },
    'a flushSync commits the updates queued earlier in the same callback from a handler, a timer and a promise continuation (the close lands alone, then the park); from a passive effect React skips the flush and one commit carries both',
  );
  assert.deepEqual(complaints, { handler: 0, timer: 0, promise: 0, effect: 2 }, 'only the effect trigger is told its two flushSync calls (the close mark, the exit mark) cannot flush');
});
