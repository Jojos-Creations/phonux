// One workspace in a 600 px tall cell: the phone (700 px) is taller than the cell, so a vertical wheel has room to move the row.
// Two panels; the first has inner content that scrolls on its own, for the panel-internal case.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const inner = () => (
  <div data-inner="" style={{ height: '100%', overflowY: 'auto', background: '#335', color: '#fff' }}>
    <div style={{ height: 2000 }}>scrolls inside the panel</div>
  </div>
);
const plain = () => <div data-plain="" style={{ height: '100%', background: '#243', color: '#fff' }}>plain</div>;
const root = definePanel({ id: 'root', settings: { title: 'History' }, view: plain });
const a = definePanel({ id: 'a', settings: { title: 'a', slots: 2, maxSlots: 64 }, view: inner });
const b = definePanel({ id: 'b', settings: { title: 'b', slots: 1, maxSlots: 64 }, view: plain });
const ws = createWorkspace({ mount: false, root, templates: [a, b] });
ws.addPanel('a');
ws.addPanel('b');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:600px';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
(window as any).ws = ws;
