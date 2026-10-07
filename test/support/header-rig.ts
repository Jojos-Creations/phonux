/**
 * A workspace whose views draw a titled Panel, mounted in a measured row, for the tests of the header buttons. Panels
 * a, b and c sit right of a root named 'root'; `slots` is the template layer every one of them inherits.
 */
import { act, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, Panel, createWorkspace, definePanel, resolvePanelSettings } from '../../index.js';
import type { HeaderButton, PanelHandle, PanelProps, PanelSettings, PanelTemplate, WorkspaceHandle, WorkspaceOptions } from '../../index.js';
import { createFakeHost } from '../../fakeHost.js';
import { LIBRARY_TUNING_DEFAULTS } from '../../panelSettings.js';
import { PanelSlotContext, type PanelSlotValue } from '../../panelSlotContext.js';
import { slotTuning } from '../../panelTuning.js';
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
  /** Passed to Panel as `headerButtons`. */
  panelHeaderButtons?: boolean;
  workspace?: Partial<WorkspaceOptions>;
  onNote?: (n: { code: string; panelId?: string | undefined; key?: string | undefined; message: string }) => void;
  width?: number;
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
  settle: () => Promise<void>;
}

export const titledTemplate = (id: string, o: HeaderRigOptions, settings: PanelSettings): PanelTemplate =>
  definePanel({
    id,
    settings,
    view: ({ panel }) =>
      createElement(
        Panel,
        { ...('title' in o ? { title: o.title } : { title: panel.id }), ...(o.actions === undefined ? {} : { actions: o.actions }), ...(o.panelHeaderButtons === undefined ? {} : { headerButtons: o.panelHeaderButtons }), children: [createElement('i', { key: 'slot', 'data-slot': panel.id }), o.body === undefined ? null : createElement('span', { key: 'body' }, o.body)] },
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
  const m = mountWorkspace(ws, { width: o.width ?? 4000, ...(o.onNote === undefined ? {} : { over: { onNote: o.onNote } }) });
  await flush();
  const row = (id: string): HTMLElement | null => {
    const slot = m.container.querySelector(`[data-slot="${id}"]`);
    return (slot?.closest('div[style]')?.querySelector('[data-header-placeholder-title], [data-header-placeholder-action]') ?? null)?.closest('div') ?? null;
  };
  return {
    ws,
    m,
    h,
    row: (id) => m.container.querySelector<HTMLElement>(`[data-header-buttons-row="${id}"]`) ?? row(id),
    buttons: (id) => [...(m.container.querySelector(`[data-header-buttons-row="${id}"]`)?.querySelectorAll('button') ?? [])] as HTMLButtonElement[],
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

let handleForStatic: PanelHandle | undefined;
/** A handle of a workspace that is never mounted: enough for a static render that only reads its state. */
export function staticHandle(): PanelHandle {
  handleForStatic ??= createWorkspace({ templates: [definePanel({ id: 'a', view: () => null })] }).addPanel('a');
  return handleForStatic;
}

/** The static markup of a Panel inside a slot declaring `slots` (none: a slot with no header buttons), a newline between tags. */
export function staticPanel(o: { slots?: Record<string, HeaderButton>; props?: Omit<PanelProps, 'children'>; handle?: PanelHandle } = {}): string {
  const handle = o.handle ?? staticHandle();
  const value: PanelSlotValue = {
    ...resolvePanelSettings().value,
    collapsible: true,
    neighborWidths: { left: [], right: [] },
    pinned: false,
    tuning: slotTuning(LIBRARY_TUNING_DEFAULTS, undefined),
    ...(o.slots === undefined ? {} : { headerButtonSlots: { slots: o.slots, handle, report: () => {}, note: () => {} } }),
  };
  const panel = createElement(Panel, { ...(o.props ?? {}), children: 'Body' });
  const tree = createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: createElement(PanelSlotContext.Provider, { value, children: panel }) }) });
  return `${renderToStaticMarkup(tree).replace(/></g, '>\n<')}\n`;
}
