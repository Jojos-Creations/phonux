// Three workspaces in a column. `?mc=always|user` renders the column through the app's own MotionConfig instead of the
// library's auto-mount, so the proof can drive the Reduce Motion source the app would set.
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { createWorkspaceColumn, definePanel, WorkspaceColumn } from 'LIB/index.js';

const params = new URLSearchParams(location.search);
const mc = params.get('mc');
const view = (tag: string) => ({ handle }: any) => (
  <div data-box={handle.id} style={{ width: '100%', height: '100%', background: handle.id === 'root' ? '#243' : '#335', color: '#fff', padding: 12, boxSizing: 'border-box' }}>{tag}:{handle.id}</div>
);
const history = definePanel({ id: 'history', view: view('history') });
const note = definePanel({ id: 'note', view: view('note'), multiple: true } as any);
const column = createWorkspaceColumn({ root: history, templates: [note], topInset: 0, mount: mc === null ? undefined : false });
for (let i = 0; i < 3; i++) {
  const ws = column.addWorkspace();
  ws.addPanel('note', { id: `note-${i + 1}a` });
  ws.addPanel('note', { id: `note-${i + 1}b` });
}
(window as any).column = column;
if (mc !== null) {
  const el = <WorkspaceColumn column={column} />;
  createRoot(document.getElementById('root')!).render(mc === 'none' ? el : <MotionConfig reducedMotion={mc as 'always' | 'user'}>{el}</MotionConfig>);
}
