/**
 * Views that draw their own frame, shaped like the ones real apps write, and the one function that renders each into a
 * workspace and reads back its DOM. The golden file the default-frame test compares against was recorded from this file on a
 * tree with no default frame, so a self-framed view's output is held to what it was.
 */
import * as React from 'react';
import { act } from 'react';
import { DragToClose, Panel, PanelFrame, createWorkspace, definePanel } from '../../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../../index.js';
import { flush, mountWorkspace } from './workspace-row.js';

/** What the effect probes of every fixture saw: one entry per `name` with the mounts and unmounts of its view. */
export const effects = new Map<string, { mounts: number; unmounts: number }>();

function useProbe(name: string): void {
  React.useEffect(() => {
    const e = effects.get(name) ?? { mounts: 0, unmounts: 0 };
    effects.set(name, e);
    e.mounts += 1;
    return () => void (e.unmounts += 1);
  }, [name]);
}

/** The shape of a browser app's live panel: title, grab props from DragToClose, overlay, viewId, size, sx, headerProps and actions. */
export const livePanel = (): PanelTemplate =>
  definePanel({
    id: 'live',
    settings: { title: 'Live page' },
    view: ({ panel, handle }) => {
      useProbe('live');
      return (
        <DragToClose onClose={() => handle.close()}>
          {(grab) => (
            <Panel
              title={panel.title}
              grabProps={{ ...grab }}
              overlay={<button type="button" data-overlay="">+</button>}
              viewId={panel.id}
              size={panel.size}
              sx={{ outline: '1px solid transparent' }}
              headerProps={{ 'data-live-header': 'yes' }}
              actions={<button type="button" data-action="reload">reload</button>}
            >
              <PanelFrame size={panel.size}>
                <p data-body="live">{panel.id}</p>
              </PanelFrame>
            </Panel>
          )}
        </DragToClose>
      );
    },
  });

/** An album view with a template footer: the frame it draws holds the footer once. */
export const albumPanel = (): PanelTemplate =>
  definePanel({
    id: 'album',
    settings: { title: 'Album' },
    view: ({ panel }) => {
      useProbe('album');
      return (
        <Panel title={panel.title} viewId={panel.id}>
          <PanelFrame>
            <ul data-body="album">
              <li>one</li>
              <li>two</li>
            </ul>
          </PanelFrame>
        </Panel>
      );
    },
    footer: ({ panel }) => <span data-footer-for={panel.id}>footer</span>,
  });

/** A view whose Panel carries `data-*` attributes and event handlers through its `...rest`. */
export const restPanel = (): PanelTemplate =>
  definePanel({
    id: 'rest',
    settings: { title: 'Rest' },
    view: ({ panel }) => {
      useProbe('rest');
      return (
        <Panel title={panel.title} data-extra="kept" aria-label="extra label" onClick={() => undefined} onPointerEnter={() => undefined}>
          <PanelFrame>
            <p data-body="rest">{panel.id}</p>
          </PanelFrame>
        </Panel>
      );
    },
  });

/** A view that draws only a `PanelFrame`, no `Panel`: half of what the default frame draws. */
export const frameOnlyPanel = (): PanelTemplate =>
  definePanel({
    id: 'frameonly',
    settings: { title: 'Frame only' },
    view: () => {
      useProbe('frameonly');
      return (
        <PanelFrame>
          <p data-body="frameonly">frame only</p>
        </PanelFrame>
      );
    },
  });

export const SELF_FRAMED: ReadonlyArray<readonly [string, () => PanelTemplate]> = [
  ['live', livePanel],
  ['album', albumPanel],
  ['rest', restPanel],
  ['frameonly', frameOnlyPanel],
];

/** Panel ids a test gets from `newIds`: stable, so the DOM it writes can be compared across runs. */
export function stableIds(): () => string {
  let n = 0;
  return () => `p${(n += 1)}`;
}

export interface Rendered {
  /** `outerHTML` of the row scroller after everything settled. */
  html: string;
  workspace: WorkspaceHandle;
  unmount: () => void;
}

/** Renders `fixture` at slot width `width` beside the root, and settles. */
export async function renderFixture(fixture: PanelTemplate, width = 1280): Promise<Rendered> {
  effects.clear();
  const root = definePanel({
    id: 'root',
    view: () => (
      <Panel title="History">
        <PanelFrame>
          <i data-slot="root" />
        </PanelFrame>
      </Panel>
    ),
  });
  const workspace = createWorkspace({ mount: false, root, templates: [fixture], newId: stableIds() });
  workspace.addPanel(fixture.id);
  const m = mountWorkspace(workspace, { width });
  await flush();
  await act(async () => undefined);
  const scroller = m.container.querySelector('[data-row-scroller]') ?? m.container;
  return { html: scroller.outerHTML, workspace, unmount: () => m.unmount() };
}
