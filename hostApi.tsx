/**
 * The public surface a view is written against: any component rendering a phone-shaped column
 * (a live panel, or a third party's) reads what it needs from `useHost()`,
 * renders a `<Panel>`, and never touches `localStorage` or any other app
 * internal (see DESIGN.md). The host mounts ONE `<HostProvider>`; a test uses the same provider
 * with `fakeHost.ts`'s fakes. The provider value is REBUILT EVERY RENDER (see HostProvider).
 */

import * as React from 'react';
import type { PhoneModel } from './phoneModels.js';
import type { SnapshotsAPI } from './snapshots.js';
import type { PhonuxLabels } from './labels.js';
import { OverlayProvider } from './windowOverlay.js';
import { ViewStateProvider } from './viewState.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** A phone size. `modelId` 'default' means the app's built-in size, not a PHONE_MODELS entry. @public */
export interface PhoneSize {
  /** Id of the chosen `PhoneModel`, or 'default' for the built-in size. */
  modelId: string;
  /** Width in CSS px. */
  width: number;
  /** Height in CSS px. */
  height: number;
}

/** The app's built-in size: upgrading must never silently resize anyone who has not chosen a model. @public */
export const DEFAULT_PHONE_SIZE: PhoneSize = { modelId: 'default', width: 390, height: 700 };

/**
 * Any value that survives a JSON round trip: string, number, boolean, `null`, or arrays and plain objects of these.
 * Never `undefined` or a function.
 * @public
 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * A panel's own rendered size (e.g. passed to Panel/PanelFrame's optional `size` prop).
 * `height: 'fill'` lets a panel wider than one slot fill its container's height instead of a fixed pixel value.
 * @public
 */
export interface PanelSize {
  /** Width in CSS px. */
  width: number;
  /** Height in CSS px, or 'fill' to fill the container's height. */
  height: number | 'fill';
}

/**
 * What a view may know about a panel. The app's own panel record is structurally assignable to it.
 * `slots`/`size` are optional so a hand-built or third-party summary without them stays valid, even
 * though every panel the app itself creates carries both -- see DESIGN.md.
 * @public
 */
export interface PanelSummary<P = JsonValue> {
  /** The panel's id, which is its key: the id `PanelsAPI` methods take and the same one `ViewHandle.id` and `PanelState.id` carry. */
  readonly id: string;
  /** The URL the panel shows; absent or empty for a host with no address concept. */
  readonly url?: string;
  /** The panel's title, when it has one. */
  readonly title?: string;
  /** Mounted in the row now (false = parked). */
  readonly live: boolean;
  /** Opaque per-panel data a create() caller supplied; undefined for built-ins. */
  readonly params?: P;
  /** How many phone-panel widths wide the panel is set to; the row draws it at most as wide as the slots that fit (`drawnSlots`). */
  readonly slots?: number;
  /** The most slots the panel may take. */
  readonly maxSlots?: number;
  /** The width a panel resting at one phone (`tuning.shrinkUnfocused`) goes back to when it is next active, while it rests; absent otherwise. A panel's own size is `savedSlots ?? slots`. */
  readonly savedSlots?: number;
  /** The slots the row draws the panel at now: `slots` capped at what fits the window. A summary a view receives from the row carries it. */
  readonly drawnSlots?: number;
  /** The most slots that fit the window now, at the row's gap: what a resize control may offer, whatever `maxSlots` allows. A summary a view receives from the row carries it. */
  readonly fitSlots?: number;
  /** This panel's own rendered size. Panel/PanelFrame do not read it: a view passes it to their separate `size` prop for a non-phone tier (a phone panel follows useHost().device.size instead). */
  readonly size?: PanelSize;
}

// ---------------------------------------------------------------------------
// The APIs
// ---------------------------------------------------------------------------

/**
 * `PanelsAPI.create`'s options bag, named so useProvidePanels.ts and fakeHost.ts can each annotate
 * their own `options` parameter explicitly (see `create`'s overload comment).
 * @public
 */
export interface CreatePanelOptions {
  /** Id of the template that renders the panel. Default: `PanelsInput.defaultView`, else none, which renders the unregistered-view placeholder. */
  view?: string;
  /** The new panel's title. */
  title?: string;
  /** Opaque data for the view, readable as `PanelSummary.params`. */
  params?: JsonValue;
  /** Whether the panel appears in `PanelsAPI.panelList`. Default true; always false with `permanent`. */
  listed?: boolean;
  /** Where the new entry sits: on `position`'s side of `panel` (default the root), `priority` lower = nearer (default: past the far end of that side). Default `{ position: 'right' }`. */
  anchor?: { panel?: string; position: 'left' | 'right'; priority?: number };
  /** Which stacking tier the new entry's row slot sits in. Default 'base'. */
  layer?: 'base' | 'raised';
  /** Whether the new entry's reappearance always resolves through the anchor formula instead of unconditionally entering from the right. Default false. */
  anchoredEnter?: boolean;
  /**
   * Makes the new entry a permanent column: `collapsible:false` (never parked by a row gesture or capacity,
   * never a drag source, and counted in the capacity floor) and `listed:false`, forced regardless of
   * any `listed` also passed, so a permanent column supplies its own close control rather than a list's
   * trash. Its own control closes it through `close`, which `closable` does not limit. Default false.
   */
  permanent?: boolean;
  /** How many phone-panel widths wide the new panel is (see `setSlots`), clamped to 1 and its `maxSlots`. Ignored with `permanent`: a permanent column is always one slot. Default 1. */
  slots?: number;
}

