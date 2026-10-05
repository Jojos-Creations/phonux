/**
 * The settings model: every behaviour a panel can differ in is a named setting with a library default, a
 * descriptor in one catalog, and one pure resolver that interprets every layer. Nothing here is rendered or
 * mounted. The only value imports are the two leaf modules below, so this file can be read (and the resolver
 * called) with no React, no Motion and no row code loaded; test/panel-settings-catalog.test.ts holds that line.
 */

import type * as React from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FormFactor } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelState, ViewHandle } from './panelTemplate.js';
import {
  DIRECTION_LOCK_PX,
  DRAG_CLOSE_NUMBERS,
  DROP_TIE_BREAK,
  EDGE_SCROLL_MAX_PX_PER_SEC,
  EDGE_SCROLL_REDUCED_STEP_MS,
  EDGE_SCROLL_ZONE_PX,
  GESTURE_LOCK_MS,
  HOP_FRACTION,
  INITIAL_SCROLL,
  RETURN_TIE_BREAK,
  ROW_GAP,
  ROW_GESTURE,
  SAVE_QUIET_MS,
  SLIDE_CLOSE_EXIT_SECONDS,
  SLIDE_DURATION_SEC,
  SLIDE_EASE,
  SNAP_BACK_SPRING,
} from './rowConstants.js';

// ---------------------------------------------------------------------------
// Declared types
// ---------------------------------------------------------------------------

/** A panel's id: a singleton's template id, an explicit instance's given id, or `${templateId}~${random}`; 'all' is reserved. @public */
export type PanelId = string;

/** Where a panel asks to sit relative to another panel. @public */
export type AnchorRequest = { panel?: PanelId; position: 'left' | 'right'; priority?: number };

/** A named place in the row, or a place next to a named panel. See DESIGN.md, "The settings catalog". @public */
export type AddPlacement =
  | 'row-start'
  | 'row-end'
  | 'parkable-start'
  | 'parkable-end'
  | 'after-fixed'
  | 'order'
  | { before: PanelId }
  | { after: PanelId }
  | { anchor: AnchorRequest & { panel: PanelId } };

/** What the row may do with a panel when the open panels do not all fit: scroll past it, or park it. @public */
export type Overflow = 'scroll' | 'park';

/** Where a scrolled-to panel lands in the window. @public */
export type ScrollAlign = 'into-view' | 'start' | 'center';

/** @public */
export type ScrollOnOpen = ScrollAlign | 'none';

/** @public */
export type ScrollOnMove = 'follow' | 'none';

/** @public */
export type ScrollOnDrag = 'edge' | 'none';

/** What a header button's functions are given. @public */
export type HeaderButtonContext = { state: PanelState; settings: ResolvedPanelSettings };

/** One generic title-bar button slot. The label is the accessible name and is never empty. @public */
export type HeaderButton = {
  icon: React.ReactNode | ((c: HeaderButtonContext) => React.ReactNode);
  label: string | ((c: HeaderButtonContext) => string);
  onClick: (handle: ViewHandle, c: HeaderButtonContext & { announce(text: string): void }) => void | Promise<unknown>;
  side?: 'start' | 'end';
  order?: number;
  pressed?: (c: HeaderButtonContext) => boolean;
  description?: string | ((c: HeaderButtonContext) => string);
  tooltip?: string | ((c: HeaderButtonContext) => string);
  disabled?: boolean | ((c: HeaderButtonContext) => boolean);
  hidden?: boolean | ((c: HeaderButtonContext) => boolean);
  sx?: SxProps<Theme>;
};

/** One half of a pin definition: where the panel goes and, optionally, whether it is parkable in that state. @public */
export type PinHalf = { placement?: AddPlacement; parkable?: boolean };

/** What pin() and unpin() do. Valid only when a drag cannot make the pinned state unreadable. @public */
export type Pinning = { pinned: PinHalf; unpinned: PinHalf };

/** @public */
export type PinWhenNotLive = 'place-only' | 'refuse' | 'show' | 'apply-on-next-show';

/** What a pin change does to a panel that is not live: one answer, or one per status. @public */
export type PinningWhenNotLive = PinWhenNotLive | { parked?: PinWhenNotLive; hidden?: PinWhenNotLive; closed?: 'refuse' | 'apply-on-next-show' };

/** Which layer a resolved value came from. A rule overrides the rest and 'derived' marks a value filled from another resolved field. @public */
export type SourceLayer = 'library' | 'workspace' | 'template' | 'host' | 'instance' | 'user' | 'derived' | 'forced';

/** The 49 settings whose value is one plain member; the catalog's other names are headerButtons and the eleven tuning leaves. @public */
export type SettingValues = {
  closable: boolean;
  parkable: boolean;
  draggable: boolean;
  crossable: boolean;
  placeable: boolean;
  resizable: boolean;
  formFactors: readonly FormFactor[];
  clearable: boolean;
  hostCreatable: boolean;
  multiple: boolean;
  maxInstances: number | 'unlimited';
  listed: boolean;
  startVisibility: 'live' | 'parked';
  hideStickiness: 'sticky' | 'until-room';
  hideWhenLast: 'allow' | 'refuse';
  capacityReturn: 'auto' | 'manual';
  returnPriority: number;
  overflow: Overflow;
  evictionRank: number;
  evictionOrder: 'farthest' | 'nearest' | 'leftmost' | 'rightmost';
  revealOnScroll: 'edges' | 'any' | 'never';
  scrollOnOpen: ScrollOnOpen;
  scrollOnMove: ScrollOnMove;
  scrollOnDrag: ScrollOnDrag;
  toggleWhenClosed: 'ignore' | 'reopen';
  showWhenClosed: 'refuse' | 'reopen';
  viewState: 'keep' | 'reset-on-park';
  keepMounted: boolean;
  placeOnAdd: AddPlacement;
  placeOnShow: AddPlacement | 'in-place';
  placeOnReturn: AddPlacement | 'in-place';
  placeFallback: 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed';
  undoPlacement: 'old-slot' | AddPlacement;
  layer: 'base' | 'raised';
  enterFrom: 'auto' | 'left' | 'right' | 'anchor';
  exitTo: 'auto' | 'left' | 'right';
  closeExit: 'down' | 'left' | 'right';
  animated: boolean;
  formFactor: FormFactor;
  title: string;
  pinning: Pinning;
  pinningWhenNotLive: PinningWhenNotLive;
  persist: 'saved' | 'session';
  rememberLayout: boolean;
  restoreVisibility: 'saved' | 'live' | 'parked';
  afterClose: 'stay-closed' | 'return-next-launch';
  undoWindowMs: number;
  reportClose: boolean;
  snapshot: 'both' | 'park' | 'close' | 'never';
};

/** @public */
export type DragToCloseTuning = {
  distanceFraction: number;
  minDistancePx: number;
  flickMinDistancePx: number;
  flickVelocity: number;
  cancelVelocity: number;
  directionLockPx: number;
  snapBack: { stiffness: number; damping: number };
};

/** @public */
export type SlideTuning = { durationSec: number; ease: readonly [number, number, number, number]; closeExitSeconds: number };

/** @public */
export type EdgeScrollTuning = { zonePx: number; maxPxPerSec: number; reducedStepMs: number };

