// The default mount with a panel whose view draws the library's own header and frame. The window's colour scheme picks the theme.
import { createWorkspace, definePanel, PanelHeaderRow, PanelFrame } from 'LIB/index.js';

const view = () => (
  <>
    <PanelHeaderRow title="Panel title" />
    <PanelFrame data-frame>{Array.from({ length: 80 }, (_, i) => <p key={i}>line {i}</p>)}</PanelFrame>
  </>
);
const ws = createWorkspace({ root: definePanel({ id: 'root', view, settings: { frame: 'none' } }) });
(window as any).__ws = ws;
