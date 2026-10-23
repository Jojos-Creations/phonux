import { StrictMode } from 'react';
import { createWorkspace, definePanel, usePanelResizing } from '../../index';

// The view keeps its own resize setter on the window, so the spec can hold the resize mark the way a grabber does.
function Plain() {
  return <p>plain</p>;
}
function Grow() {
  const [, setResizing] = usePanelResizing();
  (window as unknown as { setGrowResizing: (on: boolean) => void }).setGrowResizing = setResizing;
  return <p>grow</p>;
}

const plain = definePanel({ id: 'plain', view: Plain, settings: { title: 'Plain', multiple: true } });
const grow = definePanel({ id: 'grow', view: Grow, settings: { title: 'Grow' } });

// StrictMode is the point of this check: its double effects must not drop the replayed scroll.
const workspace = createWorkspace({
  templates: [plain, grow],
  tuning: { maxLivePanels: null },
  wrap: ({ children }) => <StrictMode>{children}</StrictMode>,
});
for (const id of ['a', 'b', 'c']) workspace.addPanel('plain', { id });
const tall = workspace.addPanel('grow', { id: 'tall' });
for (const id of ['d', 'e', 'f']) workspace.addPanel('plain', { id });
(window as unknown as { tall: typeof tall }).tall = tall;
