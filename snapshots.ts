/**
 * A view's picture, captured only by the host at fixed moments (park/close, History opening), never by a view.
 * Why the DOM-redraw engine lives in the host, not here: DESIGN.md, "Snapshots: a picture is data,
 * capturing one is not".
 */

import * as React from 'react';
import { useHost } from './hostApi.js';

/** A panel's PanelSummary.id, or a fixed id ('settings' | 'history') for the non-panel columns. @public */
export type ViewId = string;

/** A captured picture of one view, as `useViewSnapshot` returns it. @public */
export interface ViewSnapshot {
  /** The view this picture shows. */
  readonly viewId: ViewId;
  /** A data: or blob: URL for an <img>; opaque -- never parsed, never persisted verbatim. */
  readonly src: string;
  /** CSS px of the VIEW photographed, not of the image's pixel dimensions. */
  readonly width: number;
  /** CSS px of the VIEW photographed, not of the resulting image's pixel dimensions. */
  readonly height: number;
  /** The extent the picture covers, as passed to `CaptureRegistry.register`: 'viewport' or 'full'. */
  readonly extent: 'viewport' | 'full';
  /** Epoch ms. */
  readonly capturedAt: number;
  /** Marks a picture outdated by a change the host knows of (phone size, theme, panel content); nothing sets it true yet. */
  readonly stale: boolean;
}

/** Read-only, and STABLE across renders unlike the rest of Host: a field rebuilt per render would re-render every view on each snapshot, not just the one showing it. @public */
export interface SnapshotsAPI {
  /** The current picture of `viewId`, or `null` when there is none. */
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

/**
 * What a host hands phonux to call at a park or close: (re)capture a view's picture, or drop it. phonux only says
 * WHEN; what a capture is stays host code (see the DOM-redraw note above). @public
 */
export interface CaptureTrigger {
  /** (Re)captures whatever is registered for this id; a no-op if nothing is. Never throws, even if the engine does. */
  capture(viewId: ViewId): void;
  /** Discard viewId's stored picture, e.g. once its undo window elapses without being restored. A no-op if nothing was stored. */
  evict(viewId: ViewId): void;
}

/** The trigger a provider uses when its host supplies none: phonux never produces a real capture itself. @public */
export const noopCaptureTrigger: CaptureTrigger = { capture: () => {}, evict: () => {} };

/** @internal */
export const CaptureRegistryContext = React.createContext<CaptureRegistry | null>(null);

/** Rendered only by a host that captures pictures, around HostProvider. Without it (a bare HostProvider, as in most tests) Panel registers nothing. @public */
export function CaptureRegistryProvider({ registry, children }: { registry: CaptureRegistry; children: React.ReactNode }): React.ReactElement {
  return React.createElement(CaptureRegistryContext.Provider, { value: registry }, children);
}
