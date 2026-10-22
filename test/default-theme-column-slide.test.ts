/**
 * The default theme's no-transition reset must not match the column's slide element, or switching workspaces jumps.
 * The check reads the cascade the browser would use: every stylesheet rule that matches the slide and sets `transition`.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspaceColumn, definePanel } from '../index.js';
import type { WorkspaceColumnHandle } from '../index.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const tpl = definePanel({ id: 'a', view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });

/** Whether a rule's selector list has a part that matches the element; pseudo-element parts cannot match an element. */
const matches = (el: Element, selectorText: string): boolean =>
  selectorText.split(/,\s*/).some((part) => !part.includes('::') && el.matches(part));

test('the default theme reset does not match the column slide, so its transition survives', async () => {
  const c = createWorkspaceColumn({ templates: [tpl] });
  columns.push(c);
  await until('the column draws its first cell', () => document.querySelector('[data-workspace-column] > div') !== null);
  const slide = document.querySelector<HTMLElement>('[data-workspace-column] > div')!;

  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const resets = rules.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('transition') === 'none' && rule.style.getPropertyPriority('transition') === 'important');
  assert.ok(resets.length > 0, 'the default theme draws its no-transition reset');
  const hitting = resets.filter((rule) => matches(slide, rule.selectorText));
  assert.deepEqual(hitting.map((rule) => rule.selectorText), [], 'no no-transition reset may match the slide element');
});
