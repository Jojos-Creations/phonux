/**
 * The boundary above a template's view. A view that throws while rendering takes down only its own panel: the panel draws a
 * failed state in the library's frame, so its header stays and the panel can be closed.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DefaultFrame } from './defaultFrame.js';
import { useOptionalHost, type PanelSummary } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { PanelFooterContext } from './panelFooter.js';

function FailedView({ panel, retry }: { panel: PanelSummary; retry: () => void }): React.ReactElement {
  const labels = resolveLabels(useOptionalHost()?.labels);
  return (
    // The footer belongs to the view that failed.
    <PanelFooterContext.Provider value={null}>
      <DefaultFrame panel={panel}>
        <Box data-panel-view-failed="" role="alert" sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, p: 2, textAlign: 'center', bgcolor: 'background.paper', fontSize: 13 }}>
          {labels.couldNotLoad}
          <Button size="small" data-panel-view-retry="" onClick={retry}>
            {labels.tryAgain}
          </Button>
        </Box>
      </DefaultFrame>
    </PanelFooterContext.Provider>
  );
}

/**
 * Draws `children`, or the failed state once they threw while rendering; Try again draws them afresh. The error itself is reported
 * by React to the root's `onCaughtError`, which the auto mount points at the workspace's `onError`. @internal
 */
export class ViewBoundary extends React.Component<{ panel: PanelSummary; children: React.ReactNode }, { failed: boolean; attempt: number }> {
  override state = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): React.ReactNode {
    if (this.state.failed) return <FailedView panel={this.props.panel} retry={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))} />;
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
