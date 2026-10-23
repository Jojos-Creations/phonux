import * as React from 'react';
import type { PanelWindow } from './panelWindow.js';
import type { RowNumbers } from './rowNumbers.js';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';

/** What a mounted workspace's row exposes to `wrap` through `useWorkspaceRow()`. @public */
export interface WorkspaceRow {
  /** The row's one set of numbers: the shell, the row and the capacity are priced from it. */
  readonly rowNumbers: RowNumbers;
  /** The panels in row order, as the row draws them. */
  readonly entries: readonly PanelWindow[];
  /** The most panels that fit the phone width, or null when the row is not fitted. */
  readonly maxFitPanels: number | null;
  /** The row's scroll container, or null before it mounts. */
  readonly scroller: React.RefObject<HTMLElement | null>;
  /** The workspace's resolved slide tuning, which a dot bar reads. */
  readonly tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
  /** The phone size the row is fitted to, in px. */
  readonly phoneSize: { readonly width: number; readonly height: number };
}

/** @internal */
export const WorkspaceRowContext = React.createContext<WorkspaceRow | null>(null);

/**
 * The mounted row's numbers, entries and fit, for a component `wrap` renders around the row. Only valid inside `wrap`.
 * @public
 */
export function useWorkspaceRow(): WorkspaceRow {
  const row = React.useContext(WorkspaceRowContext);
  if (row === null) throw new Error('phonux: useWorkspaceRow() is only valid inside a workspace wrap');
  return row;
}
