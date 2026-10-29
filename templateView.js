import { jsx as _jsx } from "react/jsx-runtime";
/**
 * How a template's view is rendered inside a row: the adapter that gives it its handle, and the lookup a row runs for a
 * panel's `view` key.
 */
import * as React from 'react';
import { PanelLevelContext } from './panelLevelContext.js';
import { checkPanelApi, NEWEST_SHAPE, reportShapeOnce, SHIPPED_LEVELS, warnIfOldLevel } from './panelApiLevel.js';
import { FrameBoundary } from './panelFrameBoundary.js';
import { PanelFooterContext } from './panelFooter.js';
import { PanelTouchContext } from './panelTouch.js';
import { PanelVerticalDragContext } from './panelSlotContext.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { placeholderFor } from './viewRegistry.js';
/** One adapter per template object, for the same reason as the placeholders: a fresh component type on every resolve would remount the panel. */
const adapters = new WeakMap();
/**
 * The component that renders `t` inside a row: it reads the row's workspace from context and renders `t.view` with the
 * panel, its own read handle and the reader of every panel. Outside a row that has a workspace there is no handle to
 * give, so it renders the unregistered-view placeholder.
 * @internal
 */
export function templateViewFor(t, table = SHIPPED_LEVELS) {
    const forTable = adapters.get(table) ?? new WeakMap();
    adapters.set(table, forTable);
    const cached = forTable.get(t);
    if (cached)
        return cached;
    checkPanelApi(t.id, t.api, table);
    const level = t.api ?? table.newest;
    warnIfOldLevel(t.id, level, table);
    const entry = table.levels.get(level);
    const adapt = entry?.adapt;
    const shape = entry?.shape ?? NEWEST_SHAPE;
    function TemplatePanelView({ panel }) {
        const context = React.useContext(PanelViewContextValue);
        const handle = context?.handleFor(panel.id);
        if (context === undefined || context.manager === undefined || handle === undefined) {
            const Fallback = placeholderFor(t.id);
            return _jsx(Fallback, { panel: panel });
        }
        const props = { panel, handle, manager: context.manager };
        const viewProps = adapt === undefined ? props : adapt(props);
        reportShapeOnce(t.id, level, viewProps, shape);
        const View = t.view;
        const view = (_jsx(FrameBoundary, { template: t, panel: panel, children: _jsx(View, { ...viewProps }) }));
        const Footer = t.footer;
        const body = Footer === undefined ? view : _jsx(PanelFooterContext.Provider, { value: _jsx(Footer, { ...viewProps }), children: view });
        const touched = t.touch === undefined || t.touch === false ? body : _jsx(PanelTouchContext.Provider, { value: t.touch, children: body });
        const dragged = t.verticalDrag === true ? _jsx(PanelVerticalDragContext.Provider, { value: true, children: touched }) : touched;
        return _jsx(PanelLevelContext.Provider, { value: level, children: dragged });
    }
    forTable.set(t, TemplatePanelView);
    return TemplatePanelView;
}
/** The component a row draws for `key`: the workspace's template for it, else the placeholder. @internal */
export function resolveViewIn(templateOf, key) {
    const template = templateOf(key);
    return template ? templateViewFor(template) : placeholderFor(key);
}
