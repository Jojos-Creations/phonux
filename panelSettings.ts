/**
 * The settings model: every behavior a panel can differ in is a named setting with a library default, a
 * descriptor in one catalog, and one pure resolver that interprets every layer. Nothing here is rendered or
 * mounted. The only value imports are the two leaf modules below, so this file can be read (and the resolver
 * called) with no React, no Motion and no row code loaded; test/panel-settings-catalog.test.ts holds that line.
 */

import type * as React from 'react';
import type { CssStyle } from './cssStyle.js';
import { reportOnce } from './panelApiLevel.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelRowEntry } from './panelRowEntry.js';
import type { PanelState, ViewHandle } from './panelTemplate.js';
import type { PanelWindow } from './panelWindow.js';
import {
  ALL_SLOTS,
  CHROME,
  RESIZE_SETTLE_SLIDES,
  CLOSE_EXIT_EASE,
  DRAG_CLOSE_NUMBERS,
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
  FAST_SCROLL,
  SAVE_QUIET_MS,
  PHONE_FIT,
  PHONE_FIT_MIN,
  PHONE_FIT_MAX,
  SLIDE_CLOSE_EXIT_SECONDS,
  SLIDE_DURATION_SEC,
  SLIDE_EASE,
} from './rowConstants.js';

// ---------------------------------------------------------------------------
// Declared types
// ---------------------------------------------------------------------------

/** A panel's id, which is its key and its only public id: a singleton's template id, an explicit instance's given id, or `${templateId}~${suffix}` where the suffix comes from the workspace's `newId` (a counter unless a custom one is given). An explicit id follows the template-id rules and may not equal a registered template's id; 'all' is reserved. @public */
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

/**
 * How a panel enters the row. 'auto' takes the workspace's `tuning.defaultEnterFrom`, whose own 'auto' slides in from the side
 * the row picks (an engine mark, else the anchor's side for a panel entering via its anchor, else the right). 'anchor'
 * slides in from its anchor's side whenever it enters. 'left', 'right', 'top' and 'bottom' slide in from that side,
 * 'fade' fades in where it rests, and 'expand' scales the panel up, width and height together, while its neighbors part to
 * make room: an open grows from its center point, which keeps to where they part, and a reveal grows out of the edge on the
 * side it comes in from, which holds still. Every entrance takes the workspace's `slide` timing.
 * @public
 */
export type EnterFrom = 'auto' | 'left' | 'right' | 'anchor' | 'top' | 'bottom' | 'fade' | 'expand';

/**
 * How a panel leaves the row, when it parks and when it closes. 'auto' takes the workspace's `tuning.defaultExitTo`, whose own
 * 'auto' parks off the side the row picks and closes downward along `slide.closeExitSeconds` and `slide.closeExitEase`.
 * 'left', 'right', 'top' and 'bottom' slide out to that side, 'fade' fades out where it rests, and 'shrink' scales
 * the panel down, width and height together, while its neighbors close up: a close shrinks to its center point, which
 * keeps to where they meet, and a park shrinks into the edge on the side it leaves by, which holds still. Those take the
 * workspace's `slide` timing.
 * @public
 */
export type ExitTo = 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'shrink';

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

/** What the icon form and the text form of a title-bar button share. The label is the accessible name and is never empty. @public */
export type HeaderButtonBase = {
  /** The button's accessible name, and its visible text in the text form; or a function that picks it; never empty. */
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
  /** Extra styles for the button: CSS properties in camelCase, with nested keys for selectors. */
  sx?: CssStyle;
};

/** The icon form of a title-bar button: the `icon` key is present, and the label is its accessible name only. @public */
export type HeaderButtonIconForm = HeaderButtonBase & {
  /** The button's icon, or a function that picks it from the panel's current state. A function that returns null draws an empty button. */
  icon: React.ReactNode | ((c: HeaderButtonContext) => React.ReactNode);
};

/** The text form of a title-bar button: no `icon` key, and the label is drawn as the button's text. @public */
export type HeaderButtonTextForm = HeaderButtonBase & {
  /** Leave `icon` out; its presence, even as undefined, is the icon form. */
  icon?: never;
};

/** One generic title-bar button slot: the icon form or the text form, told apart by the `icon` key. @public */
export type HeaderButton = HeaderButtonIconForm | HeaderButtonTextForm;

/** Which layer a resolved value came from. A rule overrides the rest and 'derived' marks a value filled from another resolved field. @public */
export type SourceLayer = 'library' | 'workspace' | 'template' | 'host' | 'instance' | 'user' | 'derived' | 'forced';

