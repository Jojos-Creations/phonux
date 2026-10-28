/** What a view reaches as `useHost().panels`: the members of `PanelsAPI` and nothing the row keeps for itself. */
const warned = new Set();
/** Logs once per verb that it is deprecated and names what replaces it; silent in production and where `process` is undefined. @internal */
export function warnDeprecatedVerb(verb, instead) {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(verb))
        return;
    warned.add(verb);
    console.warn(`phonux: useHost().panels.${verb} is deprecated and is removed in a later release; use ${instead}.`);
}
const withWarning = (verb, instead, fn) => (...a) => {
    warnDeprecatedVerb(verb, instead);
    fn(...a);
};
/**
 * The `PanelsAPI` over `provided`: its read members, `undoClose` and `clearAll`, and the per-panel verbs, each of which still
 * works and warns once in development. The row's own members (`entries`, `rowNumbers`, `tuning` and the rest of `ProvidedPanels`) are not on it.
 * @internal
 */
export function hostPanelsOf(provided) {
    const create = (options) => {
        warnDeprecatedVerb('create', 'useWorkspace().panels.addPanel(template)');
        if (options === undefined)
            provided.create();
        else
            provided.create(options);
    };
    return {
        panelList: provided.panelList,
        ...(provided.maxFitPanels !== undefined ? { maxFitPanels: provided.maxFitPanels } : {}),
        recentlyClosed: provided.recentlyClosed,
        undoClose: provided.undoClose,
        clearAll: provided.clearAll,
        create: create,
        activate: withWarning('activate', 'useWorkspace().panels.get(key)?.show()', provided.activate),
        move: withWarning('move', 'useWorkspace().panels.get(key)?.move(count)', provided.move),
        setSlots: withWarning('setSlots', 'useWorkspace().panels.get(key)?.setSlots(slots)', provided.setSlots),
        reanchor: withWarning('reanchor', 'useWorkspace().panels.get(key)?.place(anchor)', provided.reanchor),
        close: withWarning('close', 'useWorkspace().panels.get(key)?.close()', provided.close),
    };
}