/** The tuning leaves a panel may set; each may also be set on the workspace. @public */
export type PanelTuning = {
  dragToClose?: { [K in keyof DragToCloseTuning]?: DragToCloseTuning[K] };
  slide?: { [K in keyof SlideTuning]?: SlideTuning[K] };
  hopFraction?: number;
  edgeScroll?: { [K in keyof EdgeScrollTuning]?: EdgeScrollTuning[K] };
};

/** The per-panel leaves plus the seven that only the workspace sets. @public */
export type WorkspaceTuning = PanelTuning & {
  rowGap?: number;
  saveQuietMs?: number;
  gestureLockMs?: number;
  returnTieBreak?: 'latest-first' | 'earliest-first' | 'row-order';
  dropTieBreak?: 'leftmost' | 'rightmost';
  rowGesture?: 'step' | 'free' | 'off';
  initialScroll?: 'start' | 'end' | 'root' | { panel: PanelId };
};

/** @public */
export type ResolvedPanelTuning = { dragToClose: DragToCloseTuning; slide: SlideTuning; hopFraction: number; edgeScroll: EdgeScrollTuning };

/** @public */
export type ResolvedWorkspaceTuning = ResolvedPanelTuning & {
  rowGap: number;
  saveQuietMs: number;
  gestureLockMs: number;
  returnTieBreak: 'latest-first' | 'earliest-first' | 'row-order';
  dropTieBreak: 'leftmost' | 'rightmost';
  rowGesture: 'step' | 'free' | 'off';
  initialScroll: 'start' | 'end' | 'root' | { panel: PanelId };
};

/** Deeply frozen; every key is present after a resolve except `title`. @public */
export type ResolvedPanelSettings = {
  readonly [K in Exclude<keyof SettingValues, 'title'>]: SettingValues[K];
} & { readonly title?: string; readonly tuning: ResolvedPanelTuning; readonly headerButtons: { readonly [id: string]: HeaderButton } };

/** What one settings layer may hold. A tuning key at the workspace-defaults layer is refused. @public */
export type PanelSettings = { [K in keyof SettingValues]?: SettingValues[K] } & {
  tuning?: PanelTuning;
  headerButtons?: { [id: string]: HeaderButton | false };
};

/** A diagnostic that never throws: what a rule or a restore did and which setting it concerns. @public */
export type SettingNote = { code: string; panelId?: PanelId; key?: string; message: string };

/** Recorded only for a template, host or instance layer that asked for what a rule or a scope forbids. @public */
export type SettingConflict = {
  readonly key: string;
  readonly layer: 'template' | 'host' | 'instance';
  readonly kind: 'forced' | 'wrong-scope' | 'not-view-settable';
  readonly asked: unknown;
  readonly applied: unknown;
  readonly rule?: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';
  readonly forcedBy?: string;
  readonly message: string;
};

/** Every catalog name: a setting key, `headerButtons` as one name, and a dotted name per tuning leaf. @public */
export type CatalogName = Exclude<keyof PanelSettings, 'tuning'> | `tuning.${keyof WorkspaceTuning}`;

/** The class word that opens a descriptor's on_configure rule. @public */
export type SettingClass = 'NOW' | 'NEXT' | 'STATE' | 'SCOPE';

/** The configure call that accepts a key: configure(id), configureTemplate or configureTuning. @public */
export type SettingDoor = 'instance' | 'template' | 'tuning';

/** Who may set a setting: one panel, a template, the whole workspace, or either of the last two for a panel. @public */
export type SettingScope = 'instance' | 'template' | 'workspace' | 'panel or workspace';

/** One row of the catalog. `values` and `default` are the wording of the row in DESIGN.md. @public */
export interface SettingDescriptor {
  readonly name: CatalogName;
  readonly group: string;
  readonly values: string;
  readonly default: string;
  readonly scope: SettingScope;
  readonly viewSettable: boolean;
  readonly exists: 'today' | 'new';
  readonly ownerEntry: string;
  readonly configure: { readonly cls: SettingClass; readonly doors: readonly SettingDoor[] };
}

/** The layers one resolve reads, lowest to highest: workspace, template, host, instance, user. @public */
export type PanelSettingsLayers = {
  workspace?: PanelSettings;
  template?: PanelSettings;
  instance?: PanelSettings;
  host?: PanelSettings;
  user?: PanelUserLayer;
};

/** The person's own overrides: the only three things a person can change about a panel. @public */
export type PanelUserLayer = { formFactor?: FormFactor; anchor?: AnchorRequest; parkable?: boolean };

/** @public */
export type ResolveOptions = { root?: boolean; lenient?: boolean };

/** What a resolve returns. `source` is keyed by catalog name, a tuning leaf dotted, headerButtons as one key. @public */
export type PanelSettingsResolution = {
  value: ResolvedPanelSettings;
  source: Record<string, SourceLayer>;
  conflicts: SettingConflict[];
  notes: SettingNote[];
  userAnchor?: AnchorRequest;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** A copy of plain data (objects and arrays) that is frozen all the way down; anything else is kept as it is. */
function freezeClone<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeClone(item as unknown))) as unknown as T;
  if (isPlain(value)) {
    const copy: Plain = {};
    for (const key of Object.keys(value)) copy[key] = freezeClone(value[key]);
    return Object.freeze(copy) as T;
  }
  return value;
}

/** Structural equality for settings values; functions and other objects compare by identity. */
export function sameSettingsValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameSettingsValue(item, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameSettingsValue(a[k], b[k]));
  }
  return false;
}

