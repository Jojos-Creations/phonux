import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as React from 'react';
import PanelFrame from './PanelFrame.js';
import { resolveLabels } from './labels.js';
import { useOptionalHost } from './hostApi.js';
import { firstClosedPages, groupClosedPages } from './closedPagesModel.js';
import { formatClosedPagesDay } from './closedPagesFormat.js';
/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel. Its text comes from the
 * host's `labels`.
 * @throws RangeError when `pageSize` is given and is not a positive integer.
 * @public
 */
export function ClosedPagesPanel({ list, onReopen, className, pageSize, query: hostQuery }) {
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1))
        throw new RangeError(`ClosedPagesPanel: pageSize must be a positive integer, got ${String(pageSize)}`);
    const labels = resolveLabels(useOptionalHost()?.labels);
    const [ownQuery, setOwnQuery] = React.useState('');
    const query = hostQuery ?? ownQuery;
    // Keyed by the search it was counted for, so a new search starts again at one page.
    const [paged, setPaged] = React.useState({ query, pages: 1 });
    const pages = paged.query === query ? paged.pages : 1;
    const matches = groupClosedPages(list.entries, query);
    const total = matches.reduce((n, group) => n + group.entries.length, 0);
    const shown = pageSize === undefined ? total : pages * pageSize;
    const groups = firstClosedPages(matches, shown);
    const reopen = (entry) => {
        list.touch(entry.id);
        onReopen(entry);
    };
    return (_jsxs(PanelFrame, { "data-closed-pages": "", className: className, children: [hostQuery === undefined && _jsx("input", { type: "search", value: query, onChange: (e) => setOwnQuery(e.target.value), placeholder: labels.closedPagesSearch, "aria-label": labels.closedPagesSearch }), !list.loaded ? (_jsx("div", { children: labels.closedPagesLoading })) : groups.length === 0 ? (_jsx("div", { "data-closed-pages-empty": "", children: list.entries.length === 0 ? labels.closedPagesEmpty : labels.closedPagesNoMatches })) : (_jsxs(_Fragment, { children: [groups.map((group) => (_jsxs("section", { "data-closed-pages-day": group.date, children: [_jsx("h3", { children: formatClosedPagesDay(group.date) }), _jsx("ul", { children: group.entries.map((entry) => (_jsx("li", { "data-closed-pages-row": "", children: _jsxs("button", { type: "button", onClick: () => reopen(entry), children: [_jsx("span", { children: entry.title === '' ? labels.closedPagesUntitled : entry.title }), entry.url !== undefined && entry.url !== '' && _jsx("span", { children: entry.url }), _jsx("time", { dateTime: entry.closedAt, children: new Date(entry.closedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })] }) }, entry.id))) })] }, group.date))), shown < total && (_jsx("button", { type: "button", "data-closed-pages-more": "", onClick: () => setPaged({ query, pages: pages + 1 }), children: labels.closedPagesShowMore }))] }))] }));
}
