// The default mount with tuning.phoneFit 'fit' in a real browser, under StrictMode. Query: fit=<fit|off>
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';
import { fitPhone } from 'LIB/phoneFit.js';

const q = new URLSearchParams(location.search);
const w = window as any;
w.__fitPhone = fitPhone;
const view = ({ handle }: any) => <div data-box={handle.id} style={{ width: '100%', height: '100%', background: handle.id === 'root' ? '#243' : '#335', color: '#fff' }}>{handle.id}</div>;
const names = ['a', 'b', 'c', 'd', 'e', 'f'];
const ws = createWorkspace({
  mount: false,
  topInset: 96,
  root: definePanel({ id: 'root', view }),
  templates: names.map((n) => definePanel({ id: n, view })),
  tuning: { rowGap: 24, rowGesture: 'step', phoneFit: (q.get('fit') ?? 'fit') as 'fit' | 'off' },
});
for (const n of names) ws.addPanel(n);
w.__ws = ws;
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
