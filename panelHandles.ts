/**
 * The handles of a panel: the operable one a workspace hands out for it and to its own view, and the read-only one
 * a template's reader returns for every panel. Both are plain objects holding a source and an id, so they stay valid
 * before the panel exists, while it is live and after the workspace detaches.
 */
import type { JsonValue } from './hostApi.js';
import type { ConfigureResult, PanelOpSource, PanelResult, PinResult, ResetResult } from './panelManager.js';
import type { AddPlacement, PanelId, PanelSettingsResolution, ScrollAlign, WorkspaceTuning } from './panelSettings.js';
import type { InstancePatch, SettingsPatch, ViewPatch } from './settingsPatch.js';
import type { ListFilter, PanelReader, PanelReadHandle, PanelSnapshot, PanelState, ViewHandle } from './panelTemplate.js';

/**
 * A handle on one panel: its read members and the operations on it, keyed by the panel's id. It resolves the
 * engine entry on every call, so it is valid while the panel is pending, live, parked or closed, and an operation
 * that state cannot take answers a refusal and touches nothing.
 * @public
 */
export interface PanelHandle<P extends JsonValue = JsonValue> extends PanelReadHandle {
  /**
   * The panel's current state, with `params` typed by the template.
   * @throws PanelManagerError with code `invalid-options` when the workspace knows no panel with this id.
   */
  getState(): PanelState & { readonly params: P | undefined };
  /** Brings the panel into view: a parked one comes back, a live one out of view is scrolled to, a closed one reopens when its `showWhenClosed` says so. */
  show(source?: 'code' | 'person'): PanelResult;
  /** Parks the panel and holds it parked as its `hideStickiness` says. */
  hide(source?: 'code' | 'person'): PanelResult;
  /** Hides a live panel, shows a parked one and, for a closed one, reopens it when its `toggleWhenClosed` says so. */
  toggleVisibility(source?: 'code' | 'person'): PanelResult;
  /** Closes the panel completely; the undo window of the row applies. A call from code is not limited by `closable`, but the root is never closed; with source `'person'` a panel whose `closable` is false answers `not-closable`. */
  close(source?: 'code' | 'person'): PanelResult;
  /** Brings a closed declared panel back where its `placeOnAdd` says; a panel that is already open stays as it is. */
  open(source?: 'code' | 'person'): PanelResult;
  /**
   * Moves a live panel `by` slots, negative to the left, in one gated call. It stops at the row's end or at a panel it
   * cannot cross; the result is accepted with `changed` true when at least one slot was crossed, and false at an end or for 0.
   * A call from code is not limited by `movable`, but the root moves only once its `movable` is set; with source `'person'` a panel whose `movable` is false answers `not-movable`.
   */
  move(by: number, source?: 'code' | 'person'): PanelResult;
  /** Puts the panel where `p` says; a parked panel is placed and stays parked. Limited by `movable` as `move` is. */
  place(p: AddPlacement | 'in-place', source?: 'code' | 'person'): PanelResult;
  /** Makes the panel `slots` phone widths wide, clamped to 1 and its `maxSlots`; the row draws at most the slots that fit. A call from code is not limited by `resizable`; with source `'person'` a panel whose `resizable` is false answers `not-resizable`. */
  setSlots(slots: number, source?: 'code' | 'person'): PanelResult;
  /** Scrolls the row to a live panel, to `align` or, left out, where the panel's `scrollOnOpen` says. */
  scrollTo(align?: ScrollAlign, source?: 'code' | 'person'): PanelResult;
  /** Applies the pinned half of the panel's `pinning` in one commit: it is placed, then fixed when the half says so; a panel that is not live follows `pinningWhenNotLive`. */
  pin(source?: 'code' | 'person'): PinResult;
  /** Applies the unpinned half of the panel's `pinning` in one commit: the panel is freed, then placed, so a fixed pin can always be undone. */
  unpin(source?: 'code' | 'person'): PinResult;
  /**
   * Changes settings of this panel after it was added; `null` removes an instance value. All or nothing, in one update; the result says what acts now and what waits. A flip of `parkable` on a panel that is not live follows `pinningWhenNotLive`: it may be refused with `would-reshape-row` or `is-closed`, show the panel, or wait and be listed in `later`.
   * @throws PanelManagerError with code `invalid-settings` when the patch is not an object or names an unknown key.
   */
  configure(patch: InstancePatch): ConfigureResult;
}

