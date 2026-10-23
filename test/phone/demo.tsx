import { createWorkspace, definePanel } from '../../index';

// The smallest real workspace: one panel, auto-mounted, the way the README quickstart draws it.
function Notes() {
  return <p>Hello from a phone-shaped panel.</p>;
}

const notes = definePanel({ id: 'notes', view: Notes, settings: { title: 'Notes' } });

const workspace = createWorkspace({ templates: [notes] });
workspace.addPanel('notes');
