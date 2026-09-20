/**
 * The shared shell every column in the row renders through -- Settings,
 * History, and each live panel (client/src/desktop/settings/SettingsView.tsx,
 * client/src/desktop/history/HistoryColumn.tsx, client/src/desktop/panels/
 * LivePanel.tsx) all build their own content, then hand it to PhoneView for
 * the part that was drifting between them: the `position: relative` +
 * `width: phoneWidth` wrapper box, and PhoneFrameHeaderRow's floating title
 * pill above it.
 *
 * This is deliberately a SHELL, not a content container -- it does not
 * render PhoneFrame itself (PhoneFrame.tsx's own header comment already
 * covers the shared "phone shape" -- rounded card, fixed size, scrollbar
 * treatment). A caller's `children` is expected to already be one or more
 * PhoneFrame elements (or whatever else that view needs at that width), the
 * same way it is today. Splitting it this way means AdventurePanel.tsx's own
 * PhoneFrame usage (onDragOver/onDrop, the drag-active overlay) needed no
 * changes at all to move under PhoneView.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { PhoneFrameHeaderRow, type PhoneFrameHeaderRowProps } from './PhoneFrame.js';

export interface PhoneViewProps extends Omit<BoxProps, 'children' | 'sx' | 'title'> {
  /** Same fixed width every PhoneFrame body already sizes to (usePhoneSize()) -- this wrapper and the header pill both use it. */
  phoneWidth: number;
  /**
   * The header pill's title. Omitted entirely (not passed at all) renders
   * NO header row, rather than forcing the view into
   * PhoneFrameHeaderRow's own "Untitled" placeholder. Pass an
   * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
   */
  title?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Extra PhoneFrameHeaderRow props beyond title/actions -- draggable/
   * onDragStart/onDragEnd for an extra panel's header, a custom `sx`,
   * `data-*` attributes, etc. The `data-${string}` index signature is
   * needed because TS's "data-* is always valid" leniency only applies to
   * attributes written directly on a JSX element -- it does not extend to a
   * plain object literal like this one being checked against
   * PhoneFrameHeaderRowProps before it ever reaches JSX.
   */
  headerProps?: Omit<PhoneFrameHeaderRowProps, 'title' | 'actions'> & { [key: `data-${string}`]: string | boolean | undefined };
  /**
   * Content positioned absolutely over this view (History's own "+" Fab,
   * bottom-right) -- rendered as a plain sibling of `children` inside this
   * component's own `position: relative` box, which is already the
   * positioning context an `overlay` needs.
   */
  overlay?: React.ReactNode;
  sx?: BoxProps['sx'];
  children: React.ReactNode;
}

export function PhoneView({ phoneWidth, title, actions, headerProps, overlay, sx, children, ...rest }: PhoneViewProps) {
  return (
    <Box sx={{ position: 'relative', width: phoneWidth, ...sx }} {...rest}>
      {title !== undefined && <PhoneFrameHeaderRow title={title} actions={actions} {...headerProps} />}
      {children}
      {overlay}
    </Box>
  );
}

/**
 * The one, coherent surface a PhoneView-based view uses to reach "the rest
 * of the app" -- GoalFrontPage.tsx's own session/panel/dead-end state and
 * the modals that live outside the row. This exists because
 * HistoryColumn.tsx used to take eight separate callback props
 * (openDeadEndHistory, setSettingsOpen, newSession, onToggleChecked,
 * onDropWindow, onConfirmClose, onActivate, plus the "+" Fab's own
 * onCreateView) -- one prop per action, growing without any shared shape,
 * exactly the "views implement PhoneView" abstraction was meant to prevent
 * happening again for the NEXT view that needs to spawn a window or
 * activate a panel. One object, one place to look, one place to extend.
 *
 * GoalFrontPage.tsx builds exactly one of these (its own handlers, already
 * defined for other reasons, just gathered here) and hands it to whichever
 * view needs it -- a view that needs none of this (SettingsView today) just
 * doesn't take the prop, rather than every view being forced to accept an
 * `api` object it never calls.
 */
export interface PhoneViewAPI {
  /** Create a new blank live panel/window -- the "+" Fab's own action. */
  createView: () => void;
  /** Make (or keep) the given panel live, in place, without reordering the row -- clicking any panel row, live or parked, in History. */
  activatePanel: (id: string) => void;
  /** Toggle one panel's own "staged for dead-end close" checkbox. */
  toggleDeadEndChecked: (id: string) => void;
  /** A panel's draggable header was dropped onto History -- `draggedId` is that panel's own id, off the native DragEvent's dataTransfer payload. */
  dropDeadEndWindow: (draggedId: string) => void;
  /** Confirm closing every currently-checked dead-end panel. */
  confirmDeadEndClose: () => void;
  /** Open the closed-pages history viewer (DeadEndHistoryViewer -- a DIFFERENT history than this row's own live/parked History column). */
  openDeadEndHistory: () => void;
  /** Open the legacy settings modal (SettingsPanel.tsx -- BYOK key, phone size, auto-collapse, its own "Maximum views" section). */
  openSettingsModal: () => void;
  /** Start a brand-new session. */
  newSession: () => void;
}

export default PhoneView;