/** The panel row: list, open, activate, move, resize, re-anchor and close panels. @public */
export interface PanelsAPI {
  /** Every listed panel, live or parked, in array order; a panel whose `listed` is false, such as the root, is not here. The row shows the live ones. */
  readonly panelList: readonly PanelSummary[];
  /**
   * How many panels, permanent columns such as the root included, the window fits at the current phone width and row gap:
   * the phone-width ceiling for a fresh row, at least one more than the permanent columns. A
   * scrolling row reports the same number. `null` until the row is measured, never 0; absent from a host that does not report it.
   */
  readonly maxFitPanels?: number | null;
  /**
   * The narrowest row container, in whole px, that shows every permanent column plus two phone slots, or plus one tablet
   * panel when that is wider: `minWorkspaceWidth` over the current phone width, row gap and permanent columns. A host
   * reads it to set its window's minimum width. It never reads the container width, so it is reported before the row is
   * measured. Unset while the phone width is not a positive finite number. Absent from a host that does not report it.
   *
   * It prices the phone at the width the row draws now, so it holds as a floor only where that width does not follow the
   * window (`phoneFit` off): with `phoneFit` on the drawn phone moves with the window.
   */
  readonly minWorkspaceWidth?: number;
  /**
   * Appends a live panel; zero-arg opens a panel of the host's default view. `view` names the template that renders
   * the panel -- an unknown key renders a placeholder, never a crash. No raw
   * `collapsible` key: `permanent` (CreatePanelOptions) is the only door to a permanent column. A panel whose `overflow` setting is 'park' parks the live parkable panel
   * touched longest ago at capacity; any other panel scrolls the row instead of parking anything.
   * @deprecated Use `useWorkspace().panels.addPanel(template)`. Still works, with one development warning; removed in a later release.
   */
  create(): void;
  /**
   * Two overloads, not one `create(options?: CreatePanelOptions)` -- see DESIGN.md for why a single
   * optional-arg signature would collide with a bare `onClick={panels.create}` reference.
   * @deprecated Use `useWorkspace().panels.addPanel(template)`. Still works, with one development warning; removed in a later release.
   */
  create(options: CreatePanelOptions): void;
  /**
   * Make a panel live in place, without reordering the row. When its `overflow` is 'park', it may park the live parkable panel touched longest ago.
   * @deprecated Use `useWorkspace().panels.get(key)?.show()`. Still works, with one development warning; removed in a later release.
   */
  activate(id: string): void;
  /**
   * Moves `id` one row-slot toward `direction`, swapping past whichever OTHER currently-shown panel sits there,
   * the root and any permanent column included -- the row's drag-to-reorder gesture calls this underneath. Every
   * panel is then re-anchored to the root where it stands. No-op for an id that is unknown, parked, itself a
   * permanent column (e.g. the root), or already at that edge of the row.
   * @deprecated Use `useWorkspace().panels.get(key)?.move(count)`. Still works, with one development warning; removed in a later release.
   */
  move(id: string, direction: 'left' | 'right'): void;
  /**
   * Sets `id` to `slots` phone-panel widths wide, clamped to 1 and the panel's `maxSlots`; the row draws it at most as wide as
   * fits the window. It stays mounted and live, its content the same node, and the row reflows around it. If the row no longer fits,
   * OTHER panels whose `overflow` is 'park' park, never this one -- also when one handler resizes, opens or activates several panels,
   * unless the earlier of them already fill the row. No-op for an unknown id, a permanent column (e.g. the root), a panel that is not
   * resizable or a panel already at that count. See DESIGN.md for the slots.
   * Optional so a host that does not implement slots still satisfies `PanelsAPI`; the library's own provider (`useProvidePanels`) always implements it.
   * @deprecated Use `useWorkspace().panels.get(key)?.setSlots(slots)`. Still works, with one development warning; removed in a later release.
   */
  setSlots?(id: string, slots: number): void;
  /**
   * Re-places `id`, live or parked, by `anchor` (defaults as for CreatePanelOptions.anchor) and reorders the row
   * to match. On its own it never parks or reveals: which panels fit depends on their widths, never their order.
   * No-op for an unknown id or a permanent column (e.g. the root). See DESIGN.md for the anchor model.
   * @deprecated Use `useWorkspace().panels.get(key)?.place(anchor)`. Still works, with one development warning; removed in a later release.
   */
  reanchor(id: string, anchor: { panel?: string; position: 'left' | 'right'; priority?: number }): void;
  /** Close a view completely, live or parked: it leaves the row and `panelList` at once, the host's `onPanelsClosed` hears of it, and it can be undone while its undo window lasts (recentlyClosed, undoClose; the panel's `undoWindowMs` setting, where 0 means no undo). Also accepts the root's id -- an id not in `panelList` and not the root's id, or a LOCKED fixed panel's id, does nothing.
   * @deprecated Use `useWorkspace().panels.get(key)?.close()`. Still works, with one development warning; removed in a later release.
   */
  close(id: string): void;
  /** The views closed within the current undo window, oldest first; non-null exactly while it is open, which is until the latest of each recent close's time plus that panel's `undoWindowMs`. The workspace's own undo-close toast shows exactly while it is non-null. */
  readonly recentlyClosed: readonly PanelSummary[] | null;
  /** Undo every close in `recentlyClosed`: each view returns at its old place (a live one comes back live, parking the live parkable one touched longest ago if the row is full and its `overflow` is 'park') and its log entry is removed. Does nothing when the window is closed. */
  undoClose(): void;
  /** Forgets every panel that is clearable; the root, a fixed column and an unclearable panel stay. Not logged and not undoable. */
  clearAll(): void;
}

