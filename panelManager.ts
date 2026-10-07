/**
 * The workspace's manager: read access to every panel by id, as handles, and the pieces every operation on a handle
 * is answered with. The pin, configure and reset members are added to it by the entries that own them.
 */
import type { JsonValue } from './hostApi.js';
import { filterStates, type PanelHandle, type ReadSource } from './panelHandles.js';
import type { PanelRefusal } from './panelManagerError.js';
import type { PanelId } from './panelSettings.js';
import type { ListFilter, PanelSnapshot } from './panelTemplate.js';

/**
 * What an operation on a handle answers: `ok` with whether anything was dispatched, or a refusal that touched nothing.
 * @public
 */
export type PanelResult =
  | {
      /** The operation was accepted. */
      readonly ok: true;
      /** True when a change was dispatched; false for an accepted call that had nothing to do. */
      readonly changed: boolean;
    }
  | {
      /** The operation was refused and nothing changed. */
      readonly ok: false;
      /** Why it was refused. */
      readonly code: PanelRefusal;
      /** A sentence saying which panel and what stood in the way. */
      readonly message: string;
    };

/** Who an operation is for: code, which leaves the person's arrangement alone, or a person's own gesture, which records it. @internal */
export type PanelOpSource = 'code' | 'person';

/** An accepted operation. @internal */
export const accepted = (changed: boolean): PanelResult => ({ ok: true, changed });

/** A refusal; the caller has touched nothing. @internal */
export const refused = (code: PanelRefusal, message: string): PanelResult => ({ ok: false, code, message });

/**
 * Every panel of a workspace by id. Read members only.
 * @public
 */
export interface PanelManager {
  /** The handle of the panel with this id, or undefined when the workspace knows none. */
  get<P extends JsonValue = JsonValue>(id: PanelId): PanelHandle<P> | undefined;
  /** A handle for every panel `f` keeps; all panels when `f` is left out. */
  list(f?: ListFilter): readonly PanelHandle[];
  /** A readonly picture of the whole workspace, the same object until something changes. */
  getSnapshot(): PanelSnapshot;
  /** Calls `l` when the workspace changes; returns a function that stops the calls. */
  subscribe(l: () => void): () => void;
}

/** The manager over `source`. @internal */
export function makePanelManager(source: ReadSource): PanelManager {
  return {
    get: <P extends JsonValue = JsonValue>(id: PanelId) => source.handleOf(id) as PanelHandle<P> | undefined,
    list: (f) =>
      filterStates(source.getSnapshot().panels, f)
        .map((s) => source.handleOf(s.id))
        .filter((h): h is PanelHandle => h !== undefined),
    getSnapshot: () => source.getSnapshot(),
    subscribe: (l) => source.subscribe(l),
  };
}
