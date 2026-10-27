/**
 * The mount behind `createWorkspace`'s default: one React root that renders a workspace through the exported
 * HostProvider, Workspace and PanelRow, so the default layer is the code a hand-wired flow runs. Loaded only by a dynamic
 * `import()` from workspaceCore.ts, which keeps `react-dom/client` off the import path of a React-free caller.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider } from '@mui/material/styles';
import { AutoMountContext } from './autoMountContext.js';
import { PanelRow } from './PanelRow.js';
import { Workspace } from './Workspace.js';
import { createDefaultTheme, muiThemeFor, type PhonuxTheme } from './defaultTheme.js';
import { DEFAULT_PHONE_SIZE, HostProvider, type HostInput } from './hostApi.js';
import { usePhoneFit } from './usePhoneFit.js';
import { rowBottomReservePx } from './panelChromeSize.js';
import { hostPanelsOf } from './hostPanels.js';
import { useProvidePanels } from './panels/useProvidePanels.js';
import type { ProvidedPanels } from './panels/useProvidePanels.js';
import type { WorkspaceProps } from './Workspace.js';
import { bindingOf, type WorkspaceHandle } from './workspaceCore.js';
import { WorkspaceRowContext, type WorkspaceRow } from './workspaceRow.js';
import { columnCoreOf } from './columnHandle.js';
import { WorkspaceColumn } from './WorkspaceColumn.js';
import type { WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspacePanelsInput } from './workspaceLive.js';

/** The `Workspace` props the mount derives from what `useProvidePanels` returned: the same mapping a hand-wired flow writes out. @internal */
export function workspaceProps(provided: ProvidedPanels, workspace: WorkspaceHandle): Pick<WorkspaceProps, 'fixedColumnCount' | 'liveWidths' | 'rowScroll' | 'rowNumbers' | 'workspace'> {
  return { fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace };
}

/** The `PanelRow` props the mount derives from what `useProvidePanels` returned. @internal */
export function rowProps(provided: ProvidedPanels, workspace: WorkspaceHandle): Pick<React.ComponentProps<typeof PanelRow>, 'entries' | 'rootId' | 'closingIds' | 'enteringViaAnchorIds' | 'exitRightIds' | 'enterSideById' | 'maxLiveWidth' | 'rowNumbers' | 'workspace'> {
  return { entries: provided.entries, rootId: workspace.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, rowNumbers: provided.rowNumbers, workspace };
}

/** The window's width as the row prices itself from it: the scroll container's own `clientWidth`, 0 until it is measured. */
function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = (): void => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The `panels` option as `useProvidePanels` takes it: each callback is a stand-in that calls the latest one the app gave, so
 * a closure the app rebuilt (and `update` took without waking a reader) is the one a later close or restore runs.
 */
function panelsInputOf(workspace: WorkspaceHandle, stand: Map<string, unknown>): WorkspacePanelsInput {
  const live = bindingOf(workspace).live;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live.latest().panels ?? {})) {
    if (typeof value !== 'function') {
      out[key] = value;
      continue;
    }
    if (!stand.has(key)) stand.set(key, (...args: unknown[]) => (live.latest().panels as Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined)?.[key]?.(...args));
    out[key] = stand.get(key);
  }
  return out as WorkspacePanelsInput;
}

/** What the default mount renders for `workspace`. @internal */
type ThemeFor = (mode: 'light' | 'dark') => PhonuxTheme;

const isTheme = (t: unknown): t is PhonuxTheme => typeof t === 'object' && t !== null && typeof (t as PhonuxTheme).primary === 'string' && typeof (t as PhonuxTheme).radiusUnitPx === 'number';

/** The theme for the window's color scheme: `make` once per mode, else the default; a throw or a non-theme is reported once and the default is drawn. */
function useMountTheme(make: ThemeFor | undefined, onError: (e: unknown) => void): PhonuxTheme {
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = dark ? 'dark' : 'light';
  const made = React.useMemo((): { theme: PhonuxTheme; error?: unknown } => {
    if (make === undefined) return { theme: createDefaultTheme(mode) };
    try {
      const theme = make(mode);
      if (isTheme(theme)) return { theme };
      return { theme: createDefaultTheme(mode), error: new TypeError('phonux: the theme option must return a PhonuxTheme') };
    } catch (error) {
      return { theme: createDefaultTheme(mode), error };
    }
  }, [make, mode]);
  const reported = React.useRef<unknown>(undefined);
  React.useEffect(() => {
    if (made.error === undefined || reported.current === made) return;
    reported.current = made;
    onError(made.error);
  }, [made, onError]);
  return made.theme;
}

export function AutoRoot({ workspace, columnTop = 0, columnBottom = 0, themed = true }: { workspace: WorkspaceHandle; columnTop?: number; columnBottom?: number; themed?: boolean }): React.ReactElement {
  const binding = bindingOf(workspace);
  const theme = useMountTheme(binding.theme, binding.reportError);
  const styling = React.useMemo(() => muiThemeFor(theme), [theme]);
  const body = <AutoBody workspace={workspace} columnTop={columnTop} columnBottom={columnBottom} />;
  return (
    <AutoMountContext.Provider value={workspace}>
      {themed ? (
        <ThemeProvider theme={styling}>
          <CssBaseline />
          {body}
        </ThemeProvider>
      ) : (
        body
      )}
    </AutoMountContext.Provider>
  );
}

