/**
 * The read side of a panel: the handle a workspace hands out for one panel, and the reader a template's view
 * receives for all of them. Both are plain objects holding a source and an id, so they stay valid before the panel
 * exists, while it is live and after the workspace detaches. Only read members live here.
 */
import type { JsonValue } from './hostApi.js';
import type { PanelId, PanelSettingsResolution } from './panelSettings.js';
import type { ListFilter, PanelReader, PanelReadHandle, PanelSnapshot, PanelState } from './panelTemplate.js';

/**
 * A handle on one panel: the five read members, keyed by the panel's id. It resolves the engine entry on every call, so
 * it is valid while the panel is pending, live, parked or closed.
 * @public
 */
export interface PanelHandle<P extends JsonValue = JsonValue> extends PanelReadHandle {
  /** The panel's current state, with `params` typed by the template. */
  getState(): PanelState & { readonly params: P | undefined };
}

/** What a handle or reader asks a workspace for. @internal */
export interface ReadSource {
  stateOf(id: PanelId): PanelState;
  settingsOf(id: PanelId): PanelSettingsResolution;
  subscribePanel(id: PanelId, l: () => void): () => void;
  getSnapshot(): PanelSnapshot;
  subscribe(l: () => void): () => void;
  /** The handle of `id`, or undefined when the workspace knows no such panel. */
  handleOf(id: PanelId): PanelHandle | undefined;
}

/** The read handle of panel `id` built from `templateId`: exactly the five read members. @internal */
export function makeHandle<P extends JsonValue = JsonValue>(source: ReadSource, id: PanelId, templateId: string): PanelHandle<P> {
  return {
    id,
    templateId,
    getState: () => source.stateOf(id) as PanelState & { readonly params: P | undefined },
    getSettings: () => source.settingsOf(id),
    subscribe: (l) => source.subscribePanel(id, l),
  };
}

/** `states` kept by `f`: a field left out keeps everything on that field. @internal */
export function filterStates(states: readonly PanelState[], f?: ListFilter): readonly PanelState[] {
  if (f === undefined) return states;
  const wanted = f.status === undefined ? undefined : Array.isArray(f.status) ? f.status : [f.status];
  return states.filter((s) => (wanted === undefined || wanted.includes(s.status)) && (f.listed === undefined || s.listed === f.listed));
}

/** The reader a template's view receives: exactly get, list, getSnapshot and subscribe. @internal */
export function makeReader(source: ReadSource): PanelReader {
  return {
    get: (id) => source.handleOf(id),
    list: (f) => filterStates(source.getSnapshot().panels, f),
    getSnapshot: () => source.getSnapshot(),
    subscribe: (l) => source.subscribe(l),
  };
}
