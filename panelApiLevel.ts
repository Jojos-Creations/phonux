/**
 * The panel API levels a template may declare with `api`, and the table that says which the library serves. A level names the
 * panel-facing surface a template was written against; DESIGN.md, "Panel API levels", says what it covers.
 */
import { PanelManagerError } from './panelManagerError.js';
import type { PanelViewProps } from './panelTemplate.js';

/** A panel API level a template may declare with `api`: the package major version its panel code was written for. @public */
export type PanelApiLevel = 1;

/** The newest panel API level, equal to the package's major version from 1.0.0; a template that leaves `api` out is on it. @public */
export const PANEL_API: PanelApiLevel = 1;

/** What a template's view and footer are rendered with at the newest level. @internal */
export type NewestViewProps = PanelViewProps;

/** What a member's value is: its `typeof`, or `any` for a member that holds any JSON value. @internal */
export type MemberKind = 'string' | 'number' | 'boolean' | 'function' | 'object' | 'any';

/** One member a level promises; `optional` is required by the type exactly where the described member may be absent or undefined. @internal */
export type MemberShape<T, K extends keyof T> = { readonly kind: MemberKind } & (undefined extends T[K] ? { readonly optional: true } : { readonly optional?: false });

/** The members of `T` by name and kind; a member added to or removed from `T` fails to compile until this is updated. @internal */
export type ShapeOf<T> = { readonly [K in keyof T]-?: MemberShape<T, K> };

/** The props a level hands a view and footer: each prop by name, with the members it promises. @internal */
export type PropsShape = Readonly<Record<string, Readonly<Record<string, { readonly kind: MemberKind; readonly optional?: boolean }>>>>;

/** The newest level's props, member by member. Optional members are marked so a panel without them is no mismatch. @internal */
export const NEWEST_SHAPE: { readonly [K in keyof NewestViewProps]-?: ShapeOf<NewestViewProps[K]> } = {
  panel: {
    id: { kind: 'string' },
    url: { kind: 'string', optional: true },
    title: { kind: 'string', optional: true },
    live: { kind: 'boolean' },
    locked: { kind: 'boolean' },
    params: { kind: 'any', optional: true },
    slots: { kind: 'number', optional: true },
    maxSlots: { kind: 'number', optional: true },
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
    pin: { kind: 'function' },
    unpin: { kind: 'function' },
    configure: { kind: 'function' },
  },
  manager: {
    get: { kind: 'function' },
    list: { kind: 'function' },
    getSnapshot: { kind: 'function' },
    subscribe: { kind: 'function' },
  },
};

/** One level the library serves: how it turns the newest props into the ones that level promised, and what those props contain. A level whose props are the newest props has neither `adapt` nor `shape`. @internal */
export type LevelEntry = {
  /** The release that removes the level, set when the level is deprecated and named in the warning; absent while the level is served. */
  readonly droppedIn?: string;
} & ({ readonly adapt?: undefined; readonly shape?: undefined } | { readonly adapt: (props: NewestViewProps) => object; readonly shape: PropsShape });

/** Which levels are served and which is the newest; tests pass their own to exercise a level the shipped table does not have. @internal */
export interface LevelTable {
  readonly newest: number;
  readonly levels: ReadonlyMap<number, LevelEntry>;
  /** Levels that were served once, with the release that removed each; absent means none. */
  readonly dropped?: ReadonlyMap<number, string>;
}

/** The levels this package serves. @internal */
export const SHIPPED_LEVELS: LevelTable = { newest: PANEL_API, levels: new Map<number, LevelEntry>([[1, {}]]), dropped: new Map<number, string>() };

/** Throws `invalid-template` when `api` is set to anything but a level `table` serves; an omitted `api` is the newest level. @internal */
export function checkPanelApi(templateId: string, api: unknown, table: LevelTable = SHIPPED_LEVELS): void {
  if (api === undefined) return;
  if (typeof api === 'number' && table.levels.has(api)) return;
  const droppedIn = typeof api === 'number' ? table.dropped?.get(api) : undefined;
  if (droppedIn !== undefined) throw new PanelManagerError('invalid-template', `template '${templateId}': level ${api} was dropped in ${droppedIn}`);
  throw new PanelManagerError('invalid-template', `template '${templateId}': api must be one of ${[...table.levels.keys()].join(', ')}, got ${JSON.stringify(api)}`);
}

