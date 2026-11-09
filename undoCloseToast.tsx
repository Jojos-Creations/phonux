import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import type { PanelSummary } from './hostApi.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { UNDO_CLOSE_TOAST_ATTRIBUTE } from './rowDom.js';
import { OVERLAY_Z } from './windowOverlay.js';

/** The workspace's notice for the panels the person closed in the undo window, with its Undo. @internal */
export function UndoCloseToast({ closed, onUndo }: { closed: readonly PanelSummary[] | null; onUndo: () => void }): React.ReactElement {
  const labels = resolveLabels(useOptionalHost()?.labels);
  return (
    <Snackbar
      {...{ [UNDO_CLOSE_TOAST_ATTRIBUTE]: '' }}
      open={closed !== null}
      message={closed === null ? '' : labels.undoCloseMessage(closed.map((p) => p.title || labels.untitledHeader))}
      action={
        <Button color="inherit" size="small" onClick={onUndo}>
          {labels.undo}
        </Button>
      }
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ zIndex: OVERLAY_Z.toast }}
    />
  );
}
