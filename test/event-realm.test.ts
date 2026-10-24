/**
 * The panel events are built with the element's own window's CustomEvent, so a page whose global CustomEvent is another
 * realm's (a Node global, or a second window) still gets them delivered instead of a refused dispatch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createRectReporter } from '../panelChrome.js';

test('a panel event dispatched while the global CustomEvent is from another realm is delivered, not refused', () => {
  // An event from another realm: jsdom refuses it, as a Node-native CustomEvent is refused by a jsdom element.
  class ForeignEvent {
    readonly type: string;
    readonly detail: unknown;
    constructor(type: string, init: { detail?: unknown }) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const own = globalThis.CustomEvent;
  const el = document.createElement('div');
  document.body.appendChild(el);
  let seen = 0;
  el.addEventListener('phonux:panel-rect', () => seen++);
  globalThis.CustomEvent = ForeignEvent as unknown as typeof CustomEvent;
  try {
    const reporter = createRectReporter(el, { id: () => 'a', moving: () => false });
    assert.doesNotThrow(() => reporter.settle());
  } finally {
    globalThis.CustomEvent = own;
    el.remove();
  }
  assert.equal(seen, 1);
});
