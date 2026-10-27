/**
 * The column behind `createWorkspaceColumn`: React-free state that the `WorkspaceColumn` component draws. It owns the ordered
 * list of workspaces, their names and the current one, and saves the list through one optional storage. DESIGN.md, "The workspace column".
 */
import { createWorkspace, transferPanel } from './workspaceCore.js';
import { PanelManagerError } from './panelManagerError.js';
import { checkPatch, planTuning, unchanged } from './panelConfigure.js';
import { cleanWorkspaceName } from './workspaceName.js';
import { refusedLiveKeys } from './workspaceLive.js';
const CORES = new WeakMap();
/** What the component reads from a column. Throws `invalid-options` for anything `createWorkspaceColumn` did not make. @internal */
export function columnCoreOf(column) {
    const core = CORES.get(column);
    if (core === undefined)
        throw new PanelManagerError('invalid-options', 'expected a column made by createWorkspaceColumn');
    return core;
}
const isColumnState = (v) => {
    if (typeof v !== 'object' || v === null)
        return false;
    const s = v;
    if (s.version !== 1 || !Array.isArray(s.workspaces))
        return false;
    if (s.current !== null && typeof s.current !== 'string')
        return false;
    const seen = new Set();
    return s.workspaces.every((w) => {
        if (typeof w !== 'object' || w === null)
            return false;
        const { id, name } = w;
        if (typeof id !== 'string' || id === '' || typeof name !== 'string' || seen.has(id))
            return false;
        seen.add(id);
        return true;
    });
};
/**
 * A column of workspaces that renders itself (see `ColumnOptions.mount`) unless `mount: false` hands that to a `WorkspaceColumn`
 * the app draws. Add workspaces with `addWorkspace`.
 * @public
 */
