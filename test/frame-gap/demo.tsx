import { createWorkspace, definePanel, showPanels, toggleMaximize } from '../../index';

// The workspace tools/frame-gap-probe.mjs drives: six phone panels plus one that expands in and shrinks out between p3 and p4, and
// one parked panel a set swap trades the last five for, so a tab change (many to one and back) is measured too.
function Body({ id }: { id: string }) {
  return <div data-probe-body={id} style={{ height: '100%', background: '#888' }}>{id}</div>;
}

const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const templates = ids.map((id) => definePanel({ id, view: () => <Body id={id} />, settings: { title: id } }));
const mid = definePanel({ id: 'mid', view: () => <Body id="mid" />, settings: { title: 'mid', placeOnAdd: { after: 'p3' }, enterFrom: 'expand', exitTo: 'shrink' } });

const tab = definePanel({ id: 'tab', view: () => <Body id="tab" />, settings: { title: 'tab', placeOnAdd: { after: 'p1' } } });

const workspace = createWorkspace({ templates: [...templates, mid, tab], tuning: { maxLivePanels: null } });
for (const id of ids) workspace.addPanel(id);
workspace.addPanel('tab', { settings: { startVisibility: 'parked' } });

let midHandle: ReturnType<typeof workspace.addPanel> | undefined;
const probe = {
  setPhone: (width: number, height: number) => workspace.update({ device: { size: { modelId: 'probe', width, height } } }),
  addMid: () => {
    midHandle = workspace.addPanel('mid');
  },
  closeMid: () => midHandle?.close(),
  toggleMaximize: (id: string) => toggleMaximize(document.querySelector(`[data-probe-body="${id}"]`)),
  /** A tab change: p1 stays, p2 to p6 leave and the parked tab panel arrives beside p1, in one update. */
  swapToTab: () => showPanels(workspace.panels, ['tab'], ids.slice(1)),
  swapBack: () => showPanels(workspace.panels, ids.slice(1), ['tab']),
};
(window as unknown as { probe: typeof probe }).probe = probe;
