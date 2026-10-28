import { createWorkspace, definePanel, toggleMaximize } from '../../index';

// The workspace tools/frame-gap-probe.mjs drives: six phone panels plus one that expands in and shrinks out between p3 and p4.
function Body({ id }: { id: string }) {
  return <div data-probe-body={id} style={{ height: '100%', background: '#888' }}>{id}</div>;
}

const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const templates = ids.map((id) => definePanel({ id, view: () => <Body id={id} />, settings: { title: id } }));
const mid = definePanel({ id: 'mid', view: () => <Body id="mid" />, settings: { title: 'mid', placeOnAdd: { after: 'p3' }, enterFrom: 'expand', exitTo: 'shrink' } });

const workspace = createWorkspace({ templates: [...templates, mid], tuning: { maxLivePanels: null } });
for (const id of ids) workspace.addPanel(id);

let midHandle: ReturnType<typeof workspace.addPanel> | undefined;
const probe = {
  setPhone: (width: number, height: number) => workspace.update({ device: { size: { modelId: 'probe', width, height } } }),
  addMid: () => {
    midHandle = workspace.addPanel('mid');
  },
  closeMid: () => midHandle?.close(),
  toggleMaximize: (id: string) => toggleMaximize(document.querySelector(`[data-probe-body="${id}"]`)),
};
(window as unknown as { probe: typeof probe }).probe = probe;
