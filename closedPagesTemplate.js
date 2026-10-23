import { jsx as _jsx } from "react/jsx-runtime";
import { definePanel } from './panelTemplate.js';
import { ClosedPagesPanel } from './ClosedPagesPanel.js';
import { DEFAULT_LABELS } from './labels.js';
/**
 * A panel template that shows the closed pages, with the settings a closed-pages log uses (closable, one at a time,
 * host-creatable). Add it to a workspace's `templates` like any other template.
 * @example
 * ```ts
 * const closedPages = createClosedPagesTemplate({ list: closed, onReopen: (entry) => openPage(entry.url) });
 * ```
 * @public
 */
export function createClosedPagesTemplate({ list, onReopen, id = 'closed-pages', title = DEFAULT_LABELS.closedPagesTitle }) {
    const view = () => _jsx(ClosedPagesPanel, { list: list, onReopen: onReopen });
    return definePanel({
        id,
        view,
        settings: {
            title,
            multiple: false,
            hostCreatable: true,
            overflow: 'park',
            capacityReturn: 'manual',
            revealOnScroll: 'never',
            showWhenClosed: 'reopen',
        },
    });
}
