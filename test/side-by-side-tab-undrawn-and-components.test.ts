/** Real Tab presses past content that is in the DOM and not drawn, and through shadow-root components, at the ends of each space. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, ready, sleep, onPage, until, STOPS, PLANT_BUTTONS, PLANT_OUTSIDE, tabWalk, tabRound, WATCH_ENTRY, START, END, withEnds, ring, focusStop, inOrder, type Page } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

// ---------------------------------------------------------------------------
// Content that is in the DOM and not drawn
// ---------------------------------------------------------------------------

const UNDRAWN: Record<string, string> = {
  'a hidden panel': '<div role="tabpanel" hidden><button data-tab="undrawn">x</button></div>',
  'a closed dialog': '<dialog><button data-tab="undrawn">x</button></dialog>',
  // The button is before the summary at a cell's start and after it at its end, so it is the cell's outermost element either way.
  'a closed details': '<details>@first<summary data-tab="summary">s</summary>@last</details>',
};

/** Puts `html` first in the first panel and last in the last panel in sight of each shown space: the two ends of what the cell holds. */
const plantUndrawn = (page: Page, html: string): Promise<number> =>
  page.evaluate((markup: string) => {
    const button = '<button data-tab="undrawn">x</button>';
    let count = 0;
    for (const s of (window as any).__s.shown()) {
      const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${s.id}"]`)!;
      const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      boxes[0]!.insertAdjacentHTML('afterbegin', markup.replace('@first', button).replace('@last', ''));
      boxes[boxes.length - 1]!.insertAdjacentHTML('beforeend', markup.replace('@first', '').replace('@last', button));
      const all = [...cell.querySelectorAll<HTMLElement>('button,summary')].filter((el) => el.closest('[inert]') === null);
      if (all[0]!.dataset.tab === 'undrawn' && all[all.length - 1]!.dataset.tab === 'undrawn') count += 1;
    }
    return count;
  }, html);

for (const [what, html] of Object.entries(UNDRAWN)) {
  for (const outside of [true, false]) {
    test(`Tab past ${what} at both ends of each space, ${outside ? 'between two buttons' : 'the column alone'}: a button that is not drawn is no stop, and no press is spent on it`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, 'n=3&bands=none', async (page) => {
        assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
        await page.evaluate(PLANT_BUTTONS);
        assert.equal(await plantUndrawn(page, html), 2, 'in both shown cells the outermost buttons are the ones not drawn');
        const stops: string[] = await page.evaluate(STOPS);
        assert.ok(!stops.some((x) => x.endsWith(':undrawn')) && stops.length >= 5, stops.join(' '));
        const all = await withEnds(page, stops);
        if (outside) {
          await page.evaluate(PLANT_OUTSIDE);
          await page.focus('#before');
          assert.deepEqual(await tabWalk(page, all.length + 1), [...all, 'after']);
          assert.deepEqual(await tabWalk(page, all.length + 1, true), [...[...all].reverse(), 'before']);
          await page.focus('#after');
          assert.deepEqual(await tabWalk(page, 3, true), [END, stops[stops.length - 1], stops[stops.length - 2]], 'Shift+Tab from after the column comes into it');
        } else {
          await page.evaluate(WATCH_ENTRY);
          await focusStop(page, stops[0]!);
          assert.deepEqual(await tabRound(page, all.length), ring(all, stops[0]!));
          assert.deepEqual(await tabRound(page, all.length, true), ring(all, stops[0]!, true));
        }
      });
    });
  }
}

