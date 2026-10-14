// The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const note = (id: string, title: string) => definePanel({ id, settings: { title }, view: () => <div data-body={id}>{title}</div> });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div /> }),
  templates: [note('notes', 'Notes'), note('todo', 'Todo'), note('mail', 'Mail')],
});
(window as any).__ws = ws;
ws.addPanel('notes');
ws.addPanel('todo');
ws.addPanel('mail');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
