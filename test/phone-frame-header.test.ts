/**
 * PanelHeaderRow's placeholders for a view with no title or icon. Server-render checks: markup, text and data
 * attributes only, never computed CSS, so the pill's look (background, radius, height) needs a real-app check.
 * createElement keeps this a .ts file the `test/*.test.ts` runner picks up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PanelHeaderRow } from '../index.js';

function renderDom(el: ReturnType<typeof createElement>): Document {
  const markup = renderToStaticMarkup(el);
  return new JSDOM(`<body>${markup}</body>`).window.document;
}

test('PanelHeaderRow: a real title and real actions render as-is, no placeholders', () => {
  const doc = renderDom(
    createElement(PanelHeaderRow, {
      title: 'Sessions',
      actions: createElement('button', { key: 'a' }, 'Settings'),
    }),
  );

  assert.match(doc.body.textContent ?? '', /Sessions/);
  assert.match(doc.body.textContent ?? '', /Settings/);
  assert.equal(doc.querySelector('[data-header-placeholder-title]'), null);
  assert.equal(doc.querySelector('[data-header-placeholder-action]'), null);
});

for (const emptyTitle of [undefined, null, false, '']) {
  test(`PanelHeaderRow: a falsy title (${JSON.stringify(emptyTitle)}) still renders the full pill with a placeholder title`, () => {
    const doc = renderDom(
      createElement(PanelHeaderRow, {
        title: emptyTitle as never,
        actions: createElement('button', {}, 'Settings'),
      }),
    );

    const placeholder = doc.querySelector('[data-header-placeholder-title]');
    assert.ok(placeholder, 'a placeholder title node must render in the title slot');
    assert.match(placeholder!.textContent ?? '', /Untitled/);
    // Placeholders are per slot, not all-or-nothing: the real actions render untouched.
    assert.equal(doc.querySelector('[data-header-placeholder-action]'), null);
  });
}

for (const emptyActions of [undefined, null, false]) {
  test(`PanelHeaderRow: falsy actions (${JSON.stringify(emptyActions)}) still render the full pill with a placeholder icon slot`, () => {
    const doc = renderDom(
      createElement(PanelHeaderRow, {
        title: 'Extra window',
        actions: emptyActions as never,
      }),
    );

    assert.ok(
      doc.querySelector('[data-header-placeholder-action]'),
      'a placeholder action node must render in the actions slot',
    );
    // Placeholders are per slot, not all-or-nothing: the real title renders untouched.
    assert.equal(doc.querySelector('[data-header-placeholder-title]'), null);
    assert.match(doc.body.textContent ?? '', /Extra window/);
  });
}

test('PanelHeaderRow: both a falsy title and falsy actions render both placeholders at once', () => {
  const doc = renderDom(createElement(PanelHeaderRow, { title: undefined as never, actions: undefined }));

  assert.ok(doc.querySelector('[data-header-placeholder-title]'));
  assert.ok(doc.querySelector('[data-header-placeholder-action]'));
});

test('PanelHeaderRow: the actions slot always renders a container even with no actions, so the pill never loses its right-hand slot', () => {
  // Real actions or the placeholder, the slot is always there: it keeps the pill's shape and height the same
  // whatever a caller passes.
  const doc = renderDom(createElement(PanelHeaderRow, { title: 'x', actions: false }));
  assert.ok(doc.querySelector('[data-header-placeholder-action]'));
});
