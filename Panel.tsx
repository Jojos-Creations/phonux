/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title header above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { PanelHeaderRow, type PanelHeaderRowProps } from './PanelFrame.js';
import { useChromePixels } from './panelChrome.js';
import { type PanelSize } from './hostApi.js';
import { usePhoneSize } from './phoneFit.js';
import { useFrameClaim } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { HEADER_ROW_ATTRIBUTE, PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
import { CaptureRegistryContext, type ViewId } from './snapshots.js';
import { useInsideSizeBox } from './PanelRowSlot.js';
import { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, DRAGGING_ATTRIBUTE, PanelChromeVisibleContext, useChromeFade, useChromeVisibility, usePanelActive, usePanelDragging } from './panelChrome.js';

export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
export type { Host } from './hostApi.js';
export { DRAG_CLOSE, DragToClose, type DragHandleProps, type ReorderHandle } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z, type OverlaySlotName, type WindowOverlayProps } from './windowOverlay.js';

/** The props of `Panel`: every `Box` prop except `children`, `sx` and `title`, plus the header, grab handle, overlay and capture options. @public */
export interface PanelProps extends Omit<BoxProps, 'children' | 'sx' | 'title'> {
  /**
   * The header's title. Omitted entirely (not passed at all) renders
   * NO header row, rather than forcing the view into
   * PanelHeaderRow's own "Untitled" placeholder. Pass an
   * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
   */
  title?: React.ReactNode;
  /** Content shown in the header row beside the title. Has no effect when `title` is omitted. */
  actions?: React.ReactNode;
  /**
   * Extra PanelHeaderRow props beyond title/actions: the drag handle of a DragToClose view (`onPointerDown`, `sx`),
   * `data-*` attributes, etc.
   */
  // TypeScript lets `data-*` through only on JSX attributes, not on an object literal checked against these props.
  headerProps?: Omit<PanelHeaderRowProps, 'title' | 'actions'> & { [key: `data-${string}`]: string | boolean | undefined };
  /**
   * The grab handle for dragging this Panel (DragToClose's `onPointerDown`/`sx`), rendered as its OWN
   * element, a grip icon left of the title in the header row -- never spread onto `headerProps` -- so a
   * click on the title text or an action icon in the header is never mistaken for a drag start. Without a
   * `title` there is no header row, and the icon sits above the frame's top-left corner instead. Omitted
   * (the usual case for a locked view, e.g. History) renders no grab handle at all.
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
   * host can later ask for a picture of it by id. Omitted: never registered.
   */
  viewId?: ViewId;
  /** 'never' opts a Panel with a viewId out of registration entirely -- default 'auto'. */
  capture?: 'auto' | 'never';
  /** This panel's own size instead of the shared phone size (`usePhoneSize()`). Omitted: inside a row the width is the slot's drawn width, else the phone size's, read live -- see DESIGN.md. */
  size?: PanelSize;
}

/**
 * The shell every column in the row renders through: a relatively positioned box the width of the panel, with an
 * optional header above it, an optional grab handle and an optional overlay.
 * @public
 */
