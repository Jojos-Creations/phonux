/**
 * The public surface a view is written against: any component rendering a phone-shaped column
 * (Settings, History, a live panel, or a third party's) reads what it needs from `useHost()`,
 * renders a `<Panel>`, and never touches the desktop bridge, `localStorage` or any other app
 * internal (see DESIGN.md). The host mounts ONE `<HostProvider>`; a test uses the same provider
 * with `fakeHost.ts`'s fakes. The provider value is REBUILT EVERY RENDER (see HostProvider).
 */

import * as React from 'react';
import type { PhoneModel } from './phoneModels.js';
import type { SnapshotsAPI } from './snapshots.js';
import { OverlayProvider } from './windowOverlay.js';
import { ViewStateProvider } from './viewState.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** A phone size. `modelId` 'default' means the app's built-in size, not a PHONE_MODELS entry. */
export interface PhoneSize {
  modelId: string;
  width: number;
  height: number;
}

/** The app's built-in size: upgrading must never silently resize anyone who has not chosen a model. */
export const DEFAULT_PHONE_SIZE: PhoneSize = { modelId: 'default', width: 390, height: 700 };

/** A phone-like USB device the app has just seen for the first time. */
export interface DetectedPhone {
  vendorId: number;
  productId: number;
}

/** One entry of the persisted "Closed Pages" log. */
export interface ClosedPageEntry {
  id: string;
  title: string;
  url: string;
  /** ISO-8601, UTC. */
  closedAt: string;
}

/** JSON-serializable by construction -- the minimum shape any future persistence layer could round-trip (see DESIGN.md). */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A panel's own visual tier. The app gives every panel 'phone' by default. */
export type FormFactor = 'phone' | 'tablet' | 'desktop';

/**
 * A panel's own rendered size, carrying its tier alongside the pixels so a size value stays meaningful on its
 * own (e.g. passed to Panel/PanelFrame's optional `size` prop without also passing a separate formFactor).
 * `height: 'fill'` lets a tier fill its container's height instead of a fixed pixel value.
 */
export interface PanelSize {
  formFactor: FormFactor;
  width: number;
  height: number | 'fill';
}

/**
 * What a view may know about a panel. The app's own panel record is structurally assignable to it.
 * `formFactor`/`size` are optional so a hand-built or third-party summary without them stays valid, even
 * though every panel the app itself creates carries both -- see DESIGN.md.
 */
export interface PanelSummary<P = JsonValue> {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  /** Mounted in the row now (false = parked, listed in History only). */
  readonly live: boolean;
  /** Whether a drag-down close is offered for this panel. A live/spawned panel is always false. */
  readonly locked: boolean;
  /** Opaque per-panel data a create() caller supplied; undefined for built-ins. */
  readonly params?: P;
  /** This panel's own visual tier. */
  readonly formFactor?: FormFactor;
  /** This panel's own rendered size. Panel/PanelFrame do not read it: a view passes it to their separate `size` prop for a non-phone tier (a phone panel follows useHost().device.size instead). */
  readonly size?: PanelSize;
}

// ---------------------------------------------------------------------------
// The APIs
// ---------------------------------------------------------------------------

export interface SettingsAPI {
  /** The stored "max panels on screen" choice: `null` means "follow the fit count" (the default). Live: a view re-renders when it changes. */
  readonly maxPanelsOnScreen: number | null;
  /** How many panels (History plus web panels together) the window can currently show -- `null` while unmeasured (no cap yet). */
  readonly fitCount: number | null;
  /** The lowest legal `maxPanelsOnScreen` choice: every permanent column (`collapsible:false`) plus at least one web panel. Never below 2 (History alone already counts as one). */
  readonly minPanelsOnScreen: number;
  /** Clamped to [minPanelsOnScreen, fitCount] on read; `null` resets to "follow the fit count". Applies at once, then persists. Never rejects: with no desktop bridge the choice lasts this session only. */
  setMaxPanelsOnScreen(n: number | null): Promise<void>;
  /** Settings' own sections render inside History's body when this is true (History's gear toggles it), rather than as a separate column. Starts false: a fresh session opens on History's own row list. `show()`/`hide()` last for the session. */
  readonly settingsColumn: { readonly visible: boolean; show(): void; hide(): void };
}

