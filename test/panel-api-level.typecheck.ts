/**
 * The shape of `api`. Nothing here runs: `npm run typecheck` compiles it, and a level the library does not serve must
 * fail to compile before it can answer `invalid-template` at run time.
 */
import { PANEL_API, definePanel } from '../index.js';
import type { PanelApiLevel, PanelTemplate } from '../index.js';
import { NEWEST_SHAPE, type LevelEntry, type NewestViewProps, type ShapeOf } from '../panelApiLevel.js';

const View = (): null => null;

const omitted: PanelTemplate = { id: 'a', view: View };
const named: PanelTemplate = { id: 'b', api: 1, view: View };
const newest: PanelApiLevel = PANEL_API;
const inferred = definePanel({ id: 'c', params: { page: 1 }, view: ({ panel }) => (panel.params?.page === 1 ? null : null) });
const withApi = definePanel({ id: 'd', api: PANEL_API, params: { page: 1 }, view: ({ panel }) => (panel.params?.page === 1 ? null : null) });

// @ts-expect-error a level the library does not serve is not a PanelApiLevel
const unknown: PanelTemplate = { id: 'e', api: 2, view: View };
// @ts-expect-error a level is a number, not a version string
const text: PanelTemplate = { id: 'f', api: '1', view: View };

// A level's shape is typed against the members it describes: one added to or removed from the type fails to compile until the shape says so.
type Described = { id: string; note?: number; run(): void };
const exact: ShapeOf<Described> = { id: { kind: 'string' }, note: { kind: 'number', optional: true }, run: { kind: 'function' } };
// @ts-expect-error a member the type has is not described
const missing: ShapeOf<Described> = { id: { kind: 'string' }, note: { kind: 'number', optional: true } };
// @ts-expect-error a member the type does not have is described
const extra: ShapeOf<Described> = { ...exact, other: { kind: 'string' } };
// @ts-expect-error an optional member must be marked optional so a panel without it is no mismatch
const unmarked: ShapeOf<Described> = { ...exact, note: { kind: 'number' } };
// @ts-expect-error a required member must not be marked optional
const loose: ShapeOf<Described> = { ...exact, id: { kind: 'string', optional: true } };

// A level that renames a newest prop supplies the shape of what its adapter returns beside the adapter.
const renamed: LevelEntry = {
  adapt: ({ panel, handle, manager }: NewestViewProps) => ({ panel, handle, reader: manager }),
  shape: { panel: NEWEST_SHAPE.panel, handle: NEWEST_SHAPE.handle, reader: NEWEST_SHAPE.manager },
};

// @ts-expect-error an adapter without the shape of what it hands over cannot be checked
const unshaped: LevelEntry = { adapt: ({ panel, handle, manager }: NewestViewProps) => ({ panel, handle, reader: manager }) };

export { unshaped, omitted, named, newest, inferred, withApi, unknown, text, exact, missing, extra, unmarked, loose, renamed };
