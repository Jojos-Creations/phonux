// A workspace kept in localStorage; the page exposes it as window.__ws. Reloading the page restarts the id counter, as a new launch does.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const view = ({ handle }: any) => <div data-box={handle.id} style={{ width: '100%', height: '100%', background: '#335', color: '#fff' }}>{handle.id}</div>;
const KEY = 'panel-key-reseed';
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', view }),
  templates: [definePanel({ id: 'web', view, settings: { multiple: true } })],
  tuning: { saveQuietMs: 20 },
  storage: { load: () => JSON.parse(localStorage.getItem(KEY) ?? 'null'), save: (s) => localStorage.setItem(KEY, JSON.stringify(s)) },
});
(window as any).__ws = ws;
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
