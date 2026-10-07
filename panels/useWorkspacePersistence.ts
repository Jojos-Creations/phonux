/**
 * Keeps the panel list between launches through a host's `WorkspaceStorage`: one restore at mount, then a
 * debounced save of every committed change. With no storage it does nothing: no state, no promise, no timer.
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import { computeRowOrder } from '../panelRowOrder.js';
import { SAVE_QUIET_MS } from '../rowConstants.js';
import type { PanelWindow } from '../panelWindow.js';
import { hydrateWorkspaceState, isWorkspaceState, projectWorkspaceState } from '../workspaceState.js';
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
  /** Applied to every restored panel after `defaultHostData`, so a host that resolves settings from workspace defaults can give a restored panel the same settings a new one gets. Read once, at mount. */
  decorateRestored?: (panel: PanelWindow) => PanelWindow;
}): { restoreSettled: boolean } {
  const { panels, setPanels } = i;
  const saveQuietMsRef = useRef(i.saveQuietMs ?? SAVE_QUIET_MS);
  saveQuietMsRef.current = i.saveQuietMs ?? SAVE_QUIET_MS;
  // Everything but the list itself is read once, at mount.
  const { storage, rootId, freshId, defaultHostData, decorateRestored } = useRef(i).current;
  // State, not a ref: opening the gate must re-run the save effect, or a change committed while load() was
  // pending (with nothing to restore) would never be saved.
  const [settled, setSettled] = useState(false);
  // The JSON last saved or restored; a projection equal to it is not saved again.
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (storage === undefined) return;
    // StrictMode runs this effect twice; only the run that is not cancelled may apply its result.
    let cancelled = false;
    // The executor runs at once, so a load() that throws reads as a rejection: no saved state.
    new Promise<WorkspaceState | null>((resolve) => resolve(storage.load())).then(
      (loaded) => {
        if (cancelled) return;
        let restored: PanelWindow[] = [];
        if (loaded !== null) {
          if (isWorkspaceState(loaded)) {
            // Drawn here, never inside an updater: React may run an updater twice.
            restored = hydrateWorkspaceState(loaded, freshId, rootId).map((p) => {
              const hostData = defaultHostData?.();
              const withHostData = hostData === undefined ? p : { ...p, hostData };
              return decorateRestored === undefined ? withHostData : decorateRestored(withHostData);
            });
          } else {
            console.warn('Ignored the saved workspace: it is not a version 1 workspace file.');
          }
        }
        // The baseline is what the restored list projects to, not the file: saved ids differ from fresh ones,
        // and comparing against the file would save at every launch.
        lastSaved.current = JSON.stringify(projectWorkspaceState(restored, rootId));
        // Appended after what is already there, so a panel created while load() was pending survives.
        if (restored.length > 0) setPanels((prev) => computeRowOrder([...prev, ...restored], rootId));
        setSettled(true);
      },
      () => {
        if (cancelled) return;
        lastSaved.current = JSON.stringify(projectWorkspaceState([], rootId));
        setSettled(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the inputs are read once
  }, []);

  useEffect(() => {
    if (storage === undefined || !settled) return;
    const state = projectWorkspaceState(panels, rootId);
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
