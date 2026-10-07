/**
 * Declarations written the way a later entry or an app will write them. Nothing here runs: `npm run typecheck`
 * compiles it, and a change to one of these shapes that a caller would notice stops it compiling.
 */
import * as React from 'react';
import { definePanel } from '../index.js';
import type {
  CatalogName,
  InstancePatch,
  ListFilter,
  PanelReader,
  PanelReadHandle,
  PanelSettings,
  PanelSnapshot,
  PanelState,
  PanelTemplate,
  PanelUserLayer,
  ResolvedPanelSettings,
  SettingConflict,
  SettingsPatch,
  SettingValues,
  SourceLayer,
  ViewHandle,
  ViewPatch,
} from '../index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// keyof SettingValues is the catalog's names without headerButtons and the tuning leaves, compared both ways.
type NonTuningNames = Exclude<CatalogName, 'headerButtons' | `tuning.${string}`>;
export type SettingKeysAreTheCatalogNames = Expect<Equal<keyof SettingValues, NonTuningNames>>;

/** One entry per setting key: a key added to or removed from SettingValues makes this stop compiling in one direction or the other. */
export const SETTING_KEYS: Record<keyof SettingValues, true> = {
  closable: true,
  parkable: true,
  draggable: true,
  crossable: true,
  placeable: true,
  resizable: true,
  formFactors: true,
  clearable: true,
  hostCreatable: true,
  multiple: true,
  maxInstances: true,
  listed: true,
  startVisibility: true,
  hideStickiness: true,
  hideWhenLast: true,
  capacityReturn: true,
  returnPriority: true,
  overflow: true,
  evictionRank: true,
  evictionOrder: true,
  revealOnScroll: true,
  scrollOnOpen: true,
  scrollOnMove: true,
  scrollOnDrag: true,
  toggleWhenClosed: true,
  showWhenClosed: true,
  viewState: true,
  keepMounted: true,
  placeOnAdd: true,
  placeOnShow: true,
  placeOnReturn: true,
  placeFallback: true,
  undoPlacement: true,
  layer: true,
  enterFrom: true,
  exitTo: true,
  closeExit: true,
  animated: true,
  formFactor: true,
  title: true,
  pinning: true,
  pinningWhenNotLive: true,
  persist: true,
  rememberLayout: true,
  restoreVisibility: true,
  afterClose: true,
  undoWindowMs: true,
  reportClose: true,
  snapshot: true,
};
export const CATALOG_NAMES_WITHOUT_TUNING: Record<NonTuningNames, true> = SETTING_KEYS;
export const SETTING_KEYS_AGAIN: Record<keyof SettingValues, true> = CATALOG_NAMES_WITHOUT_TUNING;

// The user layer has exactly three keys.
export type UserLayerKeys = Expect<Equal<keyof PanelUserLayer, 'formFactor' | 'anchor' | 'parkable'>>;
export const USER_LAYER_KEYS: Record<keyof PanelUserLayer, true> = { formFactor: true, anchor: true, parkable: true };
export const aUserLayer: PanelUserLayer = { formFactor: 'tablet', anchor: { panel: 'notes', position: 'left', priority: 1 }, parkable: false };

// Every field of SettingConflict, once per kind, with and without rule and forcedBy.
export type ConflictKeys = Expect<Equal<keyof SettingConflict, 'key' | 'layer' | 'kind' | 'asked' | 'applied' | 'rule' | 'forcedBy' | 'message'>>;
export const CONFLICT_FIELDS: Record<keyof SettingConflict, true> = { key: true, layer: true, kind: true, asked: true, applied: true, rule: true, forcedBy: true, message: true };
export const conflicts: readonly SettingConflict[] = [
  { key: 'overflow', layer: 'template', kind: 'forced', asked: 'park', applied: 'scroll', rule: 'C1', forcedBy: 'parkable', message: 'overflow: forced' },
  { key: 'closable', layer: 'instance', kind: 'forced', asked: true, applied: false, rule: 'C5', message: 'closable: forced' },
  { key: 'keepMounted', layer: 'host', kind: 'forced', asked: true, applied: false, rule: 'C6', forcedBy: 'viewState', message: 'keepMounted: forced' },
  { key: 'hostCreatable', layer: 'instance', kind: 'wrong-scope', asked: false, applied: true, message: 'hostCreatable: wrong scope' },
  { key: 'tuning.rowGap', layer: 'host', kind: 'wrong-scope', asked: 4, applied: 16, rule: 'C1', forcedBy: 'parkable', message: 'tuning.rowGap: wrong scope' },
  { key: 'closable', layer: 'host', kind: 'not-view-settable', asked: false, applied: true, message: 'closable: a view cannot set this' },
  { key: 'pinning', layer: 'host', kind: 'not-view-settable', asked: {}, applied: {}, rule: 'C2', message: 'pinning: a view cannot set this' },
];

