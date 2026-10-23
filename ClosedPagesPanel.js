import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import PanelFrame from './PanelFrame.js';
import { resolveLabels } from './labels.js';
import { useOptionalHost } from './hostApi.js';
import { groupClosedPages } from './closedPagesModel.js';
import { formatClosedPagesDay } from './closedPagesFormat.js';
/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel. Its text comes from the
 * host's `labels`.
 * @public
 */
export function ClosedPagesPanel({ list, onReopen, className }) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const [query, setQuery] = React.useState('');
    const groups = groupClosedPages(list.entries, query);
    const reopen = (entry) => {
        list.touch(entry.id);
        onReopen(entry);
    };
    return (_jsxs(PanelFrame, { "data-closed-pages": "", className: className, children: [_jsx("input", { type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: labels.closedPagesSearch, "aria-label": labels.closedPagesSearch }), !list.loaded ? (_jsx("div", { children: labels.closedPagesLoading })) : groups.length === 0 ? (_jsx("div", { "data-closed-pages-empty": "", children: list.entries.length === 0 ? labels.closedPagesEmpty : labels.closedPagesNoMatches })) : (groups.map((group) => (_jsxs("section", { "data-closed-pages-day": group.date, children: [_jsx("h3", { children: formatClosedPagesDay(group.date) }), _jsx("ul", { children: group.entries.map((entry) => (_jsx("li", { "data-closed-pages-row": "", children: _jsxs("button", { type: "button", onClick: () => reopen(entry), children: [_jsx("span", { children: entry.title === '' ? labels.closedPagesUntitled : entry.title }), entry.url !== undefined && entry.url !== '' && _jsx("span", { children: entry.url }), _jsx("time", { dateTime: entry.closedAt, children: new Date(entry.closedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })] }) }, entry.id))) })] }, group.date))))] }));
}
