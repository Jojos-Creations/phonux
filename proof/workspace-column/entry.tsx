// Three workspaces in a column, each with a few panels; the page exposes the column as window.column.
import * as React from 'react';
import { createWorkspaceColumn, definePanel } from 'LIB/index.js';

const view = (tag: string) => ({ handle }: any) => (
  <div data-box={handle.id} style={{ width: '100%', height: '100%', background: handle.id === 'root' ? '#243' : '#335', color: '#fff', padding: 12, boxSizing: 'border-box' }}>{tag}:{handle.id}</div>
);
const history = definePanel({ id: 'history', view: view('history') });
const note = definePanel({ id: 'note', view: view('note'), multiple: true } as any);
const column = createWorkspaceColumn({ root: history, templates: [note] });
for (let i = 0; i < 3; i++) {
  const ws = column.addWorkspace();
  ws.addPanel('note', { id: `note-${i + 1}a` });
  ws.addPanel('note', { id: `note-${i + 1}b` });
}
(window as any).column = column;
