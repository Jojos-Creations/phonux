// Two titled panels with a scrolling body, so a header and a scrollbar thumb are on screen. The page exposes the workspace as window.__ws.
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const tall = (id: string) =>
  definePanel({
    id,
    settings: { title: `Title ${id}` },
    view: () => (
      <Box data-body={id} sx={{ height: '100%', overflowY: 'scroll' }}>
        <div style={{ height: 3000 }}>{id}</div>
      </Box>
    ),
  });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => <div data-body="root" /> }),
  templates: [tall('alpha'), tall('beta')],
});
(window as any).__ws = ws;
ws.addPanel('alpha');
ws.addPanel('beta');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
