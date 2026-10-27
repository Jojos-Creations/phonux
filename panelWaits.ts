/**
 * Waiting on the row instead of on a timer. A panel takes one operation a turn: a second call on it in the same turn answers
 * `busy`, and a panel just added or shown is live only once the row has drawn it. These calls retry when the workspace changes,
 * and once more at the turn's end for a `busy`, since the turn's gate clears without the snapshot changing.
 */
import { columnCoreOf, type WorkspaceColumnHandle } from './columnHandle.js';
import type { PanelManager, PanelResult } from './panelManager.js';
import type { PanelRefusal } from './panelManagerError.js';
import type { PanelId } from './panelSettings.js';
import type { PanelState } from './panelTemplate.js';

/** Refusals a later turn can clear. */
const PASSING: ReadonlySet<PanelRefusal> = new Set<PanelRefusal>(['busy', 'is-pending', 'not-live', 'not-ready', 'not-attached']);

/** What every operation answers, a `PanelResult` or a `ConfigureResult`: accepted, or refused with a code. */
type Answer = { readonly ok: true } | { readonly ok: false; readonly code: PanelRefusal };

/** Whether `r` is a refusal a later turn can clear. */
const passes = (r: Answer): boolean => !r.ok && PASSING.has(r.code);

/** How long a wait lasts by default before it gives up. */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Options for the waits.
 * @public
 */
export interface WaitOptions {
  /**
   * How long to wait before giving up, in ms.
   * @defaultValue 2000
   */
  readonly timeoutMs?: number;
}

/**
 * Runs `op` (a handle or `configure` call such as `() => panels.get(id)?.scrollTo('center') ?? refused`) now and, while it answers a refusal a later
 * turn can clear (`busy`, `is-pending`, `not-live`, `not-ready`, `not-attached`), again whenever the workspace changes and at the end
 * of the turn, until it is accepted, refused for good, or the wait runs out. Resolves with the last answer.
 * @public
 */
export function whenAccepted<R extends Answer>(panels: Pick<PanelManager, 'subscribe'>, op: () => R, options?: WaitOptions): Promise<R> {
  return new Promise((resolve) => {
    let last = op();
    if (!passes(last)) {
      resolve(last);
      return;
    }
    let done = false;
    let turn: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      done = true;
      unsubscribe();
      clearTimeout(timer);
      clearTimeout(turn);
      resolve(last);
    };
    const attempt = (): void => {
      if (done) return;
      last = op();
      if (!passes(last)) finish();
      else nextTurn();
    };
    // A busy panel frees at the turn's end, which changes nothing a subscriber hears.
    const nextTurn = (): void => {
      if (!(last as Answer).ok && (last as Answer & { ok: false }).code === 'busy' && turn === undefined) turn = setTimeout(() => {
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
export function whenPanel(panels: Pick<PanelManager, 'get' | 'subscribe'>, id: PanelId, test: (state: PanelState) => boolean = (s) => s.status === 'live', options?: WaitOptions): Promise<PanelState | undefined> {
  const read = (): PanelState | undefined => {
    const handle = panels.get(id);
    if (handle === undefined) return undefined;
    const state = handle.getState();
    return test(state) ? state : undefined;
  };
  return new Promise((resolve) => {
    const now = read();
    if (now !== undefined) {
      resolve(now);
      return;
    }
    const finish = (state: PanelState | undefined): void => {
      unsubscribe();
      clearTimeout(timer);
      resolve(state);
    };
    const unsubscribe = panels.subscribe(() => {
      const state = read();
      if (state !== undefined) finish(state);
    });
    const timer = setTimeout(() => finish(undefined), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
}

/**
 * Puts away the panels of `hide` and then brings in those of `show`, each as soon as the row takes it: a show in the same turn as
 * the hides would still count them against the row's room. Resolves once every call is answered, with the answers in order (hides
 * first).
 * @public
 */
export async function showPanels(panels: Pick<PanelManager, 'get' | 'subscribe'>, show: readonly PanelId[], hide: readonly PanelId[] = [], options?: WaitOptions): Promise<readonly PanelResult[]> {
  const gone: PanelResult = { ok: false, code: 'unknown-panel', message: 'no such panel' };
  const hidden = await Promise.all(hide.map((id) => whenAccepted(panels, () => panels.get(id)?.hide('code') ?? gone, options)));
  if (hidden.some((r) => r.ok && r.changed)) {
    await Promise.all(hide.map((id) => whenPanel(panels, id, (s) => s.status !== 'live', options)));
    // The hides' own turn still counts them against the row's room until it ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const shown = await Promise.all(show.map((id) => whenAccepted(panels, () => panels.get(id)?.show('code') ?? gone, options)));
  return [...hidden, ...shown];
}

/**
 * Resolves true once `column` and every workspace in it have read what was saved (status `ready`), or false when the wait runs out
 * first. Hold the page back on it, so a default workspace is never shown and then replaced.
 * @public
 */
export function whenColumnReady(column: WorkspaceColumnHandle, options?: WaitOptions): Promise<boolean> {
  const ready = (): boolean => column.status === 'ready' && column.workspaces.every((w) => w.status === 'ready');
  return new Promise((resolve) => {
    if (ready()) {
      resolve(true);
      return;
    }
    const offs: (() => void)[] = [];
    let done = false;
    const finish = (ok: boolean): void => {
      done = true;
      for (const off of offs.splice(0)) off();
      clearTimeout(timer);
      resolve(ok);
    };
    // Workspaces come and go while the column restores, so each change subscribes to the ones there are now.
    const watch = (): void => {
      if (done) return;
      if (ready()) {
        finish(true);
        return;
      }
      for (const off of offs.splice(1)) off();
      for (const w of column.workspaces) offs.push(w.panels.subscribe(watch));
    };
    offs.push(columnCoreOf(column).subscribe(watch));
    const timer = setTimeout(() => finish(false), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    watch();
  });
}
