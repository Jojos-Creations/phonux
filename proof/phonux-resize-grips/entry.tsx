// The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, Panel, PanelFrame, PanelResizeGrips, PanelSizeBox } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

// The view draws its own Panel with the grips as its overlay: the default frame no longer draws them.
const bare = definePanel({
  id: 'bare',
  settings: { title: 'Bare', maxSlots: 4 },
  view: () => (
    <PanelSizeBox>
      <Panel title="Bare" overlay={<PanelResizeGrips />} sx={{ height: '100%' }}>
        <PanelFrame>
          <div data-body="bare">bare</div>
        </PanelFrame>
      </Panel>
    </PanelSizeBox>
  ),
});
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div /> }),
  templates: [bare],
  tuning: { rowGap: 24 },
});
(window as any).__ws = ws;
ws.addPanel('bare');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
