/**
 * Two launches of one workspace over a shared `memoryWorkspaceStorage`: what the first leaves in the saved file is what
 * the second restores.
 */
import { act } from 'react';
import { createWorkspace } from '../../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../../index.js';
import { memoryWorkspaceStorage } from '../../fakeHost.js';
import { flush, mountWorkspace } from './workspace-row.js';
import type { MountedWorkspace } from './workspace-row.js';

const QUICK = { tuning: { saveQuietMs: 5 } };
export const settle = async (): Promise<void> => {
  await flush();
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
};

export interface Launch {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
}

/** One launch: a fresh workspace over `store` with `templates` all added, mounted and restored. */
export async function launch(store: ReturnType<typeof memoryWorkspaceStorage>, templates: PanelTemplate[]): Promise<Launch> {
  const ws = createWorkspace({ mount: false, templates, storage: store });
  for (const t of templates) ws.addPanel(t, t.settings?.multiple === true ? { id: `${t.id}-1` } : undefined);
  const m = mountWorkspace(ws, { over: QUICK });
  await flush();
  return { ws, m };
}

export const engineId = (ws: WorkspaceHandle, id: string): string => ws.panels.get(id)!.getState().engineId!;
export const live = (ws: WorkspaceHandle): string[] => ws.panels.getSnapshot().panels.filter((p) => p.status === 'live').map((p) => p.id);
