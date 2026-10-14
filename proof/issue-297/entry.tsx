// ?layout=left|right&mode=off|visible|hidden. The row is History plus a 5-slot "desktop image" and a second 5-slot image.
// layout=left: the image sits left of History (row-start). layout=left2: a second 5-slot panel sits between the image and History.
// layout=right: the image follows History (row-end, the default).
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const q = new URLSearchParams(location.search);
const layout = q.get('layout') ?? 'left';
const mode = (q.get('mode') ?? 'hidden') as 'off' | 'visible' | 'hidden';
const view = (name: string) => () => <div data-body={name} style={{ height: '100%', background: name === 'History' ? '#243' : name === 'image' ? '#733' : '#335', color: '#fff', font: '20px sans-serif' }}>{name}</div>;
const image = definePanel({ id: 'image', settings: { title: 'image', slots: 5, maxSlots: 5, ...(layout !== 'right' ? { placeOnAdd: 'row-start' as const } : {}) }, view: view('image') });
const mid = definePanel({ id: 'mid', settings: { title: 'mid', slots: 5, maxSlots: 5, placeOnAdd: 'row-start' as const }, view: view('mid') });
const next = definePanel({ id: 'next', settings: { title: 'next', slots: 5, maxSlots: 5 }, view: view('next') });
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', settings: { title: 'History' }, view: view('History') }),
  templates: [image, mid, next],
  tuning: { rowGap: 16, rowGesture: 'step', shrinkOutOfView: mode },
});
(window as any).__ws = ws;
if (layout === 'left2') ws.addPanel('mid');
ws.addPanel('image');
ws.addPanel('next');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<AutoRoot workspace={ws} />);
