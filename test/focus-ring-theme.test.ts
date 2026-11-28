/**
 * Under the library's theme the ripple is off, so a keyboard user's only cue on a MUI button is the outline the theme draws on
 * `.Mui-focusVisible`. The check reads the cascade the browser would use, in light and dark, and the outline colour's contrast.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { PanelHeaderRow, PhonuxThemeProvider, createDefaultTheme } from '../index.js';
import { act } from 'react';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(cleanup);

const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? [...n].map((c) => c + c).join('') : n;
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(full.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y! - x!);
  return (hi! + 0.05) / (lo! + 0.05);
};

for (const mode of ['light', 'dark'] as const) {
  test(`a focused button and icon button draw a visible outline in ${mode}, at 3:1 against the window`, () => {
    const theme = createDefaultTheme(mode);
    const m = mount(
      React.createElement(
        PhonuxThemeProvider,
        { theme },
        React.createElement(Button, { id: 'b' }, 'Star'),
        React.createElement(IconButton, { id: 'i', 'aria-label': 'x' }, 'x'),
      ),
    );
    for (const id of ['b', 'i']) {
      const el = m.container.querySelector<HTMLElement>(`#${id}`)!;
      el.classList.add('Mui-focusVisible');
      const rules = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && !rule.selectorText.includes('::') && el.matches(rule.selectorText))
        .filter((rule) => /solid/.test(rule.cssText) && /outline/.test(rule.cssText));
      assert.ok(rules.length > 0, `${id}: a rule matching the focus-visible element draws a solid outline`);
      const text = rules.map((r) => r.cssText).join(' ');
      assert.match(text, /outline:\s*2px\s+solid\s+var\(--phonux-primary\)/, `${id}: the outline is 2px in the accent`);
    }
    assert.ok(contrast(theme.primary, theme.background) >= 3, `${mode}: ${theme.primary} on ${theme.background} is at least 3:1`);
  });
}

test('the editable title button and its input draw a focus ring, and the placeholder title is not the disabled grey', () => {
  const edit = mount(React.createElement(PanelHeaderRow, { title: 'Notes', isInput: true, onTitleChange: () => {} }));
  const button = edit.container.querySelector<HTMLElement>('[role="button"]')!;
  const sheet = () => [...document.styleSheets].flatMap((s) => [...s.cssRules]).map((r) => r.cssText).join('\n');
  const ringFor = (cls: string): boolean => new RegExp(`\\.${cls}:focus-visible\\s*\\{[^}]*outline:\\s*2px solid`).test(sheet());
  const classOf = (el: Element): string => [...el.classList].find((c) => c.startsWith('css-'))!;
  assert.ok(ringFor(classOf(button)), 'the title button has a :focus-visible outline');
  act(() => button.click());
  const input = edit.container.querySelector<HTMLElement>('input')!;
  assert.ok(input, 'a click opens the edit field');
  assert.ok(ringFor(classOf(input)), 'the edit field has a :focus-visible outline');
  const bare = mount(React.createElement(PanelHeaderRow, { title: '' }));
  const placeholder = bare.container.querySelector<HTMLElement>('[data-header-placeholder-title]')!;
  const placeholderRule = sheet().match(new RegExp(`\\.${classOf(placeholder)}\\s*\\{[^}]*\\}`))?.[0] ?? '';
  assert.doesNotMatch(placeholderRule, /(?:0, 0, 0, 0\.38|#9e9e9e|rgba\(255, 255, 255, 0\.5\))/i, 'not the disabled grey');
});