const show = (v: unknown): string => {
  if (typeof v === 'function') return 'a function';
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/** One descriptor per setting, in a fixed order. test/panel-settings-catalog.test.ts holds it equal to the table in DESIGN.md. */
const CATALOG_ROWS: readonly SettingDescriptor[] = [
  {
    name: 'closable',
    group: 'permissions',
    values: 'true, false',
    default: 'true (root: false)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'parkable',
    group: 'permissions',
    values: 'true, false',
    default: 'true',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'STATE', doors: ['instance'] },
  },
  {
    name: 'draggable',
    group: 'permissions',
    values: 'true, false',
    default: 'derived: parkable',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'crossable',
    group: 'permissions',
    values: 'true, false',
    default: 'true',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'placeable',
    group: 'permissions',
    values: 'true, false',
    default: 'derived: parkable',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'resizable',
    group: 'permissions',
    values: 'true, false',
    default: 'true (C1)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'formFactors',
    group: 'permissions',
    values: 'non-empty subset of phone, tablet, desktop',
    default: 'all three (C1)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'STATE', doors: ['instance'] },
  },
  {
    name: 'clearable',
    group: 'permissions',
    values: 'true, false',
    default: 'derived: parkable and closable (C2)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'hostCreatable',
    group: 'template',
    values: 'true, false (template scope)',
    default: 'true',
    scope: 'template',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'SCOPE', doors: ['template'] },
  },
  {
    name: 'multiple',
    group: 'template',
    values: 'true, false (template scope)',
    default: 'false',
    scope: 'template',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'SCOPE', doors: ['template'] },
  },
  {
    name: 'maxInstances',
    group: 'template',
    values: 'integer >= 1, unlimited (template scope)',
    default: 'unlimited',
    scope: 'template',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'SCOPE', doors: ['template'] },
  },
  {
    name: 'listed',
    group: 'identity',
    values: 'true, false',
    default: 'derived: parkable',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'startVisibility',
    group: 'visibility',
    values: 'live, parked',
    default: 'live (C1)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'hideStickiness',
    group: 'visibility',
    values: 'sticky, until-room',
    default: 'sticky',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'hideWhenLast',
    group: 'visibility',
    values: 'allow, refuse',
    default: 'allow',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'capacityReturn',
    group: 'visibility',
    values: 'auto, manual',
    default: 'auto',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'returnPriority',
    group: 'visibility',
    values: 'integer',
    default: '0',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'overflow',
    group: 'visibility',
    values: 'scroll, park',
    default: 'scroll for every panel built through the cascade (a template, workspace defaults, a Host-bag create, or a restore inside a workspace; C1: scroll for a fixed column); a hand-built 0.1.0 entry in a row with no workspace defaults: park',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-numbers-and-overflow',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'evictionRank',
    group: 'visibility',
    values: 'integer',
    default: '0',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'evictionOrder',
    group: 'visibility',
    values: 'farthest, nearest, leftmost, rightmost',
    default: 'farthest',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'revealOnScroll',
    group: 'scrolling',
    values: 'edges, any, never',
    default: 'edges (a design default the owner never fixed; Q1 holds under it)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'scrollOnOpen',
    group: 'scrolling',
    values: 'into-view, start, center, none',
    default: 'into-view (owner-confirmed, Q21)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'scrollOnMove',
    group: 'scrolling',
    values: 'follow, none',
    default: 'follow (owner-confirmed, Q21)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'scrollOnDrag',
    group: 'scrolling',
    values: 'edge, none',
    default: 'edge (Q19: the owner asked for a per-panel switch and \'Yes, scroll at the edge\'; the library default is edge)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-edge-scroll-while-dragging',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'toggleWhenClosed',
    group: 'operations',
    values: 'ignore, reopen',
    default: 'ignore',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-panel-handle-operations',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'showWhenClosed',
    group: 'operations',
    values: 'refuse, reopen',
    default: 'refuse',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-panel-handle-operations',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'viewState',
    group: 'visibility',
    values: 'keep, reset-on-park',
    default: 'keep',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'STATE', doors: ['instance'] },
  },
  {
    name: 'keepMounted',
    group: 'visibility',
    values: 'true, false',
    default: 'false (C1, C6)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-keep-mounted-render-path',
    configure: { cls: 'STATE', doors: ['instance'] },
  },
  {
    name: 'placeOnAdd',
    group: 'placement',
    values: 'row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor}',
    default: 'row-end',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'placeOnShow',
    group: 'placement',
    values: 'the same plus in-place',
    default: 'in-place',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'placeOnReturn',
    group: 'placement',
    values: 'in-place, row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor}',
    default: 'in-place',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'placeFallback',
    group: 'placement',
    values: 'row-start, row-end, parkable-start, parkable-end, after-fixed',
    default: 'row-end',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'undoPlacement',
    group: 'placement',
    values: 'old-slot or any placeOnAdd value',
    default: 'old-slot',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'layer',
    group: 'motion',
    values: 'base, raised',
    default: 'base',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'enterFrom',
    group: 'motion',
    values: 'auto, left, right, anchor',
    default: 'auto',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'exitTo',
    group: 'motion',
    values: 'auto, left, right',
    default: 'auto',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'closeExit',
    group: 'motion',
    values: 'down, left, right',
    default: 'down',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'animated',
    group: 'motion',
    values: 'true, false',
    default: 'true',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'formFactor',
    group: 'identity',
    values: 'phone, tablet, desktop',
    default: 'phone (C4)',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'title',
    group: 'identity',
    values: 'string',
    default: 'none (\'Panel N\' for the bag)',
    scope: 'instance',
    viewSettable: true,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'pinning',
    group: 'pinning',
    values: 'object { pinned: PinHalf, unpinned: PinHalf }; PinHalf = { placement?, parkable? }; valid only if readable after a drag (6A); empty = no pin',
    default: '{ pinned: { placement: \'row-start\' }, unpinned: { placement: \'row-end\' } } (0.1.0\'s one pin rule)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-pin-and-reset',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'pinningWhenNotLive',
    group: 'pinning',
    values: 'place-only, refuse, show, apply-on-next-show; or { parked?, hidden?, closed? } (closed: refuse or apply-on-next-show)',
    default: 'place-only',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-pin-and-reset',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'headerButtons',
    group: 'header',
    values: 'object: slot id (1-32 chars a-z0-9-) to HeaderButton or false; HeaderButton = { icon, label, onClick, side?, order?, pressed?, description?, tooltip?, disabled?, hidden?, sx? } (section 6)',
    default: '{} (no button drawn)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-header-buttons',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'persist',
    group: 'persistence',
    values: 'saved, session',
    default: 'saved',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'rememberLayout',
    group: 'persistence',
    values: 'true, false',
    default: 'true (C3)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'restoreVisibility',
    group: 'persistence',
    values: 'saved, live, parked',
    default: 'saved (C1)',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-saved-overrides-and-template-paths',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'afterClose',
    group: 'persistence',
    values: 'stay-closed, return-next-launch',
    default: 'stay-closed (C3)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-workspace-attach-and-snapshot',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'undoWindowMs',
    group: 'closing',
    values: 'integer ms; 0 = no undo',
    default: '10000',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'reportClose',
    group: 'closing',
    values: 'true, false',
    default: 'true',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'snapshot',
    group: 'closing',
    values: 'both, park, close, never',
    default: 'both',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'tuning.rowGap',
    group: 'tuning',
    values: 'integer px 0 to 200 (workspace only)',
    default: '16 (GAP)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.dragToClose',
    group: 'tuning',
    values: 'object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50, directionLockPx integer [2, 64], snapBack { stiffness [50, 2000], damping [5, 200] }; panel or workspace',
    default: '0.25, 80, 40, 700, -300, 8, { 520, 42 } (DRAG_CLOSE; DIRECTION_LOCK_PX)',
    scope: 'panel or workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['instance', 'tuning'] },
  },
  {
    name: 'tuning.slide',
    group: 'tuning',
    values: 'object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5]; panel or workspace',
    default: '0.4, [0.2, 0, 0, 1], 0.18 (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds)',
    scope: 'panel or workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['instance', 'tuning'] },
  },
  {
    name: 'tuning.hopFraction',
    group: 'tuning',
    values: 'number in (0, 1]; panel or workspace',
    default: '0.5',
    scope: 'panel or workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['instance', 'tuning'] },
  },
  {
    name: 'tuning.edgeScroll',
    group: 'tuning',
    values: 'object: zonePx integer [8, 200], maxPxPerSec integer [100, 5000], reducedStepMs integer [100, 5000]; panel or workspace (a key derived from Q19; the numbers are owner-confirmed, Q21)',
    default: '48, 900, 500 (owner-confirmed, Q21; the numbers live in rowConstants.ts)',
    scope: 'panel or workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-edge-scroll-while-dragging',
    configure: { cls: 'NEXT', doors: ['instance', 'tuning'] },
  },
  {
    name: 'tuning.saveQuietMs',
    group: 'tuning',
    values: 'integer ms >= 0 (workspace only)',
    default: '500',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.gestureLockMs',
    group: 'tuning',
    values: 'integer ms >= 0 (workspace only)',
    default: '350',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.returnTieBreak',
    group: 'tuning',
    values: 'latest-first, earliest-first, row-order (workspace only)',
    default: 'latest-first',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.dropTieBreak',
    group: 'tuning',
    values: 'leftmost, rightmost (workspace only)',
    default: 'leftmost',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.rowGesture',
    group: 'tuning',
    values: 'step, free, off (workspace only; a design-derived key from Q15, not requested)',
    default: 'step',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.initialScroll',
    group: 'tuning',
    values: 'start, end, root, { panel: PanelId } (workspace only; a design-derived key from Q15, not requested)',
    default: 'start (the library default, a design default the owner did not rule on; phonux-app sets \'end\', owner Q20: the newest closable panels in view at launch)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
];

