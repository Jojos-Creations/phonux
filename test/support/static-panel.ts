/**
 * A Panel rendered to static markup inside a slot that declares header buttons. Imports no jsdom: a static-markup test
 * must run where no `document` exists, so emotion inlines its styles the way the goldens hold them.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, Panel, createWorkspace, definePanel } from '../../index.js';
import type { HeaderButton, PanelHandle, PanelProps } from '../../index.js';
import { createFakeHost } from '../../fakeHost.js';
import { LIBRARY_TUNING_DEFAULTS, resolvePanelSettings } from '../../panelSettings.js';
import { PanelSlotContext, type PanelSlotValue } from '../../panelSlotContext.js';
import { slotTuning } from '../../panelTuning.js';

let handleForStatic: PanelHandle | undefined;
/** A handle of a workspace that is never mounted: enough for a static render that only reads its state. */
export function staticHandle(): PanelHandle {
  handleForStatic ??= createWorkspace({ mount: false, templates: [definePanel({ id: 'a', view: () => null })] }).addPanel('a');
  return handleForStatic;
}

/** The static markup of a Panel inside a slot declaring `slots` (none: a slot with no header buttons), a newline between tags. */
export function staticPanel(o: { slots?: Record<string, HeaderButton>; props?: Omit<PanelProps, 'children'>; handle?: PanelHandle } = {}): string {
  const handle = o.handle ?? staticHandle();
  const value: PanelSlotValue = {
    ...resolvePanelSettings().value,
    collapsible: true,
    neighborWidths: { left: [], right: [] },
    pinned: false,
    tuning: slotTuning(LIBRARY_TUNING_DEFAULTS, undefined),
    ...(o.slots === undefined ? {} : { headerButtonSlots: { slots: o.slots, handle, report: () => {}, note: () => {} } }),
  };
  const panel = createElement(Panel, { ...(o.props ?? {}), children: 'Body' });
  const tree = createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: createElement(PanelSlotContext.Provider, { value, children: panel }) }) });
  return `${renderToStaticMarkup(tree).replace(/></g, '>\n<')}\n`;
}
