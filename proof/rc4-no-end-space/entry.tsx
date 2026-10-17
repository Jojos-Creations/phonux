// The row of the Safari report: History, two phones, a five-slot desktop panel and a phone, as a stepping row.
// The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const gap = 16;
const panel = (id: string, slots: number) =>
  definePanel({ id, view: () => <div data-body={id} style={{ height: '100%', background: '#335', color: '#fff' }}>{id}</div>, settings: { slots, maxSlots: 64 } as never });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', view: () => <div data-body="root" style={{ height: '100%', background: '#243' }}>History</div>, settings: { title: 'History' } }),
  templates: [panel('one', 1), panel('two', 1), panel('wide', 5), panel('last', 1)],
  tuning: { rowGesture: 'step', rowGap: gap } as never,
});
for (const id of ['one', 'two', 'wide', 'last']) ws.addPanel(id);
(window as unknown as { __ws: unknown }).__ws = ws;
const el = document.getElementById('root')!;
createRoot(el).render(<AutoRoot workspace={ws} />);
