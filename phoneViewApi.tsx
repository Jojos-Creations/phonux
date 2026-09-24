/**
 * The public surface a view is written against. A view is any component that
 * renders a phone-shaped column (Settings, History, a live panel, or one a
 * third party writes): it reads what it needs from `usePhoneAPIs()`, renders a
 * `<PhoneView>`, and never touches the desktop bridge, `localStorage` or any
 * other app internal. The host implements these interfaces and mounts ONE
 * `<PhoneAPIsProvider>`; a test mounts the same provider with the fakes from
 * `phoneApisFake.ts`.
 *
 * This file, and the rest of shared/phone, imports only react, MUI, motion and itself (see DESIGN.md).
 *
 * The provider value is REBUILT EVERY RENDER on purpose (see PhoneAPIsProvider).
 */

import * as React from 'react';
import type { PhoneModel } from './phoneModels.js';
import { OverlayProvider } from './windowOverlay.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type MaxViewsMode = 'screen-width' | 'count';

/**
 * "Maximum views": how many panels the row keeps live before parking the
 * oldest in History. 'screen-width' grows the window and collapses only once
 * the screen is full; 'count' collapses at `collapseAtViews` total views down
 * to `downToViews` and never asks the window to grow. A "view" counts the
 * always-present columns plus the live panels.
 */
export interface MaxViewsSettings {
  mode: MaxViewsMode;
  /** 'count' mode only: total views at which collapse triggers. */
  collapseAtViews: number;
  /** 'count' mode only: total views to collapse down to once triggered. */
  downToViews: number;
}

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
  /** Live value: a view re-renders when it changes. */
  readonly maxViews: MaxViewsSettings;
  /** Legal range for `maxViews.collapseAtViews`. `min` already counts the columns on screen, so a view never passes a column count. */
  readonly maxViewsBounds: { readonly min: number; readonly max: number };
  /** Clamped against the CURRENT column count inside the app. */
  setMaxViews(next: MaxViewsSettings): void;
  /** Whether the row parks its oldest panel instead of scrolling when it would overflow. */
  readonly autoCollapse: boolean;
  /** Applies at once, then persists. Never rejects: with no desktop bridge the choice lasts this session only. */
  setAutoCollapse(on: boolean): Promise<void>;
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
 * `PanelsAPI.create`'s options bag. A named type (not inlined into `create`'s signature) so both the real
 * implementation (useProvidePanels.ts) and the test fake (phoneApisFake.ts) can annotate their own
 * `options` parameter explicitly -- see `create`'s own two-overload comment for why that annotation is
 * required, not cosmetic.
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
   * Append a live panel. Zero-arg: today's exact blank web panel, unchanged. `view` picks the rendered
   * component (registerPanelView/resolvePanelView) -- an unregistered key renders a placeholder, never a
   * crash. No `collapsible`/`locked` key: a spawned panel can never claim a permanent column or an
   * unclosable lock (that is panel-spawn-permanent-columns's own, separate scope). The app parks the oldest
   * live one first when the row would overflow, same as today.
   */
  create(): void;
  /**
   * Two overloads, not one `create(options?: CreatePanelOptions)`: a single optional-arg signature is
   * structurally assignable to a DOM `MouseEventHandler`, and `CreatePanelOptions.view` collides with
   * `MouseEvent`'s own required `view: Window` field -- a bare `onClick={panels.create}` reference would
   * then both fail typecheck AND, at runtime, spread the click event's `view` into the new panel.
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

export interface DeviceAPI {
  /** The size every PhoneFrame renders at. Live. */
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

export interface PhoneAPIs {
  readonly settings: SettingsAPI;
  readonly history: HistoryAPI;
  readonly panels: PanelsAPI;
  readonly device: DeviceAPI;
}

// ---------------------------------------------------------------------------
// Provider and hook
// ---------------------------------------------------------------------------

/** Thrown by usePhoneAPIs() when no provider is mounted, so a view rendered without APIs fails loudly instead of rendering defaults. */
export class PhoneAPIsMissingProviderError extends Error {
  constructor(hook = 'usePhoneAPIs') {
    super(
      `${hook}() was called outside a <PhoneAPIsProvider>. A view must render under the provider the host mounts; ` +
        'in a test, wrap it in <PhoneAPIsProvider apis={createFakePhoneAPIs()}> (shared/phone/phoneApisFake).',
    );
    this.name = 'PhoneAPIsMissingProviderError';
  }
}

const PhoneAPIsContext = React.createContext<PhoneAPIs | null>(null);

/**
 * Mount once, at the host. `apis` is passed straight through as the context
 * value: NEVER memoise it here or where it is built. The handlers behind it
 * close over render-time state (the panel list, the column count), so a
 * memoised bag hands views stale closures.
 */
export function PhoneAPIsProvider({ apis, children }: { apis: PhoneAPIs; children: React.ReactNode }) {
  return (
    <PhoneAPIsContext.Provider value={apis}>
      <OverlayProvider>{children}</OverlayProvider>
    </PhoneAPIsContext.Provider>
  );
}

/** The one hook a view uses to reach the rest of the app. Call API methods from event handlers; do not capture one in an effect with empty deps. */
export function usePhoneAPIs(): PhoneAPIs {
  const apis = React.useContext(PhoneAPIsContext);
  if (apis === null) throw new PhoneAPIsMissingProviderError();
  return apis;
}
