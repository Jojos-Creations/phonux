// One default panel in a real browser: where the view's own content sits inside the frame.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const view = () => <p data-content="" style={{ margin: 0 }}>content</p>;
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