/** Inside the mount's ThemeProvider, so the phone fit and the row read the one theme. */
function AutoBody({ workspace, columnTop, columnBottom }: { workspace: WorkspaceHandle; columnTop: number; columnBottom: number }): React.ReactElement {
  const binding = bindingOf(workspace);
  React.useSyncExternalStore(binding.live.subscribe, binding.live.version);
  const values = binding.live.latest();
  const stand = React.useRef(new Map<string, unknown>());
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const measuredWidth = useContainerWidth(ref);
  const preferred = values.device?.size ?? DEFAULT_PHONE_SIZE;
  const tuning = React.useSyncExternalStore(binding.subscribe, () => binding.tuning, () => binding.tuning);
  // Standalone, `tuning.rowTop` alone sets the row's top room; the column's own cell adds its topInset clearance to the band.
  const topPadding = tuning.rowTop ?? (columnTop > 0 ? columnTop + (values.topInset ?? 0) + tuning.rowGap : undefined);
  // A column's band below that outgrows the default pushes the row up by the difference.
  const bottomPadding = columnBottom > 0 ? rowBottomReservePx(tuning.rowGap) + columnBottom : undefined;
  const phone = usePhoneFit(ref, measuredWidth, preferred, tuning, topPadding, bottomPadding);
  const phoneWidth = phone.width;
  // The settled width, so the capacity, the row's place and the phone size change in the same commit.
  const containerWidth = phone.containerWidth;
  const provided = useProvidePanels({
    ...panelsInputOf(workspace, stand.current),
    ...(values.labels !== undefined ? { labels: values.labels } : {}),
    workspace,
    phoneWidth,
    containerWidth,
    overflowContainerRef: ref,
  });
  const host: HostInput = {
    panels: hostPanelsOf(provided),
    ...(values.device !== undefined ? { device: values.device } : {}),
    ...(values.snapshots !== undefined ? { snapshots: values.snapshots } : {}),
    ...(values.labels !== undefined ? { labels: values.labels } : {}),
  };
  const Wrap = binding.wrap;
  const row = (
    <Workspace overflowContainerRef={ref} rowRef={rowRef} containerWidth={containerWidth} phoneWidth={phoneWidth} phoneHeight={phone.height} heightBudget={phone.heightBudget} {...(topPadding !== undefined ? { topPadding } : {})} {...(bottomPadding !== undefined ? { bottomPadding } : {})} {...workspaceProps(provided, workspace)}>
      <PanelRow {...rowProps(provided, workspace)} />
    </Workspace>
  );
  const rowValue = React.useMemo(
    (): WorkspaceRow => ({
      rowNumbers: provided.rowNumbers,
      entries: provided.entries,
      maxFitPanels: provided.maxFitPanels ?? null,
      scroller: ref,
      tuning,
      phoneSize: { width: phone.width, height: phone.height },
    }),
    [provided.rowNumbers, provided.entries, provided.maxFitPanels, tuning, phone.width, phone.height],
  );
  return (
    <HostProvider host={host}>
      <WorkspaceRowContext.Provider value={rowValue}>{Wrap === undefined ? row : <Wrap workspace={workspace}>{row}</Wrap>}</WorkspaceRowContext.Provider>
    </HostProvider>
  );
}

/**
 * Renders `workspace` into `target` (default: a full-window element appended to `document.body`) and returns the function that
 * takes it all away again. A supplied `target` is only given a child and is never emptied.
 * @internal
 */
export function mountWorkspace(workspace: WorkspaceHandle, target: HTMLElement | undefined, onError: (e: unknown) => void): () => void {
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
  root.render(<AutoRoot workspace={workspace} />);
  return () => {
    root.unmount();
    inner.remove();
    if (owned) outer.remove();
  };
}

/** What a column renders itself with: the theme, and the column over a cell per workspace. @internal */
export function ColumnRoot({ column }: { column: WorkspaceColumnHandle }): React.ReactElement {
  const core = columnCoreOf(column);
  const theme = useMountTheme(core.theme, core.reportError);
  const styling = React.useMemo(() => muiThemeFor(theme), [theme]);
  return (
    <ThemeProvider theme={styling}>
      <CssBaseline />
      <WorkspaceColumn column={column} />
    </ThemeProvider>
  );
}

/** Renders `column` into `target` as `mountWorkspace` does a workspace, and returns the function that takes it away. @internal */
export function mountColumn(column: WorkspaceColumnHandle, target: HTMLElement | undefined, onError: (e: unknown) => void): () => void {
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
  root.render(<ColumnRoot column={column} />);
  return () => {
    root.unmount();
    inner.remove();
    if (owned) outer.remove();
  };
}
