/**
 * The panel API levels a template may declare with `api`, and the table that says which the library serves. A level names the
 * panel-facing surface a template was written against; DESIGN.md, "Panel API levels", says what it covers.
 */
import type { PanelSummary } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelReader, ViewHandle } from './panelTemplate.js';

/** A panel API level a template may declare with `api`: the package major version its panel code was written for. @public */
export type PanelApiLevel = 1;

/** The newest panel API level, equal to the package's major version from 1.0.0; a template that leaves `api` out is on it. @public */
export const PANEL_API: PanelApiLevel = 1;

/** What a template's view and footer are rendered with at the newest level. @internal */
export interface NewestViewProps {
  panel: PanelSummary;
  handle: ViewHandle;
  manager: PanelReader;
}

/** One level the library serves: how it turns the newest props into the ones that level promised. @internal */
export interface LevelEntry {
  /** Absent when the level's props are the newest props. */
  readonly adapt?: (props: NewestViewProps) => object;
  /** The release that removes the level, set when the level is deprecated and named in the warning; absent while the level is served. */
  readonly droppedIn?: string;
}

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
