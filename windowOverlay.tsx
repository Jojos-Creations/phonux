/**
 * WindowOverlay: how a view (ours or a third party's) shows something over the WINDOW (a dialog, a full-screen
 * viewer, a toast) with no host wiring and no Portal.
 *
 *   function NotesView() {
 *     const [open, setOpen] = useState(false);
 *     return (
 *       <PhoneView title="Notes">
 *         <button onClick={() => setOpen(true)}>About</button>
 *         <WindowOverlay open={open}><AboutSheet onClose={() => setOpen(false)} /></WindowOverlay>
 *       </PhoneView>
 *     );
 *   }
 *
 * How: WindowOverlay registers its children with a store (from a layout effect, never during render) and renders
 * null; the host mounts two <OverlaySlot>s once, and each renders what was registered for it, as plain fragments with
 * no wrapper element. Hoisting matters because a view's own box is the wrong place: History's column is a
 * `zIndex: 2` stacking context (capped under the 1400 drag strip) and every live panel sits inside a transformed
 * slot (a transformed ancestor re-anchors `position: fixed` to itself).
 *
 * The contract for the CONTENT (the layer adds no wrapper, so it cannot enforce these):
 *  1. Its root element is `position: fixed` and sets its own zIndex from OVERLAY_Z. A non-fixed root would become a
 *     flex item of the row and mis-centre it.
 *  2. It renders where the SLOT is. Context (theme, useHost()) comes from the slot's position; React events
 *     bubble through the slot's ancestors, not the view's; a provider the view installs itself is not visible to it.
 *  3. `open={false}` removes the content at once. Content that must animate out (MUI Snackbar) stays registered and
 *     takes its own `open`.
 *  4. Content that stays registered while idle should be a MODULE-LEVEL constant element that reads what it needs
 *     through useHost(): an element built inline is a new node every render and costs one store notification
 *     per view render.
 *  5. Never key an effect inside overlay content on a useHost() member: the provider value is rebuilt every
 *     render on purpose, so such an effect re-fires on every host render. Use [] for "once per open".
 *  6. Stacking inside a slot is open order (later on top at equal z-index). Two slots never mix.
 *  7. Lifetime is the registering view's: unmounting the view removes its overlays.
 *  8. With no provider, or under renderToStaticMarkup (effects do not run), the children render IN PLACE. That is
 *     what makes a view testable without a host; where an overlay LANDS is only ever asserted in a mounted test.
 *  9. Under a HostProvider with NO slot mounted (a test that wraps a view in the provider with the fakes), the
 *     overlay registers with nobody to show it: it never appears, and one console.error per mount names the missing
 *     slot. Such a test mounts <OverlaySlot name="dialog" /> and <OverlaySlot name="toast" /> beside the view, as the host does.
 *
 * Not to be confused with PhoneView's `overlay` prop, which decorates ONE view inside its own relative box
 * (History's "+" Fab) and is meant to be clipped to it.
 */