// Undrawn content that still has a box ends a panel that is drawn before another one: the row must not take it for that panel's last
// stop, or the Tab on the real last stop is never handed over and the panel drawn after it is passed by.
const UNDRAWN_WITH_A_BOX: Record<string, string> = {
  'a closed details': UNDRAWN['a closed details']!,
  'content kept unrendered': '<div style="content-visibility:hidden">@first@last</div>',
};
for (const [what, html] of Object.entries(UNDRAWN_WITH_A_BOX)) {
  test(`Tab past ${what} ending a page that is not the last one drawn, rows reordered: the page drawn after it is still walked, both ways`, async (t) => {
    if (!(await ready(t))) return;
    await onPage(2560, 'n=3&bands=none&slots=1,1,1', async (page) => {
      await until(page, 'c.showSide(ws[1])');
      await sleep(700);
      assert.deepEqual(await page.evaluate(() => (window as any).__s.reorder()), [true, true, true]);
      await sleep(900);
      await page.evaluate(PLANT_BUTTONS);
      assert.equal(await plantUndrawn(page, html), 2, 'in both shown cells the outermost buttons in the DOM are the ones not drawn');
      const stops: string[] = await page.evaluate(STOPS);
      assert.ok(!stops.some((x) => x.endsWith(':undrawn')) && stops.length >= 13, stops.join(' '));
      const drawnLast = stops[stops.indexOf('div0') - 1]!;
      const domLast: string = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-workspace-id="w1"] [data-row-slot] [data-box] > [data-tab]')].filter((x) => x.closest('[inert]') === null).pop()!.dataset.tab!);
      assert.notEqual(drawnLast, `w1:${domLast}`, 'the page that holds the undrawn button is not the one drawn last');
      await page.evaluate(PLANT_OUTSIDE);
      await page.focus('#before');
      assert.deepEqual(await tabWalk(page, stops.length + 1), [...stops, 'after']);
      assert.deepEqual(await tabWalk(page, stops.length + 1, true), [...[...stops].reverse(), 'before']);
    });
  });
}

// ---------------------------------------------------------------------------
// Controls the document's own queries do not see: shadow roots
// ---------------------------------------------------------------------------

/** Where focus is, read through shadow roots (a closed one is kept on its host as `__root` by the test that made it). */
const WHERE_DEEP = `(() => {
  let a = document.activeElement;
  if (a === null || a === document.body) return 'BODY';
  if (a.id === 'before' || a.id === 'after') return a.id;
  if (a.getAttribute('role') === 'separator') return 'div' + a.getAttribute('data-column-divider');
  const c = a.closest('[data-workspace-cell]')?.dataset.workspaceId ?? '?';
  for (;;) {
    const inner = (a.shadowRoot ?? a.__root)?.activeElement;
    if (!inner) break;
    a = inner;
  }
  if (a.tagName === 'IFRAME') return c + ':' + a.getAttribute('data-tab') + '>' + (a.contentDocument?.activeElement?.id || 'doc');
  return c + ':' + (a.getAttribute('data-tab') ?? (a.hasAttribute('data-column-sentinel') ? 'column-' + a.getAttribute('data-column-sentinel') : null) ?? a.tagName);
})()`;

/** What a component holds, by kind: the markup of its shadow root (`@` stands for the host's tag, `A.` or `Z.`) and its stops in order. */
const COMPONENTS: Record<string, { mode: 'open' | 'closed'; html: string; inner?: string; stops: string[] }> = {
  'an open shadow root': { mode: 'open', html: '<button data-tab="@s1">1</button><button data-tab="@s2">2</button><button data-tab="@s3">3</button>', stops: ['s1', 's2', 's3'] },
  'a shadow root inside a shadow root': { mode: 'open', html: '<button data-tab="@n1">1</button><x-inner></x-inner><button data-tab="@n4">4</button>', inner: '<button data-tab="@n2">2</button><button data-tab="@n3">3</button>', stops: ['n1', 'n2', 'n3', 'n4'] },
  'a frame inside a shadow root': { mode: 'open', html: '<button data-tab="@f1">1</button><iframe data-tab="@fr" srcdoc="<button id=inner>i</button>" style="width:60px;height:30px"></iframe><button data-tab="@f2">2</button>', stops: ['f1', 'fr>inner', 'f2'] },
  'a closed shadow root': { mode: 'closed', html: '<button data-tab="@c1">1</button><button data-tab="@c2">2</button><button data-tab="@c3">3</button>', stops: ['c1', 'c2', 'c3'] },
};

