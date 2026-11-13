import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The mount behind `createWorkspace`'s default: one React root that renders a workspace through the exported
 * HostProvider, Workspace and PanelRow, so the default layer is the code a hand-wired flow runs. Loaded only by a dynamic
 * `import()` from workspaceCore.ts, which keeps `react-dom/client` off the import path of a React-free caller.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import useMediaQuery from '@mui/material/useMediaQuery';
import { AutoMountContext } from './autoMountContext.js';
import { PanelRow } from './PanelRow.js';
import { Workspace } from './Workspace.js';
import { UndoCloseToast } from './undoCloseToast.js';
import { createDefaultTheme, PhonuxThemeProvider } from './defaultTheme.js';
import { DEFAULT_PHONE_SIZE, HostProvider } from './hostApi.js';
import { usePhoneFit } from './usePhoneFit.js';
import { rowBottomReservePx } from './panelChromeSize.js';
import { hostPanelsOf } from './hostPanels.js';
import { useProvidePanels } from './panels/useProvidePanels.js';
import { bindingOf } from './workspaceCore.js';
import { WorkspaceRowContext } from './workspaceRow.js';
import { columnCoreOf } from './columnHandle.js';
import { WorkspaceColumn } from './WorkspaceColumn.js';
/** The `Workspace` props the mount derives from what `useProvidePanels` returned: the same mapping a hand-wired flow writes out. @internal */
export function workspaceProps(provided, workspace) {
    return { fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace };
}
/** The `PanelRow` props the mount derives from what `useProvidePanels` returned. @internal */
export function rowProps(provided, workspace) {
    return { entries: provided.entries, rootId: workspace.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, swapExitIds: provided.swapExitIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, rowNumbers: provided.rowNumbers, workspace };
}
/** The window's width as the row prices itself from it: the scroll container's own `clientWidth`, 0 until it is measured. */
function useContainerWidth(ref) {
    const [width, setWidth] = React.useState(0);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (el === null)
            return;
        const read = () => setWidth(el.clientWidth);
        read();
        if (typeof ResizeObserver === 'undefined')
            return;
        // Committed before the paint the observer runs ahead of, so no frame of a live resize draws the row at the old width.
        const observer = new ResizeObserver(() => flushSync(read));
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}
/**
 * The `panels` option as `useProvidePanels` takes it: each callback is a stand-in that calls the latest one the app gave, so
 * a closure the app rebuilt (and `update` took without waking a reader) is the one a later close or restore runs.
 */
