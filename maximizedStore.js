/**
 * Which panel fills the window, kept apart from the maximize itself so a test can stand in for a grown panel without React or motion.
 */
import * as React from 'react';
const panels = new Set();
const listeners = new Set();
let grown = null;
const emit = () => {
    for (const listener of [...listeners])
        listener();
};
const subscribe = (listener) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
};
/**
 * Tells the window which phase `panel` is in; with `register`, also makes it one `toggleMaximize` can find, until the returned
 * function is called (which reports it home). A test stands in for a grown panel with it.
 * @public
 */
export function reportMaximized(panel, phase, register = false) {
    if (register)
        panels.add(panel);
    report(panel, phase);
    return () => {
        panels.delete(panel);
        report(panel, 'home');
    };
}
function report(panel, phase) {
    if (phase === 'growing' || phase === 'maximized')
        grown = { panel, settled: phase === 'maximized' };
    else if (grown?.panel === panel)
        grown = null;
    else
        return;
    emit();
}
/**
 * The panel that is growing or fills the window, or null. At most one does at a time.
 * @public
 */
export const maximizedPanel = () => grown?.panel ?? null;
/**
 * Whether a panel is growing or fills the window (`maximized`), and whether it has finished growing (`settled`). Nothing should be
 * drawn over a maximized panel: read it to hide floating controls.
 * @public
 */
export function useMaximizedPanel() {
    const maximized = React.useSyncExternalStore(subscribe, () => grown !== null, () => false);
    const settled = React.useSyncExternalStore(subscribe, () => grown?.settled === true, () => false);
    return React.useMemo(() => ({ maximized, settled }), [maximized, settled]);
}
/** Every panel `toggleMaximize` can find. @internal */
export const maximizablePanels = () => [...panels];
