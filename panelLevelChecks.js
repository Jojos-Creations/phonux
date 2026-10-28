/**
 * Two checks that tie a template to its panel API level: the settings and header button members it uses against the level
 * that introduced each, and the shape of the header button items its views read. Both are development diagnostics
 * that log one console.error per template and never throw; a malformed value is the resolver's `invalid-settings`, not this.
 */
import { PANEL_API, memberProblems, reportOnce } from './panelApiLevel.js';
const SETTINGS_SINCE = {
    closable: 1, parkable: 1, movable: 1, crossable: 1, resizable: 1, clearable: 1, hostCreatable: 1, hollowDot: 1, multiple: 1,
    maxInstances: 1, listed: 1, startVisibility: 1, hideStickiness: 1, capacityReturn: 1, overflow: 1,
    revealOnScroll: 1, edgeHold: 1, resize: 1, scrollOnOpen: 1, scrollOnMove: 1, toggleWhenClosed: 1, showWhenClosed: 1,
    placeOnAdd: 1, placeOnShow: 1, layer: 1, enterFrom: 1, exitTo: 1,
    slots: 1, maxSlots: 1, title: 1, headerButtons: 1,
    restoreVisibility: 1, afterClose: 1,
    'tuning.rowGap': 1, 'tuning.rowTop': 1, 'tuning.phoneHeight': 1, 'tuning.dragToClose': 1, 'tuning.slide': 1, 'tuning.hopFraction': 1, 'tuning.edgeScroll': 1, 'tuning.saveQuietMs': 1,
    'tuning.gestureLockMs': 1, 'tuning.gestureQuietMs': 1, 'tuning.resizeSettleSlides': 1, 'tuning.returnTieBreak': 1, 'tuning.dropTieBreak': 1,
    'tuning.rowGesture': 1, 'tuning.fastScroll': 1, 'tuning.initialScroll': 1, 'tuning.chrome': 1, 'tuning.maxLivePanels': 1, 'tuning.phoneFit': 1, 'tuning.phoneFitMin': 1, 'tuning.phoneFitMax': 1,
    'tuning.defaultEnterFrom': 1, 'tuning.defaultExitTo': 1, 'tuning.shrinkUnfocused': 1,
};
const HEADER_BUTTON_SINCE = {
    label: 1, onClick: 1, side: 1, order: 1, pressed: 1, description: 1, tooltip: 1, disabled: 1, hidden: 1, sx: 1, icon: 1,
};
/** The levels that introduced the shipped settings and header button members. @internal */
export const SHIPPED_SINCE = { settings: SETTINGS_SINCE, headerButton: HEADER_BUTTON_SINCE };
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The settings and header button members of `settings` that a template on `level` was written before; empty when it uses none. Unknown names are the resolver's to refuse. @internal */
export function levelTieProblems(settings, level, since) {
    const problems = [];
    if (!isRecord(settings))
        return problems;
    const note = (name, from, what) => {
        if (from !== undefined && from > level)
            problems.push(`${what} '${name}' was added in level ${from}`);
    };
    for (const key of Object.keys(settings)) {
        if (key === 'tuning' && isRecord(settings.tuning)) {
            for (const leaf of Object.keys(settings.tuning))
                note(`tuning.${leaf}`, since.settings[`tuning.${leaf}`], 'setting');
            continue;
        }
        note(key, since.settings[key], 'setting');
        if (key !== 'headerButtons' || !isRecord(settings.headerButtons))
            continue;
        for (const slot of Object.values(settings.headerButtons)) {
            if (!isRecord(slot))
                continue;
            for (const member of Object.keys(slot))
                note(member, since.headerButton[member], 'header button member');
        }
    }
    return problems;
}
/** Logs one console.error per template naming every setting or header button member newer than its level; called when the template is registered. @internal */
export function reportLevelTieOnce(templateId, level, settings, since = SHIPPED_SINCE) {
    const at = level ?? PANEL_API;
    reportOnce(`tie:${templateId}`, `phonux: template '${templateId}' is on panel API level ${at} but uses members of a newer level`, () => levelTieProblems(settings, at, since));
}
/** The header button item as a view reads it from `usePanelHeaderButtons`, one description per form. @internal */
export const HEADER_ITEM_SHAPE = {
    icon: {
        id: { kind: 'string' },
        label: { kind: 'string' },
        side: { kind: 'string' },
        order: { kind: 'number' },
        pressed: { kind: 'boolean', optional: true },
        disabled: { kind: 'boolean' },
        hidden: { kind: 'boolean' },
        description: { kind: 'string', optional: true },
        tooltip: { kind: 'string', optional: true },
        sx: { kind: 'any', optional: true },
        press: { kind: 'function' },
        form: { kind: 'string' },
        icon: { kind: 'any', optional: true },
    },
    text: {
        id: { kind: 'string' },
        label: { kind: 'string' },
        side: { kind: 'string' },
        order: { kind: 'number' },
        pressed: { kind: 'boolean', optional: true },
        disabled: { kind: 'boolean' },
        hidden: { kind: 'boolean' },
        description: { kind: 'string', optional: true },
        tooltip: { kind: 'string', optional: true },
        sx: { kind: 'any', optional: true },
        press: { kind: 'function' },
        form: { kind: 'string' },
        icon: { kind: 'any', optional: true },
    },
};
/** What differs between the listed items and the description of their form; an item is judged by its own `form`. @internal */
export function itemProblems(items) {
    const problems = [];
    items.forEach((item, index) => {
        if (!isRecord(item)) {
            problems.push(`item ${index} is not an object`);
            return;
        }
        const form = Object.getOwnPropertyDescriptor(item, 'form')?.value;
        const label = `item '${typeof item.id === 'string' ? item.id : index}'`;
        if (form !== 'icon' && form !== 'text')
            problems.push(`${label}.form should be 'icon' or 'text'`);
        else
            problems.push(...memberProblems(item, HEADER_ITEM_SHAPE[form], label));
        if (form === 'text' && Object.getOwnPropertyDescriptor(item, 'icon')?.value !== undefined)
            problems.push(`${label}.icon should be undefined in the text form`);
    });
    return problems;
}
/** Logs one console.error the first time a template's view lists header buttons that do not match their form; nothing is marked checked while the list is empty. @internal */
export function reportItemShapeOnce(templateId, level, items) {
    if (items.length === 0)
        return;
    const at = level ?? PANEL_API;
    reportOnce(`items:${templateId}`, `phonux: template '${templateId}' on panel API level ${at} listed header buttons that do not match that level`, () => itemProblems(items));
}