function panelsInputOf(workspace, stand) {
    const live = bindingOf(workspace).live;
    const out = {};
    for (const [key, value] of Object.entries(live.latest().panels ?? {})) {
        if (typeof value !== 'function') {
            out[key] = value;
            continue;
        }
        if (!stand.has(key))
            stand.set(key, (...args) => live.latest().panels?.[key]?.(...args));
        out[key] = stand.get(key);
    }
    return out;
}
const isTheme = (t) => typeof t === 'object' && t !== null && typeof t.primary === 'string' && typeof t.radius === 'number';
/** The theme for the window's color scheme: `make` once per mode, else the default; a throw or a non-theme is reported once and the default is drawn. */
function useMountTheme(make, onError) {
    const dark = useMediaQuery('(prefers-color-scheme: dark)');
    const mode = dark ? 'dark' : 'light';
    const made = React.useMemo(() => {
        if (make === undefined)
            return { theme: createDefaultTheme(mode) };
        try {
            const theme = make(mode);
            if (isTheme(theme))
                return { theme };
            return { theme: createDefaultTheme(mode), error: new TypeError('phonux: the theme option must return a PhonuxTheme') };
        }
        catch (error) {
            return { theme: createDefaultTheme(mode), error };
        }
    }, [make, mode]);
    const reported = React.useRef(undefined);
    React.useEffect(() => {
        if (made.error === undefined || reported.current === made)
            return;
        reported.current = made;
        onError(made.error);
    }, [made, onError]);
    return made.theme;
}
export function AutoRoot({ workspace, columnTop = 0, columnBottom = 0, themed = true }) {
    const binding = bindingOf(workspace);
    const theme = useMountTheme(binding.theme, binding.reportError);
    const body = _jsx(AutoBody, { workspace: workspace, columnTop: columnTop, columnBottom: columnBottom });
    return (_jsx(AutoMountContext.Provider, { value: workspace, children: themed ? (_jsx(PhonuxThemeProvider, { theme: theme, children: body })) : (body) }));
}
/** Inside the mount's ThemeProvider, so the phone fit and the row read the one theme. */
function AutoBody({ workspace, columnTop, columnBottom }) {
    const binding = bindingOf(workspace);
    React.useSyncExternalStore(binding.live.subscribe, binding.live.version);
    const values = binding.live.latest();
    const stand = React.useRef(new Map());
    const ref = React.useRef(null);
    const rowRef = React.useRef(null);
    const measuredWidth = useContainerWidth(ref);
    const preferred = values.device?.size ?? DEFAULT_PHONE_SIZE;
    const tuning = React.useSyncExternalStore(binding.subscribe, () => binding.tuning, () => binding.tuning);
    // Standalone, `tuning.rowTop` alone sets the row's top room; the column's own cell adds its topInset clearance to the band.
    const topPadding = tuning.rowTop ?? (columnTop > 0 ? columnTop + (values.topInset ?? 0) + tuning.rowGap : undefined);
    // A column's band below that outgrows the default pushes the row up by the difference.
    const bottomPadding = columnBottom > 0 ? rowBottomReservePx(tuning.rowGap, undefined, tuning.chrome.where) + columnBottom : undefined;
    const phone = usePhoneFit(ref, measuredWidth, preferred, tuning, topPadding, bottomPadding);
    const phoneWidth = phone.width;
    const containerWidth = phone.containerWidth;
    const provided = useProvidePanels({
        ...panelsInputOf(workspace, stand.current),
        ...(values.labels !== undefined ? { labels: values.labels } : {}),
        workspace,
        phoneWidth,
        containerWidth,
        overflowContainerRef: ref,
    });
    const host = {
        panels: hostPanelsOf(provided),
        ...(values.device !== undefined ? { device: values.device } : {}),
        ...(values.snapshots !== undefined ? { snapshots: values.snapshots } : {}),
        ...(values.labels !== undefined ? { labels: values.labels } : {}),
        ...(values.icons !== undefined ? { icons: values.icons } : {}),
    };
    const Wrap = binding.wrap;
    const row = (_jsx(Workspace, { ...(binding.rowNearSlots !== undefined ? { rowNearSlots: binding.rowNearSlots } : {}), overflowContainerRef: ref, rowRef: rowRef, containerWidth: containerWidth, phoneWidth: phoneWidth, phoneHeight: phone.height, heightBudget: phone.heightBudget, ...(topPadding !== undefined ? { topPadding } : {}), ...(bottomPadding !== undefined ? { bottomPadding } : {}), ...workspaceProps(provided, workspace), children: _jsx(PanelRow, { ...rowProps(provided, workspace) }) }));
    const shown = (_jsxs(_Fragment, { children: [row, binding.undoToast ? _jsx(UndoCloseToast, { closed: provided.closedByPerson, onUndo: provided.undoClose }) : null] }));
    const rowValue = React.useMemo(() => ({
        rowNumbers: provided.rowNumbers,
        entries: provided.entries,
        maxFitPanels: provided.maxFitPanels ?? null,
        scroller: ref,
        tuning,
        phoneSize: { width: phone.width, height: phone.height },
    }), [provided.rowNumbers, provided.entries, provided.maxFitPanels, tuning, phone.width, phone.height]);
    return (_jsx(HostProvider, { host: host, children: _jsx(WorkspaceRowContext.Provider, { value: rowValue, children: Wrap === undefined ? shown : _jsx(Wrap, { workspace: workspace, children: shown }) }) }));
}
/**
 * Renders `workspace` into `target` (default: a full-window element appended to `document.body`) and returns the function that
 * takes it all away again. A supplied `target` is only given a child and is never emptied.
 * @internal
 */
export function mountWorkspace(workspace, target, onError) {
    const owned = target === undefined;
    const outer = target ?? document.createElement('div');
    if (owned) {
        outer.style.position = 'fixed';
        outer.style.inset = '0';
        document.body.appendChild(outer);
    }
    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    outer.appendChild(inner);
    const root = createRoot(inner, { onUncaughtError: onError, onCaughtError: onError });
    root.render(_jsx(AutoRoot, { workspace: workspace }));
    return () => {
        root.unmount();
        inner.remove();
        if (owned)
            outer.remove();
    };
}
/** What a column renders itself with: the theme, and the column over a cell per workspace. @internal */
export function ColumnRoot({ column }) {
    const core = columnCoreOf(column);
    const theme = useMountTheme(core.theme, core.reportError);
    return (_jsx(PhonuxThemeProvider, { theme: theme, children: _jsx(WorkspaceColumn, { column: column }) }));
}
/** Renders `column` into `target` as `mountWorkspace` does a workspace, and returns the function that takes it away. @internal */
export function mountColumn(column, target, onError) {
    const owned = target === undefined;
    const outer = target ?? document.createElement('div');
    if (owned) {
        outer.style.position = 'fixed';
        outer.style.inset = '0';
        document.body.appendChild(outer);
    }
    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    outer.appendChild(inner);
    const root = createRoot(inner, { onUncaughtError: onError, onCaughtError: onError });
    root.render(_jsx(ColumnRoot, { column: column }));
    return () => {
        root.unmount();
        inner.remove();
        if (owned)
            outer.remove();
    };
}
