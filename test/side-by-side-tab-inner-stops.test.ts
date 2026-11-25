/** Real Tab presses through controls with stops of their own that no script can list: media players, date fields, form controls. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rigUp, rigDown, ready, sleep, onPage, shown, WHERE, STOPS, PLANT_BUTTONS, PLANT_OUTSIDE, START, END, withEnds, focusStop, inOrder, ON_SCREEN, type Page } from './support/side-rendered.js';

before(rigUp);
after(rigDown);

// ---------------------------------------------------------------------------
// Controls with stops of their own inside, which no script can list: media players, date fields
// ---------------------------------------------------------------------------

/** Gives every planted player something to play, so it shows all its controls: a second of silence, a canvas for a picture. */
const FEED_MEDIA = `(async () => {
  for (const a of document.querySelectorAll('audio[data-tab]')) {
    const n = 8000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    a.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  for (const v of document.querySelectorAll('video[data-tab]')) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32; c.getContext('2d').fillRect(0, 0, 64, 32);
    v.srcObject = c.captureStream(5);
  }
  await new Promise((r) => setTimeout(r, 600));
})()`;

/** Markup whose stops only the browser knows; `@` stands for the copy's tag, `A.` at a cell's start or `Z.` at its end. */
const INNER_STOPS: Record<string, string> = {
  'an audio player': '<audio controls data-tab="@audio"></audio>',
  'a video player': '<video controls muted data-tab="@video" style="width:240px;height:120px"></video>',
  'date and time fields': '<input type="date" data-tab="@date"><input type="time" data-tab="@time">',
  'form controls and an open details': '<select data-tab="@select"><option>o</option></select><textarea data-tab="@text"></textarea><input type="range" data-tab="@range"><input type="number" data-tab="@number"><input type="color" data-tab="@color"><details open><summary data-tab="@summary">s</summary><button data-tab="@inside">b</button></details>',
};

/** What the browser itself stops at in `html` between two buttons, on a page that holds nothing else: forward, and backward. */
async function nativeStops(page: Page, html: string): Promise<[string[], string[]]> {
  const bare = await page.context().newPage();
  try {
    await bare.setContent(`<button data-tab="first">a</button>${html.replaceAll('@', '')}<button data-tab="last">z</button>`);
    await bare.evaluate(FEED_MEDIA);
    const walk = async (from: string, to: string, key: string): Promise<string[]> => {
      await bare.focus(`[data-tab="${from}"]`);
      const out: string[] = [];
      while (out[out.length - 1] !== to && out.length < 40) {
        await bare.keyboard.press(key);
        await sleep(60);
        out.push(await bare.evaluate(() => document.activeElement?.getAttribute('data-tab') ?? 'none'));
      }
      assert.equal(out.pop(), to, `the walk on the bare page reaches its end: ${out.join(' ')}`);
      return out;
    };
    return [await walk('first', 'last', 'Tab'), await walk('last', 'first', 'Shift+Tab')];
  } finally {
    await bare.close();
  }
}

for (const [what, html] of Object.entries(INNER_STOPS)) {
  for (const order of ['list', 'stepped'] as const) {
    for (const outside of [true, false]) {
      test(`Tab through ${what} at the start and at the end of each space, ${order} order, ${outside ? 'between two buttons' : 'the column alone'}: every stop the browser makes in it on a bare page it makes here, both ways`, async (t) => {
        if (!(await ready(t))) return;
        await onPage(2560, 'n=3&bands=none', async (page) => {
          assert.deepEqual(await inOrder(page, order), ON_SCREEN[order]);
          const [forward, backward] = await nativeStops(page, html);
          assert.ok(forward.length >= 2 && backward.length === forward.length, `the browser stops more than once: ${forward.join(' ')}`);
          if (html.includes('<audio') || html.includes('<video')) assert.ok(forward.length >= 4 && new Set(forward).size === 1, `all of them inside the one player: ${forward.join(' ')}`);
          await page.evaluate(PLANT_BUTTONS);
          const base: string[] = await page.evaluate(STOPS);
          const [left, right] = (await shown(page)).map((x) => x.id) as [string, string];
          const cut = base.indexOf('div0');
          const own: Record<string, string[]> = { [left]: base.slice(0, cut), [right]: base.slice(cut + 1) };
          // Next to the cell's own ends, outside its row: the first and the last thing the cell holds.
          await page.evaluate((markup: string) => {
            for (const cell of document.querySelectorAll<HTMLElement>('[data-workspace-cell]:not([inert])')) {
              cell.querySelector(':scope > [data-column-sentinel="cell-start"]')!.insertAdjacentHTML('afterend', `<div style="position:absolute;top:0">${markup.replaceAll('@', 'A.')}</div>`);
              cell.querySelector(':scope > [data-column-sentinel="cell-end"]')!.insertAdjacentHTML('beforebegin', `<div style="position:absolute;bottom:0">${markup.replaceAll('@', 'Z.')}</div>`);
            }
          }, html);
          await page.evaluate(FEED_MEDIA);
          if (outside) await page.evaluate(PLANT_OUTSIDE);
          const ends = await withEnds(page, []);
          assert.deepEqual(ends, order === 'list' ? [] : [START, END]);
          const named = (cell: string, tag: string, names: string[]): string[] => names.map((n) => `${cell}:${tag}${n}`);
          // Presses from where focus is, with the page's body dropped: what a browser rests on outside the page is its own.
          const walk = async (n: number, shift: boolean): Promise<string[]> => {
            const out: string[] = [];
            for (let k = 0; k < n + 2 && out.length < n; k += 1) {
              await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
              await sleep(80);
              const now: string = await page.evaluate(WHERE);
              if (now !== 'BODY') out.push(now);
            }
            return out;
          };
          const divider = (): Promise<void> => page.evaluate(() => document.querySelector<HTMLElement>('[role="separator"]')!.focus());
          const expect = async (shift: boolean, want: string[], why: string): Promise<void> => assert.deepEqual(await walk(want.length, shift), want, why);
          const last = (cell: string): string => own[cell]![own[cell]!.length - 1]!;
          const first = (cell: string): string => own[cell]![0]!;

          await focusStop(page, last(left));
          await expect(false, [...named(left, 'Z.', forward), 'div0', ...named(right, 'A.', forward), first(right)], 'Tab through the end of the left space, the divider, and the start of the right one');
          await focusStop(page, first(right));
          await expect(true, [...named(right, 'A.', backward), 'div0', ...named(left, 'Z.', backward), last(left)], 'and Shift+Tab back the same way');

          const after = order === 'list' ? [] : [END];
          const before = order === 'list' ? [] : [START];
          await focusStop(page, last(right));
          await expect(false, [...named(right, 'Z.', forward), ...after, ...(outside ? ['after'] : [...before, ...named(left, 'A.', forward).slice(0, 1)])], 'Tab through the end of the right space and out of the column');
          await focusStop(page, first(left));
          await expect(true, [...named(left, 'A.', backward), ...before, ...(outside ? ['before'] : [...after, ...named(right, 'Z.', backward).slice(0, 1)])], 'Shift+Tab through the start of the left space and out of the column');

          await divider();
          await expect(true, [...named(left, 'Z.', backward), last(left)], 'Shift+Tab from the divider comes into the left space at its end');
          await divider();
          await expect(false, [...named(right, 'A.', forward), first(right)], 'Tab from the divider comes into the right space at its start');
        });
      });
    }
  }
}
