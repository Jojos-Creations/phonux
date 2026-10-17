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
import { setSlots, type PanelWindow } from '../panelWindow.js';
import { seedEngineIdsPast } from '../workspaceCore.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import type { DeclaredPanel } from '../workspacePlan.js';
import { cleanSavedScroll, DISMISSED_LIMIT, isWorkspaceState, projectWorkspaceState } from '../workspaceState.js';
import type { Dropped, WorkspaceState, WorkspaceStorage } from '../workspaceState.js';

/** Where the row rested: the id of a panel this launch, and the offset of the stop from its left edge in phone widths. */
export type RestMark = NonNullable<WorkspaceState['scroll']>;

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
  /** The title a declared panel gets when no settings layer names one. */
  panelTitle?: (id: string) => string;
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
  /** The saved rest this launch restored, then the one the row last came to rest on; null when there is none. */
  scroll: RestMark | null;
  setScroll: Dispatch<SetStateAction<RestMark | null>>;
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
  // The restore found a saved entry with no usable uid and minted one: the file lacks what the list holds.
  const uidsMinted = useRef(false);
  // Panels already in the row that take the uid the file holds for them.
  const adoptedUids = useRef<Map<string, string>>(new Map());
  // The row's rest: the one the file held, then the one a person's move last left it on. Saved with the panels.
  const [scroll, setScroll] = useState<RestMark | null>(null);

  useEffect(() => {
    // StrictMode runs this effect twice; only the run that is not cancelled may apply its result.
    let cancelled = false;
    // The file's rest, named by the id of the panel this launch gives its entry: the entry is matched by its uid, which
    // a file keeps for every panel it saves. The root keeps its own id. A malformed rest is dropped with a note.
    const savedRest = (loaded: WorkspaceState | null, restored: PanelWindow[]): RestMark | undefined => {
      if (!isWorkspaceState(loaded)) return undefined;
      const drops: Dropped[] = [];
      const rest = cleanSavedScroll(loaded.scroll, drops);
      for (const d of drops) {
        try {
          onNote?.({ code: 'invalid-saved-setting', ...d });
        } catch {
          // A reporter that throws must not break the restore that raised the note.
        }
      }
      if (rest === undefined) return undefined;
      if (rest.panel === rootId) return rest;
      const uid = loaded.panels.find((p) => p.id === rest.panel)?.uid;
      if (uid === undefined) return undefined;
      const id = restored.find((p) => p.uid === uid)?.id ?? [...adoptedUids.current].find(([, held]) => held === uid)?.[0] ?? panelsRef.current.find((p) => p.uid === uid)?.id;
      return id === undefined ? undefined : { panel: id, offset: rest.offset };
    };
    const reconcile = (saved: unknown): PanelWindow[] => {
      const templates = (typeof given === 'function' ? given() : given) ?? [];
      // Drawn here, never inside an updater: React may run an updater twice.
      const result = reconcileWorkspace({ saved, templates, declared: typeof declared === 'function' ? declared() : declared, workspaceDefaults, rootId, current: panelsRef.current, freshId, order: i.order, ...(i.panelTitle !== undefined ? { panelTitle: i.panelTitle } : {}) });
      const before = (saved as { dismissed?: unknown } | null)?.dismissed;
      // A tombstone the restore dropped is still in the file; the baseline must not match it, or the file keeps it until some other change is saved.
      tombstonesDropped.current = Array.isArray(before) && before.length !== result.dismissed.length;
      dismissed.current = result.dismissed;
      uidsMinted.current = result.minted;
      adoptedUids.current = new Map(result.adopted.map((a) => [a.id, a.uid]));
      for (const note of result.notes) {
        if (note.code === 'workspace-ignored') console.warn(note.message);
        try {
          onNote?.(note);
        } catch {
          // A reporter that throws must not break the restore that raised the note.
        }
      }
      seedEngineIdsPast(result.entries.map((p) => p.key));
      return result.entries.map((p) => {
        const hostData = defaultHostData?.();
        return hostData === undefined ? p : { ...p, hostData };
      });
    };
    const settle = (restored: PanelWindow[], rootSlots?: number, mark?: RestMark): void => {
      // The baseline is what the restored list projects to, not the file: saved ids differ from fresh ones,
      // and comparing against the file would save at every launch. A null baseline makes the first save go out.
      // The save effect projects the root too (its key and slot count), so the baseline holds the root as the restore leaves it.
      const root = panelsRef.current.filter((p) => p.id === rootId);
      const rowed = computeRowOrder([...root, ...restored], rootId);
      const baseline = rootSlots === undefined ? rowed : setSlots(rowed, rootId, rootSlots);
      lastSaved.current = tombstonesDropped.current || uidsMinted.current ? null : JSON.stringify(projectWorkspaceState(baseline, rootId, dismissed.current, mark));
      setScroll(mark ?? null);
      // Appended after what is already there, so a panel created while load() was pending survives. The root's saved size goes through setSlots, so a root that cannot resize ignores it.
      const adopt = adoptedUids.current;
      if (restored.length > 0 || rootSlots !== undefined || adopt.size > 0) {
        setPanels((prev) => {
          const adoptedRow = adopt.size === 0 ? prev : prev.map((p) => (adopt.has(p.id) ? { ...p, uid: adopt.get(p.id)! } : p));
          const added = restored.length > 0 ? computeRowOrder([...adoptedRow, ...restored], rootId) : adoptedRow;
          return rootSlots === undefined ? added : setSlots(added, rootId, rootSlots);
        });
      }
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
        const saved = (loaded as { rootSlots?: unknown } | null)?.rootSlots;
        const rest = savedRest(loaded, restored);
        settle(restored, typeof saved === 'number' && Number.isInteger(saved) && saved >= 1 ? saved : undefined, rest);
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
    const state = projectWorkspaceState(panels, rootId, dismissed.current, scroll ?? undefined);
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
  }, [panels, settled, scroll]);

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
    scroll,
    setScroll,
  };
}
