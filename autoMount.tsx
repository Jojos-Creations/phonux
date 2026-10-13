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
import { createDefaultTheme } from './defaultTheme.js';
import { DEFAULT_PHONE_SIZE, HostProvider } from './hostApi.js';
import { useProvidePanels } from './panels/useProvidePanels.js';
import type { ProvidedPanels } from './panels/useProvidePanels.js';
import type { WorkspaceProps } from './Workspace.js';
import type { WorkspaceHandle } from './workspaceCore.js';

/** The `Workspace` props the mount derives from what `useProvidePanels` returned: the same mapping a hand-wired flow writes out. @internal */
export function workspaceProps(provided: ProvidedPanels): Pick<WorkspaceProps, 'fixedColumnCount' | 'liveWidths' | 'rowScroll' | 'rowNumbers' | 'tuning'> {
  return { fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, tuning: provided.tuning };
}

/** The `PanelRow` props the mount derives from what `useProvidePanels` returned. @internal */
export function rowProps(provided: ProvidedPanels, workspace: WorkspaceHandle): Pick<React.ComponentProps<typeof PanelRow>, 'entries' | 'rootId' | 'closingIds' | 'enteringViaAnchorIds' | 'exitRightIds' | 'enterSideById' | 'maxLiveWidth' | 'tuning' | 'rowNumbers' | 'workspace'> {
  return { entries: provided.entries, rootId: workspace.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, tuning: provided.tuning, rowNumbers: provided.rowNumbers, workspace };
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

/** What the default mount renders for `workspace`. @internal */
export function AutoRoot({ workspace }: { workspace: WorkspaceHandle }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(ref);
  const provided = useProvidePanels({ workspace, rootId: workspace.rootId, phoneWidth: DEFAULT_PHONE_SIZE.width, containerWidth, overflowContainerRef: ref });
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = React.useMemo(() => createDefaultTheme(dark ? 'dark' : 'light'), [dark]);
  return (
    <AutoMountContext.Provider value={workspace}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <HostProvider host={{ panels: provided }}>
          <Workspace overflowContainerRef={ref} rowRef={rowRef} containerWidth={containerWidth} phoneWidth={DEFAULT_PHONE_SIZE.width} {...workspaceProps(provided)}>
            <PanelRow {...rowProps(provided, workspace)} />
          </Workspace>
        </HostProvider>
      </ThemeProvider>
    </AutoMountContext.Provider>
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
