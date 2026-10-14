/**
 * ViewPatch is the keys a view may set on its own panel, and the catalog says which those are with `viewSettable`.
 * The two are written apart, so this holds them equal: the type check fails when ViewPatch gains or loses a key
 * without this list, and the runtime check fails when the catalog disagrees with the list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_SETTINGS_CATALOG, type ViewPatch } from '../index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** One entry per ViewPatch key. */
const VIEW_PATCH_KEYS = {
  title: true,
  listed: true,
  layer: true,
  closable: true,
  slots: true,
  placeOnAdd: true,
  enterFrom: true,
} as const satisfies Record<keyof ViewPatch, true>;

export type ViewPatchKeysAreListed = Expect<Equal<keyof ViewPatch, keyof typeof VIEW_PATCH_KEYS>>;

test('the ViewPatch keys are exactly the catalog names marked viewSettable', () => {
  const catalog = PANEL_SETTINGS_CATALOG.filter((d) => d.viewSettable).map((d) => d.name).sort();
  assert.deepEqual(catalog, Object.keys(VIEW_PATCH_KEYS).sort());
});

test('a view cannot set a catalog name that is not in ViewPatch', () => {
  const outside = PANEL_SETTINGS_CATALOG.filter((d) => !(d.name in VIEW_PATCH_KEYS));
  assert.ok(outside.length > 0 && outside.every((d) => !d.viewSettable), 'every other name is closed to a view');
});
