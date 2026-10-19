/**
 * The footer a template declares: the context that carries it from the template's view adapter to the frame, and the
 * component that draws it.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import type { SxProps } from '@mui/material/styles';
import { type Theme } from '@mui/material/styles';
import { useFrameClaim } from './panelFrameClaim.js';
import { CHROME_ATTRIBUTE, CHROME_PARTS, PanelChromeVisibleContext, useChromeFade } from './panelChrome.js';
import { panelCornerRadiusPx } from './PanelFrame.js';
import { FOOTER_PAD_X_PX, FOOTER_PAD_Y_PX, HEADER_GAP_PX } from './rowConstants.js';

/** The footer element of the template view above, or null; provided by the view adapter, read by `PanelFooter`. @internal */
export const PanelFooterContext = React.createContext<React.ReactElement | null>(null);

/** Hides only the footer that throws while rendering, and tells the console once. */
class FooterBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(e: unknown): void {
    console.error(`PanelFooter: the footer threw while rendering and is hidden: ${e instanceof Error ? e.message : String(e)}`);
  }
  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Draws the footer the panel's template declares, floating below the frame as the header floats above it: outside the panel's own
 * space, so it takes no height, and it is bare like the header (no border, shadow or fill; the header's height). The parent must be `position: relative`, as for `PanelHeader`.
 * `PanelFrame` draws it by default; a view that does not use `PanelFrame` renders this itself. Outside a template's view, or
 * for a template that declares no footer, it draws nothing. A footer that throws while rendering is hidden and the
 * rest of the panel stays. `sx` is layered over the footer's box (its offset below the frame, its padding): to restyle the footer
 * `PanelFrame` would draw, give the frame `footer={false}` and render `PanelFooter` with the `sx`.
 * @public
 */
export function PanelFooter({ sx }: { sx?: SxProps<Theme> }): React.ReactElement | null {
  // A view that lays its footer out itself draws its own frame; the library frame would draw the footer a second time.
  useFrameClaim('frame');
  const footer = React.useContext(PanelFooterContext);
  const fade = useChromeFade(React.useContext(PanelChromeVisibleContext));
  if (footer === null) return null;
  return (
    <FooterBoundary>
      <Box data-panel-footer="" {...{ [CHROME_ATTRIBUTE]: CHROME_PARTS.footer }} ref={fade} sx={{ position: 'absolute', top: `calc(100% + ${HEADER_GAP_PX}px)`, left: 0, right: 0, boxSizing: 'border-box', height: (theme: Theme) => 2 * panelCornerRadiusPx(theme), display: 'flex', alignItems: 'center', px: `${FOOTER_PAD_X_PX}px`, py: `${FOOTER_PAD_Y_PX}px`, ...sx }}>
        {footer}
      </Box>
    </FooterBoundary>
  );
}
