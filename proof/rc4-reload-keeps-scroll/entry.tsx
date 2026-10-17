// A workspace in a stepping row, [1,1,1,64,1] panels, with its file in localStorage. The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, type WorkspaceState, type WorkspaceStorage } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const KEY = 'phonux-proof-rest';
const storage: WorkspaceStorage = {
  load: async () => {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : (JSON.parse(raw) as WorkspaceState);
  },
  save: (state) => localStorage.setItem(KEY, JSON.stringify(state)),
};

const row: [string, number][] = [['p1', 1], ['p2', 1], ['p3', 1], ['desk', 64], ['p5', 1]];
const plain = (id: string, slots: number) =>
  definePanel({ id, settings: { title: id, overflow: 'scroll', slots }, view: () => <div data-body={id} style={{ height: '100%' }}>{id}</div> });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: row.map(([id, slots]) => plain(id, slots)),
  storage,
  tuning: { rowGesture: 'step' },
});
(window as any).__ws = ws;
for (const [id] of row) ws.addPanel(id);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
