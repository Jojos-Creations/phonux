/**
 * The footer a template declares: the context that carries it from the template's view adapter to the frame, and the
 * component that draws it.
 */
import * as React from 'react';
import Box from '@mui/material/Box';

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
 * Draws the footer the panel's template declares, below the content and inside the frame, in a box that does not shrink or scroll.
 * `PanelFrame` draws it by default; a view that does not use `PanelFrame` renders this itself. Outside a template's view, or
 * for a template that declares no footer, it draws nothing. A footer that throws while rendering is hidden and the
 * rest of the panel stays.
 * @public
 */
export function PanelFooter(): React.ReactElement | null {
  const footer = React.useContext(PanelFooterContext);
  if (footer === null) return null;
  return (
    <FooterBoundary>
      <Box data-panel-footer="" sx={{ flexShrink: 0, boxSizing: 'border-box', borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1 }}>
        {footer}
      </Box>
    </FooterBoundary>
  );
}
