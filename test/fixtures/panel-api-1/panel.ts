/**
 * A panel written against panel API level 1: a view, a footer, template settings with a header button, and the slot hooks
 * and `useViewState` a view calls. Before 1.0.0 it is edited with level 1; from 1.0.0 it never changes to follow the library, and a change that breaks it needs a new level.
 */
import * as React from 'react';
import {
  DragToClose,
  PanelFooter,
  PanelFrame,
  PanelHeaderRow,
  PanelSizeBox,
  WindowOverlay,
  definePanel,
  useActivePanel,
  useHost,
  useWorkspace,
  useWorkspaceManager,
  usePanelPinned,
  usePanelState,
  usePanelStates,
  usePanelTuning,
  usePhoneSize,
  useViewState,
} from '../../../index.js';
import type { PanelTemplate } from '../../../index.js';
import type { LevelOneProps } from './types.js';

function View({ panel, handle, manager }: LevelOneProps): React.ReactElement {
  const pinned = usePanelPinned();
  const tuning = usePanelTuning();
  const [count, setCount] = useViewState('count', 0);
  // PanelsAPI block: one run of lines, so retiring the Host bag deletes it whole.
  const panelsApiAttrs = { 'data-fixture-host': String(useHost().panels.panelList.length) };
  // End PanelsAPI block.
  const manager2 = useWorkspaceManager();
  const workspace = useWorkspace();
  const states = usePanelStates();
  const own = usePanelState(handle.id);
  const [active] = useActivePanel();
  const phone = usePhoneSize();
  const h = React.createElement;
  const body = h(
    'i',
    {
      'data-fixture-view': panel.id,
      'data-fixture-handle': `${handle.id}:${handle.templateId}:${handle.getState().status}`,
      'data-fixture-manager': manager.list().map((p) => p.id).join(',') + '|' + manager.getSnapshot().panels.length,
      'data-fixture-pinned': String(pinned),
      'data-fixture-gap': String(typeof tuning.rowGap),
      'data-fixture-count': String(count),
      ...panelsApiAttrs,
      'data-fixture-wsmanager': String(manager2?.list().length),
      'data-fixture-workspace': String(workspace?.panels.get(handle.id)?.id === handle.id),
      'data-fixture-states': String(states.length),
      'data-fixture-own': String(own?.id === handle.id),
      'data-fixture-active': String(active === null || typeof active === 'string'),
      'data-fixture-phone': `${typeof phone.width}:${typeof phone.height}`,
      onClick: () => setCount((c) => c + 1),
      onDoubleClick: (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.dataset.fixtureMoved = String(handle.move(-3, 'person').ok);
      },
    },
    panel.title ?? panel.id,
  );
  return body;
}

/** A view that draws its own frame from the frame components, so the library adds none. */
function FramedView(): React.ReactElement {
  const phone = usePhoneSize();
  const h = React.createElement;
  const content = h(
    React.Fragment,
    null,
    h(PanelHeaderRow, { title: 'Framed', actions: null, leading: null }),
    h(DragToClose, { onClose: () => undefined, children: (grab) => h('u', { 'data-fixture-grab': typeof grab.onPointerDown }) }),
    h(PanelSizeBox, { width: phone.width, height: phone.height, children: h('i', { 'data-fixture-framed': 'yes' }) }),
    h(WindowOverlay, { slot: 'dialog', open: false, children: h('s', null) }),
    h(PanelFooter),
  );
  return h(PanelFrame, { footer: false, children: content });
}

function Footer({ panel, manager }: LevelOneProps): React.ReactElement {
  return React.createElement('b', { 'data-fixture-footer': panel.id }, String(manager.list().length));
}

/** The fixture template; its `api` is spelled out because level 1 is what it was written against. */
export const levelOnePanel: PanelTemplate = definePanel({
  id: 'fixture-level-1',
  api: 1,
  view: View,
  footer: Footer,
  settings: { headerButtons: { note: { label: 'Note', onClick: () => undefined } } },
});

/** The fixture template that draws its own frame; `api` spelled out like the first. */
export const levelOneFramedPanel: PanelTemplate = definePanel({
  id: 'fixture-level-1-framed',
  api: 1,
  view: FramedView,
  footer: Footer,
});
