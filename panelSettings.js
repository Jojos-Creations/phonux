/**
 * The settings model: every behavior a panel can differ in is a named setting with a library default, a
 * descriptor in one catalog, and one pure resolver that interprets every layer. Nothing here is rendered or
 * mounted. The only value imports are the two leaf modules below, so this file can be read (and the resolver
 * called) with no React, no Motion and no row code loaded; test/panel-settings-catalog.test.ts holds that line.
 */
import { reportOnce } from './panelApiLevel.js';
import { PanelManagerError } from './panelManagerError.js';
import { ALL_SLOTS, CHROME, RESIZE_SETTLE_SLIDES, CLOSE_EXIT_EASE, DRAG_CLOSE_NUMBERS, DROP_TIE_BREAK, EDGE_SCROLL_MAX_PX_PER_SEC, EDGE_SCROLL_REDUCED_STEP_MS, EDGE_SCROLL_ZONE_PX, GESTURE_LOCK_MS, GESTURE_QUIET_MS, GLIDE_EASE, HOP_FRACTION, INITIAL_SCROLL, RETURN_TIE_BREAK, ROW_GAP, ROW_GESTURE, SAVE_QUIET_MS, PHONE_FIT, PHONE_FIT_MIN, PHONE_FIT_MAX, SLIDE_CLOSE_EXIT_SECONDS, SLIDE_DURATION_SEC, SLIDE_EASE, } from './rowConstants.js';
const isPlain = (v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
/** A copy of plain data (objects and arrays) that is frozen all the way down; anything else is kept as it is. */
function freezeClone(value) {
    if (Array.isArray(value))
        return Object.freeze(value.map((item) => freezeClone(item)));
    if (isPlain(value)) {
        const copy = {};
        for (const key of Object.keys(value))
            copy[key] = freezeClone(value[key]);
        return Object.freeze(copy);
    }
    return value;
}
/** Structural equality for settings values; functions and other objects compare by identity. */
export function sameSettingsValue(a, b) {
    if (Object.is(a, b))
        return true;
    if (Array.isArray(a))
        return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameSettingsValue(item, b[i]));
    if (isPlain(a) && isPlain(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameSettingsValue(a[k], b[k]));
    }
    return false;
}
const show = (v) => {
    if (typeof v === 'function')
        return 'a function';
    try {
        return JSON.stringify(v) ?? String(v);
    }
    catch {
        return String(v);
    }
};
// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------
/** One descriptor per setting, in a fixed order. test/panel-settings-catalog.test.ts holds it equal to the table in DESIGN.md. */
const CATALOG_ROWS = [
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
        default: '1.25',
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
export const PANEL_SETTINGS_CATALOG = freezeClone(CATALOG_ROWS);
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DERIVED_DEFAULT_KEYS = ['movable', 'listed', 'clearable'];
/**
 * The library default of every setting that has one. `title` is present with no value so that the keys of this
 * object, the tuning names and the four derived keys together name every catalog row.
 * @public
 */
export const LIBRARY_PANEL_DEFAULTS = freezeClone({
    closable: true,
    parkable: true,
    crossable: true,
    resizable: true,
    hostCreatable: true,
    hollowDot: false,
    multiple: false,
    maxInstances: 'unlimited',
    startVisibility: 'live',
    hideStickiness: 'sticky',
    capacityReturn: 'auto',
    overflow: 'scroll',
    revealOnScroll: 'edges',
    edgeHold: 'off',
    resize: 'reflow',
    scrollOnOpen: 'into-view',
    scrollOnMove: 'follow',
    toggleWhenClosed: 'ignore',
    showWhenClosed: 'refuse',
    placeOnAdd: 'row-end',
    placeOnShow: 'in-place',
    layer: 'base',
    enterFrom: 'auto',
    exitTo: 'auto',
    slots: 1,
    maxSlots: ALL_SLOTS,
    title: undefined,
    headerButtons: {},
    restoreVisibility: 'saved',
    afterClose: 'stay-closed',
});
/**
 * The library default of every tuning leaf. The object-valued leaves (dragToClose, slide, edgeScroll, chrome) are each
 * their own frozen object.
 * @public
 */
export const LIBRARY_TUNING_DEFAULTS = freezeClone({
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
    slide: { durationSec: SLIDE_DURATION_SEC, ease: [...SLIDE_EASE], closeExitSeconds: SLIDE_CLOSE_EXIT_SECONDS, closeExitEase: CLOSE_EXIT_EASE, glideEase: GLIDE_EASE },
    hopFraction: HOP_FRACTION,
    edgeScroll: { zonePx: EDGE_SCROLL_ZONE_PX, maxPxPerSec: EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: EDGE_SCROLL_REDUCED_STEP_MS },
    saveQuietMs: SAVE_QUIET_MS,
    gestureLockMs: GESTURE_LOCK_MS,
    gestureQuietMs: GESTURE_QUIET_MS,
    resizeSettleSlides: RESIZE_SETTLE_SLIDES,
    returnTieBreak: RETURN_TIE_BREAK,
    dropTieBreak: DROP_TIE_BREAK,
    rowGesture: ROW_GESTURE,
    initialScroll: INITIAL_SCROLL,
    chrome: { ...CHROME },
    maxLivePanels: null,
    phoneFit: PHONE_FIT,
    phoneFitMin: PHONE_FIT_MIN,
    phoneFitMax: PHONE_FIT_MAX,
    defaultEnterFrom: 'expand',
    defaultExitTo: 'shrink',
    shrinkUnfocused: false,
});
const PLACEMENT_WORDS = ['row-start', 'row-end', 'parkable-start', 'parkable-end', 'after-fixed', 'order'];
const SLOT_ID = /^[a-z0-9-]{1,32}$/;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const bool = (v) => (typeof v === 'boolean' ? undefined : 'expected a boolean');
const text = (v) => (typeof v === 'string' ? undefined : 'expected a string');
const oneOf = (...allowed) => (v) => typeof v === 'string' && allowed.includes(v) ? undefined : `expected one of ${allowed.join(', ')}`;
const num = (min, max, { integer = false, minOpen = false } = {}) => (v) => {
    if (!finite(v))
        return 'expected a finite number';
    if (integer && !Number.isInteger(v))
        return 'expected an integer';
    if (minOpen ? !(v > min) : v < min)
        return `expected ${minOpen ? 'more than' : 'at least'} ${min}`;
    if (v > max)
        return `expected at most ${max}`;
    return undefined;
};
const integer = (min, max = Infinity) => num(min, max, { integer: true });
const nonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const anchorProblem = (v) => {
    if (!isPlain(v))
        return 'expected { panel?, position, priority? }';
    for (const key of Object.keys(v))
        if (key !== 'panel' && key !== 'position' && key !== 'priority')
            return `unknown anchor key '${key}'`;
    if (v.panel !== undefined && !nonEmptyString(v.panel))
        return 'anchor.panel must be a non-empty string';
    if (v.position !== 'left' && v.position !== 'right')
        return "anchor.position must be 'left' or 'right'";
    if (v.priority !== undefined && !finite(v.priority))
        return 'anchor.priority must be a finite number';
    return undefined;
};
const placementProblem = (v) => {
    if (typeof v === 'string') {
        if (PLACEMENT_WORDS.includes(v))
            return undefined;
        return v === 'in-place' ? "'in-place' is not a placement here" : `unknown placement '${v}'`;
    }
    if (!isPlain(v))
        return 'expected a placement word or { before } | { after } | { anchor }';
    const keys = Object.keys(v);
    const only = keys[0];
    if (keys.length !== 1 || only === undefined)
        return 'a placement object has exactly one of before, after, anchor';
    if (only === 'before' || only === 'after')
        return nonEmptyString(v[only]) ? undefined : `${only} must name a panel`;
    if (only === 'anchor') {
        const inner = anchorProblem(v.anchor);
        if (inner !== undefined)
            return inner;
        return nonEmptyString(v.anchor.panel) ? undefined : 'a placement anchor must name its panel';
    }
    return `unknown placement key '${only}'`;
};
const placementOrInPlace = (v) => (v === 'in-place' ? undefined : placementProblem(v));
const undoPlacementProblem = (v) => (v === 'old-slot' ? undefined : placementProblem(v));
const maxInstancesProblem = (v) => (v === 'unlimited' ? undefined : integer(1)(v) === undefined ? undefined : "expected an integer of at least 1 or 'unlimited'");
const stringOrFunction = (v) => typeof v === 'string' || typeof v === 'function';
const booleanOrFunction = (v) => typeof v === 'boolean' || typeof v === 'function';
function headerButtonSlotProblem(slot) {
    if ('icon' in slot && slot.icon === undefined)
        return 'icon must not be undefined; leave it out for a text button';
    if (typeof slot.label === 'function') {
        // A function label is judged when it runs: an empty result hides the slot at runtime.
    }
    else if (typeof slot.label !== 'string' || slot.label === '')
        return 'label must be a non-empty string or a function';
    if (typeof slot.onClick !== 'function')
        return 'onClick must be a function';
    if (slot.side !== undefined && slot.side !== 'start' && slot.side !== 'end')
        return "side must be 'start' or 'end'";
    if (slot.order !== undefined && (typeof slot.order !== 'number' || !Number.isFinite(slot.order)))
        return 'order must be a finite number';
    if (slot.pressed !== undefined && typeof slot.pressed !== 'function')
        return 'pressed must be a function';
    if (slot.description !== undefined && !stringOrFunction(slot.description))
        return 'description must be a string or a function';
    if (slot.tooltip !== undefined && !stringOrFunction(slot.tooltip))
        return 'tooltip must be a string or a function';
    if (slot.disabled !== undefined && !booleanOrFunction(slot.disabled))
        return 'disabled must be a boolean or a function';
    if (slot.hidden !== undefined && !booleanOrFunction(slot.hidden))
        return 'hidden must be a boolean or a function';
    if (slot.sx !== undefined && (typeof slot.sx !== 'object' || slot.sx === null || Array.isArray(slot.sx)))
        return 'sx must be a style object';
    return undefined;
}
const headerButtonsProblem = (v) => {
    if (!isPlain(v))
        return 'expected a map of slot id to slot or false';
    for (const id of Object.keys(v)) {
        if (!SLOT_ID.test(id))
            return `slot id '${id}' must be 1-32 characters of a-z, 0-9 and -`;
        const slot = v[id];
        if (slot === false)
            continue;
        if (typeof slot !== 'object' || slot === null || Array.isArray(slot))
            return `slot '${id}' must be a slot object or false`;
        const problem = headerButtonSlotProblem(slot);
        if (problem !== undefined)
            return `slot '${id}': ${problem}`;
    }
    return undefined;
};
/**
 * What the per-panel settings this version removed do now: each is fixed at the value it had as a default, for every
 * panel. A template that still names one is told once in development and the value is ignored; a later rc refuses it.
 * @internal
 */
export const FIXED = Object.freeze({
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
function reportRemovedValue(key, value) {
    reportOnce(`removed:${key}:${value}`, `phonux: the ${key} value '${value}' was removed`, () => ["it is ignored and the setting behaves as if it were 'off'", 'the next rc refuses it with invalid-settings']);
}
function reportRemovedKey(layer, key) {
    reportOnce(`removed:${key}`, `phonux: the ${layer} setting '${key}' was removed`, () => [`it is ignored and the panel behaves as if it were ${JSON.stringify(FIXED[key])}`, 'the next rc refuses it with invalid-settings']);
}
/** The keys `movable` replaced. */
const MERGED_INTO_MOVABLE = new Set(['draggable', 'placeable']);
/**
 * A saved layer's `draggable` and `placeable`, as the one `movable` they became: only when both are present and
 * agree, because either alone says nothing about the other half of what `movable` now covers.
 */
function savedMovable(raw) {
    const { draggable, placeable } = raw;
    return typeof draggable === 'boolean' && draggable === placeable && raw.movable === undefined ? draggable : undefined;
}
const ENTER_FROM = ['auto', 'left', 'right', 'anchor', 'top', 'bottom', 'fade', 'expand'];
const EXIT_TO = ['auto', 'left', 'right', 'top', 'bottom', 'fade', 'shrink'];
const SETTING_CHECKS = {
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
function bezierProblem(v) {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(finite))
        return 'expected four finite numbers';
    const [x1, , x2] = v;
    return x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 ? 'the first and third numbers must be from 0 to 1' : undefined;
}
/** Members of the three object-valued leaves, each with the check for its value. */
const TUNING_MEMBER_CHECKS = {
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
const TUNING_SCALAR_CHECKS = {
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
    initialScroll: (v) => {
        if (v === 'start' || v === 'end' || v === 'root')
            return undefined;
        if (isPlain(v) && Object.keys(v).length === 1 && nonEmptyString(v.panel))
            return undefined;
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
const isObjectLeaf = (leaf) => Object.hasOwn(TUNING_MEMBER_CHECKS, leaf);
/** What a tuning leaf's value holds: the members that passed, and one problem per member that did not. */
export function checkTuningLeaf(leaf, value) {
    const base = `tuning.${leaf}`;
    if (!isObjectLeaf(leaf)) {
        const problem = TUNING_SCALAR_CHECKS[leaf](value);
        if (problem === undefined && leaf === 'shrinkOutOfView' && value !== 'off') {
            reportRemovedValue(base, value);
            return { accepted: 'off', problems: [] };
        }
        return problem === undefined ? { accepted: value, problems: [] } : { accepted: undefined, problems: [{ key: base, problem }] };
    }
    if (!isPlain(value))
        return { accepted: undefined, problems: [{ key: base, problem: 'expected an object' }] };
    const members = TUNING_MEMBER_CHECKS[leaf];
    const accepted = {};
    const problems = [];
    for (const member of Object.keys(value)) {
        const memberValue = value[member];
        if (memberValue === undefined)
            continue;
        const check = Object.hasOwn(members, member) ? members[member] : undefined;
        if (check === undefined) {
            problems.push({ key: `${base}.${member}`, problem: 'unknown tuning member' });
            continue;
        }
        const problem = check(memberValue);
        if (problem === undefined)
            accepted[member] = memberValue;
        else
            problems.push({ key: `${base}.${member}`, problem });
    }
    return { accepted: Object.keys(accepted).length > 0 ? accepted : undefined, problems };
}
const TEMPLATE_SCOPE_KEYS = new Set(PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.length === 1 && d.configure.doors[0] === 'template').map((d) => d.name));
const VIEW_SETTABLE_KEYS = new Set(PANEL_SETTINGS_CATALOG.filter((d) => d.viewSettable).map((d) => d.name));
/**
 * Whether a view may ask for `key` as `value`: a view may place itself only by an explicit anchor and enter only from it,
 * so those keys are checked by value.
 * @internal
 */
export const viewMayAsk = (key, value) => {
    if (!VIEW_SETTABLE_KEYS.has(key))
        return false;
    if (key === 'placeOnAdd')
        return isPlain(value) && Object.keys(value).length === 1 && value.anchor !== undefined;
    if (key === 'enterFrom')
        return value === 'anchor';
    if (key === 'closable')
        return value === false;
    return true;
};
const ASK_LAYERS = ['workspace', 'template', 'host', 'instance'];
/** Drops the key with a note when this layer is a saved one read leniently; throws otherwise. */
function reject(layer, key, problem, lenientLayer, notes) {
    const where = key === '' ? layer : `${layer}.${key}`;
    if (lenientLayer) {
        notes.push({ code: 'invalid-saved-setting', ...(key === '' ? {} : { key }), message: `${where}: ${problem}; dropped` });
        return;
    }
    throw new PanelManagerError('invalid-settings', `${where}: ${problem}`, key === '' ? { layer } : { layer, key });
}
function checkLayer(layer, raw, env) {
    const accepted = { flat: new Map() };
    if (raw === undefined)
        return accepted;
    const lenientLayer = env.lenient && layer === 'instance';
    if (!isPlain(raw)) {
        reject(layer, '', 'a settings layer must be an object', lenientLayer, env.notes);
        return accepted;
    }
    for (const key of Object.keys(raw)) {
        const value = raw[key];
        if (value === undefined)
            continue;
        if (key === 'tuning') {
            reject(layer, 'tuning', 'tuning belongs to the workspace, not to a panel; set it on WorkspaceOptions.tuning', lenientLayer, env.notes);
            continue;
        }
        if (MERGED_INTO_MOVABLE.has(key)) {
            if (!lenientLayer)
                reject(layer, key, "a setting this version no longer has; set 'movable' instead", false, env.notes);
            else if (savedMovable(raw) !== undefined) {
                if (key === 'draggable') {
                    accepted.flat.set('movable', savedMovable(raw));
                    env.notes.push({ code: 'invalid-saved-setting', key: 'movable', message: `${layer}.draggable and ${layer}.placeable: settings this version no longer has; read as movable` });
                }
            }
            else
                reject(layer, key, 'a setting this version no longer has; set movable instead', true, env.notes);
            continue;
        }
        if (Object.hasOwn(FIXED, key)) {
            if (lenientLayer)
                reject(layer, key, 'a setting this version no longer has', true, env.notes);
            else
                reportRemovedKey(layer, key);
            continue;
        }
        if (!Object.hasOwn(SETTING_CHECKS, key)) {
            reject(layer, key, 'unknown setting', lenientLayer, env.notes);
            continue;
        }
        const problem = SETTING_CHECKS[key](value);
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
function checkUser(raw, env) {
    const accepted = {};
    if (raw === undefined)
        return accepted;
    if (!isPlain(raw)) {
        reject('user', '', 'a settings layer must be an object', env.lenient, env.notes);
        return accepted;
    }
    for (const key of Object.keys(raw)) {
        const value = raw[key];
        if (value === undefined)
            continue;
        let problem;
        if (key === 'slots')
            problem = integer(1, ALL_SLOTS)(value);
        else if (key === 'parkable')
            problem = bool(value);
        else if (key === 'anchor')
            problem = anchorProblem(value);
        else
            problem = 'unknown setting';
        if (problem !== undefined) {
            reject('user', key, problem, env.lenient, env.notes);
            continue;
        }
        if (key === 'slots')
            accepted.slots = value;
        else if (key === 'parkable')
            accepted.parkable = value;
        else
            accepted.anchor = { ...value };
    }
    return accepted;
}
/** Merges the accepted layers over the library defaults, lowest first; a later layer's value wins field by field. */
function merge(accepted, userParkable) {
    const values = { ...LIBRARY_PANEL_DEFAULTS };
    const source = {};
    for (const key of Object.keys(values))
        if (values[key] !== undefined)
            source[key] = 'library';
    for (const layer of ASK_LAYERS) {
        const { flat } = accepted[layer];
        for (const [key, value] of flat) {
            if (key === 'headerButtons') {
                const slots = { ...values.headerButtons };
                for (const id of Object.keys(value)) {
                    const slot = value[id];
                    if (slot === false)
                        delete slots[id];
                    else
                        slots[id] = slot;
                }
                values.headerButtons = slots;
                if (Object.keys(value).length > 0)
                    source.headerButtons = layer;
            }
            else {
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
function force(s, key, applied, rule, forcedBy) {
    const asked = s.values[key];
    if (sameSettingsValue(asked, applied))
        return;
    const layer = s.source[key];
    if (layer === 'template' || layer === 'host' || layer === 'instance')
        s.drafts.push({ key, layer, asked, rule, forcedBy });
    s.values[key] = applied;
    s.source[key] = 'forced';
}
function fill(s, key, value) {
    if (s.values[key] !== undefined)
        return;
    s.values[key] = value;
    s.source[key] = 'derived';
}
/** Derived defaults, then the coupling rules. The root's own rule runs first because it feeds C1 and C2. */
function applyRules(s, root) {
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
        const fixedSize = [['resizable', false], ['slots', 1], ['maxSlots', 1]];
        const askedForThisPanel = fixedSize.some(([key, applied]) => (s.source[key] === 'template' || s.source[key] === 'host' || s.source[key] === 'instance') && !sameSettingsValue(s.values[key], applied));
        if (!askedForThisPanel)
            for (const [key, applied] of fixedSize)
                force(s, key, applied, 'C1', 'parkable');
        force(s, 'overflow', 'scroll', 'C1', 'parkable');
        force(s, 'startVisibility', 'live', 'C1', 'parkable');
        force(s, 'restoreVisibility', 'live', 'C1', 'parkable');
    }
    if (s.values.closable === false)
        force(s, 'clearable', false, 'C2', 'closable');
    if (s.values.slots > s.values.maxSlots)
        force(s, 'slots', s.values.maxSlots, 'C4', 'maxSlots');
    // `movable` is not forced: code moves the root whatever it says, and it gates only the person's drag. The root is never closed or placed.
}
const PARK_LEVERS = ['capacityReturn'];
const forcedMessage = (d, applied) => `${d.key}: the ${d.layer} layer asked ${show(d.asked)}, but ${d.rule} makes it ${show(applied)}${d.forcedBy === undefined ? '' : ` because of ${d.forcedBy}`}`;
/**
 * Resolves the settings of one panel from its layers. Pure: the same layers give an equal result, the layers are
 * never changed, and the value is deeply frozen. An unknown key, a wrong type or an out-of-range value throws
 * PanelManagerError('invalid-settings') naming the layer and key; with `lenient`, the instance and user layers
 * (a saved file's own) drop such a key with a note instead. A conflict is recorded only for a template, host or
 * instance layer that asked for what a rule or a scope forbids.
 * @public
 */
export function resolvePanelSettings(layers = {}, options = {}) {
    const root = options.root === true;
    const env = { lenient: options.lenient === true, notes: [], pending: [] };
    const accepted = {};
    for (const layer of ASK_LAYERS)
        accepted[layer] = checkLayer(layer, layers[layer], env);
    const user = checkUser(layers.user, env);
    let state = merge(accepted, undefined);
    applyRules(state, root);
    // The person's size: their slot count, never above what the panel's own settings allow.
    const personSlots = user.slots === undefined ? undefined : Math.min(user.slots, state.values.maxSlots);
    // A person's fixed column needs one slot, so the slot count is settled before their parkable joins as the top layer.
    const width = personSlots ?? state.values.slots;
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
        state.values.slots = Math.min(user.slots, state.values.maxSlots);
        state.source.slots = 'user';
    }
    const resolved = state.values;
    const conflicts = [];
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
            if (layer !== undefined && layer !== 'library')
                notes.push({ code: 'park-lever-inert', key, message: `${key}: only a panel whose overflow is 'park' is ever parked for room, so this has no effect here` });
        }
    }
    const value = {};
    for (const descriptor of PANEL_SETTINGS_CATALOG) {
        const key = descriptor.name;
        if (key.startsWith('tuning.') || key === 'headerButtons' || resolved[key] === undefined)
            continue;
        value[key] = freezeClone(resolved[key]);
    }
    const slots = {};
    for (const id of Object.keys(resolved.headerButtons))
        slots[id] = Object.freeze({ ...resolved.headerButtons[id] });
    value.headerButtons = Object.freeze(slots);
    const result = { value: Object.freeze(value), source: state.source, conflicts, notes };
    if (user.anchor !== undefined)
        result.userAnchor = user.anchor;
    return result;
}
// ---------------------------------------------------------------------------
// Entries: the settings an entry carries and the one writer of the fields that mirror them
// ---------------------------------------------------------------------------
/** What an entry with no settings starts from: every library default, the derived ones included. */
const LEGACY_BASE = resolvePanelSettings().value;
/**
 * The settings `p` behaves under: `p.settings` itself when it has them, else values read from the fields a
 * hand-built entry carries (`collapsible`, `listed`, `layer`, `anchoredEnter`, `slots`, `title`),
 * with every other key at its library default. A hand-built entry keeps its original parking and a fixed column
 * cannot be closed, moved or resized by a person.
 * @internal
 */
export function effective(p) {
    if (p.settings !== undefined)
        return p.settings;
    const parkable = p.collapsible;
    const legacy = {
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
export const holdUnlistedNote = (panelId) => ({ code: 'hold-unlisted', panelId, key: 'listed', message: 'listed: a held hide of an unlisted panel can be shown by code only' });
/** The name readers use for an entry: its `key` when created from settings, its `id` when hand-built. @internal */
export const panelKey = (p) => p.key ?? p.id;
/**
 * `entry` with `resolved` written into the fields that mirror it, and into no other. 'create' writes them all,
 * the slots, `key` and `live` included (`startVisibility` 'parked' parks the entry; 'live' never revives
 * one the caller handed in parked); 'reconfigure' writes only what a later change may move and leaves the slots,
 * anchor, `live`, `hostData` and `key` as the person and the row left them.
 * @internal
 */
export function applyTemplate(entry, resolved, mode) {
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
