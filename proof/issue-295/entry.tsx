// Five panels, each hosting an iframe that counts its loads: an iframe whose DOM node is moved reloads. The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const loads: Record<string, number> = {};
(window as any).__loads = loads;
(window as any).__onload = (id: string) => (loads[id] = (loads[id] ?? 0) + 1);
const hosted = (id: string) =>
  definePanel({
    id,
    settings: { title: id },
    view: () => <iframe data-frame={id} title={id} srcDoc={`<body onload="parent.__onload('${id}')">${id}</body>`} style={{ width: '100%', height: '100%', border: 0 }} />,
  });
const ids = ['one', 'two', 'three', 'four', 'five'];
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: ids.map(hosted),
});
(window as any).__ws = ws;
for (const id of ids) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
