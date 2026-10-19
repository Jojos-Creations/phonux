// The default mount with a footered template, to measure the footer against the frame and the row in a real browser.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const view = ({ handle }: any) => <div data-box={handle.id} style={{ width: '100%', height: '100%', background: '#335', color: '#fff' }}>{handle.id}</div>;
const footer = () => <button type="button" data-footer-button="" style={{ width: 24, height: 24 }}>f</button>;
const ws = createWorkspace({
  mount: false,
  topInset: 48,
  tuning: { phoneFit: 'fit' },
  root: definePanel({ id: 'root', view }),
  templates: [definePanel({ id: 'a', view, footer })],
});
ws.addPanel('a');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
