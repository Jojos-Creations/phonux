// A workspace over a saved file the page seeds before it starts (window.__seed, a JSON string): the page exposes it as window.__ws.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, registerView } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const KEY = 'slots-formfactor-removed';
const seed = new URLSearchParams(location.search).get('seed');
if (seed !== null) localStorage.setItem(KEY, seed);
const handles = new Map<string, any>();
const view = ({ handle }: any) => {
  handles.set(handle.id, handle);
  return <div data-box={handle.id} style={{ width: '100%', height: '100%', background: '#335', color: '#fff' }}>{handle.id}</div>;
};
registerView('web', ({ panel }: any) => <div data-box={panel.id} style={{ width: '100%', height: '100%', background: '#353', color: '#fff' }}>{panel.id}</div>);
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', view }),
  templates: [definePanel({ id: 'wide', view, settings: { multiple: true, maxSlots: 3 } }), definePanel({ id: 'tablet', view, settings: { multiple: true } })],
  tuning: { saveQuietMs: 20 },
  storage: { load: () => JSON.parse(localStorage.getItem(KEY) ?? 'null'), save: (s) => localStorage.setItem(KEY, JSON.stringify(s)) },
});
(window as any).__ws = ws;
(window as any).__handles = handles;
(window as any).__saved = () => localStorage.getItem(KEY);
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
