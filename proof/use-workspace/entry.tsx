// A History-like view acts on other panels through useWorkspace(); the page exposes the workspace and a press-driven control.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, useWorkspace } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const history = definePanel({
  id: 'root',
  view: () => {
    const ws = useWorkspace();
    (window as any).__viewWorkspace = ws;
    return (
      <div style={{ width: '100%', height: '100%', background: '#223', color: '#fff' }}>
        <button type="button" data-close onClick={() => ws?.panels.get('web~2')?.close()}>close web~2</button>
        <button type="button" data-add onClick={() => ws?.panels.addPanel('web', { id: 'nine' })}>add nine</button>
        <button type="button" data-hide onClick={() => ws?.panels.get('web~3')?.hide()}>hide web~3</button>
        <button type="button" data-show onClick={() => ws?.panels.get('web~3')?.show()}>show web~3</button>
      </div>
    );
  },
});
const web = definePanel({ id: 'web', view: ({ handle }: any) => <div data-box={handle.id} style={{ width: '100%', height: '100%', background: '#335', color: '#fff' }}>{handle.id}</div>, settings: { multiple: true } });
const ws = createWorkspace({ mount: false, root: history, templates: [web] });
(window as any).__ws = ws;
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
