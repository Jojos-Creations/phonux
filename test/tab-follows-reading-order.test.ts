/**
 * After a drag reorders the row, Tab and Shift+Tab visit the panels in the order they are drawn, although the DOM keeps
 * them in the order they opened. jsdom has no Tab focus movement and no layout, so the test gives elements a client rect
 * and plays the browser's part: a Tab nobody prevented moves focus to the next tabbable element in DOM order.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

function TabbableView({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        const steps = stepsFor(offset);
        for (let k = 0; k < Math.abs(steps); k += 1) panels.move(id, steps > 0 ? 'right' : 'left');
      },
    },
    children: (handle) =>
      React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, [
        React.createElement('button', { key: 'a', 'data-stop': `${id}-a` }, 'a'),
        React.createElement('button', { key: 'b', 'data-stop': `${id}-b` }, 'b'),
      ]),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(TabbableView, { id: panel.id }));

const originalRects = HTMLElement.prototype.getClientRects;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
process.on('exit', () => void (HTMLElement.prototype.getClientRects = originalRects));

const stops = (m: MountedRow): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-stop]')];
/** One browser Tab press from the focused element: the row's handler first, then the default step in DOM order. */
function press(m: MountedRow, shift: boolean): string {
  const from = document.activeElement as HTMLElement;
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  act(() => void from.dispatchEvent(event));
  if (!event.defaultPrevented) {
    const all = stops(m);
    const next = all[all.indexOf(document.activeElement as HTMLElement) + (shift ? -1 : 1)];
    next?.focus();
  }
  return (document.activeElement as HTMLElement).dataset.stop!;
}

async function reorderedRow(): Promise<{ m: MountedRow; reading: string[] }> {
  const m = mountRow(panelsOf(5), 3000);
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s3"]')!, { dx: -420, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(500);
  await release(-420, 0);
  await advanceFrames(2000);
  const reading = m.latest().entries.map((p) => p.id);
  const domIds = [...m.container.querySelectorAll('[data-grab]')].map((el) => el.getAttribute('data-grab'));
  assert.notDeepEqual(domIds, reading, 'the drop left the reading order different from the DOM order');
  return { m, reading };
}

test('Tab visits the panels in the order they are drawn after a reorder', async () => {
  const { m, reading } = await reorderedRow();
  const first = m.container.querySelector<HTMLElement>(`[data-stop="${reading[0]}-a"]`)!;
  first.focus();
  const visited = [reading[0]!];
  for (let k = 0; k < reading.length * 2 - 1; k += 1) visited.push(press(m, false).split('-')[0]!);
  assert.deepEqual([...new Set(visited)], reading);
});

test('Shift+Tab visits the panels in reverse drawn order after a reorder', async () => {
  const { m, reading } = await reorderedRow();
  const last = reading[reading.length - 1]!;
  m.container.querySelector<HTMLElement>(`[data-stop="${last}-b"]`)!.focus();
  const visited = [last];
  for (let k = 0; k < reading.length * 2 - 1; k += 1) visited.push(press(m, true).split('-')[0]!);
  assert.deepEqual([...new Set(visited)], [...reading].reverse());
});
