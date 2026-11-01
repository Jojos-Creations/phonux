/**
 * The settings model: every behaviour a panel can differ in is a named setting with a library default, a
 * descriptor in one catalog, and one pure resolver that interprets every layer. Nothing here is rendered or
 * mounted. The only value imports are the two leaf modules below, so this file can be read (and the resolver
 * called) with no React, no Motion and no row code loaded; test/panel-settings-catalog.test.ts holds that line.
 */
import type * as React from 'react';
import type { CssStyle } from './cssStyle.js';
import type { PanelRowEntry } from './panelRowEntry.js';
import type { PanelState, ViewHandle } from './panelTemplate.js';
import type { PanelWindow } from './panelWindow.js';
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
export type AddPlacement = 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed' | 'order' | {
    /** Immediately left of this panel. */
    before: PanelId;
} | {
    /** Immediately right of this panel. */
    after: PanelId;
} | {
    /** The given anchor, with its `panel` required. */
    anchor: AnchorRequest & {
        panel: PanelId;
    };
};
/** What the row may do with a panel when the open panels do not all fit: scroll past it, or park it. @public */
export type Overflow = 'scroll' | 'park';
/**
 * How a panel enters the row. 'auto' takes the workspace's `tuning.defaultEnterFrom`, whose own 'auto' slides in from the side
 * the row picks (an engine mark, else the anchor's side for a panel entering via its anchor, else the right). 'anchor'
 * slides in from its anchor's side whenever it enters. 'left', 'right', 'top' and 'bottom' slide in from that side,
 * 'fade' fades in where it rests, and 'expand' scales the panel up from its center point, width and height together,
 * while its neighbours part to make room; the center keeps to where they part. Every entrance takes the workspace's `slide` timing.
 * @public
 */