export interface HistoryAPI {
  /** The persisted Closed Pages log (every view ever closed, oldest first). NEVER rejects: any failure, including no desktop bridge, resolves to []. */
  loadClosedPages(): Promise<readonly ClosedPageEntry[]>;
  /** The Closed Pages overlay. `open()` (re)fetches through loadClosedPages(). */
  readonly closedPagesViewer: {
    readonly isOpen: boolean;
    readonly loading: boolean;
    readonly entries: readonly ClosedPageEntry[];
    open(): void;
    close(): void;
  };
  /** Whether a drag-down close or an API close does anything for History; defaults true. */
  readonly locked: boolean;
  readonly closed: boolean;
  /** A no-op while `locked` (today, always -- see `locked`). */
  close(): void;
}

/**
 * `PanelsAPI.create`'s options bag, named so useProvidePanels.ts and fakeHost.ts can each annotate
 * their own `options` parameter explicitly (see `create`'s overload comment).
 */
export interface CreatePanelOptions {
  view?: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  /** Where the new entry sits: on `position`'s side of `panel` (default History), `priority` lower = nearer (default: past the far end of that side). Default { position: 'right' }. */
  anchor?: { panel?: string; position: 'left' | 'right'; priority?: number };
  /** Which stacking tier the new entry's row slot sits in. Default 'base'. */
  layer?: 'base' | 'raised';
  /** Whether the new entry's reappearance always resolves through the anchor formula instead of unconditionally entering from the right. Default false. */
  anchoredEnter?: boolean;
  /**
   * Makes the new entry a permanent column: `collapsible:false` (never parked by a row gesture or capacity,
   * never a drag source, and counted in `minPanelsOnScreen`'s floor) and `listed:false`, forced regardless of
   * any `listed` also passed -- a permanent column must supply its own close control (History's own
   * precedent), never the framework's History-row trash. `locked` stays false always: closing it through its
   * own control still works. Default false.
   */
  permanent?: boolean;
  /** The new panel's tier (see `setFormFactor`). Ignored with `permanent`: a permanent column is always 'phone'. Default 'phone'. */
  formFactor?: FormFactor;
}

export interface PanelsAPI {
  /** Every panel, live or parked, in array order. History lists them as given; the row shows the live ones. */
  readonly panelList: readonly PanelSummary[];
  /**
   * Appends a live panel; zero-arg is the blank-web-panel default. `view` selects the rendered component
   * (registerView/resolveView) -- an unregistered key renders a placeholder, never a crash. No raw
   * `collapsible`/`locked` key: `permanent` (CreatePanelOptions) is the only door to a permanent column, and
   * `locked` is never settable at all. At capacity, the live panel farthest from it is parked, as for any
   * non-permanent panel.
   */
  create(): void;
  /**
   * Two overloads, not one `create(options?: CreatePanelOptions)` -- see DESIGN.md for why a single
   * optional-arg signature would collide with a bare `onClick={panels.create}` reference.
   */
  create(options: CreatePanelOptions): void;
  /** Make a panel live in place, without reordering the row. May park the live panel farthest from it. */
  activate(id: string): void;
  /**
   * Moves `id` one row-slot toward `direction`, swapping past whichever OTHER currently-shown panel sits there,
   * History and any permanent column included -- the row's drag-to-reorder gesture calls this underneath. Every
   * panel is then re-anchored to History where it stands. No-op for an id that is unknown, parked, itself a
   * permanent column (e.g. History), or already at that edge of the row.
   */
  move(id: string, direction: 'left' | 'right'): void;
  /**
   * Resizes `id` to `next`'s tier in place: it stays mounted and live, its content the same node, and the row
   * reflows around it. If the row no longer fits, OTHER panels park, never this one -- also when one handler
   * resizes, opens or activates several panels, unless the earlier of them already fill the row. No-op for an
   * unknown id, a permanent column (e.g. History), or a panel already at `next`. See DESIGN.md for the tiers.
   */
  setFormFactor(id: string, next: FormFactor): void;
  /**
   * Re-places `id`, live or parked, by `anchor` (defaults as for CreatePanelOptions.anchor) and reorders the row
   * to match. On its own it never parks or reveals: which panels fit depends on their widths, never their order.
   * No-op for an unknown id or a permanent column (e.g. History). See DESIGN.md for the anchor model.
   */
  reanchor(id: string, anchor: { panel?: string; position: 'left' | 'right'; priority?: number }): void;
  /** Close a view completely, live or parked: it leaves the row and History at once, a closed event is appended to the persisted log (HistoryAPI), and it can be undone for 10 s (recentlyClosed, undoClose). Also accepts History's own fixed-panel id (HistoryAPI.close is the same mechanism, offered per-panel so a view need not know the id) -- an id not in `panelList` and not History's id, or a LOCKED fixed panel's id, does nothing. */
  close(id: string): void;
  /** The views closed within the current undo window, oldest first; non-null exactly while it is open (10 s after the LAST close). Drives the "Closed N pages / Undo" toast. */
  readonly recentlyClosed: readonly PanelSummary[] | null;
  /** Undo every close in `recentlyClosed`: each view returns at its old place (a live one comes back live, parking the live one farthest from it if the row is full) and its log entry is removed. Does nothing when the window is closed. */
  undoClose(): void;
  /** Forget every panel. Not logged and not undoable. */
  clearAll(): void;
}

