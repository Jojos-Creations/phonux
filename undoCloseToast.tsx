import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import type { PanelSummary } from './hostApi.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { UNDO_CLOSE_TOAST_ATTRIBUTE } from './rowDom.js';
import { OVERLAY_Z } from './windowOverlay.js';

/** The workspace's notice for the panels the person closed in the undo window, with its Undo. @internal */
export function UndoCloseToast({ closed, onUndo, onHold }: { closed: readonly PanelSummary[] | null; onUndo: () => void; onHold?: (on: boolean) => void }): React.ReactElement {
  const labels = resolveLabels(useOptionalHost()?.labels);
  // The notice is the only way back for a closed panel, so it stays while the person is on it, by pointer or by focus.
  const over = React.useRef({ pointer: false, focus: false });
  const hold = (next: Partial<typeof over.current>): void => {
    over.current = { ...over.current, ...next };
    onHold?.(over.current.pointer || over.current.focus);
  };
  const holdRef = React.useRef(hold);
  holdRef.current = hold;
  React.useEffect(() => {
    if (closed === null && (over.current.pointer || over.current.focus)) holdRef.current({ pointer: false, focus: false });
  }, [closed]);
  React.useEffect(() => () => holdRef.current({ pointer: false, focus: false }), []);
  return (
    <Snackbar
      {...{ [UNDO_CLOSE_TOAST_ATTRIBUTE]: '' }}
      onMouseEnter={() => hold({ pointer: true })}
      onMouseLeave={() => hold({ pointer: false })}
      onFocus={() => hold({ focus: true })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hold({ focus: false });
      }}
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
