/**
 * The panel API levels a template may declare with `api`, and the table that says which the library serves. A level names the
 * panel-facing surface a template was written against; DESIGN.md, "Panel API levels", says what it covers.
 */
import { PanelManagerError } from './panelManagerError.js';
/** The newest panel API level, equal to the package's major version from 1.0.0; a template that leaves `api` out is on it. @public */
export const PANEL_API = 1;
/** The newest level's props, member by member. Optional members are marked so a panel without them is no mismatch. @internal */
export const NEWEST_SHAPE = {
    panel: {
        id: { kind: 'string' },
        url: { kind: 'string', optional: true },
        title: { kind: 'string', optional: true },
        live: { kind: 'boolean' },
        params: { kind: 'any', optional: true },
        slots: { kind: 'number', optional: true },
        maxSlots: { kind: 'number', optional: true },
        savedSlots: { kind: 'number', optional: true },
        drawnSlots: { kind: 'number', optional: true },
        fitSlots: { kind: 'number', optional: true },
        size: { kind: 'object', optional: true },
    },
    handle: {
        id: { kind: 'string' },
        templateId: { kind: 'string' },
        getState: { kind: 'function' },
        getSettings: { kind: 'function' },
        subscribe: { kind: 'function' },
        show: { kind: 'function' },
        hide: { kind: 'function' },
        toggleVisibility: { kind: 'function' },
        close: { kind: 'function' },
        open: { kind: 'function' },
        move: { kind: 'function' },
        place: { kind: 'function' },
        setSlots: { kind: 'function' },
        scrollTo: { kind: 'function' },
        configure: { kind: 'function' },
    },
    manager: {
        get: { kind: 'function' },
        list: { kind: 'function' },
        getSnapshot: { kind: 'function' },
        subscribe: { kind: 'function' },
    },
};
/** The levels this package serves. @internal */
export const SHIPPED_LEVELS = { newest: PANEL_API, levels: new Map([[1, {}]]), dropped: new Map() };
/** Throws `invalid-template` when `api` is set to anything but a level `table` serves; an omitted `api` is the newest level. @internal */
export function checkPanelApi(templateId, api, table = SHIPPED_LEVELS) {
    if (api === undefined)
        return;
    if (typeof api === 'number' && table.levels.has(api))
        return;
    const droppedIn = typeof api === 'number' ? table.dropped?.get(api) : undefined;
    if (droppedIn !== undefined)
        throw new PanelManagerError('invalid-template', `template '${templateId}': level ${api} was dropped in ${droppedIn}`);
    throw new PanelManagerError('invalid-template', `template '${templateId}': api must be one of ${[...table.levels.keys()].join(', ')}, got ${JSON.stringify(api)}`);
}
/** Why `table` is not a complete account of levels 1 to `newest` (each served or dropped, never both, none outside the range), or undefined when it is. @internal */
export function levelCoverageProblem(table) {
    const dropped = table.dropped ?? new Map();
    for (const level of [...table.levels.keys(), ...dropped.keys()]) {
        if (!Number.isInteger(level) || level < 1 || level > table.newest)
            return `level ${level} is outside 1 to ${table.newest}`;
    }
    if (!table.levels.has(table.newest))
        return `the newest level ${table.newest} is not served`;
    for (let level = 1; level <= table.newest; level += 1) {
        const served = table.levels.has(level);
        const gone = dropped.has(level);
        if (served && gone)
            return `level ${level} is both served and dropped`;
        if (!served && !gone)
            return `level ${level} is neither served nor dropped`;
    }
    return undefined;
}
const warned = new Set();
/** Logs once per template id that it is on a level older than the newest, naming the removal release only for a deprecated level; silent in production. @internal */
export function warnIfOldLevel(templateId, level, table) {
    if (level === table.newest || typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(templateId))
        return;
    warned.add(templateId);
    const droppedIn = table.levels.get(level)?.droppedIn;
    const removal = droppedIn === undefined ? '' : `, and level ${level} is deprecated and removed in ${droppedIn}`;
    console.warn(`phonux: template '${templateId}' is on panel API level ${level}; the newest is ${table.newest}${removal}.`);
}
/** The `typeof` of `key` on `value`, or undefined when it is absent; a getter is reported as `any` without being run. */
function kindOf(value, key) {
    for (let o = value; o !== null; o = Object.getPrototypeOf(o)) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d === undefined)
            continue;
        if (d.get !== undefined || d.set !== undefined)
            return 'any';
        const t = typeof d.value;
        return t === 'string' || t === 'number' || t === 'boolean' || t === 'function' ? t : d.value === undefined ? undefined : 'object';
    }
    return undefined;
}
/** What differs between one object and the members described for it, as lines prefixed with `label`; empty when they match. Reads descriptors only. @internal */
export function memberProblems(value, members, label) {
    const problems = [];
    for (const [member, { kind, optional }] of Object.entries(members)) {
        const found = kindOf(value, member);
        if (found === undefined) {
            if (optional !== true)
                problems.push(`${label}.${member} is missing`);
        }
        else if (kind !== 'any' && found !== 'any' && found !== kind) {
            problems.push(`${label}.${member} should be a ${kind}, got a ${found}`);
        }
    }
    return problems;
}
/** What differs between `props` and `shape`, one line per missing or wrong member; empty when they match. Reads descriptors only, so it never runs a getter or a method. @internal */
export function shapeMismatches(props, shape) {
    const problems = [];
    for (const [name, members] of Object.entries(shape)) {
        const value = kindOf(props, name) === undefined ? undefined : props[name];
        if (typeof value !== 'object' && typeof value !== 'function') {
            problems.push(`${name} is missing`);
            continue;
        }
        if (value === null) {
            problems.push(`${name} is null`);
            continue;
        }
        problems.push(...memberProblems(value, members, name));
    }
    return problems;
}
const reported = new Set();
/** Runs `check` the first time `key` is seen and logs its lines as one console.error under `heading`; silent in production and never throws. @internal */
export function reportOnce(key, heading, check) {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' || reported.has(key))
        return;
    reported.add(key);
    try {
        const problems = check();
        if (problems.length > 0)
            console.error(`${heading}: ${problems.join('; ')}.`);
    }
    catch {
        // A check that cannot run must not stop the panel from rendering.
    }
}
/** Logs one console.error the first time a template at a level is rendered, listing every mismatch between `props` and `shape`. @internal */
export function reportShapeOnce(templateId, level, props, shape) {
    reportOnce(`props:${level}:${templateId}`, `phonux: template '${templateId}' on panel API level ${level} was handed props that do not match that level`, () => shapeMismatches(props, shape));
}