// @ts-expect-error a conflict has no layer outside template, host and instance
export const workspaceConflict: SettingConflict = { key: 'closable', layer: 'workspace', kind: 'forced', asked: true, applied: false, message: 'm' };
// @ts-expect-error a conflict has one of three kinds
export const unknownKind: SettingConflict = { key: 'closable', layer: 'host', kind: 'ignored', asked: true, applied: false, message: 'm' };
// @ts-expect-error the rule field is named rule
export const renamedRule: SettingConflict = { key: 'closable', layer: 'host', kind: 'forced', asked: true, applied: false, conflictRule: 'C1', message: 'm' };

export const sources: readonly SourceLayer[] = ['library', 'workspace', 'template', 'host', 'instance', 'user', 'derived', 'forced'];

declare const resolved: ResolvedPanelSettings;
declare const handle: PanelReadHandle;

export const aState: PanelState = {
  id: 'notes~a1',
  templateId: 'notes',
  status: 'live',
  held: false,
  engineId: 'e1',
  index: 2,
  title: undefined,
  url: 'https://example.test',
  params: { page: 1 },
  formFactor: 'phone',
  listed: true,
  settings: resolved,
  pinned: false,
  deferredPin: { by: 'pin' },
};
export const aClosedState: PanelState = { ...aState, status: 'closed', engineId: null, index: null, title: 'Notes', params: undefined, deferredPin: { parkable: true } };
export const noDeferredPin: PanelState = { ...aState, deferredPin: null };

export const aSnapshot: PanelSnapshot = { version: 3, status: 'ready', panels: [aState, aClosedState] };

export const filters: readonly ListFilter[] = [{}, { status: 'live' }, { status: ['live', 'parked'] }, { listed: false }, { status: 'closed', listed: true }];

export const viewPatches: readonly ViewPatch[] = [
  {},
  { title: 'Inbox', listed: false, layer: 'raised', formFactor: 'desktop', placeOnAdd: { anchor: { panel: 'row', position: 'right' } }, enterFrom: 'anchor' },
  { title: null, listed: null, layer: null, formFactor: null, placeOnAdd: null, enterFrom: null },
];
// @ts-expect-error closable is not a key a view may set
export const viewClosable: ViewPatch = { closable: false };
// @ts-expect-error a view places itself only by an anchor
export const viewPlacement: ViewPatch = { placeOnAdd: 'row-end' };

export const instancePatch: InstancePatch = { closable: false, title: null, tuning: { hopFraction: 0.4 } };
// @ts-expect-error a template-scope key is not an instance patch key
export const instanceTemplateKey: InstancePatch = { multiple: true };
export const settingsPatch: SettingsPatch = { multiple: true, maxInstances: null, headerButtons: { size: false } };
export const layerSettings: PanelSettings = { overflow: 'park', tuning: { dragToClose: { minDistancePx: 90 } }, headerButtons: { size: false } };

export const reader: PanelReader = {
  get: (id) => (id === handle.id ? handle : undefined),
  list: (f?: ListFilter) => (f === undefined ? [aState] : []),
  getSnapshot: () => aSnapshot,
  subscribe: () => () => undefined,
};
const done = { ok: true, changed: false } as const;
export const viewHandle: ViewHandle = {
  ...handle,
  show: () => done,
  hide: () => done,
  toggleVisibility: () => done,
  close: () => done,
  open: () => done,
  move: () => done,
  place: () => done,
  setFormFactor: () => done,
  scrollTo: () => done,
};
export const aTemplate: PanelTemplate = { id: 'notes', view: () => React.createElement('div'), settings: { overflow: 'park' } };
export const defined: PanelTemplate<{ page: number }> = definePanel({ id: 'paged', view: () => null, params: { page: 1 } });
