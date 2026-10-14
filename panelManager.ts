/**
 * The workspace's manager: every panel by id as a handle, the three configure calls and `resetLayout`, and the pieces
 * every operation on a handle is answered with.
 */
import type { JsonValue } from './hostApi.js';
import { filterStates, type PanelHandle, type ReadSource } from './panelHandles.js';
import type { PanelRefusal } from './panelManagerError.js';
import type { CatalogName, PanelId, SettingNote, WorkspaceTuning } from './panelSettings.js';
import type { InstancePatch, SettingsPatch } from './settingsPatch.js';
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

/**
 * What `pin()` and `unpin()` answer: a `PanelResult` and, where it applies, whether the pin showed a hidden panel,
 * whether it was stored for the panel's next show, and, for a refusal of `settings-conflict`, the setting in the way.
 * @public
 */
export type PinResult = PanelResult & {
  /** True when the pin showed a parked or hidden panel and applied in the same commit. */
  readonly shown?: boolean;
  /** True when the pin was stored to apply the next time the panel is live. */
  readonly deferred?: boolean;
  /** The catalog name of the explicit setting a fixed pin would override, with a `settings-conflict` refusal. */
  readonly setting?: CatalogName;
};

/**
 * What `resetLayout` answers: a `PanelResult` and the panels it reset, the live panels it parked to make a larger
 * tier fit, and the parked ones the room it freed brings back.
 * @public
 */
export type ResetResult = PanelResult & {
  /** The panels that were reset. */
  readonly panels?: readonly PanelId[];
  /** The panels parked because a tier no longer fits. */
  readonly parked?: readonly PanelId[];
  /** The parked panels that return because the reset freed room. */
  readonly returned?: readonly PanelId[];
};

/**
 * What `configure`, `configureTemplate` and `configureTuning` answer: on success whether anything was stored, the setting
 * names that act in this commit (`now`), the ones that apply at the next use (`later`), the ones a person's override or a
 * forced rule still outvotes (`shadowed`) and the runtime notes the change raised; on refusal the code, a sentence, and the
 * catalog name of the key at fault where one is.
 * @public
 */
export type ConfigureResult =
  | {
      /** The change was accepted. */
      readonly ok: true;
      /** True when a different value was stored or a waiting flip of `parkable` was cancelled; false for an equal or empty patch. */
      readonly changed: boolean;
      /** True only when a flip of `parkable` showed a parked or hidden panel under `pinningWhenNotLive` 'show'; otherwise false. */
      readonly shown: boolean;
      /** The catalog names applied in this commit. */
      readonly now: readonly string[];
      /** The catalog names stored for the next time the panel or the workspace reads them. */
      readonly later: readonly string[];
      /** The catalog names the patch set that a person's override or a forced rule outvotes. */
      readonly shadowed: readonly string[];
      /** The notes the change raised. */
      readonly notes: readonly SettingNote[];
    }
  | {
      /** The change was refused and nothing changed. */
      readonly ok: false;
      /** Why it was refused. */
      readonly code: PanelRefusal;
      /** A sentence saying which panel and what stood in the way. */
      readonly message: string;
      /** The catalog name of the key at fault: for `settings-conflict` the conflict's key, for `wrong-scope` and `not-view-settable` the key asked. */
      readonly setting?: string;
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
  /** The handle of the panel with this id, or undefined when the workspace knows none. `P` is an unchecked cast: nothing compares it with the panel's template. */
  get<P extends JsonValue = JsonValue>(id: PanelId): PanelHandle<P> | undefined;
  /** A handle for every panel `f` keeps; all panels when `f` is left out. */
  list(f?: ListFilter): readonly PanelHandle[];
  /** Changes settings of one panel after it was added; `null` removes an instance value. All or nothing, in one update. A flip of `parkable` on a panel that is not live follows `pinningWhenNotLive`: it may be refused with `would-reshape-row` or `is-closed`, show the panel, or wait and be listed in `later`. */
  configure(id: PanelId, patch: InstancePatch): ConfigureResult;
  /** Changes the template-scope settings (`hostCreatable`, `multiple`, `maxInstances`) of a template for panels made from now on. Kept for this session only. */
  configureTemplate(templateId: string, patch: Pick<SettingsPatch, 'hostCreatable' | 'multiple' | 'maxInstances'>): ConfigureResult;
  /** Changes the workspace's tuning keys; a per-panel key sets the workspace default. Kept for this session only. */
  configureTuning(patch: { [K in keyof WorkspaceTuning]?: WorkspaceTuning[K] | null }): ConfigureResult;
  /** Clears the person's overrides and any deferred pin of one panel, or of every panel but the root with 'all', and applies the cascade defaults now, in one update. */
  resetLayout(target: PanelId | 'all'): ResetResult;
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
    configure: (id, patch) => source.configure(id, patch, 'panel'),
    configureTemplate: (templateId, patch) => source.configureTemplate(templateId, patch),
    configureTuning: (patch) => source.configureTuning(patch),
    resetLayout: (target) => source.resetLayout(target),
    getSnapshot: () => source.getSnapshot(),
    subscribe: (l) => source.subscribe(l),
  };
}