/** The phone size every panel renders at. @public */
export interface PhoneDeviceAPI {
  /** The size every PanelFrame renders at. Live. */
  readonly size: PhoneSize;
  /** The built-in size (`modelId` 'default'), for a "Default (390 × 700)" choice. */
  readonly defaultSize?: PhoneSize;
  /** Selectable models. 'default' is not among them. */
  readonly models?: readonly PhoneModel[];
  /** Applies at once, then persists. 'default' resets. Never rejects: where nothing persists, the choice lasts this session only. */
  chooseModel?(modelId: string): Promise<void>;
}

/**
 * Everything a view reaches through `useHost()`. `snapshots` and `labels` may be absent, so a view reads each with a
 * fallback. The first frame of an auto-mounted workspace holds exactly the values given to `createWorkspace`; a value that arrives
 * later is absent in that frame and appears after `workspace.update`.
 * @public
 */
export interface Host {
  /** The panel row. */
  readonly panels: PanelsAPI;
  /** The phone size. */
  readonly device: PhoneDeviceAPI;
  /** Optional, unlike every other member: without it useViewSnapshot (snapshots.ts) shows no picture instead
   * of throwing, so a host that does not capture need not supply a no-op. */
  readonly snapshots?: SnapshotsAPI;
  /** Overrides of the library's visible strings (see `PhonuxLabels`); a key left out keeps its English default. */
  readonly labels?: Partial<PhonuxLabels>;
}

// ---------------------------------------------------------------------------
// Provider and hook
// ---------------------------------------------------------------------------

/** Thrown by useHost() when no provider is mounted, so a view rendered without a host fails loudly instead of rendering defaults. @public */
export class HostMissingProviderError extends Error {
  /** @param hook - Name of the hook that was called, shown in the message. */
  constructor(hook = 'useHost') {
    super(
      `${hook}() was called outside a <HostProvider>. A view must render under the provider the host mounts; ` +
        'in a test, wrap it in <HostProvider host={createFakeHost()}> (createFakeHost comes from the phonux/testing entry point).',
    );
    this.name = 'HostMissingProviderError';
  }
}

const HostContext = React.createContext<Host | null>(null);

/**
 * What `HostProvider` takes: a `Host` whose `device` may be left out. A host that never picks a phone size says nothing
 * about it; `useHost()` still returns the fully resolved `Host`.
 * @public
 */
export type HostInput = Omit<Host, 'device'> & {
  /** The phone size. Left out: `DEFAULT_PHONE_SIZE`, with no model choice and no phone-detect notice. */
  readonly device?: PhoneDeviceAPI;
};

// Module constants, not built per render: a reader memoised on `useHost().device` must see the same object every render.
const DEFAULT_DEVICE: PhoneDeviceAPI = { size: DEFAULT_PHONE_SIZE };

/** `input` as the `Host` readers get: itself when it already names a device, else a copy with the default filled in. */
function resolveHost(input: HostInput): Host {
  if (input.device !== undefined) return input as Host;
  return { ...input, device: input.device ?? DEFAULT_DEVICE };
}

/**
 * Mount once, at the host. `host` is passed straight through as the context
 * value (with the defaults of `HostInput` filled in): NEVER memoise it here or
 * where it is built. The handlers behind it close over render-time state (the
 * panel list, the column count), so a memoised bag hands views stale closures.
 * @public
 */
export function HostProvider({ host, children }: { host: HostInput; children: React.ReactNode }) {
  return (
    <HostContext.Provider value={resolveHost(host)}>
      <OverlayProvider>
        <ViewStateProvider>{children}</ViewStateProvider>
      </OverlayProvider>
    </HostContext.Provider>
  );
}

/** The host a provider mounted, or null outside one: for the library's own components that can render without a host. @internal */
export function useOptionalHost(): Host | null {
  return React.useContext(HostContext);
}

/** The one hook a view uses to reach the rest of the app. Call API methods from event handlers; do not capture one in an effect with empty deps. @public */
export function useHost(): Host {
  const host = React.useContext(HostContext);
  if (host === null) throw new HostMissingProviderError();
  return host;
}