/**
 * Every setting as data: its values, default, owning entry, the class of its on_configure rule and the calls
 * that accept it. Deeply frozen.
 * @public
 */
export const PANEL_SETTINGS_CATALOG: readonly SettingDescriptor[] = freezeClone(CATALOG_ROWS);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DERIVED_DEFAULT_KEYS = ['draggable', 'placeable', 'listed', 'clearable'] as const;
type DerivedDefaultKey = (typeof DERIVED_DEFAULT_KEYS)[number];

/** Every setting that has its own default. The four derived ones follow `parkable` and `closable`; `title` has none. @public */
export type LibraryPanelDefaults = {
  readonly [K in Exclude<keyof SettingValues, DerivedDefaultKey | 'title'>]: SettingValues[K];
} & { readonly headerButtons: { readonly [id: string]: HeaderButton }; readonly title: undefined };

/**
 * The library default of every setting that has one. `title` is present with no value so that the keys of this
 * object, the tuning names and the four derived keys together name every catalog row.
 * @public
 */
export const LIBRARY_PANEL_DEFAULTS: LibraryPanelDefaults = freezeClone({
  closable: true,
  parkable: true,
  crossable: true,
  resizable: true,
  formFactors: ['phone', 'tablet', 'desktop'] as readonly FormFactor[],
  hostCreatable: true,
  multiple: false,
  maxInstances: 'unlimited' as number | 'unlimited',
  startVisibility: 'live' as const,
  hideStickiness: 'sticky' as const,
  hideWhenLast: 'allow' as const,
  capacityReturn: 'auto' as const,
  returnPriority: 0,
  overflow: 'scroll' as Overflow,
  evictionRank: 0,
  evictionOrder: 'farthest' as const,
  revealOnScroll: 'edges' as const,
  scrollOnOpen: 'into-view' as ScrollOnOpen,
  scrollOnMove: 'follow' as ScrollOnMove,
  scrollOnDrag: 'edge' as ScrollOnDrag,
  toggleWhenClosed: 'ignore' as const,
  showWhenClosed: 'refuse' as const,
  viewState: 'keep' as const,
  keepMounted: false,
  placeOnAdd: 'row-end' as AddPlacement,
  placeOnShow: 'in-place' as AddPlacement | 'in-place',
  placeOnReturn: 'in-place' as AddPlacement | 'in-place',
  placeFallback: 'row-end' as const,
  undoPlacement: 'old-slot' as 'old-slot' | AddPlacement,
  layer: 'base' as const,
  enterFrom: 'auto' as const,
  exitTo: 'auto' as const,
  closeExit: 'down' as const,
  animated: true,
  formFactor: 'phone' as FormFactor,
  title: undefined,
  pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } as Pinning,
  pinningWhenNotLive: 'place-only' as PinningWhenNotLive,
  headerButtons: {},
  persist: 'saved' as const,
  rememberLayout: true,
  restoreVisibility: 'saved' as const,
  afterClose: 'stay-closed' as const,
  undoWindowMs: 10000,
  reportClose: true,
  snapshot: 'both' as const,
});

/**
 * The library default of every tuning leaf. The leaves a panel may set (dragToClose, slide, hopFraction,
 * edgeScroll) are each their own frozen object.
 * @public
 */
export const LIBRARY_TUNING_DEFAULTS: ResolvedWorkspaceTuning = freezeClone({
  rowGap: ROW_GAP,
  dragToClose: {
    distanceFraction: DRAG_CLOSE_NUMBERS.distanceFraction,
    minDistancePx: DRAG_CLOSE_NUMBERS.minDistancePx,
    flickMinDistancePx: DRAG_CLOSE_NUMBERS.flickMinDistancePx,
    flickVelocity: DRAG_CLOSE_NUMBERS.flickVelocity,
    cancelVelocity: DRAG_CLOSE_NUMBERS.cancelVelocity,
    directionLockPx: DIRECTION_LOCK_PX,
    snapBack: { stiffness: SNAP_BACK_SPRING.stiffness, damping: SNAP_BACK_SPRING.damping },
  },
  slide: { durationSec: SLIDE_DURATION_SEC, ease: [...SLIDE_EASE] as unknown as readonly [number, number, number, number], closeExitSeconds: SLIDE_CLOSE_EXIT_SECONDS },
  hopFraction: HOP_FRACTION,
  edgeScroll: { zonePx: EDGE_SCROLL_ZONE_PX, maxPxPerSec: EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: EDGE_SCROLL_REDUCED_STEP_MS },
  saveQuietMs: SAVE_QUIET_MS,
  gestureLockMs: GESTURE_LOCK_MS,
  returnTieBreak: RETURN_TIE_BREAK as ResolvedWorkspaceTuning['returnTieBreak'],
  dropTieBreak: DROP_TIE_BREAK as ResolvedWorkspaceTuning['dropTieBreak'],
  rowGesture: ROW_GESTURE as ResolvedWorkspaceTuning['rowGesture'],
  initialScroll: INITIAL_SCROLL as ResolvedWorkspaceTuning['initialScroll'],
});

// ---------------------------------------------------------------------------
// Validators: each returns a problem description, or undefined when the value is acceptable
// ---------------------------------------------------------------------------

type Check = (v: unknown) => string | undefined;

