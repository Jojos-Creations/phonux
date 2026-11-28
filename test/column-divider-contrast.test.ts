/**
 * The side-by-side divider's line is what a person has to find to resize, so at rest it must reach the 3:1 a UI component's edge
 * needs: the line is the text colour at an opacity, and 0.5 of black on white is about 3.2:1 and of white on near black about 5.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspaceColumn } from '../index.js';
import type { WorkspaceColumnHandle } from '../index.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const proto = HTMLElement.prototype;
const rowWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')!;
Object.defineProperty(proto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-workspace-column') ? 2560 : (rowWidth.get as () => number).call(this);
  },
});

test('the divider line at rest has an opacity that reaches 3:1, and no state of it is fainter', async () => {
  const c = createWorkspaceColumn({ sideBySide: true });
  columns.push(c);
  for (let k = 0; k < 2; k += 1) c.addWorkspace();
  await until('measured', () => document.querySelectorAll('[data-workspace-cell]').length === 2 && c.shown[0]!.slots === 6);
  act(() => void c.showSide(1));
  await until('a divider', () => document.querySelectorAll('[role="separator"]').length === 1);
  const line = document.querySelector<HTMLElement>('[data-column-divider-line]')!;
  const rules = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('opacity') !== '' && /data-column-divider-line/.test(rule.selectorText));
  const rest = rules.filter((rule) => !/:(hover|focus)/.test(rule.selectorText) && line.matches(rule.selectorText));
  assert.ok(rest.length > 0, 'a rule sets the line\'s opacity at rest');
  for (const rule of rules) assert.ok(Number(rule.style.getPropertyValue('opacity')) >= 0.5, `${rule.selectorText} is at least 0.5`);
});