export function Panel({ title, actions, headerProps, headerButtons = true, grabProps, overlay, sx, children, viewId, capture = 'auto', size, ...rest }: PanelProps) {
  const phoneSize = usePhoneSize();
  useFrameClaim('panel');
  const registry = React.useContext(CaptureRegistryContext);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const slot = React.useContext(PanelSlotContext);
  // Below a size box the panel fills it on both axes, so it eases with the box and its frame's 100% has a height to resolve against.
  const boxed = useInsideSizeBox();
  const declared = slot?.headerButtonSlots;
  const buttons = usePanelHeaderButtons();
  const drawn = headerButtons && declared !== undefined && title !== undefined && buttons.some((b) => !b.hidden);
  const untitled = headerButtons && declared !== undefined && title === undefined && buttons.some((b) => !b.hidden);
  const active = usePanelActive();
  const dragging = usePanelDragging();
  const { visible, handlers } = useChromeVisibility();
  const fadeHeader = useChromeFade(visible);
  const fadeGrab = useChromeFade(visible);
  const chrome = useChromePixels();
  const warned = React.useRef(false);
  // One element, either way: inside the header it fades with the header, so only the header-less one fades itself.
  const grabHandleProps = {
    'data-panel-grab-bar': '',
    [CHROME_ATTRIBUTE]: CHROME_PARTS.grabBar,
    ...grabProps,
    sx: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      width: `${chrome.headerGapPx}px`,
      height: `${chrome.headerGapPx}px`,
      ...grabProps?.sx,
    },
  };
  const grabIcon = <DragIndicatorIcon aria-hidden="true" fontSize="small" />;
  const grabHandle = grabProps && title !== undefined ? <Box {...grabHandleProps}>{grabIcon}</Box> : undefined;
  React.useEffect(() => {
    if (!untitled || warned.current || typeof process === 'undefined' || process.env.NODE_ENV === 'production') return;
    warned.current = true;
    console.warn('Panel: header buttons are declared but the panel has no title, so no header row is drawn and they are not shown.');
  }, [untitled]);
  React.useEffect(() => {
    // No registry (a bare <HostProvider>, as in most tests) or opted out: registering is a no-op, never a throw.
    if (!registry || !viewId || capture === 'never' || !rootRef.current) return undefined;
    return registry.register(viewId, rootRef.current, 'viewport');
  }, [registry, viewId, capture]);
  return (
    <PanelChromeVisibleContext.Provider value={visible}>
    <Box
      sx={{ position: 'relative', width: boxed ? '100%' : (size?.width ?? slot?.drawn?.width ?? phoneSize.width), height: boxed ? '100%' : undefined, ...sx }}
      {...rest}
      {...(active ? { [ACTIVE_ATTRIBUTE]: '' } : {})}
      {...(dragging ? { [DRAGGING_ATTRIBUTE]: '' } : {})}
      onPointerEnter={(e: React.PointerEvent<HTMLDivElement>) => {
        handlers.onPointerEnter(e);
        rest.onPointerEnter?.(e);
      }}
      onPointerLeave={(e: React.PointerEvent<HTMLDivElement>) => {
        handlers.onPointerLeave(e);
        rest.onPointerLeave?.(e);
      }}
      onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
        handlers.onFocus(e);
        rest.onFocus?.(e);
      }}
      onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
        handlers.onBlur(e);
        rest.onBlur?.(e);
      }}
      ref={rootRef}
    >
      {title !== undefined && (
        <PanelHeaderRow
          ref={fadeHeader}
          {...{ [CHROME_ATTRIBUTE]: CHROME_PARTS.header }}
          title={title}
          actions={drawn ? (
            <>
              {actions}
              <PanelHeaderButtons side="end" />
            </>
          ) : actions}
          {...headerProps}
          // space-between would float the title to the middle; beside the handle it needs the auto margin, and only there.
          {...(grabHandle ? { sx: { '& > [data-panel-grab-bar] + *': { mr: 'auto' }, ...headerProps?.sx } } : {})}
          {...(drawn ? { tabIndex: -1, role: 'toolbar', 'aria-orientation': 'horizontal' as const, ...(typeof title === 'string' ? { 'aria-label': title } : {}), [HEADER_ROW_ATTRIBUTE]: declared.handle.id } : {})}
          leading={grabHandle || drawn ? (
            <>
              {grabHandle}
              {drawn ? <PanelHeaderButtons side="start" /> : headerProps?.leading}
            </>
          ) : headerProps?.leading}
        />
      )}
      {grabProps && title === undefined && (
        <Box {...grabHandleProps} ref={fadeGrab} sx={{ ...grabHandleProps.sx, position: 'absolute', bottom: '100%', left: 0 }}>
          {grabIcon}
        </Box>
      )}
      {children}
      {overlay}
    </Box>
    </PanelChromeVisibleContext.Provider>
  );
}

export default Panel;