const FORM_FACTORS: readonly FormFactor[] = ['phone', 'tablet', 'desktop'];
const PLACEMENT_WORDS: readonly string[] = ['row-start', 'row-end', 'parkable-start', 'parkable-end', 'after-fixed', 'order'];
const SLOT_ID = /^[a-z0-9-]{1,32}$/;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bool: Check = (v) => (typeof v === 'boolean' ? undefined : 'expected a boolean');
const text: Check = (v) => (typeof v === 'string' ? undefined : 'expected a string');
const oneOf =
  (...allowed: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && allowed.includes(v) ? undefined : `expected one of ${allowed.join(', ')}`;
const num =
  (min: number, max: number, { integer = false, minOpen = false }: { integer?: boolean; minOpen?: boolean } = {}): Check =>
  (v) => {
    if (!finite(v)) return 'expected a finite number';
    if (integer && !Number.isInteger(v)) return 'expected an integer';
    if (minOpen ? !(v > min) : v < min) return `expected ${minOpen ? 'more than' : 'at least'} ${min}`;
    if (v > max) return `expected at most ${max}`;
    return undefined;
  };
const integer = (min: number, max = Infinity): Check => num(min, max, { integer: true });
const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

const anchorProblem: Check = (v) => {
  if (!isPlain(v)) return 'expected { panel?, position, priority? }';
  for (const key of Object.keys(v)) if (key !== 'panel' && key !== 'position' && key !== 'priority') return `unknown anchor key '${key}'`;
  if (v.panel !== undefined && !nonEmptyString(v.panel)) return 'anchor.panel must be a non-empty string';
  if (v.position !== 'left' && v.position !== 'right') return "anchor.position must be 'left' or 'right'";
  if (v.priority !== undefined && !finite(v.priority)) return 'anchor.priority must be a finite number';
  return undefined;
};

const placementProblem: Check = (v) => {
  if (typeof v === 'string') {
    if (PLACEMENT_WORDS.includes(v)) return undefined;
    return v === 'in-place' ? "'in-place' is not a placement here" : `unknown placement '${v}'`;
  }
  if (!isPlain(v)) return 'expected a placement word or { before } | { after } | { anchor }';
  const keys = Object.keys(v);
  const only = keys[0];
  if (keys.length !== 1 || only === undefined) return 'a placement object has exactly one of before, after, anchor';
  if (only === 'before' || only === 'after') return nonEmptyString(v[only]) ? undefined : `${only} must name a panel`;
  if (only === 'anchor') {
    const inner = anchorProblem(v.anchor);
    if (inner !== undefined) return inner;
    return nonEmptyString((v.anchor as Plain).panel) ? undefined : 'a placement anchor must name its panel';
  }
  return `unknown placement key '${only}'`;
};

const placementOrInPlace: Check = (v) => (v === 'in-place' ? undefined : placementProblem(v));
const undoPlacementProblem: Check = (v) => (v === 'old-slot' ? undefined : placementProblem(v));

const formFactorsProblem: Check = (v) => {
  if (!Array.isArray(v) || v.length === 0) return 'expected a non-empty list of phone, tablet, desktop';
  if (!v.every((item) => FORM_FACTORS.includes(item as FormFactor))) return 'expected only phone, tablet, desktop';
  return new Set(v).size === v.length ? undefined : 'expected no repeated tier';
};

const maxInstancesProblem: Check = (v) => (v === 'unlimited' ? undefined : integer(1)(v) === undefined ? undefined : "expected an integer of at least 1 or 'unlimited'");

const headerButtonsProblem: Check = (v) => {
  if (!isPlain(v)) return 'expected a map of slot id to slot or false';
  for (const id of Object.keys(v)) {
    if (!SLOT_ID.test(id)) return `slot id '${id}' must be 1-32 characters of a-z, 0-9 and -`;
    const slot = v[id];
    if (slot !== false && (typeof slot !== 'object' || slot === null || Array.isArray(slot))) return `slot '${id}' must be a slot object or false`;
  }
  return undefined;
};

const PIN_HALF_KEYS: readonly string[] = ['placement', 'parkable'];

const pinHalfProblem = (half: unknown, which: string): string | undefined => {
  if (!isPlain(half)) return `${which} must be an object`;
  for (const key of Object.keys(half)) if (!PIN_HALF_KEYS.includes(key)) return `unknown key '${key}' in ${which}`;
  if (half.placement !== undefined) {
    const problem = placementProblem(half.placement);
    if (problem !== undefined) return `${which}.placement: ${problem}`;
  }
  if (half.parkable !== undefined && typeof half.parkable !== 'boolean') return `${which}.parkable must be a boolean`;
  return undefined;
};

/** Pinned is read from facts a drag cannot erase: the parkable pair, or row-start with row-end or after-fixed; an empty definition reads false. */
function pinIsReadable(pinned: Plain, unpinned: Plain): boolean {
  if (Object.keys(pinned).length === 0 && Object.keys(unpinned).length === 0) return true;
  if (pinned.parkable !== undefined) return true;
  return pinned.placement === 'row-start' && (unpinned.placement === 'row-end' || unpinned.placement === 'after-fixed');
}

const pinningProblem: Check = (v) => {
  if (!isPlain(v)) return 'expected { pinned, unpinned }';
  for (const key of Object.keys(v)) if (key !== 'pinned' && key !== 'unpinned') return `unknown key '${key}'`;
  const pinned = v.pinned ?? {};
  const unpinned = v.unpinned ?? {};
  const halves = pinHalfProblem(pinned, 'pinned') ?? pinHalfProblem(unpinned, 'unpinned');
  if (halves !== undefined) return halves;
  const pinnedHalf = pinned as Plain;
  const unpinnedHalf = unpinned as Plain;
  if ((pinnedHalf.parkable === undefined) !== (unpinnedHalf.parkable === undefined)) return 'parkable is named in one half only';
  if (pinnedHalf.parkable !== undefined && pinnedHalf.parkable === unpinnedHalf.parkable) return 'both halves name the same parkable value';
  if (!pinIsReadable(pinnedHalf, unpinnedHalf)) return 'a drag would make the pinned state unreadable: name parkable in both halves, or use row-start with row-end or after-fixed';
  return undefined;
};

const PIN_WHEN_NOT_LIVE: readonly string[] = ['place-only', 'refuse', 'show', 'apply-on-next-show'];

const pinningWhenNotLiveProblem: Check = (v) => {
  if (typeof v === 'string') return PIN_WHEN_NOT_LIVE.includes(v) ? undefined : `expected one of ${PIN_WHEN_NOT_LIVE.join(', ')}`;
  if (!isPlain(v)) return 'expected a word or { parked?, hidden?, closed? }';
  for (const key of Object.keys(v)) {
    const value = v[key];
    if (value === undefined) continue;
    if (key === 'parked' || key === 'hidden') {
      if (typeof value !== 'string' || !PIN_WHEN_NOT_LIVE.includes(value)) return `${key} must be one of ${PIN_WHEN_NOT_LIVE.join(', ')}`;
    } else if (key === 'closed') {
      if (value !== 'refuse' && value !== 'apply-on-next-show') return "closed must be 'refuse' or 'apply-on-next-show'";
    } else {
      return `unknown key '${key}'`;
    }
  }
  return undefined;
};

type SettingKey = Exclude<CatalogName, `tuning.${string}`>;

const SETTING_CHECKS: Record<SettingKey, Check> = {
  closable: bool,
  parkable: bool,
  draggable: bool,
  crossable: bool,
  placeable: bool,
  resizable: bool,
  formFactors: formFactorsProblem,
  clearable: bool,
  hostCreatable: bool,
  multiple: bool,
  maxInstances: maxInstancesProblem,
  listed: bool,
  startVisibility: oneOf('live', 'parked'),
  hideStickiness: oneOf('sticky', 'until-room'),
  hideWhenLast: oneOf('allow', 'refuse'),
  capacityReturn: oneOf('auto', 'manual'),
  returnPriority: integer(-Infinity),
  overflow: oneOf('scroll', 'park'),
  evictionRank: integer(-Infinity),
  evictionOrder: oneOf('farthest', 'nearest', 'leftmost', 'rightmost'),
  revealOnScroll: oneOf('edges', 'any', 'never'),
  scrollOnOpen: oneOf('into-view', 'start', 'center', 'none'),
  scrollOnMove: oneOf('follow', 'none'),
  scrollOnDrag: oneOf('edge', 'none'),
  toggleWhenClosed: oneOf('ignore', 'reopen'),
  showWhenClosed: oneOf('refuse', 'reopen'),
  viewState: oneOf('keep', 'reset-on-park'),
  keepMounted: bool,
  placeOnAdd: placementProblem,
  placeOnShow: placementOrInPlace,
  placeOnReturn: placementOrInPlace,
  placeFallback: oneOf('row-start', 'row-end', 'parkable-start', 'parkable-end', 'after-fixed'),
  undoPlacement: undoPlacementProblem,
  layer: oneOf('base', 'raised'),
  enterFrom: oneOf('auto', 'left', 'right', 'anchor'),
  exitTo: oneOf('auto', 'left', 'right'),
  closeExit: oneOf('down', 'left', 'right'),
  animated: bool,
  formFactor: oneOf(...FORM_FACTORS),
  title: text,
  pinning: pinningProblem,
  pinningWhenNotLive: pinningWhenNotLiveProblem,
  headerButtons: headerButtonsProblem,
  persist: oneOf('saved', 'session'),
  rememberLayout: bool,
  restoreVisibility: oneOf('saved', 'live', 'parked'),
  afterClose: oneOf('stay-closed', 'return-next-launch'),
  undoWindowMs: integer(0),
  reportClose: bool,
  snapshot: oneOf('both', 'park', 'close', 'never'),
};

type TuningLeaf = keyof WorkspaceTuning;

/** Members of the three object-valued leaves, each with the check for its value. */
const TUNING_MEMBER_CHECKS: Record<'dragToClose' | 'slide' | 'edgeScroll', Record<string, Check>> = {
  dragToClose: {
    distanceFraction: num(0.05, 1),
    minDistancePx: num(8, Infinity),
    flickMinDistancePx: num(8, Infinity),
    flickVelocity: num(100, Infinity),
    cancelVelocity: num(-Infinity, -50),
    directionLockPx: integer(2, 64),
    snapBack: (v) => {
      if (!isPlain(v)) return 'expected { stiffness, damping }';
      for (const key of Object.keys(v)) if (key !== 'stiffness' && key !== 'damping') return `unknown key '${key}'`;
      return num(50, 2000)(v.stiffness) !== undefined ? 'stiffness must be a number from 50 to 2000' : num(5, 200)(v.damping) !== undefined ? 'damping must be a number from 5 to 200' : undefined;
    },
  },
  slide: {
    durationSec: num(0, 10),
    ease: (v) => {
      if (!Array.isArray(v) || v.length !== 4 || !v.every(finite)) return 'expected four finite numbers';
      const [x1, , x2] = v as number[];
      return (x1 as number) < 0 || (x1 as number) > 1 || (x2 as number) < 0 || (x2 as number) > 1 ? 'the first and third numbers must be from 0 to 1' : undefined;
    },
    closeExitSeconds: num(0, 5),
  },
  edgeScroll: {
    zonePx: integer(8, 200),
    maxPxPerSec: integer(100, 5000),
    reducedStepMs: integer(100, 5000),
  },
};

const TUNING_SCALAR_CHECKS: Record<'hopFraction' | 'rowGap' | 'saveQuietMs' | 'gestureLockMs' | 'returnTieBreak' | 'dropTieBreak' | 'rowGesture' | 'initialScroll', Check> = {
  hopFraction: num(0, 1, { minOpen: true }),
  rowGap: integer(0, 200),
  saveQuietMs: integer(0),
  gestureLockMs: integer(0),
  returnTieBreak: oneOf('latest-first', 'earliest-first', 'row-order'),
  dropTieBreak: oneOf('leftmost', 'rightmost'),
  rowGesture: oneOf('step', 'free', 'off'),
  initialScroll: (v) => {
    if (v === 'start' || v === 'end' || v === 'root') return undefined;
    if (isPlain(v) && Object.keys(v).length === 1 && nonEmptyString(v.panel)) return undefined;
    return "expected 'start', 'end', 'root' or { panel: a non-empty id }";
  },
};

const isObjectLeaf = (leaf: string): leaf is keyof typeof TUNING_MEMBER_CHECKS => Object.hasOwn(TUNING_MEMBER_CHECKS, leaf);
const isTuningLeaf = (leaf: string): leaf is TuningLeaf => isObjectLeaf(leaf) || Object.hasOwn(TUNING_SCALAR_CHECKS, leaf);

/** What a tuning leaf's value holds: the members that passed, and one problem per member that did not. */
function checkTuningLeaf(leaf: TuningLeaf, value: unknown): { accepted: unknown; problems: { key: string; problem: string }[] } {
  const base = `tuning.${leaf}`;
  if (!isObjectLeaf(leaf)) {
    const problem = TUNING_SCALAR_CHECKS[leaf](value);
    return problem === undefined ? { accepted: value, problems: [] } : { accepted: undefined, problems: [{ key: base, problem }] };
  }
  if (!isPlain(value)) return { accepted: undefined, problems: [{ key: base, problem: 'expected an object' }] };
  const members = TUNING_MEMBER_CHECKS[leaf];
  const accepted: Plain = {};
  const problems: { key: string; problem: string }[] = [];
  for (const member of Object.keys(value)) {
    const memberValue = value[member];
    if (memberValue === undefined) continue;
    const check = Object.hasOwn(members, member) ? members[member] : undefined;
    if (check === undefined) {
      problems.push({ key: `${base}.${member}`, problem: 'unknown tuning member' });
      continue;
    }
    const problem = check(memberValue);
    if (problem === undefined) accepted[member] = memberValue;
    else problems.push({ key: `${base}.${member}`, problem });
  }
  return { accepted: Object.keys(accepted).length > 0 ? accepted : undefined, problems };
}

const WORKSPACE_ONLY_TUNING = new Set<string>(PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.length === 1 && d.configure.doors[0] === 'tuning').map((d) => d.name.slice('tuning.'.length)));
const TEMPLATE_SCOPE_KEYS = new Set<string>(PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.length === 1 && d.configure.doors[0] === 'template').map((d) => d.name));
const VIEW_SETTABLE_KEYS = new Set<string>(PANEL_SETTINGS_CATALOG.filter((d) => d.viewSettable).map((d) => d.name));

