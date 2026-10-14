// Three panels of a multiple template in a workspace; the page exposes the workspace, the host's panels and what each view was given.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, useActivePanel, useHost, usePanelActive } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const view = ({ panel, handle }: any) => {
  const [active, setActive] = useActivePanel();
  const isActive = usePanelActive();
  (window as any).__panels = useHost().panels;
  (window as any).__setActive = setActive;
  return (
    <div data-panel-id={panel.id} data-handle-id={handle.id} data-active={String(active)} data-is-active={String(isActive)} style={{ width: '100%', height: '100%', background: '#335', color: '#fff' }}>
      {panel.id}
    </div>
  );
};
const ws = createWorkspace({ mount: false, root: definePanel({ id: 'root', view }), templates: [definePanel({ id: 'web', view, settings: { multiple: true } })] });
(window as any).__ws = ws;
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
