/**
 * Which panel fills the window, kept apart from the maximize itself so a test can stand in for a grown panel without React or motion.
 */
import * as React from 'react';

/**
 * Where a panel is between its slot and the whole window: `home` in its slot, `growing`, `maximized` filling the window, or `shrinking`.
 * @public
 */
export type MaximizePhase = 'home' | 'growing' | 'maximized' | 'shrinking';

/**
 * A panel that can fill the window, as `maximizedPanel` and `toggleMaximize` hand it out.
 * @public
 */
export interface MaximizablePanel {
  /** The panel's root element, or null while it is not drawn. */
  root(): Element | null;
  /** Grows the panel, or shrinks it if it is grown. False when the browser refused to lift it (no popover support). */
  toggle(): boolean;
}

const panels = new Set<MaximizablePanel>();
const listeners = new Set<() => void>();
let grown: { panel: MaximizablePanel; settled: boolean } | null = null;

const emit = (): void => {
  for (const listener of [...listeners]) listener();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Tells the window which phase `panel` is in; with `register`, also makes it one `toggleMaximize` can find, until the returned
 * function is called (which reports it home). A test stands in for a grown panel with it.
 * @public
 */
export function reportMaximized(panel: MaximizablePanel, phase: MaximizePhase, register = false): () => void {
  if (register) panels.add(panel);
  report(panel, phase);
  return () => {
    panels.delete(panel);
    report(panel, 'home');
  };
}

function report(panel: MaximizablePanel, phase: MaximizePhase): void {
  if (phase === 'growing' || phase === 'maximized') grown = { panel, settled: phase === 'maximized' };
  else if (grown?.panel === panel) grown = null;
  else return;
  emit();
}

/**
 * The panel that is growing or fills the window, or null. At most one does at a time.
 * @public
 */
export const maximizedPanel = (): MaximizablePanel | null => grown?.panel ?? null;

/**
 * Whether a panel is growing or fills the window (`maximized`), and whether it has finished growing (`settled`). Nothing should be
 * drawn over a maximized panel: read it to hide floating controls.
 * @public
 */
export function useMaximizedPanel(): { readonly maximized: boolean; readonly settled: boolean } {
  const maximized = React.useSyncExternalStore(subscribe, () => grown !== null, () => false);
  const settled = React.useSyncExternalStore(subscribe, () => grown?.settled === true, () => false);
  return React.useMemo(() => ({ maximized, settled }), [maximized, settled]);
}

/** Every panel `toggleMaximize` can find. @internal */
export const maximizablePanels = (): readonly MaximizablePanel[] => [...panels];