/** A view may place itself only by an explicit anchor and enter only from it, so those two keys are checked by value. */
const viewMayAsk = (key: string, value: unknown): boolean => {
  if (!VIEW_SETTABLE_KEYS.has(key)) return false;
  if (key === 'placeOnAdd') return isPlain(value) && Object.keys(value).length === 1 && value.anchor !== undefined;
  if (key === 'enterFrom') return value === 'anchor';
  return true;
};

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

type AskLayer = 'workspace' | 'template' | 'host' | 'instance';
const ASK_LAYERS: readonly AskLayer[] = ['workspace', 'template', 'host', 'instance'];

type Rule = NonNullable<SettingConflict['rule']>;

interface Accepted {
  flat: Map<string, unknown>;
  tuning: Map<string, unknown>;
}

interface Pending {
  key: string;
  layer: 'host' | 'instance';
  kind: 'wrong-scope' | 'not-view-settable';
  asked: unknown;
}

interface Env {
  lenient: boolean;
  notes: SettingNote[];
  pending: Pending[];
}

/** Drops the key with a note when this layer is a saved one read leniently; throws otherwise. */
function reject(layer: string, key: string, problem: string, lenientLayer: boolean, notes: SettingNote[]): void {
  const where = key === '' ? layer : `${layer}.${key}`;
  if (lenientLayer) {
    notes.push({ code: 'invalid-saved-setting', ...(key === '' ? {} : { key }), message: `${where}: ${problem}; dropped` });
    return;
  }
  throw new PanelManagerError('invalid-settings', `${where}: ${problem}`, key === '' ? { layer } : { layer, key });
}

