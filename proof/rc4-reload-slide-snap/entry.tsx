// Three panels mounted at once, as a reload restores them. The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const plain = (id: string) => definePanel({ id, settings: { title: id }, view: () => <div data-body={id} style={{ height: '100%' }}>{id}</div> });
const ids = ['one', 'two', 'three', 'late'];
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: ids.map(plain),
});
(window as any).__ws = ws;
for (const id of ids.slice(0, 3)) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
