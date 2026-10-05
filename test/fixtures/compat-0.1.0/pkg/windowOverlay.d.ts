/**
 * WindowOverlay: how a view shows something over the WINDOW (a dialog, a full-screen viewer, a toast) with no
 * host wiring and no Portal. It registers its children with a store, and the host's two OverlaySlots render
 * them. Usage, why content is hoisted, and the numbered contract the content must keep (the layer adds no
 * wrapper, so it cannot enforce it): DESIGN.md, "`WindowOverlay`: window-level content with no Portal".
 * Not to be confused with Panel's `overlay` prop, which decorates ONE view and is clipped to it.
 */
import * as React from 'react';
/**
 * Where hoisted content renders (a PLACE the host chooses, never the view).
 *   'dialog': the row's first children. Modal-ish, window-sized (scrims, dialogs, full-screen viewers).
 *   'toast':  the window root, after the scroll container. Transient notices (snackbars).
 * @public
 */
export type OverlaySlotName = 'dialog' | 'toast';
/**
 * The z-index each slot's content applies to ITS OWN root. WindowOverlay adds no wrapper element,
 * so it cannot set it for you. dialog 2000 clears the host's 1400 drag strip (the Closed Pages viewer);
 * toast 1400 is MUI's snackbar band (the undo toast).
 * @public
 */
export declare const OVERLAY_Z: {
    readonly dialog: 2000;
    readonly toast: 1400;
};
/** @public */
export interface WindowOverlayProps {
    /** Default 'dialog'. */
    slot?: OverlaySlotName;
    /**
     * Default true. false = nothing registered, removed IMMEDIATELY. Content that must animate out
     * (MUI Snackbar) stays registered and takes its own `open`.
     */
    open?: boolean;
    children: React.ReactNode;
}
/** @public */
export interface Entry {
    slot: OverlaySlotName;
    node: React.ReactNode;
}
/** @public */
export interface Item {
    id: string;
    node: React.ReactNode;
}
/** External store, NOT React state: a registration re-renders neither the host nor any view. @public */
export declare class OverlayStore {
    private entries;
    private listeners;
    private slots;
    private warned;
    private snap;
    /** Count of listener notifications (test seam: pins the same-node short-circuit). */
    notifications: number;
    set(id: string, entry: Entry): void;
    remove(id: string): void;
    mountSlot(name: OverlaySlotName): () => void;
    hasSlot(name: OverlaySlotName): boolean;
    /** True once per slot name per store: the caller logs the "no slot" error only the first time. */
    firstWarning(name: OverlaySlotName): boolean;
    subscribe: (l: () => void) => (() => void);
    read(slot: OverlaySlotName): readonly Item[];
    /** Ids in registration order across both slots (test seam). */
    ids(): string[];
    private rebuild;
    private emit;
}
/**
 * Rendered by HostProvider, so a host adds nothing. The store is never part of the app-supplied Host bag
 * (nothing about an overlay is app-specific). `store` is a TEST SEAM: a test passes its own to read `notifications`/`ids()`.
 * @public
 */
export declare function OverlayProvider({ children, store: injected }: {
    children: React.ReactNode;
    store?: OverlayStore;
}): React.JSX.Element;
/** Mounted by the HOST once per slot. Emits NO element: hoisted overlays become its parent's direct children. @public */
export declare const OverlaySlot: React.NamedExoticComponent<{
    name: OverlaySlotName;
}>;
/**
 * Render this anywhere in a view, at any depth. Its children appear in the matching OverlaySlot.
 * With no provider, or under renderToStaticMarkup (no effects), the children render IN PLACE instead.
 * @public
 */
export declare function WindowOverlay({ slot, open, children }: WindowOverlayProps): React.JSX.Element | null;
