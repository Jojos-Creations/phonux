/**
 * Keeps the panel list between launches through a host's `WorkspaceStorage`: one restore at mount, then a
 * debounced save of every committed change; a save that fails is saved again by the next change. The restore is
 * `reconcileWorkspace`, called in the load's success handler; a throw there takes the same path as a failed load, so
 * the workspace always settles. With no storage it does nothing: no state, no promise, no timer.
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import { computeRowOrder } from '../panelRowOrder.js';
import type { PanelSettings, SettingNote } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { SAVE_QUIET_MS } from '../rowConstants.js';
import type { PanelWindow } from '../panelWindow.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import type { DeclaredPanel } from '../workspacePlan.js';
import { DISMISSED_LIMIT, projectWorkspaceState } from '../workspaceState.js';
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
  /** The templates a saved panel may be rebuilt from, over the registered ones. A list is read once, at mount; a function is called at each restore. */
  templates?: readonly PanelTemplate[] | (() => readonly PanelTemplate[]);
  /** The panels code declares; each is created unless the file has it or the person dismissed it. A list is read once, at mount; a function is called at each restore. */
  declared?: readonly DeclaredPanel[] | (() => readonly DeclaredPanel[]);
  /** The workspace's panel settings, so a restored panel resolves as a new one does. Read once, at mount. */
  workspaceDefaults?: Omit<PanelSettings, 'tuning'>;
  /** Receives each note the restore raises; whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
  /** The developer's panel order, read by every placement the restore makes whose value is `'order'`. */
  order?: () => readonly string[];
  /** Receives an error a save raised, by throwing or rejecting. Unset: `console.error`. */
  onError?: (e: unknown) => void;
  /** True for a workspace: the declared panels are created at mount even with no storage, and the restore settles after them. Read once, at mount. */
  replay?: boolean;
}): {
  restoreSettled: boolean;
  /** Adds tombstones for keys that left the list, newest last, dropping the oldest past the cap. */
  dismiss(keys: readonly string[]): void;
  /** Removes the tombstones of keys that are back in the list. */
  undismiss(keys: readonly string[]): void;
  /** Whether `key` is a tombstone now. */
  isDismissed(key: string): boolean;
} {
  const { panels, setPanels } = i;
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const saveQuietMsRef = useRef(i.saveQuietMs ?? SAVE_QUIET_MS);
  saveQuietMsRef.current = i.saveQuietMs ?? SAVE_QUIET_MS;
  // Everything but the list itself is read once, at mount.
  const { storage, rootId, freshId, defaultHostData, workspaceDefaults, declared, onNote, replay } = useRef(i).current;
  // The declared panels are replayed once per mount; StrictMode's second run of the effect finds them already made.
  const replayed = useRef(false);
  const given = useRef(i.templates).current;
  const onErrorRef = useRef(i.onError);
  onErrorRef.current = i.onError;
  const reportError = (e: unknown): void => {
    if (onErrorRef.current === undefined) {
      console.error(e);
      return;
    }
    try {
      onErrorRef.current(e);
    } catch {
      // A reporter that throws must not break the save that raised the error.
    }
  };
  // State, not a ref: opening the gate must re-run the save effect, or a change committed while load() was
  // pending (with nothing to restore) would never be saved.
  const [settled, setSettled] = useState(false);
  // The JSON the file is known to hold: restored, or saved and settled without error. A projection equal to it is not saved again.
  const lastSaved = useRef<string | null>(null);
  // The newest save that has not settled; a change that projects to the same JSON is already on its way.
  const inFlight = useRef<{ n: number; json: string } | null>(null);
  const started = useRef(0);
  // The tombstones the file held, written back with every save; `dismiss` and `undismiss` edit them.
  const dismissed = useRef<string[]>([]);
  const tombstonesDropped = useRef(false);

  useEffect(() => {
    // StrictMode runs this effect twice; only the run that is not cancelled may apply its result.
    let cancelled = false;
    const reconcile = (saved: unknown): PanelWindow[] => {
      const templates = (typeof given === 'function' ? given() : given) ?? [];
      // Drawn here, never inside an updater: React may run an updater twice.
      const result = reconcileWorkspace({ saved, templates, declared: typeof declared === 'function' ? declared() : declared, workspaceDefaults, rootId, current: panelsRef.current, freshId, order: i.order });
      const before = (saved as { dismissed?: unknown } | null)?.dismissed;
      // A tombstone the restore dropped is still in the file; the baseline must not match it, or the file keeps it until some other change is saved.
      tombstonesDropped.current = Array.isArray(before) && before.length !== result.dismissed.length;
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
      lastSaved.current = tombstonesDropped.current ? null : JSON.stringify(projectWorkspaceState(restored, rootId, dismissed.current));
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
    if (storage === undefined) {
      if (replay === true && !replayed.current) {
        replayed.current = true;
        fail();
      }
      return;
    }
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
    // A save in flight may land after this change, so a match with the baseline does not yet mean the file is right.
    if (json === lastSaved.current && inFlight.current === null) return;
    // No flush on unmount or quit: a change in the last quiet period is lost, never a torn write.
    const timer = setTimeout(() => {
      const flying = inFlight.current;
      // Equal content is already on its way, or the file holds it now.
      if (json === flying?.json || (flying === null && json === lastSaved.current)) return;
      started.current += 1;
      const n = started.current;
      inFlight.current = { n, json };
      // A thenable that settles twice, or throws after settling, is reported and applied once.
      let done = false;
      const settle = (failure: { e: unknown } | null): void => {
        if (done) return;
        done = true;
        if (inFlight.current?.n === n) inFlight.current = null;
        // A save that settles after a newer one started says nothing about what the file holds now.
        if (failure === null) {
          if (n === started.current) lastSaved.current = json;
        } else reportError(failure.e);
      };
      try {
        const outcome = storage.save(state) as unknown;
        if (typeof outcome === 'object' && outcome !== null && typeof (outcome as PromiseLike<unknown>).then === 'function') {
          (outcome as PromiseLike<unknown>).then(
            () => settle(null),
            (e) => settle({ e }),
          );
        } else settle(null);
      } catch (e) {
        settle({ e });
      }
    }, saveQuietMsRef.current);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storage and rootId never change
  }, [panels, settled]);

  // True at once without storage: there is nothing to wait for.
  return {
    restoreSettled: (storage === undefined && replay !== true) || settled,
    dismiss: (keys) => {
      dismissed.current = [...dismissed.current.filter((k) => !keys.includes(k)), ...keys].slice(-DISMISSED_LIMIT);
    },
    undismiss: (keys) => {
      if (dismissed.current.some((k) => keys.includes(k))) dismissed.current = dismissed.current.filter((k) => !keys.includes(k));
    },
    isDismissed: (key) => dismissed.current.includes(key),
  };
}
