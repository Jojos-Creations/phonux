import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const registry = new Map();
/** One placeholder instance per unregistered key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map();
/**
 * Registers (or replaces) `key`'s component; this module registers nothing itself. Declare `P` with a `type`,
 * never an `interface`: an interface has no implicit index signature, so it never satisfies `JsonValue`.
 * @public
 */
export function registerView(key, Component) {
    registry.set(key, Component);
}
/** @public @deprecated use registerView */
export const registerPanelView = registerView;
function placeholderFor(key) {
    const cached = placeholders.get(key);
    if (cached)
        return cached;
    function UnregisteredPanelPlaceholder({ panel }) {
        return (_jsxs("div", { "data-unregistered-panel-view": key, children: [_jsx("span", { children: panel.title ?? 'Untitled panel' }), _jsx("span", { "data-unregistered-panel-view-key": "", children: key })] }));
    }
    placeholders.set(key, UnregisteredPanelPlaceholder);
    return UnregisteredPanelPlaceholder;
}
/** Never throws, never returns nothing: an unregistered key is a typo or a plugin missing THIS session, not a corrupt layout. @public */
export function resolveView(key) {
    return registry.get(key) ?? placeholderFor(key);
}
/** @public @deprecated use resolveView */
export const resolvePanelView = resolveView;
