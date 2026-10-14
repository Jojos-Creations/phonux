// The page exposes the workspace as window.__ws; every panel is a bare view in the default frame.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const bare = (id: string) => definePanel({ id, settings: { title: id }, view: () => <div data-body={id} style={{ padding: 8 }}>{id}</div> });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: ['one', 'two', 'three', 'four'].map(bare),
});
(window as any).__ws = ws;
for (const id of ['one', 'two', 'three', 'four']) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