/** A component first in the first panel (`A.`) and last in the last panel in sight (`Z.`) of each shown space. */
const plantComponents = (page: Page, spec: { mode: string; html: string; inner?: string }): Promise<void> =>
  page.evaluate(async (c: { mode: 'open' | 'closed'; html: string; inner?: string }) => {
    for (const s of (window as any).__s.shown()) {
      const cell = document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${s.id}"]`)!;
      const boxes = [...cell.querySelectorAll('[data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      for (const tag of ['A.', 'Z.']) {
        const host = document.createElement('x-host');
        host.setAttribute('data-host', tag);
        const root = host.attachShadow({ mode: c.mode });
        root.innerHTML = c.html.replaceAll('@', tag);
        if (c.inner !== undefined) root.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML = c.inner.replaceAll('@', tag);
        (host as any).__root = root;
        if (tag === 'A.') boxes[0]!.prepend(host);
        else boxes[boxes.length - 1]!.append(host);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }, spec);

/** Focuses the component's first (`last`: last) own control, by script, as a click on it would. */
const focusInComponent = (page: Page, cell: string, tag: string, last: boolean): Promise<void> =>
  page.evaluate(([c, t, l]: [string, string, boolean]) => {
    const root = (document.querySelector(`[data-workspace-id="${c}"] [data-host="${t}"]`) as any).__root as ShadowRoot;
    const deep = [...root.querySelectorAll<HTMLElement>('button,x-inner')].flatMap((el) => (el.localName === 'x-inner' ? [...el.shadowRoot!.querySelectorAll<HTMLElement>('button')] : [el]));
    deep[l ? deep.length - 1 : 0]!.focus();
  }, [cell, tag, last] as [string, string, boolean]);

for (const [what, spec] of Object.entries(COMPONENTS)) {
  for (const outside of [true, false]) {
    test(`Tab inside ${what} at either end of a space, ${outside ? 'between two buttons' : 'the column alone'}: every control of the component is walked before focus leaves the space`, async (t) => {
      if (!(await ready(t))) return;
      await onPage(2560, 'n=3&bands=none', async (page) => {
        assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
        await page.evaluate(PLANT_BUTTONS);
        const base: string[] = await page.evaluate(STOPS);
        await plantComponents(page, spec);
        if (outside) await page.evaluate(PLANT_OUTSIDE);
        const at = base.indexOf('div0');
        const sides = { w3: base.slice(0, at), w2: base.slice(at + 1) };
        // Presses from inside a component, with the page's body dropped: what a browser rests on outside the page is its own.
        const from = async (cell: string, tag: string, shift: boolean, n: number): Promise<string[]> => {
          await focusInComponent(page, cell, tag, shift);
          const start: string = await page.evaluate(WHERE_DEEP);
          assert.equal(start, `${cell}:${tag}${spec.stops[shift ? spec.stops.length - 1 : 0]!.split('>')[0]}`, 'focus starts inside the component');
          const out: string[] = [];
          for (let k = 0; k < n + 2 && out.length < n; k += 1) {
            await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
            await sleep(80);
            const now: string = await page.evaluate(WHERE_DEEP);
            if (now !== 'BODY') out.push(now);
          }
          return out;
        };
        const rest = (cell: string, tag: string, shift: boolean): string[] => (shift ? [...spec.stops].reverse() : spec.stops).slice(1).map((x) => `${cell}:${tag}${x}`);
        const check = async (cell: 'w3' | 'w2', tag: string, shift: boolean, after: string[]): Promise<void> => {
          const want = [...rest(cell, tag, shift), ...after];
          assert.deepEqual(await from(cell, tag, shift, want.length), want, `${shift ? 'Shift+Tab' : 'Tab'} from ${cell} ${tag}`);
        };
        // The component at a space's end: Tab walks it, then leaves the space. Notes is on the left, Trip food on the right.
        // Into a space the browser steps by itself, so it comes in at the component, which a selector over the page would not find.
        await check('w3', 'Z.', false, ['div0', `w2:A.${spec.stops[0]}`]);
        await check('w2', 'Z.', false, [END, outside ? 'after' : START]);
        await check('w3', 'Z.', true, [sides.w3[sides.w3.length - 1]!]);
        await check('w2', 'Z.', true, [sides.w2[sides.w2.length - 1]!]);
        // The component at a space's start: Shift+Tab walks it, then leaves the space.
        await check('w2', 'A.', true, ['div0', `w3:Z.${spec.stops[spec.stops.length - 1]}`]);
        await check('w3', 'A.', true, [START, outside ? 'before' : END]);
        await check('w3', 'A.', false, [sides.w3[0]!]);
        await check('w2', 'A.', false, [sides.w2[0]!]);
      });
    });
  }
}

test('Tab through a group of radio buttons, editable text and a scrolling box at a space’s end: each is walked as the browser walks it before focus leaves the space', async (t) => {
  if (!(await ready(t))) return;
  await onPage(2560, 'n=3&bands=none', async (page) => {
    assert.deepEqual(await inOrder(page, 'stepped'), ['Notes', 'Trip food']);
    await page.evaluate(PLANT_BUTTONS);
    await page.evaluate(PLANT_OUTSIDE);
    const base: string[] = await page.evaluate(STOPS);
    const first = base[base.indexOf('div0') + 1]!;
    const plant = (html: string): Promise<void> =>
      page.evaluate((markup: string) => {
        document.querySelectorAll('[data-planted]').forEach((el) => void el.remove());
        const boxes = [...document.querySelectorAll('[data-workspace-id="w3"] [data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
        boxes[boxes.length - 1]!.insertAdjacentHTML('beforeend', `<div data-planted="">${markup}</div>`);
        document.querySelector<HTMLElement>('[data-planted] [data-tab]')!.focus();
      }, html);
    const walk = async (n: number): Promise<string[]> => {
      const out: string[] = [];
      for (let k = 0; k < n; k += 1) {
        await page.keyboard.press('Tab');
        await sleep(80);
        out.push(await page.evaluate(WHERE_DEEP));
      }
      return out;
    };
    await plant('<div contenteditable="plaintext-only" data-tab="e1">e</div><div contenteditable="plaintext-only" data-tab="e2">e</div>');
    assert.deepEqual(await walk(3), ['w3:e2', 'div0', first], 'editable text is a stop although its tabIndex property says -1');
    await plant('<input type="radio" name="one" data-tab="r1"><input type="radio" name="one" data-tab="r2" checked><input type="radio" name="one" data-tab="r3">');
    assert.deepEqual(await walk(2), ['w3:r2', 'div0'], 'from an unchecked radio button Tab goes to the checked one of its group, and from there out');
    await plant('<input type="radio" name="none" data-tab="r1"><input type="radio" name="none" data-tab="r2">');
    assert.deepEqual(await walk(1), ['div0'], 'a group with none checked is one stop');
    await plant('<div data-tab="sc1" style="height:30px;width:80px;overflow:auto"><div style="height:300px">t</div></div><div data-tab="sc2" style="height:30px;width:80px;overflow:auto"><div style="height:300px">t</div></div>');
    assert.deepEqual(await walk(2), ['w3:sc2', 'div0'], 'a box that scrolls and holds nothing focusable is a stop of the browser’s own');
    await page.evaluate(() => {
      document.querySelectorAll('[data-planted]').forEach((el) => void el.remove());
      const boxes = [...document.querySelectorAll('[data-workspace-id="w3"] [data-row-slot]')].filter((x) => x.closest('[inert]') === null).map((x) => x.querySelector('[data-box]')!);
      const wrap = document.createElement('div');
      wrap.setAttribute('data-planted', '');
      for (const mode of ['open', 'closed'] as const) {
        const host = wrap.appendChild(document.createElement('x-host'));
        const root = host.attachShadow({ mode });
        root.innerHTML = `<button data-tab="${mode}">b</button>`;
        (host as any).__root = root;
      }
      boxes[boxes.length - 1]!.append(wrap);
      wrap.querySelector('x-host')!.shadowRoot!.querySelector('button')!.focus();
    });
    assert.deepEqual(await walk(2), ['w3:closed', 'div0'], 'a root the column cannot read, after the control that has focus, is stepped into and not over');
  });
});
