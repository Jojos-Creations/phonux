import { createWorkspace, definePanel } from '../../index';

// Three fitted panels whose content is taller than any phone, so a frame cut by the screen would show.
function Lines({ name }: { name: string }) {
  return (
    <div>
      {Array.from({ length: 60 }, (_, i) => `${name} line ${i}`).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

const templates = ['One', 'Two', 'Three'].map((name) => definePanel({ id: name.toLowerCase(), view: () => <Lines name={name} />, settings: { title: name } }));

const workspace = createWorkspace({ templates, tuning: { phoneFit: 'fit' } });
for (const template of templates) workspace.addPanel(template.id);