export type EnterFrom = 'auto' | 'left' | 'right' | 'anchor' | 'top' | 'bottom' | 'fade' | 'expand';
/**
 * How a panel leaves the row, when it parks and when it closes. 'auto' takes the workspace's `tuning.defaultExitTo`, whose own
 * 'auto' parks off the side the row picks and closes downward along `slide.closeExitSeconds` and `slide.closeExitEase`.
 * 'left', 'right', 'top' and 'bottom' slide out to that side, 'fade' fades out where it rests, and 'shrink' scales
 * the panel down to its center point, width and height together, while its neighbours close up; the center keeps to
 * where they meet, so in a centered row it holds still. Those take the workspace's `slide` timing.
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
    onClick: (handle: ViewHandle, c: HeaderButtonContext & {
        /** Announces `text` to assistive technology. */
        announce(text: string): void;
    }) => void | Promise<unknown>;
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
export type PinningWhenNotLive = PinWhenNotLive | {
    /** The answer for a parked panel. */
    parked?: PinWhenNotLive;
    /** The answer for a hidden panel. */
    hidden?: PinWhenNotLive;
    /** The answer for a closed panel: refuse, or apply on its next show. */
    closed?: 'refuse' | 'apply-on-next-show';
};
/** Which layer a resolved value came from. A rule overrides the rest and 'derived' marks a value filled from another resolved field. @public */
export type SourceLayer = 'library' | 'workspace' | 'template' | 'host' | 'instance' | 'user' | 'derived' | 'forced';
/** The settings whose value is one plain member; the catalog's other names are headerButtons and the tuning leaves. @public */
export type SettingValues = {
    /** Whether a person can close the panel; false removes the drag-down close and the close button. The developer's own `close()` is not limited by it. */
    closable: boolean;
    /** Whether the panel can be parked; false makes it a fixed column, which needs one slot. */
    parkable: boolean;
    /** Whether a person can move the panel, by a reorder drag or by dropping it at a placement. The developer's own `move()`, `place()` and pin with a placement are not limited by it. Defaults to the resolved `parkable`. */
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
    /** Where the row scrolls the panel to on its next open, show or click. */
    scrollOnOpen: ScrollOnOpen;
    /** Whether the row follows the panel when it is moved, placed, resized, pinned, unpinned or its layout reset. */
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
    /** What `pin()` and `unpin()` do, and what the panel reads as pinned. */
    pinning: Pinning;
    /** What a pin change does to a panel that is not live. */
    pinningWhenNotLive: PinningWhenNotLive;
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
    dragToClose?: {
        [K in keyof DragToCloseTuning]?: DragToCloseTuning[K];
    };
    /** Overrides for the slide timing. */
    slide?: {
        [K in keyof SlideTuning]?: SlideTuning[K];
    };
    /** The fraction of a neighbour's span a dragged panel must cover to cross it, above 0 and at most 1. */
    hopFraction?: number;
    /** Overrides for the edge-scroll numbers. */
    edgeScroll?: {
        [K in keyof EdgeScrollTuning]?: EdgeScrollTuning[K];
    };
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
    /** How many `slide.durationSec` the container width must hold still before the row's centring margin glides again; 0 settles at once. */
    resizeSettleSlides?: number;
    /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
    returnTieBreak?: 'latest-first' | 'earliest-first' | 'row-order';
    /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
    dropTieBreak?: 'leftmost' | 'rightmost';
    /** What the row's own scroll input does: 'step' or 'off'. */
    rowGesture?: 'step' | 'off';
    /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
    initialScroll?: 'start' | 'end' | 'root' | {
        panel: PanelId;
    };
    /** Overrides for the chrome numbers: when header, grab bar and footer show, and how they fade. */
    chrome?: {
        [K in keyof ChromeTuning]?: ChromeTuning[K];
    };
    /**
     * The most unpinned parkable panels the row keeps live, an integer of 1 or more, or `null` for no cap. Panels beyond
     * it park the way they do when the window is full; a pinned panel neither counts nor parks for it. In a row that
     * scrolls, the window width does not decide how many are live. No row the document shows holds more, the first included.
     * Raising it (or setting `null`) through `configureTuning` brings back the most recently capacity-parked panels, up to the new
     * value, in one commit; a panel the host hid stays hidden, and scrolling, closing, resizing or an equal or lower value return none.
     */
    maxLivePanels?: number | null;
    /**
     * Removed: a stepping row always leaves every panel at its size and the window edge cuts the neighbour of a stop. 'off'
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
};
/** Every tuning leaf after resolving, each present. @public */
export type ResolvedWorkspaceTuning = {
    /** The drag-down close numbers. */
    dragToClose: DragToCloseTuning;
    /** The slide timing. */
    slide: SlideTuning;
    /** The fraction of a neighbour's span a dragged panel must cover to cross it. */
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
    /** How many `slide.durationSec` the container width must hold still before the row's centring margin glides again; 0 settles at once. */
    resizeSettleSlides: number;
    /** Which of two equally ranked parked panels returns first: the latest parked, the earliest parked, or the earlier in the row. */
    returnTieBreak: 'latest-first' | 'earliest-first' | 'row-order';
    /** Which of two equally ranked panels is parked first when the row loses room: the leftmost or the rightmost. */
    dropTieBreak: 'leftmost' | 'rightmost';
    /** What the row's own scroll input does: 'step' or 'off'. */
    rowGesture: 'step' | 'off';
    /** Where the row starts scrolled: its 'start', its 'end', the 'root', or a given panel. */
    initialScroll: 'start' | 'end' | 'root' | {
        panel: PanelId;
    };
    /** The chrome numbers: when header, grab bar and footer show, and how they fade. */
    chrome: ChromeTuning;
    /** The most unpinned parkable panels the row keeps live, or `null` for no cap. */
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
};
/** Deeply frozen; every key is present after a resolve except `title`. @public */
export type ResolvedPanelSettings = {
    readonly [K in Exclude<keyof SettingValues, 'title'>]: SettingValues[K];
} & {
    /** The panel's title; absent when no layer set one. */
    readonly title?: string;
    /** The panel's header buttons by slot id. */
    readonly headerButtons: {
        readonly [id: string]: HeaderButton;
    };
};
/** What one settings layer may hold. Tuning is the workspace's, so a layer carrying `tuning` is refused (a saved instance layer loads with a note). @public */
export type PanelSettings = {
    [K in keyof SettingValues]?: SettingValues[K];
} & {
    /** Header buttons by slot id; `false` removes a slot an earlier layer set. */
    headerButtons?: {
        [id: string]: HeaderButton | false;
    };
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
/** Structural equality for settings values; functions and other objects compare by identity. */
export declare function sameSettingsValue(a: unknown, b: unknown): boolean;
/**
 * Every setting as data: its values, default, owning entry, the class of its on_configure rule and the calls
 * that accept it. Deeply frozen.
 * @public
 */
export declare const PANEL_SETTINGS_CATALOG: readonly SettingDescriptor[];
/** Every setting that has its own default. The three derived ones follow `parkable` and `closable`; `title` has none. @public */
export type LibraryPanelDefaults = {
    readonly [K in Exclude<keyof SettingValues, 'movable' | 'listed' | 'clearable' | 'title'>]: SettingValues[K];
} & {
    /** No header buttons by default. */
    readonly headerButtons: {
        readonly [id: string]: HeaderButton;
    };
    /** Always undefined: a title has no default. */
    readonly title: undefined;
};
/**
 * The library default of every setting that has one. `title` is present with no value so that the keys of this
 * object, the tuning names and the four derived keys together name every catalog row.
 * @public
 */
export declare const LIBRARY_PANEL_DEFAULTS: LibraryPanelDefaults;
/**
 * The library default of every tuning leaf. The object-valued leaves (dragToClose, slide, edgeScroll, chrome) are each
 * their own frozen object.
 * @public
 */
export declare const LIBRARY_TUNING_DEFAULTS: ResolvedWorkspaceTuning;
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
 * What the per-panel settings the library removed do now: each is fixed at the value it had as a default, for every
 * panel. A template that still names one is told once in development and the value is ignored; a later release refuses it.
 * @internal
 */
export declare const FIXED: FixedBehaviour;
export type TuningLeaf = keyof WorkspaceTuning;
/** What a tuning leaf's value holds: the members that passed, and one problem per member that did not. */
export declare function checkTuningLeaf(leaf: TuningLeaf, value: unknown): {
    accepted: unknown;
    problems: {
        key: string;
        problem: string;
    }[];
};
/**
 * Whether a view may ask for `key` as `value`: a view may place itself only by an explicit anchor and enter only from it,
 * so those keys are checked by value.
 * @internal
 */
export declare const viewMayAsk: (key: string, value: unknown) => boolean;
/**
 * Resolves the settings of one panel from its layers. Pure: the same layers give an equal result, the layers are
 * never changed, and the value is deeply frozen. An unknown key, a wrong type or an out-of-range value throws
 * PanelManagerError('invalid-settings') naming the layer and key; with `lenient`, the instance and user layers
 * (a saved file's own) drop such a key with a note instead. A conflict is recorded only for a template, host or
 * instance layer that asked for what a rule or a scope forbids.
 * @public
 */
export declare function resolvePanelSettings(layers?: PanelSettingsLayers, options?: ResolveOptions): PanelSettingsResolution;
/**
 * The settings `p` behaves under: `p.settings` itself when it has them, else values read from the fields a
 * hand-built entry carries (`collapsible`, `listed`, `layer`, `anchoredEnter`, `slots`, `title`),
 * with every other key at its library default. A hand-built entry keeps its original parking and a fixed column
 * cannot be closed, moved or resized by a person.
 * @internal
 */
export declare function effective(p: PanelWindow | PanelRowEntry): ResolvedPanelSettings;
/** The note raised when a hold keeps an unlisted panel parked: nothing in the list can show it, so only code can. @internal */
export declare const holdUnlistedNote: (panelId: PanelId) => SettingNote;
/** The name readers use for an entry: its `key` when created from settings, its `id` when hand-built. @internal */
export declare const panelKey: (p: PanelWindow | PanelRowEntry) => string;
/**
 * `entry` with `resolved` written into the fields that mirror it, and into no other. 'create' writes them all,
 * the slots, `key` and `live` included (`startVisibility` 'parked' parks the entry; 'live' never revives
 * one the caller handed in parked); 'reconfigure' writes only what a later change may move and leaves the slots,
 * anchor, `live`, `hostData` and `key` as the person and the row left them.
 * @internal
 */
export declare function applyTemplate(entry: PanelWindow, resolved: ResolvedPanelSettings, mode: 'create' | 'reconfigure'): PanelWindow;
