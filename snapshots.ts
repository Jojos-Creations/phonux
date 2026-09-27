/**
 * A view's picture, captured only by the host at fixed moments (park/close, History opening), never by a view.
 * Why the DOM-redraw engine lives in client/src/desktop/capture/: DESIGN.md, "Snapshots: a picture is data,
 * capturing one is not".
 */

import * as React from 'react';
import { useHost } from './hostApi.js';

/** A panel's PanelSummary.id, or a fixed id ('settings' | 'history') for the non-panel columns. @public */
export type ViewId = string;

/** @public */
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
  /** Marks a picture outdated by a change the host knows of (phone size, theme, panel content); nothing sets it true yet. */
  readonly stale: boolean;
}

/** Read-only, and STABLE across renders unlike the rest of Host: a field rebuilt per render would re-render every view on each snapshot, not just the one showing it. @public */
export interface SnapshotsAPI {
  get(viewId: ViewId): ViewSnapshot | null;
  /** For useSyncExternalStore. */
  subscribe(viewId: ViewId, listener: () => void): () => void;
}

const NO_SNAPSHOT = null;

/** How a view reads a picture. Re-renders only when ITS viewId's picture changes: subscribe is keyed per id. @public */
export function useViewSnapshot(viewId: ViewId): ViewSnapshot | null {
  const { snapshots } = useHost();
  // Host.snapshots is optional: a host without it shows no picture and never throws.
  return React.useSyncExternalStore(
    (onStoreChange) => (snapshots ? snapshots.subscribe(viewId, onStoreChange) : () => {}),
    () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT),
    () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT),
  );
}

/**
 * How Panel hands its DOM node to the capture engine, in its own context and never on Host: every Host member lets a
 * view act on itself or read shared state, but "hand me your DOM node" would expose its subtree to something else.
 * @public
 */
export interface CaptureRegistry {
  /** Returns an unregister function. Registering the same viewId again (e.g. a re-mount, or a body-swap) replaces the previous entry. */
  register(viewId: ViewId, el: HTMLElement, extent: 'viewport' | 'full'): () => void;
}

/** @public */
export const CaptureRegistryContext = React.createContext<CaptureRegistry | null>(null);

/** Rendered only by client/src/desktop, around HostProvider. Without it (a bare HostProvider, as in most tests) Panel registers nothing. @public */
export function CaptureRegistryProvider({ registry, children }: { registry: CaptureRegistry; children: React.ReactNode }): React.ReactElement {
  return React.createElement(CaptureRegistryContext.Provider, { value: registry }, children);
}
