// One default panel in a real browser. ?mode=plain puts a text node straight in the frame; ?mode=scroll puts a
// Box scroller with no look values of its own (the library now exports none) around a tall child.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const mode = new URLSearchParams(location.search).get('mode') ?? 'plain';
const view = () =>
  mode === 'scroll' ? (
    <Box data-scroller="" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <p data-content="" style={{ margin: 0, height: 2000 }}>content</p>
    </Box>
  ) : (
    <p data-content="" style={{ margin: 0 }}>content</p>
  );
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', view }),
  tuning: { rowGesture: 'step' },
});
ws.addPanel('root');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
