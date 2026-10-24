import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
/** One placeholder instance per unknown key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map();
/** The placeholder view for a `key` no template answers to. @internal */
export function placeholderFor(key) {
    const cached = placeholders.get(key);
    if (cached)
        return cached;
    function UnregisteredPanelPlaceholder({ panel }) {
        const labels = resolveLabels(useOptionalHost()?.labels);
        return (_jsxs("div", { "data-unregistered-panel-view": key, children: [_jsx("span", { children: panel.title ?? labels.untitledPanel }), _jsx("span", { "data-unregistered-panel-view-key": "", children: key })] }));
    }
    placeholders.set(key, UnregisteredPanelPlaceholder);
    return UnregisteredPanelPlaceholder;
}
