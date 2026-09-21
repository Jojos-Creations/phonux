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
 * same way it is today. Splitting it this way means a view's own PhoneFrame
 * usage needed no changes at all to move under PhoneView.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { PhoneFrameHeaderRow, type PhoneFrameHeaderRowProps } from './PhoneFrame.js';
import { usePhoneAPIs } from './phoneViewApi.js';

// One import path for a view author: the contracts, the provider and the hook.
export { PhoneAPIsMissingProviderError, PhoneAPIsProvider, usePhoneAPIs } from './phoneViewApi.js';
export type { PhoneAPIs } from './phoneViewApi.js';
export { DRAG_CLOSE, DragToClose, shouldCloseOnRelease, type DragHandleProps } from './dragToClose.js';

export interface PhoneViewProps extends Omit<BoxProps, 'children' | 'sx' | 'title'> {
  /**
   * The header pill's title. Omitted entirely (not passed at all) renders
   * NO header row, rather than forcing the view into
   * PhoneFrameHeaderRow's own "Untitled" placeholder. Pass an
   * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
   */
  title?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Extra PhoneFrameHeaderRow props beyond title/actions -- the drag handle
   * of a DragToClose view (`onPointerDown`, `sx`), `data-*` attributes, etc. The `data-${string}` index signature is
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

export function PhoneView({ title, actions, headerProps, overlay, sx, children, ...rest }: PhoneViewProps) {
  const { device } = usePhoneAPIs();
  return (
    <Box sx={{ position: 'relative', width: device.size.width, ...sx }} {...rest}>
      {title !== undefined && <PhoneFrameHeaderRow title={title} actions={actions} {...headerProps} />}
      {children}
      {overlay}
    </Box>
  );
}

export default PhoneView;
