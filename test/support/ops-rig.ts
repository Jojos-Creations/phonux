/**
 * A workspace of marker templates mounted in a roomy row, for the tests that drive handle operations. Panels are added
 * in id order, so the row is [root a b c ...].
 */
import * as React from 'react';
import { act } from 'react';
import { createWorkspace } from '../../index.js';
import type { PanelHandle, PanelResult, PanelSettings, PanelTemplate, WorkspaceHandle } from '../../index.js';
import { mount } from './mount-harness.js';
import { flush, markerTemplate, mountWorkspace, type MountedWorkspace } from './workspace-row.js';

export interface Rig {
  ws: WorkspaceHandle;
  h: Record<string, PanelHandle>;
  m: MountedWorkspace | undefined;
  /** Runs `fn` inside one act, so every call in it shares a turn. */
  turn: <T>(fn: () => T) => T;
  /** Every panel as `id` (live), `id*` (parked), `~id` (closed) or `?id` (pending), in snapshot order. */
  row: () => string;
  /** The ids of the mounted live-and-parked views, in document order. */
  slots: () => string;
}

export interface RigOptions {
  /** Settings layer per template id; a template not named here has none. */
  settings?: Record<string, PanelSettings>;
  ids?: readonly string[];
  width?: number;
  /** Leave the workspace unmounted, so every panel is pending. */
  unmounted?: boolean;
  extra?: readonly PanelTemplate[];
}

export async function rig(o: RigOptions = {}): Promise<Rig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const ws = createWorkspace({ templates: [...ids.map((id) => markerTemplate(id, o.settings?.[id] === undefined ? {} : { settings: o.settings[id] })), ...(o.extra ?? [])] });
  const h: Record<string, PanelHandle> = {};
  for (const id of ids) h[id] = ws.addPanel(id);
  const m = o.unmounted === true ? undefined : mountWorkspace(ws, { width: o.width ?? 4000 });
  if (m !== undefined) await flush();
  const mark = (p: { id: string; status: string }): string => (p.status === 'live' ? p.id : p.status === 'parked' ? `${p.id}*` : p.status === 'closed' ? `~${p.id}` : `?${p.id}`);
  return {
    ws,
    h,
    m,
    turn: <T>(fn: () => T): T => {
      let out!: T;
      act(() => {
        out = fn();
      });
      return out;
    },
    row: () =>
      ws.panels
        .getSnapshot()
        .panels.filter((p) => p.id !== ws.rootId)
        .map(mark)
        .join(' '),
    slots: () => (m === undefined ? '' : m.slots().filter((s) => s !== ws.rootId).join(' ')),
  };
}

/** A result as a short literal: 'T' accepted and changed, 'F' accepted with nothing to do, or the refusal code. */
export const brief = (r: PanelResult): string => (r.ok ? (r.changed ? 'T' : 'F') : r.code);

export const TRIGGERS = ['handler', 'timer', 'promise', 'effect'] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** Runs `fn` the way `trigger` would: a discrete handler, a setTimeout, a promise continuation or a passive effect. */
export async function fire<T>(trigger: Trigger, fn: () => T): Promise<T> {
  let out: T | undefined;
  if (trigger === 'handler') {
    act(() => {
      out = fn();
    });
  } else if (trigger === 'timer') {
    await act(async () => {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          out = fn();
          resolve();
        }, 0),
      );
    });
  } else if (trigger === 'promise') {
    await act(async () => {
      await Promise.resolve();
      out = fn();
    });
  } else {
    function Effector(): null {
      React.useEffect(() => {
        out = fn();
      }, []);
      return null;
    }
    mount(React.createElement(Effector));
  }
  return out as T;
}
