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
/**
 * Tells the window which phase `panel` is in; with `register`, also makes it one `toggleMaximize` can find, until the returned
 * function is called (which reports it home). A test stands in for a grown panel with it.
 * @public
 */
export declare function reportMaximized(panel: MaximizablePanel, phase: MaximizePhase, register?: boolean): () => void;
/**
 * The panel that is growing or fills the window, or null. At most one does at a time.
 * @public
 */
export declare const maximizedPanel: () => MaximizablePanel | null;
/**
 * Whether a panel is growing or fills the window (`maximized`), and whether it has finished growing (`settled`). Nothing should be
 * drawn over a maximized panel: read it to hide floating controls.
 * @public
 */
export declare function useMaximizedPanel(): {
    readonly maximized: boolean;
    readonly settled: boolean;
};
/** Every panel `toggleMaximize` can find. @internal */
export declare const maximizablePanels: () => readonly MaximizablePanel[];
