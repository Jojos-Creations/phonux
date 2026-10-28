/**
 * Waiting on the row instead of on a timer. A panel takes one operation a turn: a second call on it in the same turn answers
 * `busy`, and a panel just added or shown is live only once the row has drawn it. These calls retry when the workspace changes,
 * and once more at the turn's end for a `busy`, since the turn's gate clears without the snapshot changing.
 */
import { columnCoreOf } from './columnHandle.js';
/** Refusals a later turn can clear. */
const PASSING = new Set(['busy', 'is-pending', 'not-live', 'not-ready', 'not-attached']);
/** Whether `r` is a refusal a later turn can clear. */
const passes = (r) => !r.ok && PASSING.has(r.code);
/** How long a wait lasts by default before it gives up. */
const DEFAULT_TIMEOUT_MS = 2000;
/**
 * Runs `op` (a handle or `configure` call such as `() => panels.get(id)?.scrollTo('center') ?? refused`) now and, while it answers a refusal a later
 * turn can clear (`busy`, `is-pending`, `not-live`, `not-ready`, `not-attached`), again whenever the workspace changes and at the end
 * of the turn, until it is accepted, refused for good, or the wait runs out. Resolves with the last answer.
 * @public
 */
export function whenAccepted(panels, op, options) {
    return new Promise((resolve) => {
        let last = op();
        if (!passes(last)) {
            resolve(last);
            return;
        }
        let done = false;
        let turn;
        const finish = () => {
            done = true;
            unsubscribe();
            clearTimeout(timer);
            clearTimeout(turn);
            resolve(last);
        };
        const attempt = () => {
            if (done)
                return;
            last = op();
            if (!passes(last))
                finish();
            else
                nextTurn();
        };
        // A busy panel frees at the turn's end, which changes nothing a subscriber hears.
        const nextTurn = () => {
            if (!last.ok && last.code === 'busy' && turn === undefined)
                turn = setTimeout(() => {
                    turn = undefined;
                    attempt();
                }, 0);
        };
        const unsubscribe = panels.subscribe(attempt);
        const timer = setTimeout(finish, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        nextTurn();
    });
}
/**
 * Resolves with panel `id`'s state once `test` passes on it (by default: the panel is live), or undefined when the wait runs out
 * first. Checked now and on every change of the workspace.
 * @public
 */
export function whenPanel(panels, id, test = (s) => s.status === 'live', options) {
    const read = () => {
        const handle = panels.get(id);
        if (handle === undefined)
            return undefined;
        const state = handle.getState();
        return test(state) ? state : undefined;
    };
    return new Promise((resolve) => {
        const now = read();
        if (now !== undefined) {
            resolve(now);
            return;
        }
        const finish = (state) => {
            unsubscribe();
            clearTimeout(timer);
            resolve(state);
        };
        const unsubscribe = panels.subscribe(() => {
            const state = read();
            if (state !== undefined)
                finish(state);
        });
        const timer = setTimeout(() => finish(undefined), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
}
/**
 * Puts away the panels of `hide` and brings in those of `show` in one update (`PanelManager.swap`), as soon as the row takes it,
 * and resolves with its answer once every shown panel is live: one commit, so the old set leaves, the new set arrives and the row
 * re-centers in one motion. A `busy` answer is retried as `whenAccepted` retries it.
 * @public
 */
export async function showPanels(panels, show, hide = [], options) {
    const result = await whenAccepted(panels, () => panels.swap(show, hide), options);
    if (result.ok && result.changed)
        await Promise.all(show.map((entry) => whenPanel(panels, typeof entry === 'string' ? entry : entry.id, (s) => s.status === 'live', options)));
    return result;
}
/**
 * Resolves true once `column` and every workspace in it have read what was saved (status `ready`), or false when the wait runs out
 * first. Hold the page back on it, so a default workspace is never shown and then replaced.
 * @public
 */
export function whenColumnReady(column, options) {
    const ready = () => column.status === 'ready' && column.workspaces.every((w) => w.status === 'ready');
    return new Promise((resolve) => {
        if (ready()) {
            resolve(true);
            return;
        }
        const offs = [];
        let done = false;
        const finish = (ok) => {
            done = true;
            for (const off of offs.splice(0))
                off();
            clearTimeout(timer);
            resolve(ok);
        };
        // Workspaces come and go while the column restores, so each change subscribes to the ones there are now.
        const watch = () => {
            if (done)
                return;
            if (ready()) {
                finish(true);
                return;
            }
            for (const off of offs.splice(1))
                off();
            for (const w of column.workspaces)
                offs.push(w.panels.subscribe(watch));
        };
        offs.push(columnCoreOf(column).subscribe(watch));
        const timer = setTimeout(() => finish(false), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        watch();
    });
}