function checkTuning(layer: AskLayer, raw: unknown, accepted: Accepted, env: Env, lenientLayer: boolean): void {
  if (layer === 'workspace') {
    throw new PanelManagerError('invalid-settings', 'workspace.tuning: tuning is not a workspace default; set it on WorkspaceOptions.tuning', { layer, key: 'tuning' });
  }
  if (!isPlain(raw)) {
    reject(layer, 'tuning', 'expected an object', lenientLayer, env.notes);
    return;
  }
  for (const leaf of Object.keys(raw)) {
    const value = raw[leaf];
    if (value === undefined) continue;
    if (!isTuningLeaf(leaf)) {
      reject(layer, `tuning.${leaf}`, 'unknown tuning key', lenientLayer, env.notes);
      continue;
    }
    const checked = checkTuningLeaf(leaf, value);
    for (const { key, problem } of checked.problems) reject(layer, key, problem, lenientLayer, env.notes);
    if (checked.accepted === undefined) continue;
    const name = `tuning.${leaf}`;
    if (WORKSPACE_ONLY_TUNING.has(leaf)) {
      if (layer === 'template') throw new PanelManagerError('invalid-settings', `${layer}.${name}: a workspace-only tuning key; set it on WorkspaceOptions.tuning`, { layer, key: name });
      env.pending.push({ key: name, layer: layer as 'host' | 'instance', kind: 'wrong-scope', asked: checked.accepted });
      continue;
    }
    if (layer === 'host') {
      env.pending.push({ key: name, layer, kind: 'not-view-settable', asked: checked.accepted });
      continue;
    }
    accepted.tuning.set(leaf, checked.accepted);
  }
}

/** A pin definition may leave a half out; the resolved value always has both. */
const withBothHalves = (v: Plain): Pinning => ({ pinned: (v.pinned ?? {}) as PinHalf, unpinned: (v.unpinned ?? {}) as PinHalf });

function checkLayer(layer: AskLayer, raw: unknown, env: Env): Accepted {
  const accepted: Accepted = { flat: new Map(), tuning: new Map() };
  if (raw === undefined) return accepted;
  const lenientLayer = env.lenient && layer === 'instance';
  if (!isPlain(raw)) {
    reject(layer, '', 'a settings layer must be an object', lenientLayer, env.notes);
    return accepted;
  }
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === 'tuning') {
      checkTuning(layer, value, accepted, env, lenientLayer);
      continue;
    }
    if (!Object.hasOwn(SETTING_CHECKS, key)) {
      reject(layer, key, 'unknown setting', lenientLayer, env.notes);
      continue;
    }
    const problem = SETTING_CHECKS[key as SettingKey](value);
    if (problem !== undefined) {
      reject(layer, key, problem, lenientLayer, env.notes);
      continue;
    }
    if (TEMPLATE_SCOPE_KEYS.has(key) && (layer === 'host' || layer === 'instance')) {
      env.pending.push({ key, layer, kind: 'wrong-scope', asked: value });
      continue;
    }
    if (layer === 'host' && !viewMayAsk(key, value)) {
      env.pending.push({ key, layer, kind: 'not-view-settable', asked: value });
      continue;
    }
    accepted.flat.set(key, key === 'pinning' ? withBothHalves(value as Plain) : value);
  }
  return accepted;
}

function checkUser(raw: unknown, env: Env): PanelUserLayer {
  const accepted: { formFactor?: FormFactor; anchor?: AnchorRequest; parkable?: boolean } = {};
  if (raw === undefined) return accepted;
  if (!isPlain(raw)) {
    reject('user', '', 'a settings layer must be an object', env.lenient, env.notes);
    return accepted;
  }
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value === undefined) continue;
    let problem: string | undefined;
    if (key === 'formFactor') problem = oneOf(...FORM_FACTORS)(value);
    else if (key === 'parkable') problem = bool(value);
    else if (key === 'anchor') problem = anchorProblem(value);
    else problem = 'unknown setting';
    if (problem !== undefined) {
      reject('user', key, problem, env.lenient, env.notes);
      continue;
    }
    if (key === 'formFactor') accepted.formFactor = value as FormFactor;
    else if (key === 'parkable') accepted.parkable = value as boolean;
    else accepted.anchor = { ...(value as AnchorRequest) };
  }
  return accepted;
}

interface Draft {
  key: string;
  layer: 'template' | 'host' | 'instance';
  asked: unknown;
  rule: Rule;
  forcedBy: string | undefined;
}

interface State {
  values: Plain;
  source: Record<string, SourceLayer>;
  tuning: { dragToClose: Plain; slide: Plain; hopFraction: number; edgeScroll: Plain };
  drafts: Draft[];
}

/** Merges the accepted layers over the library defaults, lowest first; a later layer's value wins field by field. */
function merge(accepted: Record<AskLayer, Accepted>, userParkable: boolean | undefined): State {
  const values: Plain = { ...LIBRARY_PANEL_DEFAULTS };
  const source: Record<string, SourceLayer> = {};
  for (const key of Object.keys(values)) if (values[key] !== undefined) source[key] = 'library';
  const tuning = {
    dragToClose: { ...LIBRARY_TUNING_DEFAULTS.dragToClose } as Plain,
    slide: { ...LIBRARY_TUNING_DEFAULTS.slide } as Plain,
    hopFraction: LIBRARY_TUNING_DEFAULTS.hopFraction,
    edgeScroll: { ...LIBRARY_TUNING_DEFAULTS.edgeScroll } as Plain,
  };
  for (const leaf of ['dragToClose', 'slide', 'hopFraction', 'edgeScroll']) source[`tuning.${leaf}`] = 'library';

  for (const layer of ASK_LAYERS) {
    const { flat, tuning: leaves } = accepted[layer];
    for (const [key, value] of flat) {
      if (key === 'headerButtons') {
        const slots: Plain = { ...(values.headerButtons as Plain) };
        for (const id of Object.keys(value as Plain)) {
          const slot = (value as Plain)[id];
          if (slot === false) delete slots[id];
          else slots[id] = slot;
        }
        values.headerButtons = slots;
        if (Object.keys(value as Plain).length > 0) source.headerButtons = layer;
      } else {
        values[key] = value;
        source[key] = layer;
      }
    }
    for (const [leaf, value] of leaves) {
      if (leaf === 'hopFraction') tuning.hopFraction = value as number;
      else Object.assign(tuning[leaf as 'dragToClose' | 'slide' | 'edgeScroll'], value as Plain);
      source[`tuning.${leaf}`] = layer;
    }
  }
  if (userParkable !== undefined) {
    values.parkable = userParkable;
    source.parkable = 'user';
  }
  return { values, source, tuning, drafts: [] };
}

/** Overrides one value. A conflict is recorded only when a developer layer's own ask is what changes. */
function force(s: State, key: string, applied: unknown, rule: Rule, forcedBy?: string): void {
  const asked = s.values[key];
  if (sameSettingsValue(asked, applied)) return;
  const layer = s.source[key];
  if (layer === 'template' || layer === 'host' || layer === 'instance') s.drafts.push({ key, layer, asked, rule, forcedBy });
  s.values[key] = applied;
  s.source[key] = 'forced';
}

function fill(s: State, key: DerivedDefaultKey, value: boolean): void {
  if (s.values[key] !== undefined) return;
  s.values[key] = value;
  s.source[key] = 'derived';
}

