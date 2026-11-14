import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * WindowOverlay: how a view shows something over the WINDOW (a dialog, a full-screen viewer, a toast) with no
 * host wiring and no Portal. It registers its children with a store, and the host's two OverlaySlots render
 * them. Usage, why content is hoisted, and the numbered contract the content must keep (the layer adds no
 * wrapper, so it cannot enforce it): DESIGN.md, "`WindowOverlay`: window-level content with no Portal".
 * Not to be confused with Panel's `overlay` prop, which decorates ONE view and is clipped to it.
 */
import * as React from 'react';
import { Fragment, createContext, useContext, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';
/**
 * The z-index each slot's content applies to ITS OWN root. WindowOverlay adds no wrapper element,
 * so it cannot set it for you. dialog 2000 clears the host's 1400 drag strip (the Closed Pages viewer);
 * toast 1400 is MUI's snackbar band (the undo toast).
 * @public
 */
export const OVERLAY_Z = { dialog: 2000, toast: 1400 };
const EMPTY = Object.freeze([]);
/** External store, NOT React state: a registration re-renders neither the host nor any view. @internal */
export class OverlayStore {
    entries = new Map(); // Map keeps FIRST-insertion position across overwrites
    listeners = new Set();
    slots = new Map();
    warned = new Set();
    snap = { dialog: EMPTY, toast: EMPTY };
    /** Count of listener notifications (test seam: pins the same-node short-circuit). */
    notifications = 0;
    /** Registers `entry` under `id`, replacing an earlier one; does nothing when it is identical. */
    set(id, entry) {
        const prev = this.entries.get(id);
        if (prev && prev.slot === entry.slot && prev.node === entry.node)
            return;
        this.entries.set(id, entry);
        this.rebuild(entry.slot);
        if (prev && prev.slot !== entry.slot)
            this.rebuild(prev.slot);
        this.emit();
    }
    /** Removes the registration `id`; does nothing when there is none. */
    remove(id) {
        const prev = this.entries.get(id);
        if (!prev)
            return;
        this.entries.delete(id);
        this.rebuild(prev.slot);
        this.emit();
    }
    /** Records that a slot named `name` is mounted; returns a function that undoes it. */
    mountSlot(name) {
        this.slots.set(name, (this.slots.get(name) ?? 0) + 1);
        return () => void this.slots.set(name, (this.slots.get(name) ?? 1) - 1);
    }
    /** Whether at least one slot named `name` is mounted. */
    hasSlot(name) {
        return (this.slots.get(name) ?? 0) > 0;
    }
    /** True once per slot name per store: the caller logs the "no slot" error only the first time. */
    firstWarning(name) {
        if (this.warned.has(name))
            return false;
        this.warned.add(name);
        return true;
    }
    /** Calls `l` when any registration changes; returns a function that stops the calls. */
    subscribe = (l) => {
        this.listeners.add(l);
        return () => void this.listeners.delete(l);
    };
    /** The overlays registered for `slot`, in registration order. */
    read(slot) {
        return this.snap[slot];
    }
    /** Ids in registration order across both slots (test seam). */
    ids() {
        return [...this.entries.keys()];
    }
    rebuild(slot) {
        const items = [];
        for (const [id, e] of this.entries)
            if (e.slot === slot)
                items.push({ id, node: e.node });
        this.snap = { ...this.snap, [slot]: items.length ? items : EMPTY };
    }
    emit() {
        this.notifications += 1;
        for (const l of [...this.listeners])
            l();
    }
}
const StoreContext = createContext(null);
const noopSubscribe = () => () => { };
/**
 * Rendered by HostProvider, so a host adds nothing. The store is never part of the app-supplied Host bag
 * (nothing about an overlay is app-specific). `store` is a TEST SEAM: a test passes its own to read `notifications`/`ids()`.
 * @internal
 */
export function OverlayProvider({ children, store: injected }) {
    const [store] = useState(() => injected ?? new OverlayStore()); // pure constructor: StrictMode's double init is harmless
    return _jsx(StoreContext.Provider, { value: store, children: children }); // stable value: never re-renders consumers
}
/** Mounted by the HOST once per slot. Emits NO element: hoisted overlays become its parent's direct children. @public */
export const OverlaySlot = React.memo(function OverlaySlot({ name }) {
    const store = useContext(StoreContext);
    useLayoutEffect(() => store?.mountSlot(name), [store, name]);
    // A slot outside the provider sees an empty store forever: a host bug that would otherwise be silent.
    useEffect(() => {
        if (store === null)
            console.error(`OverlaySlot name="${name}": rendered outside <OverlayProvider> (HostProvider renders it), so nothing hoisted will ever show here.`);
    }, [store, name]);
    const items = useSyncExternalStore(store ? store.subscribe : noopSubscribe, () => (store ? store.read(name) : EMPTY), () => EMPTY);
    return _jsx(_Fragment, { children: items.map((i) => _jsx(Fragment, { children: i.node }, i.id)) });
});
/**
 * Render this anywhere in a view, at any depth. Its children appear in the matching OverlaySlot.
 * With no provider, or under renderToStaticMarkup (no effects), the children render IN PLACE instead.
 * @public
 */
export function WindowOverlay({ slot = 'dialog', open = true, children }) {
    const store = useContext(StoreContext);
    // getServerSnapshot -> false (static markup); a client render with a provider -> true on the first pass.
    const hoisting = useSyncExternalStore(noopSubscribe, () => store !== null, () => false);
    const id = useId();
    const active = hoisting && open && store !== null;
    // Every commit: `children` is a fresh element each render. The store skips an identical node.
    useLayoutEffect(() => {
        if (active)
            store.set(id, { slot, node: children });
    });
    // Unregister on unmount, close and slot change. Order against the set-effect above is not load-bearing:
    // React runs every cleanup of a commit, StrictMode's simulated remount included, before any setup.
    useLayoutEffect(() => () => {
        store?.remove(id);
    }, [store, id, active, slot]);
    // Passive on purpose: by now every slot's layout effect has run, so "no slot" really means none.
    useEffect(() => {
        if (active && !store.hasSlot(slot) && store.firstWarning(slot)) {
            console.error(`WindowOverlay: no <OverlaySlot name="${slot}"> is mounted, so this overlay will never be shown.`);
        }
    }, [active, store, slot]);
    if (!open)
        return null;
    return active ? null : _jsx(_Fragment, { children: children });
}