/** One operation a handle asks of its workspace. @internal */
export type PanelVerbCall =
  | { verb: 'show' | 'hide' | 'toggleVisibility' | 'close' | 'open' }
  | { verb: 'move'; by: number }
  | { verb: 'place'; value: AddPlacement | 'in-place' }
  | { verb: 'setSlots'; slots: number }
  | { verb: 'scrollTo'; align: ScrollAlign | undefined }
  | { verb: 'pin' | 'unpin' };

/** What a handle or reader asks a workspace for. @internal */
export interface ReadSource {
  stateOf(id: PanelId): PanelState;
  settingsOf(id: PanelId): PanelSettingsResolution;
  subscribePanel(id: PanelId, l: () => void): () => void;
  getSnapshot(): PanelSnapshot;
  subscribe(l: () => void): () => void;
  /** The operable handle of `id`, or undefined when the workspace knows no such panel. */
  handleOf(id: PanelId): PanelHandle | undefined;
  /** The read-only handle of `id`, or undefined when the workspace knows no such panel. */
  readHandleOf(id: PanelId): PanelReadHandle | undefined;
  /** Runs one operation on `id` for `source`. */
  operate(id: PanelId, call: PanelVerbCall, source: PanelOpSource): PinResult;
  /** The handle `id`'s own view receives: the operable one, whose `configure` takes only the keys a view may set. */
  viewHandleOf(id: PanelId): ViewHandle | undefined;
  /** Resets one panel, or every panel but the root. */
  resetLayout(target: PanelId | 'all'): ResetResult;
  /** Patches one panel's settings, for a panel's own caller or for its view. */
  configure(id: PanelId, patch: InstancePatch | ViewPatch, caller: 'panel' | 'view'): ConfigureResult;
  /** Patches the template-scope settings of a template. */
  configureTemplate(templateId: string, patch: SettingsPatch): ConfigureResult;
  /** Patches the workspace tuning. */
  configureTuning(patch: { [K in keyof WorkspaceTuning]?: WorkspaceTuning[K] | null }): ConfigureResult;
}

/** The read handle of panel `id` built from `templateId`: exactly the read members. @internal */
export function makeHandle(source: ReadSource, id: PanelId, templateId: string): PanelReadHandle {
  return {
    id,
    templateId,
    getState: () => source.stateOf(id),
    getSettings: () => source.settingsOf(id),
    subscribe: (l) => source.subscribePanel(id, l),
  };
}

/** The handle of panel `id` built from `templateId`: the read members and every operation. @internal */
export function makeViewHandle<P extends JsonValue = JsonValue>(source: ReadSource, id: PanelId, templateId: string): PanelHandle<P> {
  return {
    id,
    templateId,
    getState: () => source.stateOf(id) as PanelState & { readonly params: P | undefined },
    getSettings: () => source.settingsOf(id),
    subscribe: (l) => source.subscribePanel(id, l),
    show: (src = 'code') => source.operate(id, { verb: 'show' }, src),
    hide: (src = 'code') => source.operate(id, { verb: 'hide' }, src),
    toggleVisibility: (src = 'code') => source.operate(id, { verb: 'toggleVisibility' }, src),
    close: (src = 'code') => source.operate(id, { verb: 'close' }, src),
    open: (src = 'code') => source.operate(id, { verb: 'open' }, src),
    move: (by, src = 'code') => source.operate(id, { verb: 'move', by }, src),
    place: (value, src = 'code') => source.operate(id, { verb: 'place', value }, src),
    setSlots: (slots, src = 'code') => source.operate(id, { verb: 'setSlots', slots }, src),
    scrollTo: (align, src = 'code') => source.operate(id, { verb: 'scrollTo', align }, src),
    pin: (src = 'code') => source.operate(id, { verb: 'pin' }, src),
    unpin: (src = 'code') => source.operate(id, { verb: 'unpin' }, src),
    configure: (patch) => source.configure(id, patch, 'panel'),
  };
}

/** The handle panel `id`'s own view receives: the operable handle with a `configure` that takes only what a view may set. @internal */
export function makeOwnHandle<P extends JsonValue = JsonValue>(source: ReadSource, id: PanelId, templateId: string): ViewHandle<P> {
  return { ...makeViewHandle<P>(source, id, templateId), configure: (patch: ViewPatch) => source.configure(id, patch, 'view') };
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
    get: (id) => source.readHandleOf(id),
    list: (f) => filterStates(source.getSnapshot().panels, f),
    getSnapshot: () => source.getSnapshot(),
    subscribe: (l) => source.subscribe(l),
  };
}
