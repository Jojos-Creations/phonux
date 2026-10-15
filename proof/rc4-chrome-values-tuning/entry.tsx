// One default panel in a real browser. ?mode=header draws a header pill and the default footer; ?mode=grab draws a
// self-framed Panel with its grab bar. The chrome numbers are the defaults, so both bundles should measure the same.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createWorkspace, definePanel, Panel, PanelHeaderRow } from 'LIB/index.js';
import { AutoRoot } from 'LIB/autoMount.js';

const mode = new URLSearchParams(location.search).get('mode') ?? 'header';
const view = () =>
  mode === 'grab' ? (
    <Panel title="Sessions" grabProps={{ 'data-grab': '' } as any} sx={{ height: 700, width: 390 }}>
      <p data-content="" style={{ margin: 0 }}>content</p>
    </Panel>
  ) : (
    <div style={{ position: 'relative', height: '100%' }}>
      <PanelHeaderRow title="Sessions" />
      <p data-content="" style={{ margin: 0 }}>content</p>
    </div>
  );
const ws = createWorkspace({
  mount: false,
  root: definePanel({ id: 'root', view, footer: () => <span data-foot="">footer</span> }),
  tuning: { rowGesture: 'step' },
});
ws.addPanel('root');
const el = document.createElement('div');
el.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(el);
createRoot(el).render(<React.StrictMode><AutoRoot workspace={ws} /></React.StrictMode>);
