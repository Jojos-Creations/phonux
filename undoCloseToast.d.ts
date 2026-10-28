import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
/** The workspace's notice for the panels the person closed in the undo window, with its Undo. @internal */
export declare function UndoCloseToast({ closed, onUndo }: {
    closed: readonly PanelSummary[] | null;
    onUndo: () => void;
}): React.ReactElement;