export function createWorkspaceColumn(o = {}) {
    const { storage, mount, bands, ...shared } = o;
    let tuningInput = o.tuning;
    let live = {
        ...(o.device !== undefined ? { device: o.device } : {}),
        ...(o.settings !== undefined ? { settings: o.settings } : {}),
        ...(o.history !== undefined ? { history: o.history } : {}),
        ...(o.snapshots !== undefined ? { snapshots: o.snapshots } : {}),
        ...(o.labels !== undefined ? { labels: o.labels } : {}),
        ...(o.topInset !== undefined ? { topInset: o.topInset } : {}),
        ...(o.panels !== undefined ? { panels: o.panels } : {}),
    };
    const reportError = (e) => {
        if (o.onError === undefined)
            console.error(e);
        else {
            try {
                o.onError(e);
            }
            catch {
                // A reporter that throws must not break the work that raised the error.
            }
        }
    };
    let status = storage === undefined ? 'ready' : 'loading';
    let list = [];
    let current = -1;
    const listeners = new Set();
    const removers = [];
    let snap;
    let restoring = false;
    const changed = () => {
        snap = undefined;
        for (const l of [...listeners])
            l();
    };
    const snapshot = () => (snap ??= { status, workspaces: list, names: list.map((w) => w.name), current, labels: live.labels, topInset: live.topInset ?? 0, tuning: tuningInput });
    const state = () => ({ version: 1, workspaces: list.map((w) => ({ id: w.id, name: w.name })), current: list[current]?.id ?? null });
    // Saves go one after another so a slow one cannot land after the one that followed it.
    let saving = Promise.resolve();
    const persist = () => {
        if (storage === undefined || status !== 'ready' || restoring)
            return;
        const next = state();
        saving = saving.then(async () => {
            try {
                await storage.save(next);
            }
            catch (e) {
                reportError(e);
            }
        });
    };
    const commit = () => {
        changed();
        persist();
    };
    /** `movePanel`, or with `run` false `canMovePanel`. */
    const move = (from, panelId, to, options, run) => {
        const stay = (code, message) => ({ ok: false, code, message });
        if (status === 'disposed')
            return stay('disposed', 'the column was disposed');
        const at = (w) => (typeof w === 'number' ? (Number.isInteger(w) && w >= 0 && w < list.length ? w : -1) : list.indexOf(w));
        const source = at(from);
        const target = at(to);
        if (source < 0 || target < 0)
            return stay('unknown-workspace', `${source < 0 ? 'the source' : 'the target'} workspace is not in this column`);
        if (source === target)
            return stay('same-workspace', `panel '${panelId}' is already in workspace '${list[source].name}'`);
        const moved = transferPanel(list[source], panelId, list[target], options ?? {}, run);
        if (!moved.ok)
            return moved;
        return { ok: true, workspace: list[target], index: target, panelId, panelIds: moved.panelIds };
    };
    const freeName = () => {
        const used = new Set(list.map((w) => w.name));
        for (let n = list.length + 1;; n++)
            if (!used.has(`Workspace ${n}`))
                return `Workspace ${n}`;
    };
    const freeId = () => {
        const ids = new Set(list.map((w) => w.id));
        for (let n = list.length + 1;; n++)
            if (!ids.has(`workspace-${n}`))
                return `workspace-${n}`;
    };
    const make = (id, name) => {
        const panels = storage?.workspace?.(id);
        const ws = createWorkspace({
            ...shared,
            ...live,
            ...(tuningInput !== undefined ? { tuning: tuningInput } : {}),
            ...(panels !== undefined ? { storage: panels } : {}),
            id,
            name,
            mount: false,
            onRename: () => {
                if (!restoring)
                    commit();
            },
        });
        removers.push(() => ws.dispose());
        return ws;
    };
    const insert = (ws, index) => {
        const at = index === undefined || !Number.isFinite(index) ? list.length : Math.max(0, Math.min(list.length, Math.trunc(index)));
        const cur = list[current];
        list = [...list.slice(0, at), ws, ...list.slice(at)];
        current = cur === undefined ? at : list.indexOf(cur);
    };
    const column = {
        get status() {
            return status;
        },
        get workspaces() {
            return list;
        },
        get current() {
            return current;
        },
        addWorkspace: (a = {}) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the column was disposed');
            const id = a.id ?? freeId();
            if (list.some((w) => w.id === id))
                throw new PanelManagerError('invalid-options', `the column already has a workspace '${id}'`);
            const ws = make(id, cleanWorkspaceName(a.name) ?? freeName());
            insert(ws, a.index);
            commit();
            return ws;
        },
        scrollTo: (target) => {
            if (status === 'disposed')
                return;
            const i = typeof target === 'number' ? target : list.indexOf(target);
            if (!Number.isInteger(i) || i < 0 || i >= list.length || i === current)
                return;
            current = i;
            commit();
        },
        step: (direction) => {
            const next = current + (direction === 'up' ? -1 : 1);
            if (status === 'disposed' || next < 0 || next >= list.length)
                return false;
            current = next;
            commit();
            return true;
        },
        removeWorkspace: (target) => {
            const i = typeof target === 'number' ? target : list.indexOf(target);
            if (status !== 'ready' || list.length < 2 || !Number.isInteger(i) || i < 0 || i >= list.length)
                return false;
            const removed = list[i];
            const cur = list[current];
            removed.dispose();
            list = list.filter((w) => w !== removed);
            current = cur === removed ? Math.min(i, list.length - 1) : cur === undefined ? -1 : list.indexOf(cur);
            commit();
            return true;
        },
        movePanel: (from, panelId, to, options) => move(from, panelId, to, options, true),
        canMovePanel: (from, panelId, to, options) => move(from, panelId, to, options, false),
        configureTuning: (patch) => {
            if (status === 'disposed')
                return { ok: false, code: 'disposed', message: 'the column was disposed' };
            const checked = checkPatch('tuning', patch);
            if ('refusal' in checked)
                return { ok: false, ...checked.refusal };
            const plan = planTuning(tuningInput, patch);
            if (!plan.changed)
                return unchanged();
            tuningInput = plan.input;
            for (const w of list)
                w.panels.configureTuning(patch);
            changed();
            return { ok: true, changed: true, shown: false, now: plan.now, later: plan.later, shadowed: [], notes: [] };
        },
        update: (change) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the column was disposed');
            const refused = refusedLiveKeys(change);
            if (refused.length > 0)
                throw new PanelManagerError('invalid-options', `update cannot change ${refused.join(', ')}: only device, settings, history, snapshots, labels, topInset and panels are live`);
            live = { ...live, ...change };
            for (const w of list)
                w.update(change);
            changed();
        },
        dispose: () => {
            if (status === 'disposed')
                return;
            status = 'disposed';
            for (const remove of removers.splice(0))
                remove();
            list = [];
            current = -1;
            changed();
            listeners.clear();
        },
    };
    CORES.set(column, {
        subscribe: (l) => {
            listeners.add(l);
            return () => void listeners.delete(l);
        },
        snapshot,
        autoMounted: mount !== false && typeof document !== 'undefined',
        theme: o.theme,
        bands,
        reportError,
    });
    if (storage !== undefined) {
        // The saved list is laid around the workspaces code added before it arrived: saved ones keep their saved order and name.
        void Promise.resolve()
            .then(() => storage.load())
            .catch(() => null)
            .then((saved) => {
            if (status === 'disposed')
                return;
            restoring = true;
            try {
                if (isColumnState(saved)) {
                    const keep = list[current]?.id;
                    const byId = new Map(list.map((w) => [w.id, w]));
                    const ordered = [];
                    for (const s of saved.workspaces) {
                        const have = byId.get(s.id);
                        if (have === undefined)
                            ordered.push(make(s.id, cleanWorkspaceName(s.name) ?? freeName()));
                        else {
                            have.rename(s.name);
                            ordered.push(have);
                            byId.delete(s.id);
                        }
                    }
                    list = [...ordered, ...byId.values()];
                    const id = saved.current ?? keep;
                    const at = list.findIndex((w) => w.id === id);
                    current = at >= 0 ? at : list.length > 0 ? Math.min(Math.max(current, 0), list.length - 1) : -1;
                }
            }
            finally {
                restoring = false;
            }
            status = 'ready';
            changed();
            persist();
        });
    }
    if (CORES.get(column)?.autoMounted === true) {
        // Loaded on demand so a column that never mounts keeps `react-dom/client` off its import path; a mount that outlives a dispose is undone at once.
        void import('./autoMount.js')
            .then((m) => {
            if (status === 'disposed')
                return;
            removers.push(m.mountColumn(column, mount === false ? undefined : mount, reportError));
        })
            .catch(reportError);
    }
    return column;
}
