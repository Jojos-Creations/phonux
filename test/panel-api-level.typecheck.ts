/**
 * The shape of `api`. Nothing here runs: `npm run typecheck` compiles it, and a level the library does not serve must
 * fail to compile before it can answer `invalid-template` at run time.
 */
import { PANEL_API, definePanel } from '../index.js';
import type { PanelApiLevel, PanelTemplate } from '../index.js';

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

export { omitted, named, newest, inferred, withApi, unknown, text };