/** Derived defaults, then the coupling rules. The root's own rule runs first because it feeds C1 and C2. */
function applyRules(s: State, root: boolean): void {
  if (root) {
    force(s, 'parkable', false, 'C5');
    force(s, 'closable', false, 'C5');
  }
  const parkable = s.values.parkable === true;
  fill(s, 'draggable', parkable);
  fill(s, 'placeable', parkable);
  fill(s, 'listed', parkable);
  fill(s, 'clearable', parkable && s.values.closable === true);

  if (s.values.parkable === false) {
    force(s, 'resizable', false, 'C1', 'parkable');
    force(s, 'formFactors', ['phone'], 'C1', 'parkable');
    force(s, 'formFactor', 'phone', 'C1', 'parkable');
    force(s, 'overflow', 'scroll', 'C1', 'parkable');
    force(s, 'startVisibility', 'live', 'C1', 'parkable');
    force(s, 'restoreVisibility', 'live', 'C1', 'parkable');
    force(s, 'keepMounted', false, 'C1', 'parkable');
  }
  if (s.values.closable === false) force(s, 'clearable', false, 'C2', 'closable');
  if (s.values.persist === 'session') {
    force(s, 'rememberLayout', false, 'C3', 'persist');
    force(s, 'afterClose', 'return-next-launch', 'C3', 'persist');
  }
  const tiers = s.values.formFactors as readonly FormFactor[];
  if (!tiers.includes(s.values.formFactor as FormFactor)) force(s, 'formFactor', tiers[0], 'C4', 'formFactors');
  if (root) {
    force(s, 'draggable', false, 'C5');
    force(s, 'placeable', false, 'C5');
  }
  if (s.values.viewState === 'reset-on-park') force(s, 'keepMounted', false, 'C6', 'viewState');
}

const PARK_LEVERS = ['capacityReturn', 'returnPriority', 'evictionRank', 'evictionOrder'] as const;

function appliedFor(key: string, value: Plain, tuning: State['tuning']): unknown {
  if (key.startsWith('tuning.')) {
    const leaf = key.slice('tuning.'.length);
    if (leaf === 'dragToClose' || leaf === 'slide' || leaf === 'edgeScroll' || leaf === 'hopFraction') return tuning[leaf];
    return (LIBRARY_TUNING_DEFAULTS as unknown as Plain)[leaf];
  }
  return value[key];
}

const forcedMessage = (d: Draft, applied: unknown): string => `${d.key}: the ${d.layer} layer asked ${show(d.asked)}, but ${d.rule} makes it ${show(applied)}${d.forcedBy === undefined ? '' : ` because of ${d.forcedBy}`}`;

/**
 * Resolves the settings of one panel from its layers. Pure: the same layers give an equal result, the layers are
 * never changed, and the value is deeply frozen. An unknown key, a wrong type or an out-of-range value throws
 * PanelManagerError('invalid-settings') naming the layer and key; with `lenient`, the instance and user layers
 * (a saved file's own) drop such a key with a note instead. A conflict is recorded only for a template, host or
 * instance layer that asked for what a rule or a scope forbids.
 * @public
 */
export function resolvePanelSettings(layers: PanelSettingsLayers = {}, options: ResolveOptions = {}): PanelSettingsResolution {
  const root = options.root === true;
  const env: Env = { lenient: options.lenient === true, notes: [], pending: [] };
  const accepted = {} as Record<AskLayer, Accepted>;
  for (const layer of ASK_LAYERS) accepted[layer] = checkLayer(layer, layers[layer], env);
  const user = checkUser(layers.user, env);

  let state = merge(accepted, undefined);
  applyRules(state, root);

  // A person's fixed column needs the phone tier, so the tier is settled before their parkable joins as the top layer.
  let tier = state.values.formFactor as FormFactor;
  const userTierFits = user.formFactor !== undefined && (state.values.formFactors as readonly FormFactor[]).includes(user.formFactor);
  if (user.formFactor !== undefined && userTierFits) tier = user.formFactor;
  let userParkable = user.parkable;
  if (userParkable === false && tier !== 'phone') {
    env.notes.push({ code: 'override-dropped', key: 'parkable', message: `user.parkable: a fixed column needs the phone tier and this panel resolves to ${tier}; dropped` });
    userParkable = undefined;
  }
  if (userParkable !== undefined) {
    state = merge(accepted, userParkable);
    applyRules(state, root);
  }
  if (user.formFactor !== undefined) {
    if ((state.values.formFactors as readonly FormFactor[]).includes(user.formFactor)) {
      state.values.formFactor = user.formFactor;
      state.source.formFactor = 'user';
    } else {
      env.notes.push({ code: 'override-dropped', key: 'formFactor', message: `user.formFactor: ${user.formFactor} is outside this panel's formFactors; dropped` });
    }
  }

  const resolved = state.values;
  const conflicts: SettingConflict[] = [];
  for (const p of env.pending) {
    const applied = appliedFor(p.key, resolved, state.tuning);
    const message = p.kind === 'wrong-scope' ? `${p.key}: the ${p.layer} layer cannot set a ${TEMPLATE_SCOPE_KEYS.has(p.key) ? 'template-scope' : 'workspace-only'} setting; it was ignored` : `${p.key}: a view cannot set this; the ${p.layer} layer's ask was ignored`;
    conflicts.push({ key: p.key, layer: p.layer, kind: p.kind, asked: p.asked, applied, message });
  }
  for (const d of state.drafts) {
    const applied = appliedFor(d.key, resolved, state.tuning);
    conflicts.push({ key: d.key, layer: d.layer, kind: 'forced', asked: d.asked, applied, rule: d.rule, ...(d.forcedBy === undefined ? {} : { forcedBy: d.forcedBy }), message: forcedMessage(d, applied) });
  }

  const notes = env.notes;
  const pinning = resolved.pinning as Pinning;
  if (pinning.pinned.parkable === false && state.source.listed === 'derived') {
    notes.push({ code: 'pin-unlists', key: 'pinning', message: 'pinning: the pinned half makes the panel a fixed column, which is unlisted unless listed is set' });
  }
  if (resolved.overflow === 'scroll') {
    for (const key of PARK_LEVERS) {
      const layer = state.source[key];
      if (layer !== undefined && layer !== 'library') notes.push({ code: 'park-lever-inert', key, message: `${key}: only a panel whose overflow is 'park' is ever parked for room, so this has no effect here` });
    }
  }

  const value: Plain = {};
  for (const descriptor of PANEL_SETTINGS_CATALOG) {
    const key = descriptor.name;
    if (key.startsWith('tuning.') || key === 'headerButtons' || resolved[key] === undefined) continue;
    value[key] = freezeClone(resolved[key]);
  }
  const slots: Plain = {};
  for (const id of Object.keys(resolved.headerButtons as Plain)) slots[id] = Object.freeze({ ...((resolved.headerButtons as Plain)[id] as Plain) });
  value.headerButtons = Object.freeze(slots);
  value.tuning = freezeClone({ dragToClose: state.tuning.dragToClose, slide: state.tuning.slide, hopFraction: state.tuning.hopFraction, edgeScroll: state.tuning.edgeScroll });

  const result: PanelSettingsResolution = { value: Object.freeze(value) as unknown as ResolvedPanelSettings, source: state.source, conflicts, notes };
  if (user.anchor !== undefined) result.userAnchor = user.anchor;
  return result;
}
