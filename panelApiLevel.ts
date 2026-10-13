/**
 * The panel API levels a template may declare with `api`, and the table that says which the library serves. A level names the
 * panel-facing surface a template was written against; DESIGN.md, "Panel API levels", says what it covers.
 */
import type { PanelSummary } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelReader, ViewHandle } from './panelTemplate.js';

/** A panel API level a template may declare with `api`. @public */
export type PanelApiLevel = 1;

/** The newest panel API level; a template that leaves `api` out is on it. @public */
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
  /** The release that stops serving the level, named in the warning; absent when none is set. */
  readonly droppedIn?: string;
}

/** Which levels are served and which is the newest; tests pass their own to exercise a level the shipped table does not have. @internal */
export interface LevelTable {
  readonly newest: number;
  readonly levels: ReadonlyMap<number, LevelEntry>;
}

/** The levels this package serves. @internal */
export const SHIPPED_LEVELS: LevelTable = { newest: PANEL_API, levels: new Map<number, LevelEntry>([[1, {}]]) };

/** Throws `invalid-template` when `api` is set to anything but a level `table` serves; an omitted `api` is the newest level. @internal */
export function checkPanelApi(templateId: string, api: unknown, table: LevelTable = SHIPPED_LEVELS): void {
  if (api === undefined) return;
  if (typeof api === 'number' && table.levels.has(api)) return;
  throw new PanelManagerError('invalid-template', `template '${templateId}': api must be one of ${[...table.levels.keys()].join(', ')}, got ${JSON.stringify(api)}`);
}

const warned = new Set<string>();

/** Logs once per template id that it is on a level older than the newest; silent in production. @internal */
export function warnIfOldLevel(templateId: string, level: number, table: LevelTable): void {
  if (level === table.newest || typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(templateId)) return;
  warned.add(templateId);
  const dropped = table.levels.get(level)?.droppedIn ?? 'a later release';
  console.warn(`phonux: template '${templateId}' is on panel API level ${level}; the newest is ${table.newest}, and level ${level} stops being served in ${dropped}.`);
}
