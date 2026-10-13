/**
 * A workspace whose views draw a titled Panel, mounted in a measured row, for the tests of the header buttons. Panels
 * a, b and c sit right of a root named 'root'; `slots` is the template layer every one of them inherits.
 */
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { Panel, createWorkspace, definePanel } from '../../index.js';
import type { HeaderButton, PanelHandle, PanelsInput, PanelState, PanelWindow, PanelSettings, PanelTemplate, WorkspaceHandle, WorkspaceOptions } from '../../index.js';
import { panelKey } from '../../panelSettings.js';
import { flush, markerTemplate, mountWorkspace, type MountedWorkspace } from './workspace-row.js';

export interface HeaderRigOptions {
  ids?: readonly string[];
  /** The header buttons of every template. */
  slots?: Record<string, HeaderButton | false>;
  /** Template settings per id, merged over `slots`. */
  settings?: Record<string, PanelSettings>;
  /** The Panel's title; `undefined` as a value draws a Panel with no title. */
  title?: ReactNode;
  /** The view's own actions. */
  actions?: ReactNode;
  /** Rendered inside every Panel, below the header. */
  body?: ReactNode;
  /** Gives every Panel a grab bar. */
  grab?: boolean;
  /** Passed to Panel as `headerButtons`. */
  panelHeaderButtons?: boolean;
  workspace?: Partial<WorkspaceOptions>;
  onNote?: (n: { code: string; panelId?: string | undefined; key?: string | undefined; message: string }) => void;
  width?: number;
  /** Provider input overrides, e.g. a short saveQuietMs. */
  over?: Partial<PanelsInput>;
  /** Wraps the mounted tree, e.g. in a MotionConfig. */
  wrap?: (tree: ReactElement) => ReactElement;
}

export interface HeaderRig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
  h: Record<string, PanelHandle>;
  /** The header row of panel `id`, or null. */
  row: (id: string) => HTMLElement | null;
  /** Every IconButton in panel `id`'s header, in document order. */
  buttons: (id: string) => HTMLButtonElement[];
  turn: <T>(fn: () => T) => T;
  /** The row in array order by panel name, the root named 'root'. */
  order: () => string[];
  entry: (id: string) => PanelWindow;
  state: (id: string) => PanelState;
  settle: () => Promise<void>;
}

export const titledTemplate = (id: string, o: HeaderRigOptions, settings: PanelSettings): PanelTemplate =>
  definePanel({
    id,
    settings,
    view: ({ panel }) =>
      createElement(
        Panel,
        { ...('title' in o ? { title: o.title } : { title: panel.id }), ...(o.actions === undefined ? {} : { actions: o.actions }), ...(o.panelHeaderButtons === undefined ? {} : { headerButtons: o.panelHeaderButtons }), ...(o.grab === true ? { grabProps: { 'data-grab': '' } } : {}), children: [createElement('i', { key: 'slot', 'data-slot': panel.id }), o.body === undefined ? null : createElement('span', { key: 'body' }, o.body)] },
      ),
  });

export async function headerRig(o: HeaderRigOptions = {}): Promise<HeaderRig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const ws = createWorkspace({
    root: markerTemplate('root', { settings: { title: 'History' } }),
    templates: ids.map((id) => titledTemplate(id, o, { ...(o.slots === undefined ? {} : { headerButtons: o.slots }), ...(o.settings?.[id] ?? {}) })),
    ...(o.workspace ?? {}),
  });
  const h: Record<string, PanelHandle> = {};
  for (const id of ids) h[id] = ws.addPanel(id);
  const m = mountWorkspace(ws, { ...(o.wrap === undefined ? {} : { wrap: o.wrap }), width: o.width ?? 4000, over: { ...(o.onNote === undefined ? {} : { onNote: o.onNote }), ...(o.over ?? {}) } });
  await flush();
  return {
    ws,
    m,
    h,
    row: (id) => m.container.querySelector<HTMLElement>(`[data-header-buttons-row="${id}"]`),
    buttons: (id) => [...(m.container.querySelector(`[data-header-buttons-row="${id}"]`)?.querySelectorAll('button') ?? [])] as HTMLButtonElement[],
    order: () => m.latest().entries.filter((p) => p.marker !== true).map(panelKey),
    entry: (id) => {
      const found = m.latest().entries.find((p) => p.marker !== true && panelKey(p) === id);
      if (found === undefined) throw new Error(`no entry '${id}' in the row`);
      return found;
    },
    state: (id) => ws.panels.get(id)!.getState(),
    turn: <T,>(fn: () => T): T => {
      let out!: T;
      act(() => {
        out = fn();
      });
      return out;
    },
    settle: flush,
  };
}