/** Why `table` is not a complete account of levels 1 to `newest` (each served or dropped, never both, none outside the range), or undefined when it is. @internal */
export function levelCoverageProblem(table: LevelTable): string | undefined {
  const dropped = table.dropped ?? new Map<number, string>();
  for (const level of [...table.levels.keys(), ...dropped.keys()]) {
    if (!Number.isInteger(level) || level < 1 || level > table.newest) return `level ${level} is outside 1 to ${table.newest}`;
  }
  if (!table.levels.has(table.newest)) return `the newest level ${table.newest} is not served`;
  for (let level = 1; level <= table.newest; level += 1) {
    const served = table.levels.has(level);
    const gone = dropped.has(level);
    if (served && gone) return `level ${level} is both served and dropped`;
    if (!served && !gone) return `level ${level} is neither served nor dropped`;
  }
  return undefined;
}

const warned = new Set<string>();

/** Logs once per template id that it is on a level older than the newest, naming the removal release only for a deprecated level; silent in production. @internal */
export function warnIfOldLevel(templateId: string, level: number, table: LevelTable): void {
  if (level === table.newest || typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(templateId)) return;
  warned.add(templateId);
  const droppedIn = table.levels.get(level)?.droppedIn;
  const removal = droppedIn === undefined ? '' : `, and level ${level} is deprecated and removed in ${droppedIn}`;
  console.warn(`phonux: template '${templateId}' is on panel API level ${level}; the newest is ${table.newest}${removal}.`);
}

/** The `typeof` of `key` on `value`, or undefined when it is absent; a getter is reported as `any` without being run. */
function kindOf(value: object, key: string): MemberKind | undefined {
  for (let o: object | null = value; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d === undefined) continue;
    if (d.get !== undefined || d.set !== undefined) return 'any';
    const t = typeof d.value;
    return t === 'string' || t === 'number' || t === 'boolean' || t === 'function' ? t : d.value === undefined ? undefined : 'object';
  }
  return undefined;
}

/** What differs between one object and the members described for it, as lines prefixed with `label`; empty when they match. Reads descriptors only. @internal */
export function memberProblems(value: object, members: PropsShape[string], label: string): string[] {
  const problems: string[] = [];
  for (const [member, { kind, optional }] of Object.entries(members)) {
    const found = kindOf(value, member);
    if (found === undefined) {
      if (optional !== true) problems.push(`${label}.${member} is missing`);
    } else if (kind !== 'any' && found !== 'any' && found !== kind) {
      problems.push(`${label}.${member} should be a ${kind}, got a ${found}`);
    }
  }
  return problems;
}

/** What differs between `props` and `shape`, one line per missing or wrong member; empty when they match. Reads descriptors only, so it never runs a getter or a method. @internal */
export function shapeMismatches(props: object, shape: PropsShape): string[] {
  const problems: string[] = [];
  for (const [name, members] of Object.entries(shape)) {
    const value = kindOf(props, name) === undefined ? undefined : (props as Record<string, unknown>)[name];
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

const reported = new Set<string>();

/** Runs `check` the first time `key` is seen and logs its lines as one console.error under `heading`; silent in production and never throws. @internal */
export function reportOnce(key: string, heading: string, check: () => string[]): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' || reported.has(key)) return;
  reported.add(key);
  try {
    const problems = check();
    if (problems.length > 0) console.error(`${heading}: ${problems.join('; ')}.`);
  } catch {
    // A check that cannot run must not stop the panel from rendering.
  }
}

/** Logs one console.error the first time a template at a level is rendered, listing every mismatch between `props` and `shape`. @internal */
export function reportShapeOnce(templateId: string, level: number, props: object, shape: PropsShape): void {
  reportOnce(`props:${level}:${templateId}`, `phonux: template '${templateId}' on panel API level ${level} was handed props that do not match that level`, () => shapeMismatches(props, shape));
}