/** The settings whose value is one plain member; the catalog's other names are headerButtons and the tuning leaves. @public */
export type SettingValues = {
  /** Whether a person can close the panel; false removes the drag-down close and the close button. The developer's own `close()` is not limited by it. */
  closable: boolean;
  /** Whether the panel can be parked; false makes it a fixed column, which needs one slot. */
  parkable: boolean;
  /** Whether a person can move the panel, by a reorder drag or by dropping it at a placement. The developer's own `move()` and `place()` are not limited by it. Defaults to the resolved `parkable`. */
  movable: boolean;
  /** Whether another panel's drag can cross this panel. */
  crossable: boolean;
  /** Whether a person can change the panel's slot count. The developer's own `setSlots()` is not limited by it. */
  resizable: boolean;
  /** Whether clear-all closes the panel. Defaults to the resolved `parkable` and `closable`. */
  clearable: boolean;
  /** Whether a view's host-bag `create` may name the template. Template scope. */
  hostCreatable: boolean;
  /** Whether the dot bar draws this panel's dot hollow (the one an app marks, such as History). Template scope; the library reads the flag, never a name. */
  hollowDot: boolean;
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
  /** Whether a panel parked for room returns by itself when room appears ('auto') or only when shown ('manual'). */
  capacityReturn: 'auto' | 'manual';
  /** What the row may do with the panel when the open panels do not all fit. */
  overflow: Overflow;
  /** Which hidden panels a row scroll gesture may reveal: 'edges', 'any' or 'never'. */
  revealOnScroll: 'edges' | 'any' | 'never';
  /** Which edge the panel stays at while the row scrolls: 'off' lets it scroll away, 'left' keeps it at the left edge and 'right' at the right, with the other panels sliding under it. 'both' is in the strip while it is in view, and holds at whichever edge the scroll takes it past. A held panel that cannot fit beside the others, or sits in a row that does not scroll, lets go and scrolls normally. */
  edgeHold: 'off' | 'left' | 'right' | 'both';
  /** How the panel's content follows a size glide. 'reveal' lays it out once at the glide's larger size and the panel's eased edge clips it, so the content is resized when a grow starts and when a shrink ends. 'reflow' lays it out at the new size when the glide starts and draws it scaled to the eased size. */
  resize: 'reveal' | 'reflow';
  /** Where the row scrolls the panel to on its next open, show or click. */
  scrollOnOpen: ScrollOnOpen;
  /** Whether the row follows the panel when it is moved, placed, resized or its layout reset. */
  scrollOnMove: ScrollOnMove;
  /** What `toggleVisibility()` does to a closed declared panel: nothing ('ignore') or reopen it ('reopen'). */
  toggleWhenClosed: 'ignore' | 'reopen';
  /** What `show()` does to a closed declared panel: refuse it or reopen it. */
  showWhenClosed: 'refuse' | 'reopen';
  /** Where the panel lands when it is added, and when the layout is reset. */
  placeOnAdd: AddPlacement;
  /** Where the panel lands when it is shown; 'in-place' leaves it where it is. */
  placeOnShow: AddPlacement | 'in-place';
  /** The stacking tier of the panel's slot. */
  layer: 'base' | 'raised';
  /** How the panel enters the row (`EnterFrom`); 'auto' takes the workspace's `tuning.defaultEnterFrom`. */
  enterFrom: EnterFrom;
  /** How the panel leaves the row when it parks or closes (`ExitTo`); 'auto' takes the workspace's `tuning.defaultExitTo`. */
  exitTo: ExitTo;
  /** How many phone-panel widths wide the panel is, a whole number from 1 to 64 (the most any panel can have); the row draws at most the slots that fit. It starts a panel at that width and never resizes one that already exists. Default 1. */
  slots: number;
  /** The most slots the panel may take, a whole number from 1 to 64. Default: 64, which the window's fit caps in practice. */
  maxSlots: number;
  /** The panel's title. */
  title: string;
  /** Whether the panel is restored as it was saved ('saved'), live or parked. */
  restoreVisibility: 'saved' | 'live' | 'parked';
  /** Whether a closed panel stays closed ('stay-closed') or returns at the next launch ('return-next-launch'). */
  afterClose: 'stay-closed' | 'return-next-launch';
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

/** The curve of the chrome fade: a Motion ease name or a cubic bezier. @public */
export type FadeEase = 'easeIn' | 'easeOut' | 'easeInOut' | 'linear' | BezierEase;

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

/** When a panel's header, grab bar and footer show, and how they fade. A workspace sets it; every panel reads the workspace's value. @public */
export type ChromeTuning = {
  /** 'always' draws the chrome of every panel; 'hover-or-active' draws it fully only on a panel that is hovered, focused, active or being dragged. */
  mode: 'always' | 'hover-or-active';
  /** Milliseconds the chrome takes to fade in or out; 0 when animation is off. */
  fadeMs: number;
  /** The curve of that fade: 'easeIn', 'easeOut', 'easeInOut', 'linear' or four cubic-bezier numbers. */
  fadeEase: FadeEase;
};

/** The workspace's tuning: the row-wide numbers, set through `createWorkspace({ tuning })` and `configureTuning`. A panel carries none. @public */
export type WorkspaceTuning = {
  /** Overrides for the drag-down close numbers. */
  dragToClose?: { [K in keyof DragToCloseTuning]?: DragToCloseTuning[K] };
  /** Overrides for the slide timing. */
  slide?: { [K in keyof SlideTuning]?: SlideTuning[K] };
  /** The fraction of a neighbor's span a dragged panel must cover to cross it, above 0 and at most 1. */
  hopFraction?: number;
  /** Overrides for the edge-scroll numbers. */
  edgeScroll?: { [K in keyof EdgeScrollTuning]?: EdgeScrollTuning[K] };
  /** The gap between panels in px, an integer from 0 to 200. */
  rowGap?: number;
  /** The room above the row in px, an integer from 0 to 400: the only control for a standalone workspace's row top room. Taken as given and never raised, so a value under 40 (the header's height and its gap) can push panel headers off the top of the screen. Null: the default room (in a column, the column band, the cell's top inset and the row gap), never less than 40 so headers stay on screen. */
  rowTop?: number | null;
  /** The phone's height under `phoneFit: 'fit'`: 'fit' scales it with the width; 'auto' makes the frame as tall as the row's room, never shorter than the fit. */
  phoneHeight?: 'fit' | 'auto';
  /** Milliseconds of quiet before the workspace is saved. */
  saveQuietMs?: number;
  /** Milliseconds after a row scroll gesture during which further wheel events are ignored. */
  gestureLockMs?: number;
  /** Milliseconds without a wheel event that end a row scroll gesture, so the next event steps whatever its size. */
  gestureQuietMs?: number;
  /** How many `slide.durationSec` the container width must hold still before the phone size is fitted again; 0 settles at once. */
  resizeSettleSlides?: number;
  /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
  returnTieBreak?: 'latest-first' | 'earliest-first' | 'row-order';
  /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
  dropTieBreak?: 'leftmost' | 'rightmost';
  /** What the row's own scroll input does: 'step' or 'off'. */
  rowGesture?: 'step' | 'off';
  /**
   * How a run of fast steps or a far dot moves the row. 'coalesce': the steps add to one target the row glides to in one
   * motion, each glide shorter as input speeds up, down to a quarter second. 'jump': the same, but a move of more than a
   * window fades the row out, moves it unseen and fades it back in.
   */
  fastScroll?: 'coalesce' | 'jump';
  /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
  initialScroll?: 'start' | 'end' | 'root' | { panel: PanelId };
  /** Overrides for the chrome numbers: when header, grab bar and footer show, and how they fade. */
  chrome?: { [K in keyof ChromeTuning]?: ChromeTuning[K] };
  /**
   * The most parkable panels the row keeps live, an integer of 1 or more, or `null` for no cap. Panels beyond
   * it park the way they do when the window is full. In a row that
   * scrolls, the window width does not decide how many are live. No row the document shows holds more, the first included.
   * Raising it (or setting `null`) through `configureTuning` brings back the most recently capacity-parked panels, up to the new
   * value, in one commit; a panel the host hid stays hidden, and scrolling, closing, resizing or an equal or lower value return none.
   */
  maxLivePanels?: number | null;
  /**
   * Removed: a stepping row always leaves every panel at its size and the window edge cuts the neighbor of a stop. 'off'
   * is accepted; 'visible' and 'hidden' log one console warning each and act as 'off'.
   * @deprecated Has no effect; remove it. The next release refuses 'visible' and 'hidden'.
   */
  shrinkOutOfView?: 'off' | 'visible' | 'hidden';
  /**
   * Whether the default mount fits the phone size to the window: 'off' draws the host's preferred size as it is, 'fit'
   * scales it (width and height together, whole pixels) so whole slots fill the window, within `phoneFitMin` to `phoneFitMax`.
   */
  phoneFit?: 'off' | 'fit';
  /** The smallest scale the fit gives the phone, a number above 0 and up to 1, as a fraction of the preferred size. */
  phoneFitMin?: number;
  /** The largest scale the fit gives the phone, a number from 1 to 4, as a fraction of the preferred size. */
  phoneFitMax?: number;
  /** How a panel whose own `enterFrom` is 'auto' enters the row; any value of `EnterFrom`, and 'auto' is the row's own choice of side. Default 'expand'. */
  defaultEnterFrom?: EnterFrom;
  /** How a panel whose own `exitTo` is 'auto' leaves the row; any value of `ExitTo`, and 'auto' parks sideways and closes downward. Default 'shrink'. */
  defaultExitTo?: ExitTo;
  /**
   * Whether a panel wider than one phone goes back to one phone width when the person scrolls the row or another panel
   * becomes active, and back to its own width the next time it is active. Its own width is what the workspace saves. Default false.
   */
  shrinkUnfocused?: boolean;
};

/** Every tuning leaf after resolving, each present. @public */
export type ResolvedWorkspaceTuning = {
  /** The drag-down close numbers. */
  dragToClose: DragToCloseTuning;
  /** The slide timing. */
  slide: SlideTuning;
  /** The fraction of a neighbor's span a dragged panel must cover to cross it. */
  hopFraction: number;
  /** The edge-scroll numbers. */
  edgeScroll: EdgeScrollTuning;
  /** The gap between panels in px, an integer from 0 to 200. */
  rowGap: number;
  /** The room above the row in px, or null for the default room. */
  rowTop: number | null;
  /** The phone's height under `phoneFit: 'fit'`: 'fit' or 'auto'. */
  phoneHeight: 'fit' | 'auto';
  /** Milliseconds of quiet before the workspace is saved. */
  saveQuietMs: number;
  /** Milliseconds after a row scroll gesture during which further wheel events are ignored. */
  gestureLockMs: number;
  /** Milliseconds without a wheel event that end a row scroll gesture, so the next event steps whatever its size. */
  gestureQuietMs: number;
  /** How many `slide.durationSec` the container width must hold still before the phone size is fitted again; 0 settles at once. */
  resizeSettleSlides: number;
  /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
  returnTieBreak: 'latest-first' | 'earliest-first' | 'row-order';
  /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
  dropTieBreak: 'leftmost' | 'rightmost';
  /** What the row's own scroll input does: 'step' or 'off'. */
  rowGesture: 'step' | 'off';
  /** How a run of fast steps or a far dot moves the row: one coalesced glide, or a fade past a move of more than a window. */
  fastScroll: 'coalesce' | 'jump';
  /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
  initialScroll: 'start' | 'end' | 'root' | { panel: PanelId };
  /** The chrome numbers: when header, grab bar and footer show, and how they fade. */
  chrome: ChromeTuning;
  /** The most parkable panels the row keeps live, or `null` for no cap. */
  maxLivePanels: number | null;
  /** Whether the default mount fits the phone size to the window: 'off' or 'fit'. */
  phoneFit: 'off' | 'fit';
  /** The smallest scale of the preferred phone size the fit gives. */
  phoneFitMin: number;
  /** The largest scale of the preferred phone size the fit gives. */
  phoneFitMax: number;
  /** How a panel whose own `enterFrom` is 'auto' enters the row. */
  defaultEnterFrom: EnterFrom;
  /** How a panel whose own `exitTo` is 'auto' leaves the row. */
  defaultExitTo: ExitTo;
  /** Whether a panel wider than one phone rests at one phone width while it is not the active one. */
  shrinkUnfocused: boolean;
};

/** Deeply frozen; every key is present after a resolve except `title`. @public */
export type ResolvedPanelSettings = {
  readonly [K in Exclude<keyof SettingValues, 'title'>]: SettingValues[K];
} & {
  /** The panel's title; absent when no layer set one. */
  readonly title?: string;
  /** The panel's header buttons by slot id. */
  readonly headerButtons: { readonly [id: string]: HeaderButton };
};

/** What one settings layer may hold. Tuning is the workspace's, so a layer carrying `tuning` is refused (a saved instance layer loads with a note). @public */
export type PanelSettings = { [K in keyof SettingValues]?: SettingValues[K] } & {
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
  /** Why the ask was not honored: a rule forced another value, the key is set at the wrong scope, or a view may not set it. */
  readonly kind: 'forced' | 'wrong-scope' | 'not-view-settable';
  /** The value the layer asked for. */
  readonly asked: unknown;
  /** The value that applies instead. */
  readonly applied: unknown;
  /** The coupling rule that forced the value, for kind 'forced'. */
  readonly rule?: 'C1' | 'C2' | 'C4' | 'C5';
  /** The setting or condition behind the rule, for kind 'forced'. */
  readonly forcedBy?: string;
  /** A readable description. */
  readonly message: string;
};

/** Every catalog name: a setting key, `headerButtons` as one name, and a dotted name per tuning leaf. @public */
export type CatalogName = keyof PanelSettings | `tuning.${Exclude<keyof WorkspaceTuning, 'shrinkOutOfView'>}`;

/** The class word that opens a descriptor's on_configure rule. @public */
export type SettingClass = 'NOW' | 'NEXT' | 'STATE' | 'SCOPE';

/** The configure call that accepts a key: configure(id), configureTemplate or configureTuning. @public */
export type SettingDoor = 'instance' | 'template' | 'tuning';

/** Who may set a setting: one panel, a template, or the whole workspace. @public */
export type SettingScope = 'instance' | 'template' | 'workspace';

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
  /** Whether a view may set it with `ViewHandle.configure`, which also checks the value the view asks for. */
  readonly viewSettable: boolean;
  /** Whether the setting names a behavior that already existed ('today') or a new one ('new'). */
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

/** The person's own overrides: what a person can change about a panel. @public */
export type PanelUserLayer = {
  /** The slot count the person chose. */
  slots?: number;
  /** Where the person put the panel. */
  anchor?: AnchorRequest;
  /** Whether the person made the panel parkable. */
  parkable?: boolean;
};

/** Options for `resolvePanelSettings`. @public */
export type ResolveOptions = {
  /** Resolve the root panel, which its coupling rule makes unparkable and unclosable; its `movable` gates only a person's drag and is false until a layer sets it. Default false. */
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
    viewSettable: true,
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
    name: 'movable',
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
    name: 'resizable',
    group: 'permissions',
    values: 'true, false',
    default: 'true',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-permission-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'clearable',
    group: 'permissions',
    values: 'true, false',
    default: 'derived: parkable and closable',
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
    name: 'hollowDot',
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
    default: 'live',
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
    name: 'revealOnScroll',
    group: 'scrolling',
    values: 'edges, any, never',
    default: 'edges',
    scope: 'instance',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'edgeHold',
    group: 'scrolling',
    values: 'off, left, right, both',
    default: 'off',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'resize',
    group: 'motion',
    values: 'reveal, reflow',
    default: 'reflow',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-engine-placement-and-motion-settings',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'scrollOnOpen',
    group: 'scrolling',
    values: 'into-view, start, center, none',
    default: 'into-view',
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
    default: 'follow',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
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
    values: 'auto, left, right, anchor, top, bottom, fade, expand',
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
    values: 'auto, left, right, top, bottom, fade, shrink',
    default: 'auto',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'lib-enter-expand',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'slots',
    group: 'identity',
    values: 'integer >= 1',
    default: '1',
    scope: 'instance',
    viewSettable: true,
    exists: 'new',
    ownerEntry: 'phonux-slot-sizing-resizable-root-v3',
    configure: { cls: 'NEXT', doors: ['instance'] },
  },
  {
    name: 'maxSlots',
    group: 'permissions',
    values: 'integer >= 1',
    default: 'every visible slot',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-slot-sizing-resizable-root-v3',
    configure: { cls: 'STATE', doors: ['instance'] },
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
    name: 'headerButtons',
    group: 'header',
    values: 'object: slot id (1-32 chars a-z0-9-) to HeaderButton or false; HeaderButton = { icon?, label, onClick, side?, order?, pressed?, description?, tooltip?, disabled?, hidden?, sx? } (section 6); with icon the label is the accessible name, without it the label is the text drawn',
    default: '{} (no button drawn)',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-header-buttons',
    configure: { cls: 'NOW', doors: ['instance'] },
  },
  {
    name: 'restoreVisibility',
    group: 'persistence',
    values: 'saved, live, parked',
    default: 'saved',
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
    default: 'stay-closed',
    scope: 'instance',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-workspace-attach-and-snapshot',
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
    values: 'object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50 (workspace only)',
    default: '0.25, 80, 40, 700, -300 (DRAG_CLOSE)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.slide',
    group: 'tuning',
    values: "object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5], closeExitEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers), glideEase ('cubic-out', 'linear' or four numbers) (workspace only)",
    default: "0.6, [0.4, 0, 0.2, 1], 0.18, 'easeIn', 'cubic-out' (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds, CLOSE_EXIT_EASE, GLIDE_EASE)",
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.hopFraction',
    group: 'tuning',
    values: 'number in (0, 1] (workspace only)',
    default: '0.5',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.edgeScroll',
    group: 'tuning',
    values: 'object: zonePx integer [8, 200], maxPxPerSec integer [100, 5000], reducedStepMs integer [100, 5000] (workspace only)',
    default: '48, 900, 500 (the numbers live in rowConstants.ts)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-edge-scroll-while-dragging',
    configure: { cls: 'NEXT', doors: ['tuning'] },
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
    default: '30',
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
    name: 'tuning.resizeSettleSlides',
    group: 'tuning',
    values: 'number [0, 10], multiplies slide.durationSec (workspace only)',
    default: '1/3',
    scope: 'workspace',
    viewSettable: false,
    exists: 'today',
    ownerEntry: 'phonux-engine-tuning-look-settings',
    configure: { cls: 'NOW', doors: ['tuning'] },
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
    values: 'step, off (workspace only)',
    default: 'step',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.fastScroll',
    group: 'tuning',
    values: 'coalesce, jump (workspace only)',
    default: 'coalesce',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.initialScroll',
    group: 'tuning',
    values: 'start, end, root, { panel: PanelId } (workspace only)',
    default: 'start (the library default)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-row-scroll-gesture-and-requests',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.chrome',
    group: 'tuning',
    values: "object: mode 'always' or 'hover-or-active', fadeMs integer [0, 10000], fadeEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers, x1 and x2 in [0,1]) (workspace only)",
    default: "always, 120, easeOut (CHROME)",
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
  {
    name: 'tuning.rowTop',
    group: 'tuning',
    values: 'integer px 0 to 400, or null (workspace only)',
    default: 'null (the default room)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'core-app-row-api',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.phoneHeight',
    group: 'tuning',
    values: "'fit', 'auto' (workspace only)",
    default: "'fit'",
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'core-app-row-api',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.phoneFit',
    group: 'tuning',
    values: 'off, fit (workspace only)',
    default: 'off (PHONE_FIT)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-fit-phone-to-screen-v3',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.phoneFitMin',
    group: 'tuning',
    values: 'number above 0 and up to 1 (workspace only)',
    default: '0.82 (PHONE_FIT_MIN)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-fit-phone-to-screen-v3',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.phoneFitMax',
    group: 'tuning',
    values: 'number from 1 to 4 (workspace only)',
    default: '1.13 (PHONE_FIT_MAX)',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'phonux-fit-phone-to-screen-v3',
    configure: { cls: 'NOW', doors: ['tuning'] },
  },
  {
    name: 'tuning.defaultEnterFrom',
    group: 'tuning',
    values: 'auto, left, right, anchor, top, bottom, fade, expand (workspace only)',
    default: 'expand',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'lib-enter-expand',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.defaultExitTo',
    group: 'tuning',
    values: 'auto, left, right, top, bottom, fade, shrink (workspace only)',
    default: 'shrink',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'lib-enter-expand',
    configure: { cls: 'NEXT', doors: ['tuning'] },
  },
  {
    name: 'tuning.shrinkUnfocused',
    group: 'tuning',
    values: 'boolean (workspace only)',
    default: 'false',
    scope: 'workspace',
    viewSettable: false,
    exists: 'new',
    ownerEntry: 'lib-shrink-unfocused',
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

const DERIVED_DEFAULT_KEYS = ['movable', 'listed', 'clearable'] as const;
type DerivedDefaultKey = (typeof DERIVED_DEFAULT_KEYS)[number];

/** Every setting that has its own default. The three derived ones follow `parkable` and `closable`; `title` has none. @public */
export type LibraryPanelDefaults = {
  readonly [K in Exclude<keyof SettingValues, 'movable' | 'listed' | 'clearable' | 'title'>]: SettingValues[K];
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
  hostCreatable: true,
  hollowDot: false,
  multiple: false,
  maxInstances: 'unlimited' as number | 'unlimited',
  startVisibility: 'live' as const,
  hideStickiness: 'sticky' as const,
  capacityReturn: 'auto' as const,
  overflow: 'scroll' as Overflow,
  revealOnScroll: 'edges' as const,
  edgeHold: 'off' as const,
  resize: 'reflow' as const,
  scrollOnOpen: 'into-view' as ScrollOnOpen,
  scrollOnMove: 'follow' as ScrollOnMove,
  toggleWhenClosed: 'ignore' as const,
  showWhenClosed: 'refuse' as const,
  placeOnAdd: 'row-end' as AddPlacement,
  placeOnShow: 'in-place' as AddPlacement | 'in-place',
  layer: 'base' as const,
  enterFrom: 'auto' as EnterFrom,
  exitTo: 'auto' as ExitTo,
  slots: 1,
  maxSlots: ALL_SLOTS,
  title: undefined,
  headerButtons: {},
  restoreVisibility: 'saved' as const,
  afterClose: 'stay-closed' as const,
});

/**
 * The library default of every tuning leaf. The object-valued leaves (dragToClose, slide, edgeScroll, chrome) are each
 * their own frozen object.
 * @public
 */
export const LIBRARY_TUNING_DEFAULTS: ResolvedWorkspaceTuning = freezeClone({
  rowGap: ROW_GAP,
  rowTop: null,
  phoneHeight: 'fit',
  dragToClose: {
    distanceFraction: DRAG_CLOSE_NUMBERS.distanceFraction,
    minDistancePx: DRAG_CLOSE_NUMBERS.minDistancePx,
    flickMinDistancePx: DRAG_CLOSE_NUMBERS.flickMinDistancePx,
    flickVelocity: DRAG_CLOSE_NUMBERS.flickVelocity,
    cancelVelocity: DRAG_CLOSE_NUMBERS.cancelVelocity,
  },
  slide: { durationSec: SLIDE_DURATION_SEC, ease: [...SLIDE_EASE] as unknown as readonly [number, number, number, number], closeExitSeconds: SLIDE_CLOSE_EXIT_SECONDS, closeExitEase: CLOSE_EXIT_EASE, glideEase: GLIDE_EASE },
  hopFraction: HOP_FRACTION,
  edgeScroll: { zonePx: EDGE_SCROLL_ZONE_PX, maxPxPerSec: EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: EDGE_SCROLL_REDUCED_STEP_MS },
  saveQuietMs: SAVE_QUIET_MS,
  gestureLockMs: GESTURE_LOCK_MS,
  gestureQuietMs: GESTURE_QUIET_MS,
  resizeSettleSlides: RESIZE_SETTLE_SLIDES,
  returnTieBreak: RETURN_TIE_BREAK as ResolvedWorkspaceTuning['returnTieBreak'],
  dropTieBreak: DROP_TIE_BREAK as ResolvedWorkspaceTuning['dropTieBreak'],
  rowGesture: ROW_GESTURE as ResolvedWorkspaceTuning['rowGesture'],
  fastScroll: FAST_SCROLL as ResolvedWorkspaceTuning['fastScroll'],
  initialScroll: INITIAL_SCROLL as ResolvedWorkspaceTuning['initialScroll'],
  chrome: { ...CHROME },
  maxLivePanels: null,
  phoneFit: PHONE_FIT as ResolvedWorkspaceTuning['phoneFit'],
  phoneFitMin: PHONE_FIT_MIN,
  phoneFitMax: PHONE_FIT_MAX,
  defaultEnterFrom: 'expand',
  defaultExitTo: 'shrink',
  shrinkUnfocused: false,
});

// ---------------------------------------------------------------------------
// Validators: each returns a problem description, or undefined when the value is acceptable
// ---------------------------------------------------------------------------

type Check = (v: unknown) => string | undefined;

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

const maxInstancesProblem: Check = (v) => (v === 'unlimited' ? undefined : integer(1)(v) === undefined ? undefined : "expected an integer of at least 1 or 'unlimited'");

const stringOrFunction = (v: unknown): boolean => typeof v === 'string' || typeof v === 'function';
const booleanOrFunction = (v: unknown): boolean => typeof v === 'boolean' || typeof v === 'function';

function headerButtonSlotProblem(slot: Plain): string | undefined {
  if ('icon' in slot && slot.icon === undefined) return 'icon must not be undefined; leave it out for a text button';
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
  if (slot.sx !== undefined && (typeof slot.sx !== 'object' || slot.sx === null || Array.isArray(slot.sx))) return 'sx must be a style object';
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

/** What the removed per-panel settings do, typed as the values they once took so the code that reads them keeps its branches. @internal */
export interface FixedBehaviour {
  readonly hideWhenLast: 'allow' | 'refuse';
  readonly returnPriority: number;
  readonly evictionRank: number;
  readonly evictionOrder: 'least-recently-touched';
  readonly scrollOnDrag: ScrollOnDrag;
  readonly viewState: 'keep' | 'reset-on-park';
  readonly keepMounted: boolean;
  readonly frame: 'auto' | 'none';
  readonly placeOnReturn: AddPlacement | 'in-place';
  readonly placeFallback: 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed';
  readonly undoPlacement: 'old-slot' | AddPlacement;
  readonly closeExit: 'down' | 'left' | 'right';
  readonly animated: boolean;
  readonly persist: 'saved' | 'session';
  readonly rememberLayout: boolean;
  readonly undoWindowMs: number;
  readonly reportClose: boolean;
  readonly snapshot: 'both' | 'park' | 'close' | 'never';
}

/**
 * What the per-panel settings this version removed do now: each is fixed at the value it had as a default, for every
 * panel. A template that still names one is told once in development and the value is ignored; a later rc refuses it.
 * @internal
 */
export const FIXED: FixedBehaviour = Object.freeze({
  hideWhenLast: 'allow',
  returnPriority: 0,
  evictionRank: 0,
  evictionOrder: 'least-recently-touched',
  scrollOnDrag: 'edge',
  viewState: 'keep',
  keepMounted: false,
  frame: 'auto',
  placeOnReturn: 'in-place',
  placeFallback: 'row-end',
  undoPlacement: 'old-slot',
  closeExit: 'down',
  animated: true,
  persist: 'saved',
  rememberLayout: true,
  undoWindowMs: 10000,
  reportClose: true,
  snapshot: 'both',
});

function reportRemovedValue(key: string, value: string): void {
  reportOnce(`removed:${key}:${value}`, `phonux: the ${key} value '${value}' was removed`, () => ["it is ignored and the setting behaves as if it were 'off'", 'the next rc refuses it with invalid-settings']);
}

function reportRemovedKey(layer: string, key: string): void {
  reportOnce(`removed:${key}`, `phonux: the ${layer} setting '${key}' was removed`, () => [`it is ignored and the panel behaves as if it were ${JSON.stringify(FIXED[key as keyof typeof FIXED])}`, 'the next rc refuses it with invalid-settings']);
}

/** The keys `movable` replaced. */
const MERGED_INTO_MOVABLE: ReadonlySet<string> = new Set(['draggable', 'placeable']);

/**
 * A saved layer's `draggable` and `placeable`, as the one `movable` they became: only when both are present and
 * agree, because either alone says nothing about the other half of what `movable` now covers.
 */
function savedMovable(raw: Plain): boolean | undefined {
  const { draggable, placeable } = raw;
  return typeof draggable === 'boolean' && draggable === placeable && raw.movable === undefined ? draggable : undefined;
}

type SettingKey = Exclude<CatalogName, `tuning.${string}`>;

const ENTER_FROM: readonly EnterFrom[] = ['auto', 'left', 'right', 'anchor', 'top', 'bottom', 'fade', 'expand'];
const EXIT_TO: readonly ExitTo[] = ['auto', 'left', 'right', 'top', 'bottom', 'fade', 'shrink'];

const SETTING_CHECKS: Record<SettingKey, Check> = {
  closable: bool,
  parkable: bool,
  movable: bool,
  crossable: bool,
  resizable: bool,
  clearable: bool,
  hostCreatable: bool,
  hollowDot: bool,
  multiple: bool,
  maxInstances: maxInstancesProblem,
  listed: bool,
  startVisibility: oneOf('live', 'parked'),
  hideStickiness: oneOf('sticky', 'until-room'),
  capacityReturn: oneOf('auto', 'manual'),
  overflow: oneOf('scroll', 'park'),
  revealOnScroll: oneOf('edges', 'any', 'never'),
  edgeHold: oneOf('off', 'left', 'right', 'both'),
  resize: oneOf('reveal', 'reflow'),
  scrollOnOpen: oneOf('into-view', 'start', 'center', 'none'),
  scrollOnMove: oneOf('follow', 'none'),
  toggleWhenClosed: oneOf('ignore', 'reopen'),
  showWhenClosed: oneOf('refuse', 'reopen'),
  placeOnAdd: placementProblem,
  placeOnShow: placementOrInPlace,
  layer: oneOf('base', 'raised'),
  enterFrom: oneOf(...ENTER_FROM),
  exitTo: oneOf(...EXIT_TO),
  slots: integer(1, ALL_SLOTS),
  maxSlots: integer(1, ALL_SLOTS),
  title: text,
  headerButtons: headerButtonsProblem,
  restoreVisibility: oneOf('saved', 'live', 'parked'),
  afterClose: oneOf('stay-closed', 'return-next-launch'),
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
    fadeEase: (v) => (typeof v === 'string' ? oneOf('easeIn', 'easeOut', 'easeInOut', 'linear')(v) : bezierProblem(v)),
  },
};

const TUNING_SCALAR_CHECKS: Record<'hopFraction' | 'rowGap' | 'rowTop' | 'phoneHeight' | 'saveQuietMs' | 'gestureLockMs' | 'gestureQuietMs' | 'resizeSettleSlides' | 'returnTieBreak' | 'dropTieBreak' | 'rowGesture' | 'fastScroll' | 'initialScroll' | 'maxLivePanels' | 'shrinkOutOfView' | 'phoneFit' | 'phoneFitMin' | 'phoneFitMax' | 'defaultEnterFrom' | 'defaultExitTo' | 'shrinkUnfocused', Check> = {
  hopFraction: num(0, 1, { minOpen: true }),
  rowGap: integer(0, 200),
  rowTop: (v) => (v === null ? undefined : integer(0, 400)(v)),
  phoneHeight: oneOf('fit', 'auto'),
  saveQuietMs: integer(0),
  gestureLockMs: integer(0),
  gestureQuietMs: integer(1),
  resizeSettleSlides: num(0, 10),
  returnTieBreak: oneOf('latest-first', 'earliest-first', 'row-order'),
  dropTieBreak: oneOf('leftmost', 'rightmost'),
  rowGesture: oneOf('step', 'off'),
  fastScroll: oneOf('coalesce', 'jump'),
  initialScroll: (v) => {
    if (v === 'start' || v === 'end' || v === 'root') return undefined;
    if (isPlain(v) && Object.keys(v).length === 1 && nonEmptyString(v.panel)) return undefined;
    return "expected 'start', 'end', 'root' or { panel: a non-empty id }";
  },
  maxLivePanels: (v) => (v === null ? undefined : integer(1)(v)),
  shrinkOutOfView: oneOf('off', 'visible', 'hidden'),
  phoneFit: oneOf('off', 'fit'),
  phoneFitMin: num(0, 1, { minOpen: true }),
  phoneFitMax: num(1, 4),
  defaultEnterFrom: oneOf(...ENTER_FROM),
  defaultExitTo: oneOf(...EXIT_TO),
  shrinkUnfocused: bool,
};

const isObjectLeaf = (leaf: string): leaf is keyof typeof TUNING_MEMBER_CHECKS => Object.hasOwn(TUNING_MEMBER_CHECKS, leaf);

/** What a tuning leaf's value holds: the members that passed, and one problem per member that did not. */
export function checkTuningLeaf(leaf: TuningLeaf, value: unknown): { accepted: unknown; problems: { key: string; problem: string }[] } {
  const base = `tuning.${leaf}`;
  if (!isObjectLeaf(leaf)) {
    const problem = TUNING_SCALAR_CHECKS[leaf](value);
    if (problem === undefined && leaf === 'shrinkOutOfView' && value !== 'off') {
      reportRemovedValue(base, value as string);
      return { accepted: 'off', problems: [] };
    }
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

const TEMPLATE_SCOPE_KEYS = new Set<string>(PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.length === 1 && d.configure.doors[0] === 'template').map((d) => d.name));
const VIEW_SETTABLE_KEYS = new Set<string>(PANEL_SETTINGS_CATALOG.filter((d) => d.viewSettable).map((d) => d.name));

/**
 * Whether a view may ask for `key` as `value`: a view may place itself only by an explicit anchor and enter only from it,
 * so those keys are checked by value.
 * @internal
 */
export const viewMayAsk = (key: string, value: unknown): boolean => {
  if (!VIEW_SETTABLE_KEYS.has(key)) return false;
  if (key === 'placeOnAdd') return isPlain(value) && Object.keys(value).length === 1 && value.anchor !== undefined;
  if (key === 'enterFrom') return value === 'anchor';
  if (key === 'closable') return value === false;
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

function checkLayer(layer: AskLayer, raw: unknown, env: Env): Accepted {
  const accepted: Accepted = { flat: new Map() };
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
      reject(layer, 'tuning', 'tuning belongs to the workspace, not to a panel; set it on WorkspaceOptions.tuning', lenientLayer, env.notes);
      continue;
    }
    if (MERGED_INTO_MOVABLE.has(key)) {
      if (!lenientLayer) reject(layer, key, "a setting this version no longer has; set 'movable' instead", false, env.notes);
      else if (savedMovable(raw) !== undefined) {
        if (key === 'draggable') {
          accepted.flat.set('movable', savedMovable(raw));
          env.notes.push({ code: 'invalid-saved-setting', key: 'movable', message: `${layer}.draggable and ${layer}.placeable: settings this version no longer has; read as movable` });
        }
      } else reject(layer, key, 'a setting this version no longer has; set movable instead', true, env.notes);
      continue;
    }
    if (Object.hasOwn(FIXED, key)) {
      if (lenientLayer) reject(layer, key, 'a setting this version no longer has', true, env.notes);
      else reportRemovedKey(layer, key);
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
    accepted.flat.set(key, value);
  }
  return accepted;
}

function checkUser(raw: unknown, env: Env): PanelUserLayer {
  const accepted: { slots?: number; anchor?: AnchorRequest; parkable?: boolean } = {};
  if (raw === undefined) return accepted;
  if (!isPlain(raw)) {
    reject('user', '', 'a settings layer must be an object', env.lenient, env.notes);
    return accepted;
  }
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (value === undefined) continue;
    let problem: string | undefined;
    if (key === 'slots') problem = integer(1, ALL_SLOTS)(value);
    else if (key === 'parkable') problem = bool(value);
    else if (key === 'anchor') problem = anchorProblem(value);
    else problem = 'unknown setting';
    if (problem !== undefined) {
      reject('user', key, problem, env.lenient, env.notes);
      continue;
    }
    if (key === 'slots') accepted.slots = value as number;
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
  drafts: Draft[];
}

/** Merges the accepted layers over the library defaults, lowest first; a later layer's value wins field by field. */
function merge(accepted: Record<AskLayer, Accepted>, userParkable: boolean | undefined): State {
  const values: Plain = { ...LIBRARY_PANEL_DEFAULTS };
  const source: Record<string, SourceLayer> = {};
  for (const key of Object.keys(values)) if (values[key] !== undefined) source[key] = 'library';

  for (const layer of ASK_LAYERS) {
    const { flat } = accepted[layer];
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
  }
  if (userParkable !== undefined) {
    values.parkable = userParkable;
    source.parkable = 'user';
  }
  return { values, source, drafts: [] };
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
  fill(s, 'movable', parkable);
  fill(s, 'listed', parkable);
  fill(s, 'clearable', parkable && s.values.closable === true);

  if (s.values.parkable === false) {
    // The size settings are one group: if the panel's own template, host or instance asked for any of them (History is resizable when the app says so), all stand; otherwise they are forced to one phone slot.
    const fixedSize = [['resizable', false], ['slots', 1], ['maxSlots', 1]] as const;
    const askedForThisPanel = fixedSize.some(([key, applied]) => (s.source[key] === 'template' || s.source[key] === 'host' || s.source[key] === 'instance') && !sameSettingsValue(s.values[key], applied));
    if (!askedForThisPanel) for (const [key, applied] of fixedSize) force(s, key, applied, 'C1', 'parkable');
    force(s, 'overflow', 'scroll', 'C1', 'parkable');
    force(s, 'startVisibility', 'live', 'C1', 'parkable');
    force(s, 'restoreVisibility', 'live', 'C1', 'parkable');
  }
  if (s.values.closable === false) force(s, 'clearable', false, 'C2', 'closable');
  if ((s.values.slots as number) > (s.values.maxSlots as number)) force(s, 'slots', s.values.maxSlots, 'C4', 'maxSlots');
  // `movable` is not forced: code moves the root whatever it says, and it gates only the person's drag. The root is never closed or placed.
}

const PARK_LEVERS = ['capacityReturn'] as const;

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

  // The person's size: their slot count, never above what the panel's own settings allow.
  const personSlots = user.slots === undefined ? undefined : Math.min(user.slots, state.values.maxSlots as number);
  // A person's fixed column needs one slot, so the slot count is settled before their parkable joins as the top layer.
  const width = personSlots ?? (state.values.slots as number);
  let userParkable = user.parkable;
  if (userParkable === false && width !== 1) {
    env.notes.push({ code: 'override-dropped', key: 'parkable', message: `user.parkable: a fixed column needs one slot and this panel resolves to ${width}; dropped` });
    userParkable = undefined;
  }
  if (userParkable !== undefined) {
    state = merge(accepted, userParkable);
    applyRules(state, root);
  }
  if (user.slots !== undefined) {
    // The person's size outvotes what a rule made of the layers' asks, so that conflict no longer describes the result.
    state.drafts = state.drafts.filter((d) => d.key !== 'slots');
    // Held to the maxSlots of the final merge: their own parkable may have lifted a fixed column's cap.
    state.values.slots = Math.min(user.slots, state.values.maxSlots as number);
    state.source.slots = 'user';
  }

  const resolved = state.values;
  const conflicts: SettingConflict[] = [];
  for (const p of env.pending) {
    const applied = resolved[p.key];
    const message = p.kind === 'wrong-scope' ? `${p.key}: the ${p.layer} layer cannot set a template-scope setting; it was ignored` : `${p.key}: a view cannot set this; the ${p.layer} layer's ask was ignored`;
    conflicts.push({ key: p.key, layer: p.layer, kind: p.kind, asked: p.asked, applied, message });
  }
  for (const d of state.drafts) {
    const applied = resolved[d.key];
    conflicts.push({ key: d.key, layer: d.layer, kind: 'forced', asked: d.asked, applied, rule: d.rule, ...(d.forcedBy === undefined ? {} : { forcedBy: d.forcedBy }), message: forcedMessage(d, applied) });
  }

  const notes = env.notes;
  const resizableAsked = state.source.resizable === 'template' || state.source.resizable === 'host' || state.source.resizable === 'instance';
  if (resolved.resizable === true && resizableAsked && resolved.maxSlots === 1) {
    notes.push({ code: 'resizable-capped', key: 'maxSlots', message: `maxSlots: resizable is set by the ${state.source.resizable} layer but maxSlots resolves to 1, so the panel cannot grow; set maxSlots too` });
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

  const result: PanelSettingsResolution = { value: Object.freeze(value) as unknown as ResolvedPanelSettings, source: state.source, conflicts, notes };
  if (user.anchor !== undefined) result.userAnchor = user.anchor;
  return result;
}

// ---------------------------------------------------------------------------
// Entries: the settings an entry carries and the one writer of the fields that mirror them
// ---------------------------------------------------------------------------

/** What an entry with no settings starts from: every library default, the derived ones included. */
const LEGACY_BASE: ResolvedPanelSettings = resolvePanelSettings().value;

/**
 * The settings `p` behaves under: `p.settings` itself when it has them, else values read from the fields a
 * hand-built entry carries (`collapsible`, `listed`, `layer`, `anchoredEnter`, `slots`, `title`),
 * with every other key at its library default. A hand-built entry keeps its original parking and a fixed column
 * cannot be closed, moved or resized by a person.
 * @internal
 */
export function effective(p: PanelWindow | PanelRowEntry): ResolvedPanelSettings {
  if (p.settings !== undefined) return p.settings;
  const parkable = p.collapsible;
  const legacy: ResolvedPanelSettings = {
    ...LEGACY_BASE,
    closable: parkable,
    parkable,
    movable: parkable,
    resizable: parkable,
    clearable: parkable,
    listed: 'listed' in p ? p.listed : parkable,
    overflow: parkable ? 'park' : 'scroll',
    layer: p.layer ?? 'base',
    enterFrom: p.anchoredEnter === true ? 'anchor' : 'auto',
    slots: ('slots' in p ? p.slots : undefined) ?? 1,
    maxSlots: parkable ? ALL_SLOTS : 1,
    ...(p.title !== undefined ? { title: p.title } : {}),
  };
  return Object.freeze(legacy);
}

/** The note raised when a hold keeps an unlisted panel parked: nothing in the list can show it, so only code can. @internal */
export const holdUnlistedNote = (panelId: PanelId): SettingNote => ({ code: 'hold-unlisted', panelId, key: 'listed', message: 'listed: a held hide of an unlisted panel can be shown by code only' });

/** The name readers use for an entry: its `key` when created from settings, its `id` when hand-built. @internal */
export const panelKey = (p: PanelWindow | PanelRowEntry): string => p.key ?? p.id;

/**
 * `entry` with `resolved` written into the fields that mirror it, and into no other. 'create' writes them all,
 * the slots, `key` and `live` included (`startVisibility` 'parked' parks the entry; 'live' never revives
 * one the caller handed in parked); 'reconfigure' writes only what a later change may move and leaves the slots,
 * anchor, `live`, `hostData` and `key` as the person and the row left them.
 * @internal
 */
export function applyTemplate(entry: PanelWindow, resolved: ResolvedPanelSettings, mode: 'create' | 'reconfigure'): PanelWindow {
  const title = resolved.title !== undefined ? { title: resolved.title } : {};
  if (mode === 'reconfigure') {
    return {
      ...entry,
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
    collapsible: resolved.parkable,
    live: entry.live && resolved.startVisibility === 'live',
    listed: resolved.listed,
    layer: resolved.layer,
    anchoredEnter: resolved.enterFrom === 'anchor',
    slots: resolved.slots,
    ...title,
    settings: resolved,
    key: entry.key ?? entry.id,
  };
}
