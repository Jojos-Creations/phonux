/**
 * A MUI Dialog opened from a panel is a React child of the row but a DOM child of the body. Focus moving between the
 * dialog's own buttons must stay there instead of being steered to a panel as if it had entered the row.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import Dialog from '@mui/material/Dialog';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

registerTestView('scroll-row-view', ({ panel }) =>
  React.createElement('div', null, [
    React.createElement('button', { key: 'own', 'data-own': panel.id }, 'own'),
    panel.id !== 's1' ? null : React.createElement(Dialog, { key: 'dialog', open: true, transitionDuration: 0, disableEnforceFocus: true, disableAutoFocus: true }, [
      React.createElement('button', { key: 'a', 'data-dialog-stop': `${panel.id}-a` }, 'a'),
      React.createElement('button', { key: 'b', 'data-dialog-stop': `${panel.id}-b` }, 'b'),
    ]),
  ]),
);

const originalRects = HTMLElement.prototype.getClientRects;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
process.on('exit', () => void (HTMLElement.prototype.getClientRects = originalRects));

test('Tab between a portaled dialog\'s buttons keeps focus in the dialog', async () => {
  const m = mountRow(panelsOf(2), 3000);
  await advanceFrames(60);
  const stops = [...document.querySelectorAll<HTMLElement>('[data-dialog-stop]')];
  assert.ok(stops.length >= 2, 'the dialog rendered its buttons');
  assert.ok(!m.container.contains(stops[0]!), 'the dialog is portaled out of the row');
  const first = stops[0]!;
  const second = stops[1]!;
  document.body.focus();
  for (const [from, to] of [[first, first], [first, second]] as const) {
    act(() => void from.focus());
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    act(() => void to.focus());
    // Not assert.equal: a failing diff of two jsdom elements exhausts memory.
    assert.ok(document.activeElement === to, `focus stays on the dialog button the Tab reached, not ${(document.activeElement as HTMLElement).outerHTML.slice(0, 60)}`);
  }
});
