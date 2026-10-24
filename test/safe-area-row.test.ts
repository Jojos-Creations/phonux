/**
 * The row's top and bottom edges sit inside the device's safe areas, and the row measures the room it has from its own box,
 * so the inset shrinks the box rather than the padding. Without viewport-fit=cover every env() is 0 and nothing moves.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(cleanup);

/** Every CSS rule emotion has written for the element's class, joined. */
function ruleText(el: Element): string {
  const classes = [...el.classList].filter((name) => name.startsWith('css-'));
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (classes.some((name) => rule.cssText.includes(`.${name}`))) rules.push(rule.cssText);
    }
  }
  return rules.join('\n');
}

test('the row takes the top and bottom safe-area insets out of its box, not out of its padding', () => {
  const mounted = mountRow(panelsOf(2), 800);
  const css = ruleText(mounted.container).replace(/\s+/g, '');
  assert.match(css, /margin-top:env\(safe-area-inset-top,0px\)/);
  assert.match(css, /height:calc\(100%-env\(safe-area-inset-top,0px\)-env\(safe-area-inset-bottom,0px\)\)/);
  assert.doesNotMatch(css, /padding-top:calc\([^)]*safe-area/);
});

test('the row keeps its left and right padding: the phone-width geometry does not read a side inset', () => {
  const mounted = mountRow(panelsOf(2), 800);
  const css = ruleText(mounted.container).replace(/\s+/g, '');
  assert.doesNotMatch(css, /safe-area-inset-(left|right)/);
});
