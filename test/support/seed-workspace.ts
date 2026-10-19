/**
 * A workspace over hand-built entries, and a `PanelRow` that renders a list of them. No jsdom here: a test that renders to a
 * string imports this file without the browser globals the mount harness installs.
 */
import * as React from 'react';
import { PanelRow, createWorkspace } from '../../index.js';
import type { PanelSettings, PanelTemplate, WorkspaceHandle, WorkspaceStorage, WorkspaceTuning } from '../../index.js';
import type { PanelWindow } from '../../panelWindow.js';
import { bindingOf } from '../../workspaceCore.js';
import { testViewTemplate } from './test-views.js';

/** What a workspace over hand-built entries is made with. */
export interface SeedOptions {
  /** The root's id; default 'root'. */
  rootId?: string;
  /** Free by default, so the literal scroll targets these tests pin stay panel-start numbers; the whole-panel stops have their own tests. */
  tuning?: WorkspaceTuning;
  workspaceDefaults?: PanelSettings;
  /** Templates beyond the plain one made for each distinct `view` the entries name. */
  templates?: readonly PanelTemplate[];
  storage?: WorkspaceStorage;
}

const PlainView = ({ panel }: { panel: { id: string; title?: string | undefined } }): React.ReactElement => React.createElement('i', { 'data-slot': panel.id }, panel.title);

type RowProps = React.ComponentProps<typeof PanelRow>;

/**
 * A `PanelRow` over a list the test hands it on every render, with no provider hook behind it: the workspace is made from
 * the first list, and each render tells it the list the row draws, as the hook does, so a template view finds its handle.
 */
export function StaticRow({ seed, workspace: given, ...row }: Omit<RowProps, 'workspace'> & { seed?: SeedOptions; workspace?: WorkspaceHandle }): React.ReactElement {
  const [made] = React.useState(() => given ?? seededWorkspace(row.entries as readonly PanelWindow[], { rootId: row.rootId, ...seed }));
  const workspace = given ?? made;
  bindingOf(workspace).observe(row.entries as readonly PanelWindow[], NOT_HELD);
  return React.createElement(PanelRow, { ...row, workspace });
}

const NOT_HELD = { has: (): boolean => false };

/** A template for `id` that renders the view remembered under `key` (default `id`), else `<i data-slot={panel.id}>` with the panel's title, the shape the row tests read. */
export const plainTemplate = (id: string, key: string = id): PanelTemplate => testViewTemplate(key, id, PlainView);

/**
 * A workspace whose row starts with `entries`: the first paint of a hand-built row, without a restore. Every `view` the
 * entries name that no given template answers to gets a plain template, so it renders as a registered view did.
 */
export function seededWorkspace(entries: readonly PanelWindow[], o: SeedOptions = {}): WorkspaceHandle {
  const rootId = o.rootId ?? 'root';
  const given = new Set([rootId, ...(o.templates ?? []).map((t) => t.id)]);
  const views = [...new Set(entries.map((e) => e.view))].filter((v) => !given.has(v));
  const ws = createWorkspace({
    mount: false,
    // A root the engine names itself (`__root__`) is the marker a workspace without a root template has.
    ...(rootId.startsWith('_') ? {} : { root: plainTemplate(rootId, entries.find((e) => e.id === rootId)?.view ?? rootId) }),
    templates: [...(o.templates ?? []), ...views.map((v) => plainTemplate(v))],
    tuning: { rowGesture: 'step', ...o.tuning },
    ...(o.workspaceDefaults !== undefined ? { defaults: o.workspaceDefaults } : {}),
    ...(o.storage !== undefined ? { storage: o.storage } : {}),
  });
  // The one seam a test has to start a row from a list it built: the engine reads its first paint from here.
  (bindingOf(ws) as { initialEntries: () => PanelWindow[] }).initialEntries = () => [...entries];
  return ws;
}
