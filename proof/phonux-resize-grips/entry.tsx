// The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const bare = definePanel({ id: 'bare', settings: { title: 'Bare', maxSlots: 4 }, view: () => <div data-body="bare">bare</div> });
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