export interface PhoneDeviceAPI {
  /** The size every PanelFrame renders at. Live. */
  readonly size: PhoneSize;
  /** The built-in size (`modelId` 'default'), for a "Default (390 × 700)" choice. */
  readonly defaultSize: PhoneSize;
  /** Selectable models. 'default' is not among them. */
  readonly models: readonly PhoneModel[];
  /** Applies at once, then persists. 'default' resets. Never rejects: with no desktop bridge the choice lasts this session only. */
  chooseModel(modelId: string): Promise<void>;
  /** Non-null exactly while the one-time "phone connected" notice should show. */
  readonly detectedPhone: DetectedPhone | null;
  dismissDetectedPhone(): void;
  /** Resize to `modelId` and dismiss the notice. */
  resizeForDetectedPhone(modelId: string): void;
}

/** @deprecated use PhoneDeviceAPI */
export type DeviceAPI = PhoneDeviceAPI;

export interface Host {
  readonly settings: SettingsAPI;
  readonly history: HistoryAPI;
  readonly panels: PanelsAPI;
  readonly device: PhoneDeviceAPI;
  /**
   * Optional -- unlike every other member here, a host may genuinely not wire this yet: useViewSnapshot
   * (snapshots.ts) degrades to "no picture" rather than throwing when it is absent, so a host mid-rollout of
   * the feature (or a third-party host that never adds it) is not forced to supply a no-op implementation.
   */
  readonly snapshots?: SnapshotsAPI;
}

/** @deprecated use Host */
export type PhoneAPIs = Host;

// ---------------------------------------------------------------------------
// Provider and hook
// ---------------------------------------------------------------------------

/** Thrown by useHost() when no provider is mounted, so a view rendered without a host fails loudly instead of rendering defaults. */
export class HostMissingProviderError extends Error {
  constructor(hook = 'useHost') {
    super(
      `${hook}() was called outside a <HostProvider>. A view must render under the provider the host mounts; ` +
        'in a test, wrap it in <HostProvider host={createFakeHost()}> (shared/phone/phoneApisFake).',
    );
    this.name = 'HostMissingProviderError';
  }
}

/** @deprecated use HostMissingProviderError -- same class, so `instanceof` works under either name. */
export const PhoneAPIsMissingProviderError = HostMissingProviderError;

const HostContext = React.createContext<Host | null>(null);

/**
 * Mount once, at the host. `host` is passed straight through as the context
 * value: NEVER memoise it here or where it is built. The handlers behind it
 * close over render-time state (the panel list, the column count), so a
 * memoised bag hands views stale closures.
 */
export function HostProvider({ host, children }: { host: Host; children: React.ReactNode }) {
  return (
    <HostContext.Provider value={host}>
      <OverlayProvider>
        <ViewStateProvider>{children}</ViewStateProvider>
      </OverlayProvider>
    </HostContext.Provider>
  );
}

/**
 * @deprecated use HostProvider (its prop is `host`, not `apis`). This is a distinct thin wrapper, not the
 * same value as HostProvider, because the prop itself renamed.
 */
export function PhoneAPIsProvider({ apis, children }: { apis: Host; children: React.ReactNode }) {
  return <HostProvider host={apis}>{children}</HostProvider>;
}

/** The one hook a view uses to reach the rest of the app. Call API methods from event handlers; do not capture one in an effect with empty deps. */
export function useHost(): Host {
  const host = React.useContext(HostContext);
  if (host === null) throw new HostMissingProviderError();
  return host;
}

/** @deprecated use useHost -- same function, so identity checks keep working. */
export const usePhoneAPIs = useHost;