import * as React from 'react';
import { Fragment, createContext, useContext, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Where hoisted content renders (a PLACE the host chooses, never the view).
 *   'dialog': the row's first children. Modal-ish, window-sized (scrims, dialogs, full-screen viewers).
 *   'toast':  the window root, after the scroll container. Transient notices (snackbars).
 */
export type OverlaySlotName = 'dialog' | 'toast';

/**
 * The z-index each slot's content applies to ITS OWN root. WindowOverlay adds no wrapper element,
 * so it cannot set it for you. dialog 2000 = today's Closed Pages viewer (above the 1400 drag strip);
 * toast 1400 = MUI's snackbar band = today's undo toast.
 */
export const OVERLAY_Z = { dialog: 2000, toast: 1400 } as const;

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

interface Entry {
  slot: OverlaySlotName;
  node: React.ReactNode;
}
interface Item {
  id: string;
  node: React.ReactNode;
}
const EMPTY: readonly Item[] = Object.freeze([]);

/** External store, NOT React state: a registration re-renders neither the host nor any view. */
export class OverlayStore {
  private entries = new Map<string, Entry>(); // Map keeps FIRST-insertion position across overwrites
  private listeners = new Set<() => void>();
  private slots = new Map<OverlaySlotName, number>();
  private warned = new Set<OverlaySlotName>();
  private snap: Record<OverlaySlotName, readonly Item[]> = { dialog: EMPTY, toast: EMPTY };
  /** Count of listener notifications (test seam: pins the same-node short-circuit). */
  notifications = 0;

  set(id: string, entry: Entry): void {
    const prev = this.entries.get(id);
    if (prev && prev.slot === entry.slot && prev.node === entry.node) return;
    this.entries.set(id, entry);
    this.rebuild(entry.slot);
    if (prev && prev.slot !== entry.slot) this.rebuild(prev.slot);
    this.emit();
  }
  remove(id: string): void {
    const prev = this.entries.get(id);
    if (!prev) return;
    this.entries.delete(id);
    this.rebuild(prev.slot);
    this.emit();
  }
  mountSlot(name: OverlaySlotName): () => void {
    this.slots.set(name, (this.slots.get(name) ?? 0) + 1);
    return () => void this.slots.set(name, (this.slots.get(name) ?? 1) - 1);
  }
  hasSlot(name: OverlaySlotName): boolean {
    return (this.slots.get(name) ?? 0) > 0;
  }
  /** True once per slot name per store: the caller logs the "no slot" error only the first time. */
  firstWarning(name: OverlaySlotName): boolean {
    if (this.warned.has(name)) return false;
    this.warned.add(name);
    return true;
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  read(slot: OverlaySlotName): readonly Item[] {
    return this.snap[slot];
  }
  /** Ids in registration order across both slots (test seam). */
  ids(): string[] {
    return [...this.entries.keys()];
  }
  private rebuild(slot: OverlaySlotName): void {
    const items: Item[] = [];
    for (const [id, e] of this.entries) if (e.slot === slot) items.push({ id, node: e.node });
    this.snap = { ...this.snap, [slot]: items.length ? items : EMPTY };
  }
  private emit(): void {
    this.notifications += 1;
    for (const l of [...this.listeners]) l();
  }
}

const StoreContext = createContext<OverlayStore | null>(null);
const noopSubscribe = () => () => {};

/**
 * Rendered by HostProvider, so a host adds nothing. The store is never part of the app-supplied Host bag
 * (nothing about an overlay is app-specific). `store` is a TEST SEAM: a test passes its own to read `notifications`/`ids()`.
 */
export function OverlayProvider({ children, store: injected }: { children: React.ReactNode; store?: OverlayStore }) {
  const [store] = useState(() => injected ?? new OverlayStore()); // pure constructor: StrictMode's double init is harmless
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>; // stable value: never re-renders consumers
}

/** Mounted by the HOST once per slot. Emits NO element: hoisted overlays become its parent's direct children. */
export const OverlaySlot = React.memo(function OverlaySlot({ name }: { name: OverlaySlotName }) {
  const store = useContext(StoreContext);
  useLayoutEffect(() => store?.mountSlot(name), [store, name]);
  // A slot outside the provider sees an empty store forever: a host bug that would otherwise be silent.
  useEffect(() => {
    if (store === null) console.error(`OverlaySlot name="${name}": rendered outside <OverlayProvider> (HostProvider renders it), so nothing hoisted will ever show here.`);
  }, [store, name]);
  const items = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    () => (store ? store.read(name) : EMPTY),
    () => EMPTY,
  );
  return <>{items.map((i) => <Fragment key={i.id}>{i.node}</Fragment>)}</>;
});

/**
 * Render this anywhere in a view, at any depth. Its children appear in the matching OverlaySlot.
 * With no provider, or under renderToStaticMarkup (no effects), the children render IN PLACE instead.
 */
export function WindowOverlay({ slot = 'dialog', open = true, children }: WindowOverlayProps) {
  const store = useContext(StoreContext);
  // getServerSnapshot -> false (static markup); a client render with a provider -> true on the first pass.
  const hoisting = useSyncExternalStore(noopSubscribe, () => store !== null, () => false);
  const id = useId();
  const active = hoisting && open && store !== null;
  // Every commit: `children` is a fresh element each render. The store skips an identical node.
  useLayoutEffect(() => {
    if (active) store!.set(id, { slot, node: children });
  });
  // Unregister on unmount, on close and on slot change. Declaration order against the set-effect above is NOT
  // load-bearing (measured: swapping them turns no test red): React runs every cleanup of a commit, StrictMode's
  // simulated remount included, before any setup.
  useLayoutEffect(
    () => () => {
      store?.remove(id);
    },
    [store, id, active, slot],
  );
  // Passive on purpose: by now every slot's layout effect has run, so "no slot" really means none.
  useEffect(() => {
    if (active && !store!.hasSlot(slot) && store!.firstWarning(slot)) {
      console.error(`WindowOverlay: no <OverlaySlot name="${slot}"> is mounted, so this overlay will never be shown.`);
    }
  }, [active, store, slot]);
  if (!open) return null;
  return active ? null : <>{children}</>;
}
