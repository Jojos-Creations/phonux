/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title pill above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { PANEL_HEADER_GAP_PX, PanelHeaderRow, type PanelHeaderRowProps } from './PanelFrame.js';
import { useHost, type PanelSize } from './hostApi.js';
import { PanelHiddenContext, PanelSlotContext } from './panelSlotContext.js';
import { HEADER_ROW_ATTRIBUTE, PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
import { CaptureRegistryContext, type ViewId } from './snapshots.js';

// One import path for a view author: the contracts, the provider and the hook.
export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
export type { Host } from './hostApi.js';
export { DRAG_CLOSE, DragToClose, type DragHandleProps, type ReorderHandle } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z, type OverlaySlotName, type WindowOverlayProps } from './windowOverlay.js';

/** The props of `Panel`: every `Box` prop except `children`, `sx` and `title`, plus the header, grab bar, overlay and capture options. @public */
export interface PanelProps extends Omit<BoxProps, 'children' | 'sx' | 'title'> {
  /**
   * The header pill's title. Omitted entirely (not passed at all) renders
   * NO header row, rather than forcing the view into
   * PanelHeaderRow's own "Untitled" placeholder. Pass an
   * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
   */
  title?: React.ReactNode;
  /** Content shown in the header row beside the title. Has no effect when `title` is omitted. */
  actions?: React.ReactNode;
  /**
   * Extra PanelHeaderRow props beyond title/actions -- the drag handle
   * of a DragToClose view (`onPointerDown`, `sx`), `data-*` attributes, etc. The `data-${string}` index signature is
   * needed because TS's "data-* is always valid" leniency only applies to
   * attributes written directly on a JSX element -- it does not extend to a
   * plain object literal like this one being checked against
   * PanelHeaderRowProps before it ever reaches JSX.
   */
  headerProps?: Omit<PanelHeaderRowProps, 'title' | 'actions'> & { [key: `data-${string}`]: string | boolean | undefined };
  /**
   * The grab handle for dragging this Panel (DragToClose's `onPointerDown`/`sx`), rendered as its OWN
   * element filling the gap between the header and the frame -- never spread onto `headerProps` -- so a
   * click on the title text or an action icon in the header is never mistaken for a drag start. Omitted
   * (the usual case for a locked view, e.g. History) renders no grab bar at all.
   */
  grabProps?: Omit<BoxProps, 'children'> & { [key: `data-${string}`]: string | boolean | undefined };
  /**
   * Content positioned absolutely over this view (History's own "+" Fab,
   * bottom-right) -- rendered as a plain sibling of `children` inside this
   * component's own `position: relative` box, which is already the
   * positioning context an `overlay` needs.
   */
  overlay?: React.ReactNode;
  /**
   * `false` keeps the header buttons the panel declares out of its header: a view that draws them itself with
   * `usePanelHeaderButtons` or `PanelHeaderButtons` still can. Default: they are drawn with the title.
   */
  headerButtons?: boolean;
  /** Extra styles for the panel's root box, merged over the width and positioning it sets itself. */
  sx?: BoxProps['sx'];
  /** The panel's content, rendered inside the root box below the header. */
  children: React.ReactNode;
  /**
   * Registers this Panel's own root element with the capture registry a `CaptureRegistryProvider` supplies, so the
   * host can later ask for a picture of it by id. Omitted: never registered. A panel parked with its view kept
   * mounted is unregistered while hidden and registered again when shown.
   */
  viewId?: ViewId;
  /** 'never' opts a Panel with a viewId out of registration entirely -- default 'auto'. */
  capture?: 'auto' | 'never';
  /** This panel's own size instead of the shared useHost().device.size. Omitted: the width comes from device.size, read live -- see DESIGN.md. */
  size?: PanelSize;
}

/**
 * The shell every column in the row renders through: a relatively positioned box the width of the panel, with an
 * optional header pill above it, an optional grab bar and an optional overlay.
 * @public
 */
export function Panel({ title, actions, headerProps, headerButtons = true, grabProps, overlay, sx, children, viewId, capture = 'auto', size, ...rest }: PanelProps) {
  const { device } = useHost();
  const registry = React.useContext(CaptureRegistryContext);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const hidden = React.useContext(PanelHiddenContext);
  const declared = React.useContext(PanelSlotContext)?.headerButtonSlots;
  const buttons = usePanelHeaderButtons();
  const drawn = headerButtons && declared !== undefined && title !== undefined && buttons.some((b) => !b.hidden);
  const untitled = headerButtons && declared !== undefined && title === undefined && buttons.some((b) => !b.hidden);
  const warned = React.useRef(false);
  React.useEffect(() => {
    if (!untitled || warned.current || typeof process === 'undefined' || process.env.NODE_ENV === 'production') return;
    warned.current = true;
    console.warn('Panel: header buttons are declared but the panel has no title, so no header row is drawn and they are not shown.');
  }, [untitled]);
  React.useEffect(() => {
    // No registry (a bare <HostProvider>, as in most tests) or opted out: registering is a no-op, never a throw.
    // A hidden root is display:none and has no box to photograph, so it leaves the registry until it is shown.
    if (!registry || !viewId || capture === 'never' || hidden || !rootRef.current) return undefined;
    return registry.register(viewId, rootRef.current, 'viewport');
  }, [registry, viewId, capture, hidden]);
  return (
    <Box sx={{ position: 'relative', width: size?.width ?? device.size.width, ...sx }} {...rest} ref={rootRef}>
      {title !== undefined && (
        <PanelHeaderRow
          title={title}
          actions={drawn ? (
            <>
              {actions}
              <PanelHeaderButtons side="end" />
            </>
          ) : actions}
          {...headerProps}
          {...(drawn ? { tabIndex: -1, [HEADER_ROW_ATTRIBUTE]: declared.handle.id } : {})}
          {...(drawn ? { leading: <PanelHeaderButtons side="start" /> } : {})}
        />
      )}
      {grabProps && (
        <Box
          data-panel-grab-bar=""
          {...grabProps}
          sx={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            height: `${PANEL_HEADER_GAP_PX}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...grabProps.sx,
          }}
        >
          {/* Decorative only -- the clickable area is the whole strip above, sized to WCAG 2.5.8's 24px
              minimum even though this drawn pill is thinner. */}
          <Box aria-hidden="true" sx={{ width: 32, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
        </Box>
      )}
      {children}
      {overlay}
    </Box>
  );
}

export default Panel;
