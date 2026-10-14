// The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, Panel, PanelFrame, PanelSizeBox } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const bare = definePanel({ id: 'bare', settings: { title: 'Bare', slots: 2 }, view: () => <div data-body="bare">bare</div> });
const own = definePanel({
  id: 'own',
  settings: { frame: 'none', slots: 2 },
  view: () => (
    <PanelSizeBox>
      <Panel title="Own" data-own-panel="">
        <PanelFrame>
          <div data-body="own">own</div>
        </PanelFrame>
      </Panel>
    </PanelSizeBox>
  ),
});
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div /> }),
  templates: [bare, own],
  tuning: { rowGap: 24 },
});
(window as any).__ws = ws;
ws.addPanel('bare');
ws.addPanel('own');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
