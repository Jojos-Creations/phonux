/**
 * The snapshots contract: a picture of a view (History, Settings today; a panel once one has real content),
 * captured only at fixed moments -- park/close, History opening -- and only by the host, never by a view
 * (see DESIGN.md's "Where the pixels come from" for why the DOM-redraw engine itself lives in
 * client/src/desktop/capture/ instead of here). Plain .ts (no JSX): every element is built with
 * React.createElement so this file needs no .tsx extension, matching how the rest of shared/phone splits
 * value exports from type exports.
 */

import * as React from 'react';
import { useHost } from './hostApi.js';

/** A panel's PanelSummary.id, or a fixed id ('settings' | 'history') for the non-panel columns. */
export type ViewId = string;

export interface ViewSnapshot {
  readonly viewId: ViewId;
  /** A data: or blob: URL for an <img>; opaque -- never parsed, never persisted verbatim. */
  readonly src: string;
  readonly width: number;
  /** CSS px of the VIEW photographed, not of the resulting image's pixel dimensions. */
  readonly height: number;
  readonly extent: 'viewport' | 'full';
  /** Epoch ms. */
  readonly capturedAt: number;
  /** True once something the host knows changed since capture (phone size, theme, panel content). Unused by v1 (nothing yet marks a snapshot stale); reserved for a later cache-invalidation pass. */
  readonly stale: boolean;
}

/** Read-only. STABLE identity across renders (unlike the rest of the Host bag): a picture arriving is a value that changes independently of any other API member, so a naive rebuilt-every-render field would force every view to re-render on every snapshot, not just the one showing it. */
export interface SnapshotsAPI {
  get(viewId: ViewId): ViewSnapshot | null;
  /** For useSyncExternalStore. */
  subscribe(viewId: ViewId, listener: () => void): () => void;
}

const NO_SNAPSHOT = null;

/** The one hook a view actually uses. Re-renders ONLY the calling component when ITS view's picture changes -- a sibling subscribed to a different viewId never re-renders (SnapshotsAPI.subscribe is keyed per id, not one global listener list). */
export function useViewSnapshot(viewId: ViewId): ViewSnapshot | null {
  const { snapshots } = useHost();
  // A host that never wired a real SnapshotsAPI (snapshots is optional on Host -- see phoneViewApi.tsx) shows
  // no picture, never throws: the same "missing capability degrades gracefully" convention the rest of this
  // folder uses for a missing desktop bridge.
  return React.useSyncExternalStore(
    (onStoreChange) => (snapshots ? snapshots.subscribe(viewId, onStoreChange) : () => {}),
    () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT),
    () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT),
  );
}

/**
 * The engine-facing registration surface -- deliberately NOT part of Host/SnapshotsAPI: every other Host
 * member lets a view act on itself or read shared state, but "hand me your DOM node" would let a view expose
 * its own subtree for something else to reach into. A second, independent context (never used from inside
 * Host), the same pattern HostProvider already uses internally for OverlayProvider.
 */
export interface CaptureRegistry {
  /** Returns an unregister function. Registering the same viewId again (e.g. a re-mount, or a body-swap) replaces the previous entry. */
  register(viewId: ViewId, el: HTMLElement, extent: 'viewport' | 'full'): () => void;
}

export const CaptureRegistryContext = React.createContext<CaptureRegistry | null>(null);

/** Only client/src/desktop code renders this, wrapping HostProvider, passing its own real registry -- a view rendered under a bare HostProvider (the common case in a test) sees no provider and Panel's own registration effect is then a no-op. */
export function CaptureRegistryProvider({ registry, children }: { registry: CaptureRegistry; children: React.ReactNode }): React.ReactElement {
  return React.createElement(CaptureRegistryContext.Provider, { value: registry }, children);
}
