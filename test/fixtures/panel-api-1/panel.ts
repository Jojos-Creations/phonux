/**
 * A panel written against panel API level 1: a view, a footer, template settings with a header button, and the slot hooks
 * and `useViewState` a view calls. It never changes to follow the library; a change that breaks it breaks level 1.
 */
import * as React from 'react';
import { definePanel, usePanelPinned, usePanelTuning, useViewState } from '../../../index.js';
import type { PanelTemplate } from '../../../index.js';
import type { LevelOneProps } from './types.js';

function View({ panel, handle, manager }: LevelOneProps): React.ReactElement {
  const pinned = usePanelPinned();
  const tuning = usePanelTuning();
  const [count, setCount] = useViewState('count', 0);
  return React.createElement(
    'i',
    {
      'data-fixture-view': panel.id,
      'data-fixture-handle': `${handle.id}:${handle.templateId}:${handle.getState().status}`,
      'data-fixture-manager': manager.list().map((p) => p.id).join(',') + '|' + manager.getSnapshot().panels.length,
      'data-fixture-pinned': String(pinned),
      'data-fixture-gap': String(typeof tuning.rowGap),
      'data-fixture-count': String(count),
      onClick: () => setCount((c) => c + 1),
    },
    panel.title ?? panel.id,
  );
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
