/**
 * Keeps the panel list between launches through a host's `WorkspaceStorage`: one restore at mount, then a
 * debounced save of every committed change. The restore is `reconcileWorkspace`, called in the load's success
 * handler; a throw there takes the same path as a failed load, so the workspace always settles. With no storage
 * it does nothing: no state, no promise, no timer.
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import { computeRowOrder } from '../panelRowOrder.js';
import type { PanelSettings, SettingNote } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { SAVE_QUIET_MS } from '../rowConstants.js';
import type { PanelWindow } from '../panelWindow.js';
import { listTemplates } from '../viewRegistry.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import type { DeclaredPanel } from '../workspacePlan.js';
import { projectWorkspaceState } from '../workspaceState.js';
import type { WorkspaceState, WorkspaceStorage } from '../workspaceState.js';

export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };

export function useWorkspacePersistence(i: {
  storage: WorkspaceStorage | undefined;
  panels: PanelWindow[];
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
  rootId: string;
  freshId: () => string;
  defaultHostData: (() => JsonValue) | undefined;
  /** How long the panel list must stay unchanged before it is saved; a change inside that time restarts it. Default SAVE_QUIET_MS. */
  saveQuietMs?: number;
  /** The templates a saved panel may be rebuilt from, over the registered ones. Read once, at mount. */
  templates?: readonly PanelTemplate[];
  /** The panels code declares; each is created unless the file has it or the person dismissed it. Read once, at mount. */
  declared?: readonly DeclaredPanel[];
  /** The workspace's panel settings, so a restored panel resolves as a new one does. Read once, at mount. */
  workspaceDefaults?: Omit<PanelSettings, 'tuning'>;
  /** Receives each note the restore raises; whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
}): { restoreSettled: boolean } {
  const { panels, setPanels } = i;
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const saveQuietMsRef = useRef(i.saveQuietMs ?? SAVE_QUIET_MS);
  saveQuietMsRef.current = i.saveQuietMs ?? SAVE_QUIET_MS;
  // Everything but the list itself is read once, at mount.
  const { storage, rootId, freshId, defaultHostData, workspaceDefaults, declared, onNote } = useRef(i).current;
  const given = useRef(i.templates).current;
  // State, not a ref: opening the gate must re-run the save effect, or a change committed while load() was
  // pending (with nothing to restore) would never be saved.
  const [settled, setSettled] = useState(false);
  // The JSON last saved or restored; a projection equal to it is not saved again.
  const lastSaved = useRef<string | null>(null);
  // The tombstones the file held, written back with every save; this hook never adds one.
  const dismissed = useRef<string[]>([]);

  useEffect(() => {
    if (storage === undefined) return;
    // StrictMode runs this effect twice; only the run that is not cancelled may apply its result.
    let cancelled = false;
    // The executor runs at once, so a load() that throws reads as a rejection: no saved state.
    const reconcile = (saved: unknown): PanelWindow[] => {
      const templates = [...listTemplates().filter((t) => !(given ?? []).some((g) => g.id === t.id)), ...(given ?? [])];
      // Drawn here, never inside an updater: React may run an updater twice.
      const result = reconcileWorkspace({ saved, templates, declared, workspaceDefaults, rootId, current: panelsRef.current, freshId });
      dismissed.current = result.dismissed;
      for (const note of result.notes) {
        if (note.code === 'workspace-ignored') console.warn(note.message);
        try {
          onNote?.(note);
        } catch {
          // A reporter that throws must not break the restore that raised the note.
        }
      }
      return result.entries.map((p) => {
        const hostData = defaultHostData?.();
        return hostData === undefined ? p : { ...p, hostData };
      });
    };
    const settle = (restored: PanelWindow[]): void => {
      // The baseline is what the restored list projects to, not the file: saved ids differ from fresh ones,
      // and comparing against the file would save at every launch.
      lastSaved.current = JSON.stringify(projectWorkspaceState(restored, rootId, dismissed.current));
      // Appended after what is already there, so a panel created while load() was pending survives.
      if (restored.length > 0) setPanels((prev) => computeRowOrder([...prev, ...restored], rootId));
      setSettled(true);
    };
    // A failed load, or a restore that threw, still gets the panels code declares; a restore that cannot even do that restores nothing.
    const fail = (): void => {
      let restored: PanelWindow[] = [];
      try {
        restored = reconcile(null);
      } catch {
        dismissed.current = [];
      }
      settle(restored);
    };
    // The executor runs at once, so a load() that throws reads as a rejection: no saved state.
    new Promise<WorkspaceState | null>((resolve) => resolve(storage.load())).then(
      (loaded) => {
        if (cancelled) return;
        let restored: PanelWindow[];
        try {
          restored = reconcile(loaded);
        } catch {
          fail();
          return;
        }
        settle(restored);
      },
      () => {
        if (cancelled) return;
        fail();
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the inputs are read once
  }, []);

  useEffect(() => {
    if (storage === undefined || !settled) return;
    const state = projectWorkspaceState(panels, rootId, dismissed.current);
    const json = JSON.stringify(state);
    if (json === lastSaved.current) return;
    // No flush on unmount or quit: a change in the last quiet period is lost, never a torn write.
    const timer = setTimeout(() => {
      lastSaved.current = json;
      storage.save(state);
    }, saveQuietMsRef.current);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storage and rootId never change
  }, [panels, settled]);

  // True at once without storage: there is nothing to wait for.
  return { restoreSettled: storage === undefined || settled };
}
