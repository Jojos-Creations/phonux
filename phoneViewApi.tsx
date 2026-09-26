/**
 * The public surface a view is written against. A view is any component that
 * renders a phone-shaped column (Settings, History, a live panel, or one a
 * third party writes): it reads what it needs from `useHost()`, renders a
 * `<Panel>`, and never touches the desktop bridge, `localStorage` or any
 * other app internal. The host implements these interfaces and mounts ONE
 * `<HostProvider>`; a test mounts the same provider with the fakes from
 * `phoneApisFake.ts`.
 *
 * This file, and the rest of shared/phone, imports only react, MUI, motion and itself (see DESIGN.md).
 *
 * The provider value is REBUILT EVERY RENDER on purpose (see HostProvider).
 */

import * as React from 'react';
import type { PhoneModel } from './phoneModels.js';
import { OverlayProvider } from './windowOverlay.js';

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

/** What a view may know about a panel. The app's own panel record is structurally assignable to it. */
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
}

// ---------------------------------------------------------------------------
// The APIs
// ---------------------------------------------------------------------------

export interface SettingsAPI {
  /** The stored "max panels on screen" choice: `null` means "follow the fit count" (the default). Live: a view re-renders when it changes. */
  readonly maxPanelsOnScreen: number | null;
  /** How many panels (History plus web panels together) the window can currently show -- `null` while unmeasured (no cap yet). */
  readonly fitCount: number | null;
  /** Clamped to [2, fitCount] on read; `null` resets to "follow the fit count". Applies at once, then persists. Never rejects: with no desktop bridge the choice lasts this session only. */
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
 * `PanelsAPI.create`'s options bag, named so useProvidePanels.ts and phoneApisFake.ts can each annotate
 * their own `options` parameter explicitly (see `create`'s overload comment).
 */
export interface CreatePanelOptions {
  view?: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  /** Where the new entry lands: 'start' = right after the last non-collapsible entry (e.g. History), never before it. Default 'end'. */
  insertAt?: 'start' | 'end';
  /** Which stacking tier the new entry's row slot sits in. Default 'base'. */
  layer?: 'base' | 'raised';
  /** Whether the new entry's reappearance always resolves through the anchor formula instead of unconditionally entering from the right. Default false. */
  anchoredEnter?: boolean;
}

export interface PanelsAPI {
  /** Every panel, live or parked, in array order. History lists them as given; the row shows the live ones. */
  readonly panelList: readonly PanelSummary[];
  /**
   * Appends a live panel; zero-arg is the blank-web-panel default. `view` selects the rendered component
   * (registerView/resolveView) -- an unregistered key renders a placeholder, never a crash. No
   * `collapsible`/`locked` key: a spawned panel can never claim a permanent column or an unclosable lock.
   * Overflow parks the oldest live panel first, as it does for any panel.
   */
  create(): void;
  /**
   * Two overloads, not one `create(options?: CreatePanelOptions)` -- see DESIGN.md for why a single
   * optional-arg signature would collide with a bare `onClick={panels.create}` reference.
   */
  create(options: CreatePanelOptions): void;
  /** Make a panel live in place, without reordering the row. May park the oldest live one. */
  activate(id: string): void;
  /** Close a view completely, live or parked: it leaves the row and History at once, a closed event is appended to the persisted log (HistoryAPI), and it can be undone for 10 s (recentlyClosed, undoClose). Also accepts History's own fixed-panel id (HistoryAPI.close is the same mechanism, offered per-panel so a view need not know the id) -- an id not in `panelList` and not History's id, or a LOCKED fixed panel's id, does nothing. */
  close(id: string): void;
  /** The views closed within the current undo window, oldest first; non-null exactly while it is open (10 s after the LAST close). Drives the "Closed N pages / Undo" toast. */
  readonly recentlyClosed: readonly PanelSummary[] | null;
  /** Undo every close in `recentlyClosed`: each view returns at its old place (a live one comes back live, parking the oldest live one if the row is full) and its log entry is removed. Does nothing when the window is closed. */
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
      <OverlayProvider>{children}</OverlayProvider>
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
