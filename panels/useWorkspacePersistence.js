/**
 * Keeps the panel list between launches through a host's `WorkspaceStorage`: one restore at mount, then a
 * debounced save of every committed change; a save that fails is saved again by the next change. The restore is
 * `reconcileWorkspace`, called in the load's success handler; a throw there takes the same path as a failed load, so
 * the workspace always settles. With no storage it does nothing: no state, no promise, no timer.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPanelList } from './panelList.js';
import { computeRowOrder } from '../panelRowOrder.js';
import { SAVE_QUIET_MS } from '../rowConstants.js';
import { setSlots, slotsOf } from '../panelWindow.js';
import { seedEngineIdsPast } from '../workspaceCore.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import { cleanSavedScroll, DISMISSED_LIMIT, isWorkspaceState, projectWorkspaceState, savedNames } from '../workspaceState.js';
export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };
export function useWorkspacePersistence(i) {
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
    const reportError = (e) => {
        if (onErrorRef.current === undefined) {
            console.error(e);
            return;
        }
        try {
            onErrorRef.current(e);
        }
        catch {
            // A reporter that throws must not break the save that raised the error.
        }
    };
    // State, not a ref: opening the gate must re-run the save effect, or a change committed while load() was
    // pending (with nothing to restore) would never be saved.
    const [settledStore] = useState(() => createPanelList(false));
    const settled = useSyncExternalStore(settledStore.subscribe, settledStore.get, settledStore.get);
    // The JSON the file is known to hold: restored, or saved and settled without error. A projection equal to it is not saved again.
    const lastSaved = useRef(null);
    // The newest save that has not settled; a change that projects to the same JSON is already on its way.
    const inFlight = useRef(null);
    const started = useRef(0);
    // The tombstones the file held, written back with every save; `dismiss` and `undismiss` edit them.
    const dismissed = useRef([]);
    const tombstonesDropped = useRef(false);
    // The restore found a saved entry with no usable uid and minted one: the file lacks what the list holds.
    const uidsMinted = useRef(false);
    // Panels already in the row that take the uid the file holds for them.
    const adoptedUids = useRef(new Map());
    // The row's rest: the one the file held, then the one a person's move last left it on. Saved with the panels.
    const [scrollStore] = useState(() => createPanelList(null));
    const scroll = useSyncExternalStore(scrollStore.subscribe, scrollStore.get, scrollStore.get);
    const setScroll = scrollStore.set;
    useEffect(() => {
        // StrictMode runs this effect twice; only the run that is not canceled may apply its result.
        let cancelled = false;
        // The file's rest, named by the id of the panel this launch gives its entry: the entry is matched by its uid, which
        // a file keeps for every panel it saves (an older file names it by the entry's id). The root keeps its own id. A malformed rest is dropped with a note.
        const savedRest = (loaded, restored) => {
            if (!isWorkspaceState(loaded))
                return undefined;
            const drops = [];
            const rest = cleanSavedScroll(loaded.scroll, drops);
            for (const d of drops) {
                try {
                    onNote?.({ code: 'invalid-saved-setting', ...d });
                }
                catch {
                    // A reporter that throws must not break the restore that raised the note.
                }
            }
            if (rest === undefined)
                return undefined;
            if (rest.panel === rootId)
                return rest;
            const uid = savedNames(loaded.panels, loaded.panels.map((p) => p.uid)).get(rest.panel);
            if (uid === undefined)
                return undefined;
            const id = restored.find((p) => p.uid === uid)?.id ?? [...adoptedUids.current].find(([, held]) => held === uid)?.[0] ?? panelsRef.current.find((p) => p.uid === uid)?.id;
            return id === undefined ? undefined : { panel: id, offset: rest.offset };
        };
        const reconcile = (saved) => {
            const templates = (typeof given === 'function' ? given() : given) ?? [];
            // Drawn here, never inside an updater: React may run an updater twice.
            const result = reconcileWorkspace({ saved, templates, declared: typeof declared === 'function' ? declared() : declared, workspaceDefaults, rootId, current: panelsRef.current, freshId, order: i.order, ...(i.panelTitle !== undefined ? { panelTitle: i.panelTitle } : {}) });
            const before = saved?.dismissed;
            // A tombstone the restore dropped is still in the file; the baseline must not match it, or the file keeps it until some other change is saved.
            tombstonesDropped.current = Array.isArray(before) && before.length !== result.dismissed.length;
            dismissed.current = result.dismissed;
            uidsMinted.current = result.minted;
            adoptedUids.current = new Map(result.adopted.map((a) => [a.id, a.uid]));
            for (const note of result.notes) {
                if (note.code === 'workspace-ignored')
                    console.warn(note.message);
                try {
                    onNote?.(note);
                }
                catch {
                    // A reporter that throws must not break the restore that raised the note.
                }
            }
            seedEngineIdsPast(result.entries.map((p) => p.key));
            return result.entries.map((p) => {
                const hostData = defaultHostData?.();
                return hostData === undefined ? p : { ...p, hostData };
            });
        };
        const settle = (restored, rootSlots, mark) => {
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
            const resting = i.restAtPhone?.() === true ? restored.map((p) => (slotsOf(p) > 1 ? { ...p, slots: 1, savedSlots: slotsOf(p) } : p)) : restored;
            if (resting.length > 0 || rootSlots !== undefined || adopt.size > 0) {
                setPanels((prev) => {
                    const adoptedRow = adopt.size === 0 ? prev : prev.map((p) => (adopt.has(p.id) ? { ...p, uid: adopt.get(p.id) } : p));
                    const added = resting.length > 0 ? computeRowOrder([...adoptedRow, ...resting], rootId) : adoptedRow;
                    return rootSlots === undefined ? added : setSlots(added, rootId, rootSlots);
                });
            }
            settledStore.set(true);
        };
        // A failed load, or a restore that threw, still gets the panels code declares; a restore that cannot even do that restores nothing.
        const fail = () => {
            let restored = [];
            try {
                restored = reconcile(null);
            }
            catch {
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
        new Promise((resolve) => resolve(storage.load())).then((loaded) => {
            if (cancelled)
                return;
            let restored;
            try {
                restored = reconcile(loaded);
            }
            catch {
                fail();
                return;
            }
            const saved = loaded?.rootSlots;
            const rest = savedRest(loaded, restored);
            settle(restored, typeof saved === 'number' && Number.isInteger(saved) && saved >= 1 ? saved : undefined, rest);
        }, () => {
            if (cancelled)
                return;
            fail();
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the inputs are read once
    }, []);
    useEffect(() => {
        if (storage === undefined || !settled)
            return;
        const state = projectWorkspaceState(panels, rootId, dismissed.current, scroll ?? undefined);
        const json = JSON.stringify(state);
        // A save in flight may land after this change, so a match with the baseline does not yet mean the file is right.
        if (json === lastSaved.current && inFlight.current === null)
            return;
        // No flush on unmount or quit: a change in the last quiet period is lost, never a torn write.
        const timer = setTimeout(() => {
            const flying = inFlight.current;
            // Equal content is already on its way, or the file holds it now.
            if (json === flying?.json || (flying === null && json === lastSaved.current))
                return;
            started.current += 1;
            const n = started.current;
            inFlight.current = { n, json };
            // A thenable that settles twice, or throws after settling, is reported and applied once.
            let done = false;
            const settle = (failure) => {
                if (done)
                    return;
                done = true;
                if (inFlight.current?.n === n)
                    inFlight.current = null;
                // A save that settles after a newer one started says nothing about what the file holds now.
                if (failure === null) {
                    if (n === started.current)
                        lastSaved.current = json;
                }
                else
                    reportError(failure.e);
            };
            try {
                const outcome = storage.save(state);
                if (typeof outcome === 'object' && outcome !== null && typeof outcome.then === 'function') {
                    outcome.then(() => settle(null), (e) => settle({ e }));
                }
                else
                    settle(null);
            }
            catch (e) {
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
            if (dismissed.current.some((k) => keys.includes(k)))
                dismissed.current = dismissed.current.filter((k) => !keys.includes(k));
        },
        isDismissed: (key) => dismissed.current.includes(key),
        scroll,
        setScroll,
    };
}
