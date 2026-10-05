/**
 * A view's picture, captured only by the host at fixed moments (park/close, History opening), never by a view.
 * Why the DOM-redraw engine lives in the host, not here: DESIGN.md, "Snapshots: a picture is data,
 * capturing one is not".
 */
import * as React from 'react';
import { useHost } from './hostApi.js';
const NO_SNAPSHOT = null;
/** How a view reads a picture. Re-renders only when ITS viewId's picture changes: subscribe is keyed per id. @public */
export function useViewSnapshot(viewId) {
    const { snapshots } = useHost();
    // Host.snapshots is optional: a host without it shows no picture and never throws.
    return React.useSyncExternalStore((onStoreChange) => (snapshots ? snapshots.subscribe(viewId, onStoreChange) : () => { }), () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT), () => (snapshots ? snapshots.get(viewId) : NO_SNAPSHOT));
}
/** The trigger a provider uses when its host supplies none: phonux never produces a real capture itself. @public */
export const noopCaptureTrigger = { capture: () => { }, evict: () => { } };
/** @public */
export const CaptureRegistryContext = React.createContext(null);
/** Rendered only by a host that captures pictures, around HostProvider. Without it (a bare HostProvider, as in most tests) Panel registers nothing. @public */
export function CaptureRegistryProvider({ registry, children }) {
    return React.createElement(CaptureRegistryContext.Provider, { value: registry }, children);
}
