/**
 * front-page-unify-panel-header-visual-style (plans/queue.yaml): unit
 * coverage for PhoneFrameHeaderRow's placeholder behavior -- the owner's own
 * explicit follow-up ("if the view has no title or icon put placeholders")
 * on top of the earlier layout-only PhoneFrameHeaderRow.
 *
 * Written with createElement rather than JSX so the file is a .ts and is
 * picked up by the existing `test/*.test.ts` runner without changing it
 * (see test/tabchip.test.ts, which established this pattern, and
 * test/goal-front-page.test.ts's own renderDom helper, mirrored here).
 *
 * These are pure server-render (renderToStaticMarkup) checks, so they can
 * only assert on markup/text/data-attributes -- not on computed CSS (no
 * emotion style extraction in this harness, matching every other test in
 * this repo that touches an sx-styled component). The shared pill's actual
 * visual look (background/border-radius/height) is confirmed live, by
 * screenshot of the real desktop app, per this entry's own evidence
 * requirement -- see plans/evidence/front-page-unify-panel-header-visual-
 * style/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PhoneFrameHeaderRow } from '../client/src/PhoneFrame.js';

function renderDom(el: ReturnType<typeof createElement>): Document {
  const markup = renderToStaticMarkup(el);
  return new JSDOM(`<body>${markup}</body>`).window.document;
}

test('PhoneFrameHeaderRow: a real title and real actions render as-is, no placeholders', () => {
  const doc = renderDom(
    createElement(PhoneFrameHeaderRow, {
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
  test(`PhoneFrameHeaderRow: a falsy title (${JSON.stringify(emptyTitle)}) still renders the full pill with a placeholder title`, () => {
    const doc = renderDom(
      createElement(PhoneFrameHeaderRow, {
        title: emptyTitle as never,
        actions: createElement('button', {}, 'Settings'),
      }),
    );

    const placeholder = doc.querySelector('[data-header-placeholder-title]');
    assert.ok(placeholder, 'a placeholder title node must render in the title slot');
    assert.match(placeholder!.textContent ?? '', /Untitled/);
    // The real actions passed alongside the falsy title must still render
    // untouched -- placeholder substitution is per-slot, not all-or-nothing.
    assert.equal(doc.querySelector('[data-header-placeholder-action]'), null);
  });
}

for (const emptyActions of [undefined, null, false]) {
  test(`PhoneFrameHeaderRow: falsy actions (${JSON.stringify(emptyActions)}) still render the full pill with a placeholder icon slot`, () => {
    const doc = renderDom(
      createElement(PhoneFrameHeaderRow, {
        title: 'Extra window',
        actions: emptyActions as never,
      }),
    );

    assert.ok(
      doc.querySelector('[data-header-placeholder-action]'),
      'a placeholder action node must render in the actions slot',
    );
    // The real title passed alongside the falsy actions must still render
    // untouched -- placeholder substitution is per-slot, not all-or-nothing.
    assert.equal(doc.querySelector('[data-header-placeholder-title]'), null);
    assert.match(doc.body.textContent ?? '', /Extra window/);
  });
}

test('PhoneFrameHeaderRow: both a falsy title and falsy actions render both placeholders at once', () => {
  const doc = renderDom(createElement(PhoneFrameHeaderRow, { title: undefined as never, actions: undefined }));

  assert.ok(doc.querySelector('[data-header-placeholder-title]'));
  assert.ok(doc.querySelector('[data-header-placeholder-action]'));
});

test('PhoneFrameHeaderRow: the actions slot always renders a container even with no actions, so the pill never loses its right-hand slot', () => {
  // Before this entry, `actions ? <Box>...</Box> : null` meant a caller with
  // no actions rendered NO right-hand box at all. Now the slot is always
  // present (holding either real actions or the placeholder), which is what
  // keeps the pill's shape/height identical regardless of a caller's props.
  const doc = renderDom(createElement(PhoneFrameHeaderRow, { title: 'x', actions: false }));
  assert.ok(doc.querySelector('[data-header-placeholder-action]'));
});
