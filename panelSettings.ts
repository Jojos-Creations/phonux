/**
 * The settings model: every behaviour a panel can differ in is a named setting with a library default, a
 * descriptor in one catalog, and one pure resolver that interprets every layer. Nothing here is rendered or
 * mounted. The only value imports are the two leaf modules below, so this file can be read (and the resolver
 * called) with no React, no Motion and no row code loaded; test/panel-settings-catalog.test.ts holds that line.
 */

import type * as React from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FormFactor, PanelSize } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelRowEntry } from './panelRowEntry.js';
import type { PanelState, ViewHandle } from './panelTemplate.js';
import type { PanelWindow } from './panelWindow.js';
import {
  CHROME,
  CLOSE_EXIT_EASE,
  DIRECTION_LOCK_PX,
  DRAG_CLOSE_NUMBERS,
  DRAG_REST_MS,
  DRAG_VELOCITY_WINDOW_MS,
  DROP_TIE_BREAK,
  EDGE_SCROLL_MAX_PX_PER_SEC,
  EDGE_SCROLL_REDUCED_STEP_MS,
  EDGE_SCROLL_ZONE_PX,
  GESTURE_LOCK_MS,
  GESTURE_QUIET_MS,
  GLIDE_EASE,
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
export type AnchorRequest = {
  /** The panel to sit beside; absent means the root. */
  panel?: PanelId;
  /** Which side of `panel` to sit on. */
  position: 'left' | 'right';
  /** Nearness to `panel` on that side; a lower number is nearer. Absent means the far end. */
  priority?: number;
};

/** A named place in the row, or a place next to a named panel. See DESIGN.md, "The settings catalog". @public */
export type AddPlacement =
  | 'row-start'
  | 'row-end'
  | 'parkable-start'
  | 'parkable-end'
  | 'after-fixed'
  | 'order'
  | {
      /** Immediately left of this panel. */
      before: PanelId;
    }
  | {
      /** Immediately right of this panel. */
      after: PanelId;
    }
  | {
      /** The given anchor, with its `panel` required. */
      anchor: AnchorRequest & { panel: PanelId };
    };

/** What the row may do with a panel when the open panels do not all fit: scroll past it, or park it. @public */
export type Overflow = 'scroll' | 'park';

/** Where a scrolled-to panel lands in the window. A stepping row (`rowGesture` 'step') lands on the nearest stop that shows the panel whole instead, so 'start' and 'center' are then approximate. @public */
export type ScrollAlign = 'into-view' | 'start' | 'center';

/** Where the row scrolls a panel to on open, show or click: a `ScrollAlign`, or 'none' for no scroll. @public */
export type ScrollOnOpen = ScrollAlign | 'none';

/** Whether the row follows a panel that moves: 'follow' scrolls it into view, 'none' leaves the scroll alone. @public */
export type ScrollOnMove = 'follow' | 'none';

/** Whether the row scrolls while a panel is dragged near the window's edge: 'edge' scrolls, 'none' does not. @public */
export type ScrollOnDrag = 'edge' | 'none';

/** What a header button's functions are given. @public */
export type HeaderButtonContext = {
  /** The panel's current state. */
  state: PanelState;
  /** The panel's resolved settings. */
  settings: ResolvedPanelSettings;
};

/** One generic title-bar button slot. The label is the accessible name and is never empty. @public */
export type HeaderButton = {
  /** The button's icon, or a function that picks it from the panel's current state. */
  icon: React.ReactNode | ((c: HeaderButtonContext) => React.ReactNode);
  /** The button's accessible name, or a function that picks it; never empty. */
  label: string | ((c: HeaderButtonContext) => string);
  /** Called when the button is pressed, with the panel's handle and the context plus `announce`, which tells assistive technology a message. */
  onClick: (
    handle: ViewHandle,
    c: HeaderButtonContext & {
      /** Announces `text` to assistive technology. */
      announce(text: string): void;
    },
  ) => void | Promise<unknown>;
  /** Which end of the header row the button sits at. */
  side?: 'start' | 'end';
  /** Sort position among the buttons on the same side. */
  order?: number;
  /** Whether the button shows as pressed, read from the panel's current state. */
  pressed?: (c: HeaderButtonContext) => boolean;
  /** Longer help text for the button, or a function that picks it. */
  description?: string | ((c: HeaderButtonContext) => string);
  /** The button's tooltip text, or a function that picks it. */
  tooltip?: string | ((c: HeaderButtonContext) => string);
  /** Whether the button is disabled, or a function that decides. */
  disabled?: boolean | ((c: HeaderButtonContext) => boolean);
  /** Whether the button is left out, or a function that decides. */
  hidden?: boolean | ((c: HeaderButtonContext) => boolean);
  /** Extra styles for the button. */
  sx?: SxProps<Theme>;
};

/** One half of a pin definition: where the panel goes and, optionally, whether it is parkable in that state. @public */
export type PinHalf = {
  /** Where the panel is placed in this state. */
  placement?: AddPlacement;
  /** The `parkable` value the panel takes in this state. */
  parkable?: boolean;
};

/** What pin() and unpin() do. Valid only when a drag cannot make the pinned state unreadable. @public */
export type Pinning = {
  /** What `pin()` does, and what the panel reads as when pinned. */
  pinned: PinHalf;
  /** What `unpin()` does. */
  unpinned: PinHalf;
};

/** What a pin change does to a panel that is not live: place it only, refuse, show it, or apply on its next show. @public */
export type PinWhenNotLive = 'place-only' | 'refuse' | 'show' | 'apply-on-next-show';

/** What a pin change does to a panel that is not live: one answer, or one per status. @public */
export type PinningWhenNotLive =
  | PinWhenNotLive
  | {
      /** The answer for a parked panel. */
      parked?: PinWhenNotLive;
      /** The answer for a hidden panel. */
      hidden?: PinWhenNotLive;
      /** The answer for a closed panel: refuse, or apply on its next show. */
      closed?: 'refuse' | 'apply-on-next-show';
    };

/** Which layer a resolved value came from. A rule overrides the rest and 'derived' marks a value filled from another resolved field. @public */
export type SourceLayer = 'library' | 'workspace' | 'template' | 'host' | 'instance' | 'user' | 'derived' | 'forced';

/** The 49 settings whose value is one plain member; the catalog's other names are headerButtons and the fourteen tuning leaves. @public */
export type SettingValues = {
  /** Whether the panel can be closed; false removes the drag-down close and makes `close()` answer not-closable. */
  closable: boolean;
  /** Whether the panel can be parked; false makes it a fixed column, which needs the phone tier. */
  parkable: boolean;
  /** Whether the panel can be moved by dragging or by `move()`. Defaults to the resolved `parkable`. */
  draggable: boolean;
  /** Whether another panel's drag can cross this panel. */
  crossable: boolean;
  /** Whether the panel can be re-anchored, placed, or pinned with a placement. Defaults to the resolved `parkable`. */
  placeable: boolean;
  /** Whether the panel's tier can be changed. */
  resizable: boolean;
  /** The tiers the panel may take; never empty. */
  formFactors: readonly FormFactor[];
  /** Whether clear-all closes the panel. Defaults to the resolved `parkable` and `closable`. */
  clearable: boolean;
  /** Whether a view's host-bag `create` may name the template. Template scope. */
  hostCreatable: boolean;
  /** Whether the template may have more than one instance. Template scope. */
  multiple: boolean;
  /** The most instances the template may have: an integer of at least 1, or 'unlimited'. Template scope. */
  maxInstances: number | 'unlimited';
  /** Whether the panel appears in the panel list. Defaults to the resolved `parkable`. */
  listed: boolean;
  /** Whether a panel made from this setting starts live or parked. */
  startVisibility: 'live' | 'parked';
  /** Whether a hidden panel stays hidden until shown ('sticky') or comes back once there is room ('until-room'). */
  hideStickiness: 'sticky' | 'until-room';
  /** Whether `hide()` is allowed or refused when the panel is the last one visible. */
  hideWhenLast: 'allow' | 'refuse';
  /** Whether a panel parked for room returns by itself when room appears ('auto') or only when shown ('manual'). */
  capacityReturn: 'auto' | 'manual';
  /** An integer ranking which parked panel returns first when room appears; the highest returns first. Read only when `overflow` is 'park'. */
  returnPriority: number;
  /** What the row may do with the panel when the open panels do not all fit. */
  overflow: Overflow;
  /** An integer ranking which panel is parked first when room is needed; the lowest rank is parked first. Read only when `overflow` is 'park'. */
  evictionRank: number;
  /** Which live panel is parked when this panel needs room: the farthest from it, the nearest, the leftmost or the rightmost. Read only when `overflow` is 'park'. */
  evictionOrder: 'farthest' | 'nearest' | 'leftmost' | 'rightmost';
  /** Which hidden panels a row scroll gesture may reveal: 'edges', 'any' or 'never'. */
  revealOnScroll: 'edges' | 'any' | 'never';
  /** Where the row scrolls the panel to on its next open, show or click. */
  scrollOnOpen: ScrollOnOpen;
  /** Whether the row follows the panel when it is moved, placed, resized, pinned, unpinned or its layout reset. */
  scrollOnMove: ScrollOnMove;
  /** Whether the row scrolls at the window's edge while the panel is dragged. */
  scrollOnDrag: ScrollOnDrag;
  /** What `toggleVisibility()` does to a closed declared panel: nothing ('ignore') or reopen it ('reopen'). */
  toggleWhenClosed: 'ignore' | 'reopen';
  /** What `show()` does to a closed declared panel: refuse it or reopen it. */
  showWhenClosed: 'refuse' | 'reopen';
  /** Whether the view's `useViewState` state is kept across a park ('keep') or reset at each park ('reset-on-park'). */
  viewState: 'keep' | 'reset-on-park';
  /** Whether parking hides the view instead of unmounting it. */
  keepMounted: boolean;
  /** Where the panel lands when it is added, and when the layout is reset. */
  placeOnAdd: AddPlacement;
  /** Where the panel lands when it is shown; 'in-place' leaves it where it is. */
  placeOnShow: AddPlacement | 'in-place';
  /** Where a parked panel lands when it returns automatically; 'in-place' leaves it where it is. */
  placeOnReturn: AddPlacement | 'in-place';
  /** Where a panel lands when its placement names a panel that is missing or is the panel itself. */
  placeFallback: 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed';
  /** Where `undoClose` puts the panel back: 'old-slot', or a placement. */
  undoPlacement: 'old-slot' | AddPlacement;
  /** The stacking tier of the panel's slot. */
  layer: 'base' | 'raised';
  /** The side the panel slides in from; 'auto' follows the row and 'anchor' uses its anchor's side. */
  enterFrom: 'auto' | 'left' | 'right' | 'anchor';
  /** The side the panel slides out toward when parked; 'auto' follows the row. */
  exitTo: 'auto' | 'left' | 'right';
  /** How the panel leaves when it closes. */
  closeExit: 'down' | 'left' | 'right';
  /** Whether the panel's enter, exit, park and scroll are animated. */
  animated: boolean;
  /** The tier a panel starts at; it never resizes a panel that already exists. */
  formFactor: FormFactor;
  /** The panel's title. */
  title: string;
  /** What `pin()` and `unpin()` do, and what the panel reads as pinned. */
  pinning: Pinning;
  /** What a pin change does to a panel that is not live. */
  pinningWhenNotLive: PinningWhenNotLive;
  /** Whether the panel is saved with the workspace ('saved') or lasts only for the session ('session'). */
  persist: 'saved' | 'session';
  /** Whether a person's layout changes to the panel are recorded and applied when the workspace is restored. */
  rememberLayout: boolean;
  /** Whether the panel is restored as it was saved ('saved'), live or parked. */
  restoreVisibility: 'saved' | 'live' | 'parked';
  /** Whether a closed panel stays closed ('stay-closed') or returns at the next launch ('return-next-launch'). */
  afterClose: 'stay-closed' | 'return-next-launch';
  /** How long a close can be undone, in ms; 0 means no undo. */
  undoWindowMs: number;
  /** Whether closing the panel is reported to the host. */
  reportClose: boolean;
  /** When a picture of the panel is taken: on park, on close, on both or never. */
  snapshot: 'both' | 'park' | 'close' | 'never';
};

/** The numbers behind a drag-down close. Distances are in px and velocities in px per second, positive downward. @public */
export type DragToCloseTuning = {
  /** The fraction of the panel's height a drag must cover to close. */
  distanceFraction: number;
  /** The least distance in px that closes, however short the panel. */
  minDistancePx: number;
  /** The least distance in px a flick must cover to close. */
  flickMinDistancePx: number;
  /** The release velocity at or above which a drag of at least `flickMinDistancePx` closes. */
  flickVelocity: number;
  /** A negative velocity: a release moving back up at least this fast cancels the close. */
  cancelVelocity: number;
  /** The movement in px on either axis that decides whether a drag locks to the horizontal or the vertical. */
  directionLockPx: number;
  /** Milliseconds a pointer may lie still before the release: a lift after that long has no velocity, so only distance can close. */
  restMs: number;
  /** Milliseconds the release looks back for its velocity. */
  velocityWindowMs: number;
  /** The spring a released drag that does not close returns with. */
  snapBack: {
    /** The spring's stiffness. */
    stiffness: number;
    /** The spring's damping. */
    damping: number;
  };
};

/** The timing of a panel's slide in and out of the row. @public */
export type SlideTuning = {
  /** Seconds an enter or exit slide takes. */
  durationSec: number;
  /** The slide's easing, as the four numbers of a cubic bezier. */
  ease: readonly [number, number, number, number];
  /** Seconds a closing panel takes to leave. */
  closeExitSeconds: number;
  /** The curve a closing panel leaves along, for a drag close and a button close alike: a Motion name or a cubic bezier. */
  closeExitEase: CloseExitEase;
  /** The curve a row scroll glides along: 'cubic-out' (today's), 'linear' or a cubic bezier. Independent of `ease`. */
  glideEase: GlideEase;
};

/** A cubic bezier as its four numbers, x1 and x2 within [0, 1]. @public */
export type BezierEase = readonly [number, number, number, number];

/** The curve a closing panel leaves along. @public */
export type CloseExitEase = 'easeIn' | 'easeOut' | 'easeInOut' | 'linear' | BezierEase;

/** The curve a row scroll glides along; 'cubic-out' is 1 - (1 - t)^3. @public */
export type GlideEase = 'cubic-out' | 'linear' | BezierEase;

/** How the row scrolls while a dragged panel is held near the window's edge. @public */
export type EdgeScrollTuning = {
  /** The width in px of the band at each window edge that scrolls the row. */
  zonePx: number;
  /** The fastest scroll speed, in px per second. */
  maxPxPerSec: number;
  /** The interval in ms between scroll steps when reduced motion is requested. */
  reducedStepMs: number;
};

/**
 * When a panel's header, grab bar and footer show, and the numbers a host's header icon row animates with. A workspace
 * sets it; every panel reads the workspace's value. @public
 */
export type ChromeTuning = {
  /** 'always' draws the chrome of every panel; 'hover-or-active' draws it fully only on a panel that is hovered, focused, active or being dragged. */
  mode: 'always' | 'hover-or-active';
  /** Milliseconds the chrome takes to fade in or out; 0 when animation is off. */
  fadeMs: number;
  /** Milliseconds a host's header icon row takes to slide in. The library draws no such row; it only carries the number. */
  slideMs: number;
  /** Pixels that icon row travels while it slides in. */
  slidePx: number;
  /** Milliseconds that icon row stays open after the pointer leaves the header. */
  graceMs: number;
};

/** The tuning leaves a panel may set; each may also be set on the workspace. @public */
export type PanelTuning = {
  /** Overrides for the drag-down close numbers. */
  dragToClose?: { [K in keyof DragToCloseTuning]?: DragToCloseTuning[K] };
  /** Overrides for the slide timing. */
  slide?: { [K in keyof SlideTuning]?: SlideTuning[K] };
  /** The fraction of a neighbour's span a dragged panel must cover to cross it, above 0 and at most 1. */
  hopFraction?: number;
  /** Overrides for the edge-scroll numbers. */
  edgeScroll?: { [K in keyof EdgeScrollTuning]?: EdgeScrollTuning[K] };
};

/** The per-panel leaves plus the ten that only the workspace sets. @public */
export type WorkspaceTuning = PanelTuning & {
  /** The gap between panels in px, an integer from 0 to 200. */
  rowGap?: number;
  /** Milliseconds of quiet before the workspace is saved. */
  saveQuietMs?: number;
  /** Milliseconds after a row scroll gesture during which further wheel events are ignored. */
  gestureLockMs?: number;
  /** Milliseconds without a wheel event that end a row scroll gesture, so the next event steps whatever its size. */
  gestureQuietMs?: number;
  /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
  returnTieBreak?: 'latest-first' | 'earliest-first' | 'row-order';
  /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
  dropTieBreak?: 'leftmost' | 'rightmost';
  /** What the row's own scroll input does: 'step', 'free' or 'off'. */
  rowGesture?: 'step' | 'free' | 'off';
  /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
  initialScroll?: 'start' | 'end' | 'root' | { panel: PanelId };
  /** Overrides for the chrome numbers: when header, grab bar and footer show, and the fade and slide timing. */
  chrome?: { [K in keyof ChromeTuning]?: ChromeTuning[K] };
  /**
   * The most unpinned parkable panels the row keeps live, an integer of 1 or more, or `null` for no cap. Panels beyond
   * it park, the leftmost first; a pinned panel neither counts nor parks for it. In a row that scrolls, the window width
   * no longer decides how many are live.
   */
  maxLivePanels?: number | null;
};

/** The per-panel tuning leaves after resolving, every one present. @public */
export type ResolvedPanelTuning = {
  /** The drag-down close numbers. */
  dragToClose: DragToCloseTuning;
  /** The slide timing. */
  slide: SlideTuning;
  /** The fraction of a neighbour's span a dragged panel must cover to cross it. */
  hopFraction: number;
  /** The edge-scroll numbers. */
  edgeScroll: EdgeScrollTuning;
};

/** Every tuning leaf after resolving: the per-panel ones plus the workspace-only ones. @public */
export type ResolvedWorkspaceTuning = ResolvedPanelTuning & {
  /** The gap between panels in px, an integer from 0 to 200. */
  rowGap: number;
  /** Milliseconds of quiet before the workspace is saved. */
  saveQuietMs: number;
  /** Milliseconds after a row scroll gesture during which further wheel events are ignored. */
  gestureLockMs: number;
  /** Milliseconds without a wheel event that end a row scroll gesture, so the next event steps whatever its size. */
  gestureQuietMs: number;
  /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
  returnTieBreak: 'latest-first' | 'earliest-first' | 'row-order';
  /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
  dropTieBreak: 'leftmost' | 'rightmost';
  /** What the row's own scroll input does: 'step', 'free' or 'off'. */
  rowGesture: 'step' | 'free' | 'off';
  /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
  initialScroll: 'start' | 'end' | 'root' | { panel: PanelId };
  /** The chrome numbers: when header, grab bar and footer show, and the fade and slide timing. */
  chrome: ChromeTuning;
  /** The most unpinned parkable panels the row keeps live, or `null` for no cap. */
  maxLivePanels: number | null;
};

/** Deeply frozen; every key is present after a resolve except `title`. @public */
export type ResolvedPanelSettings = {
  readonly [K in Exclude<keyof SettingValues, 'title'>]: SettingValues[K];
} & {
  /** The panel's title; absent when no layer set one. */
  readonly title?: string;
  /** The panel's tuning leaves, every one present. */
  readonly tuning: ResolvedPanelTuning;
  /** The panel's header buttons by slot id. */
  readonly headerButtons: { readonly [id: string]: HeaderButton };
};

/** What one settings layer may hold. A tuning key at the workspace-defaults layer is refused. @public */
export type PanelSettings = { [K in keyof SettingValues]?: SettingValues[K] } & {
  /** Tuning leaves to override. */
  tuning?: PanelTuning;
  /** Header buttons by slot id; `false` removes a slot an earlier layer set. */
  headerButtons?: { [id: string]: HeaderButton | false };
};

/** A diagnostic that never throws: what a rule or a restore did and which setting it concerns. @public */
export type SettingNote = {
  /** A short name for what happened, such as `park-lever-inert`. */
  code: string;
  /** The panel the note concerns, when it concerns one. */
  panelId?: PanelId;
  /** The setting the note concerns, when it concerns one. */
  key?: string;
  /** A readable description. */
  message: string;
};

/** Recorded only for a template, host or instance layer that asked for what a rule or a scope forbids. @public */
export type SettingConflict = {
  /** The setting that was asked for. */
  readonly key: string;
  /** The layer that asked for it. */
  readonly layer: 'template' | 'host' | 'instance';
  /** Why the ask was not honoured: a rule forced another value, the key is set at the wrong scope, or a view may not set it. */
  readonly kind: 'forced' | 'wrong-scope' | 'not-view-settable';
  /** The value the layer asked for. */
  readonly asked: unknown;
  /** The value that applies instead. */
  readonly applied: unknown;
  /** The coupling rule that forced the value, for kind 'forced'. */
  readonly rule?: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';
  /** The setting or condition behind the rule, for kind 'forced'. */
  readonly forcedBy?: string;
  /** A readable description. */
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
  /** The setting's catalog name. */
  readonly name: CatalogName;
  /** The catalog group the setting belongs to, such as 'permissions' or 'motion'. */
  readonly group: string;
  /** The values the setting accepts, as worded in DESIGN.md. */
  readonly values: string;
  /** The library default, as worded in DESIGN.md. */
  readonly default: string;
  /** Who may set the setting. */
  readonly scope: SettingScope;
  /** Whether a view may set it, through the host layer. */
  readonly viewSettable: boolean;
  /** Whether the setting names a behaviour that already existed ('today') or a new one ('new'). */
  readonly exists: 'today' | 'new';
  /** The catalog's identifier for the part of the library that owns the setting. */
  readonly ownerEntry: string;
  /** How a change is accepted: the class of its on-configure rule and the calls that accept it. */
  readonly configure: {
    /** The class word of the setting's on-configure rule. */
    readonly cls: SettingClass;
    /** The configure calls that accept the setting. */
    readonly doors: readonly SettingDoor[];
  };
}

/** The layers one resolve reads, lowest to highest: workspace, template, host, instance, user. @public */
export type PanelSettingsLayers = {
  /** The workspace defaults. */
  workspace?: PanelSettings;
  /** The template's own settings. */
  template?: PanelSettings;
  /** The settings given to this one panel. */
  instance?: PanelSettings;
  /** What a view asked for in a host-bag `create`. */
  host?: PanelSettings;
  /** The person's own overrides. */
  user?: PanelUserLayer;
};

/** The person's own overrides: the only three things a person can change about a panel. @public */
export type PanelUserLayer = {
  /** The tier the person chose. */
  formFactor?: FormFactor;
  /** Where the person put the panel. */
  anchor?: AnchorRequest;
  /** Whether the person made the panel parkable. */
  parkable?: boolean;
};

/** Options for `resolvePanelSettings`. @public */
export type ResolveOptions = {
  /** Resolve the root panel, which its coupling rule makes unparkable, unclosable, undraggable and unplaceable. Default false. */
  root?: boolean;
  /** Drop an invalid key from the instance and user layers with a note instead of throwing. Default false. */
  lenient?: boolean;
};

/** What a resolve returns. `source` is keyed by catalog name, a tuning leaf dotted, headerButtons as one key. @public */
export type PanelSettingsResolution = {
  /** The resolved settings, deeply frozen. */
  value: ResolvedPanelSettings;
  /** The layer each value came from. */
  source: Record<string, SourceLayer>;
  /** What a template, host or instance layer asked for that a rule or scope overrode. */
  conflicts: SettingConflict[];
  /** Diagnostics raised during the resolve. */
  notes: SettingNote[];
  /** The person's anchor for the panel, when they set one. */
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
    values: 'object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50, directionLockPx integer [2, 64], restMs integer [1, 1000], velocityWindowMs integer [16, 1000], snapBack { stiffness [50, 2000], damping [5, 200] }; panel or workspace',
    default: '0.25, 80, 40, 700, -300, 8, 50, 100, { 520, 42 } (DRAG_CLOSE; DIRECTION_LOCK_PX; DRAG_REST_MS; DRAG_VELOCITY_WINDOW_MS)',
    scope: 'panel or workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['instance', 'tuning'] },
  },
  {
    name: 'tuning.slide',
    group: 'tuning',
    values: "object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5], closeExitEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers), glideEase ('cubic-out', 'linear' or four numbers); panel or workspace",
    default: "0.4, [0.2, 0, 0, 1], 0.18, 'easeIn', 'cubic-out' (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds, CLOSE_EXIT_EASE, GLIDE_EASE)",
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
    default: '60',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-visibility-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.gestureQuietMs',
    group: 'tuning',
    values: 'integer ms >= 1 (workspace only)',
    default: '150',
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
  {
    name: 'tuning.chrome',
    group: 'tuning',
    values: "object: mode 'always' or 'hover-or-active', fadeMs integer [0, 10000], slideMs integer [0, 10000], slidePx integer [0, 200], graceMs integer [0, 10000] (workspace only)",
    default: "always, 120, 140, 8, 250 (CHROME)",
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.maxLivePanels',
    group: 'tuning',
    values: 'integer >= 1, or null for no cap (workspace only)',
    default: 'null (no cap)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-max-live-panels',
    configure: { cls: 'NOW', doors: ['tuning'] },
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
  readonly [K in Exclude<keyof SettingValues, 'draggable' | 'placeable' | 'listed' | 'clearable' | 'title'>]: SettingValues[K];
} & {
  /** No header buttons by default. */
  readonly headerButtons: { readonly [id: string]: HeaderButton };
  /** Always undefined: a title has no default. */
  readonly title: undefined;
};

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
    restMs: DRAG_REST_MS,
    velocityWindowMs: DRAG_VELOCITY_WINDOW_MS,
    snapBack: { stiffness: SNAP_BACK_SPRING.stiffness, damping: SNAP_BACK_SPRING.damping },
  },
  slide: { durationSec: SLIDE_DURATION_SEC, ease: [...SLIDE_EASE] as unknown as readonly [number, number, number, number], closeExitSeconds: SLIDE_CLOSE_EXIT_SECONDS, closeExitEase: CLOSE_EXIT_EASE, glideEase: GLIDE_EASE },
  hopFraction: HOP_FRACTION,
  edgeScroll: { zonePx: EDGE_SCROLL_ZONE_PX, maxPxPerSec: EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: EDGE_SCROLL_REDUCED_STEP_MS },
  saveQuietMs: SAVE_QUIET_MS,
  gestureLockMs: GESTURE_LOCK_MS,
  gestureQuietMs: GESTURE_QUIET_MS,
  returnTieBreak: RETURN_TIE_BREAK as ResolvedWorkspaceTuning['returnTieBreak'],
  dropTieBreak: DROP_TIE_BREAK as ResolvedWorkspaceTuning['dropTieBreak'],
  rowGesture: ROW_GESTURE as ResolvedWorkspaceTuning['rowGesture'],
  initialScroll: INITIAL_SCROLL as ResolvedWorkspaceTuning['initialScroll'],
  chrome: { ...CHROME },
  maxLivePanels: null,
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

const stringOrFunction = (v: unknown): boolean => typeof v === 'string' || typeof v === 'function';
const booleanOrFunction = (v: unknown): boolean => typeof v === 'boolean' || typeof v === 'function';

function headerButtonSlotProblem(slot: Plain): string | undefined {
  if (!('icon' in slot) || slot.icon === undefined) return 'icon is required';
  if (typeof slot.label === 'function') {
    // A function label is judged when it runs: an empty result hides the slot at runtime.
  } else if (typeof slot.label !== 'string' || slot.label === '') return 'label must be a non-empty string or a function';
  if (typeof slot.onClick !== 'function') return 'onClick must be a function';
  if (slot.side !== undefined && slot.side !== 'start' && slot.side !== 'end') return "side must be 'start' or 'end'";
  if (slot.order !== undefined && (typeof slot.order !== 'number' || !Number.isFinite(slot.order))) return 'order must be a finite number';
  if (slot.pressed !== undefined && typeof slot.pressed !== 'function') return 'pressed must be a function';
  if (slot.description !== undefined && !stringOrFunction(slot.description)) return 'description must be a string or a function';
  if (slot.tooltip !== undefined && !stringOrFunction(slot.tooltip)) return 'tooltip must be a string or a function';
  if (slot.disabled !== undefined && !booleanOrFunction(slot.disabled)) return 'disabled must be a boolean or a function';
  if (slot.hidden !== undefined && !booleanOrFunction(slot.hidden)) return 'hidden must be a boolean or a function';
  if (slot.sx !== undefined && (typeof slot.sx !== 'function' && (typeof slot.sx !== 'object' || slot.sx === null))) return 'sx must be an object, an array or a function';
  return undefined;
}

const headerButtonsProblem: Check = (v) => {
  if (!isPlain(v)) return 'expected a map of slot id to slot or false';
  for (const id of Object.keys(v)) {
    if (!SLOT_ID.test(id)) return `slot id '${id}' must be 1-32 characters of a-z, 0-9 and -`;
    const slot = v[id];
    if (slot === false) continue;
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) return `slot '${id}' must be a slot object or false`;
    const problem = headerButtonSlotProblem(slot as Plain);
    if (problem !== undefined) return `slot '${id}': ${problem}`;
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

export type TuningLeaf = keyof WorkspaceTuning;

function bezierProblem(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(finite)) return 'expected four finite numbers';
  const [x1, , x2] = v as number[];
  return (x1 as number) < 0 || (x1 as number) > 1 || (x2 as number) < 0 || (x2 as number) > 1 ? 'the first and third numbers must be from 0 to 1' : undefined;
}

/** Members of the three object-valued leaves, each with the check for its value. */
const TUNING_MEMBER_CHECKS: Record<'dragToClose' | 'slide' | 'edgeScroll' | 'chrome', Record<string, Check>> = {
  dragToClose: {
    distanceFraction: num(0.05, 1),
    minDistancePx: num(8, Infinity),
    flickMinDistancePx: num(8, Infinity),
    flickVelocity: num(100, Infinity),
    cancelVelocity: num(-Infinity, -50),
    directionLockPx: integer(2, 64),
    restMs: integer(1, 1000),
    velocityWindowMs: integer(16, 1000),
    snapBack: (v) => {
      if (!isPlain(v)) return 'expected { stiffness, damping }';
      for (const key of Object.keys(v)) if (key !== 'stiffness' && key !== 'damping') return `unknown key '${key}'`;
      return num(50, 2000)(v.stiffness) !== undefined ? 'stiffness must be a number from 50 to 2000' : num(5, 200)(v.damping) !== undefined ? 'damping must be a number from 5 to 200' : undefined;
    },
  },
  slide: {
    durationSec: num(0, 10),
    ease: bezierProblem,
    closeExitSeconds: num(0, 5),
    closeExitEase: (v) => (typeof v === 'string' ? oneOf('easeIn', 'easeOut', 'easeInOut', 'linear')(v) : bezierProblem(v)),
    glideEase: (v) => (typeof v === 'string' ? oneOf('cubic-out', 'linear')(v) : bezierProblem(v)),
  },
  edgeScroll: {
    zonePx: integer(8, 200),
    maxPxPerSec: integer(100, 5000),
    reducedStepMs: integer(100, 5000),
  },
  chrome: {
    mode: oneOf('always', 'hover-or-active'),
    fadeMs: integer(0, 10000),
    slideMs: integer(0, 10000),
    slidePx: integer(0, 200),
    graceMs: integer(0, 10000),
  },
};

const TUNING_SCALAR_CHECKS: Record<'hopFraction' | 'rowGap' | 'saveQuietMs' | 'gestureLockMs' | 'gestureQuietMs' | 'returnTieBreak' | 'dropTieBreak' | 'rowGesture' | 'initialScroll' | 'maxLivePanels', Check> = {
  hopFraction: num(0, 1, { minOpen: true }),
  rowGap: integer(0, 200),
  saveQuietMs: integer(0),
  gestureLockMs: integer(0),
  gestureQuietMs: integer(1),
  returnTieBreak: oneOf('latest-first', 'earliest-first', 'row-order'),
  dropTieBreak: oneOf('leftmost', 'rightmost'),
  rowGesture: oneOf('step', 'free', 'off'),
  initialScroll: (v) => {
    if (v === 'start' || v === 'end' || v === 'root') return undefined;
    if (isPlain(v) && Object.keys(v).length === 1 && nonEmptyString(v.panel)) return undefined;
    return "expected 'start', 'end', 'root' or { panel: a non-empty id }";
  },
  maxLivePanels: (v) => (v === null ? undefined : integer(1)(v)),
};

const isObjectLeaf = (leaf: string): leaf is keyof typeof TUNING_MEMBER_CHECKS => Object.hasOwn(TUNING_MEMBER_CHECKS, leaf);
const isTuningLeaf = (leaf: string): leaf is TuningLeaf => isObjectLeaf(leaf) || Object.hasOwn(TUNING_SCALAR_CHECKS, leaf);

/** What a tuning leaf's value holds: the members that passed, and one problem per member that did not. */
export function checkTuningLeaf(leaf: TuningLeaf, value: unknown): { accepted: unknown; problems: { key: string; problem: string }[] } {
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

/**
 * Whether a view may ask for `key` as `value`: a view may place itself only by an explicit anchor and enter only from it,
 * so those two keys are checked by value.
 * @internal
 */
export const viewMayAsk = (key: string, value: unknown): boolean => {
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
function merge(accepted: Record<AskLayer, Accepted>, userParkable: boolean | undefined, workspaceTuning: WorkspaceTuning | undefined): State {
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
  for (const leaf of ['dragToClose', 'slide', 'hopFraction', 'edgeScroll'] as const) {
    const given = workspaceTuning?.[leaf];
    const kept = given === undefined ? undefined : checkTuningLeaf(leaf, given).accepted;
    if (kept === undefined) continue;
    if (leaf === 'hopFraction') tuning.hopFraction = kept as number;
    else Object.assign(tuning[leaf], kept as Plain);
    source[`tuning.${leaf}`] = 'workspace';
  }

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
  return resolveUnderTuning(layers, options, undefined);
}

/**
 * `resolvePanelSettings` with the workspace's four per-panel tuning leaves as the layer under the template: what a panel
 * resolves to inside a workspace. Leaves the workspace does not set keep the library default.
 * @internal
 */
export function resolveUnderTuning(layers: PanelSettingsLayers, options: ResolveOptions, workspaceTuning: WorkspaceTuning | undefined): PanelSettingsResolution {
  const root = options.root === true;
  const env: Env = { lenient: options.lenient === true, notes: [], pending: [] };
  const accepted = {} as Record<AskLayer, Accepted>;
  for (const layer of ASK_LAYERS) accepted[layer] = checkLayer(layer, layers[layer], env);
  const user = checkUser(layers.user, env);

  let state = merge(accepted, undefined, workspaceTuning);
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
    state = merge(accepted, userParkable, workspaceTuning);
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

// ---------------------------------------------------------------------------
// Entries: the settings an entry carries and the one writer of the fields that mirror them
// ---------------------------------------------------------------------------

/** What an entry with no settings starts from: every library default, the derived ones included. */
const LEGACY_BASE: ResolvedPanelSettings = resolvePanelSettings().value;
const FIXED_COLUMN_TIERS: readonly FormFactor[] = Object.freeze(['phone'] as const);

/**
 * The settings `p` behaves under: `p.settings` itself when it has them, else values read from the fields a
 * hand-built entry carries (`locked`, `collapsible`, `listed`, `layer`, `anchoredEnter`, `formFactor`, `title`),
 * with every other key at its library default. A hand-built entry keeps its original parking and a fixed column
 * cannot be dragged, placed or resized.
 * @internal
 */
export function effective(p: PanelWindow | PanelRowEntry): ResolvedPanelSettings {
  if (p.settings !== undefined) return p.settings;
  const parkable = p.collapsible;
  const legacy: ResolvedPanelSettings = {
    ...LEGACY_BASE,
    closable: !p.locked,
    parkable,
    draggable: parkable,
    placeable: parkable,
    resizable: parkable,
    formFactors: parkable ? LEGACY_BASE.formFactors : FIXED_COLUMN_TIERS,
    clearable: parkable && !p.locked,
    listed: 'listed' in p ? p.listed : parkable,
    overflow: parkable ? 'park' : 'scroll',
    layer: p.layer ?? 'base',
    enterFrom: p.anchoredEnter === true ? 'anchor' : 'auto',
    formFactor: p.formFactor ?? 'phone',
    ...(p.title !== undefined ? { title: p.title } : {}),
  };
  return Object.freeze(legacy);
}

/** The note raised when a hold keeps an unlisted panel parked: nothing in the list can show it, so only code can. @internal */
export const holdUnlistedNote = (panelId: PanelId): SettingNote => ({ code: 'hold-unlisted', panelId, key: 'listed', message: 'listed: a held hide of an unlisted panel can be shown by code only' });

/** The name readers use for an entry: its `key` when created from settings, its `id` when hand-built. @internal */
export const panelKey = (p: PanelWindow | PanelRowEntry): string => p.key ?? p.id;

// Literals, not panelTiers.ts's TIER_SIZES: this file may value-import only its two leaf modules, and
// test/settings-enforcement-permissions.test.ts holds these equal to the table the row prices widths from.
const TIER_SIZE_LITERALS: Readonly<Record<FormFactor, PanelSize>> = {
  phone: { formFactor: 'phone', width: 390, height: 700 },
  tablet: { formFactor: 'tablet', width: 768, height: 'fill' },
  desktop: { formFactor: 'desktop', width: 1200, height: 'fill' },
};

/**
 * `entry` with `resolved` written into the fields that mirror it, and into no other. 'create' writes them all,
 * the tier and its size, `key` and `live` included (`startVisibility` 'parked' parks the entry; 'live' never revives
 * one the caller handed in parked); 'reconfigure' writes only what a later change may move and leaves the tier,
 * size, anchor, `live`, `hostData` and `key` as the person and the row left them.
 * @internal
 */
export function applyTemplate(entry: PanelWindow, resolved: ResolvedPanelSettings, mode: 'create' | 'reconfigure'): PanelWindow {
  const title = resolved.title !== undefined ? { title: resolved.title } : {};
  if (mode === 'reconfigure') {
    return {
      ...entry,
      locked: !resolved.closable,
      ...(resolved.parkable !== entry.collapsible ? { collapsible: resolved.parkable } : {}),
      listed: resolved.listed,
      layer: resolved.layer,
      anchoredEnter: resolved.enterFrom === 'anchor',
      ...title,
      settings: resolved,
    };
  }
  return {
    ...entry,
    locked: !resolved.closable,
    collapsible: resolved.parkable,
    live: entry.live && resolved.startVisibility === 'live',
    listed: resolved.listed,
    layer: resolved.layer,
    anchoredEnter: resolved.enterFrom === 'anchor',
    formFactor: resolved.formFactor,
    size: entry.size?.formFactor === resolved.formFactor ? entry.size : { ...TIER_SIZE_LITERALS[resolved.formFactor] },
    ...title,
    settings: resolved,
    key: entry.key ?? entry.id,
  };
}
