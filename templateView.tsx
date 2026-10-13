/**
 * How a template's view is rendered inside a row: the adapter that gives it its handle, and the lookup a row runs for a
 * panel's `view` key. Kept apart from viewRegistry.tsx so that module, which workspaceCore imports, loads no component.
 */
import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
import { FrameBoundary } from './panelFrameBoundary.js';
import { PanelFooterContext } from './panelFooter.js';
import type { PanelTemplate } from './panelTemplate.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { placeholderFor, plainViewFor, type ViewComponent } from './viewRegistry.js';

/** One adapter per template object, for the same reason as the placeholders: a fresh component type on every resolve would remount the panel. */
const adapters = new WeakMap<PanelTemplate, ViewComponent>();

/**
 * The component that renders `t` inside a row: it reads the row's workspace from context and renders `t.view` with the
 * panel, its own read handle and the reader of every panel. Outside a row that has a workspace there is no handle to
 * give, so it renders the unregistered-view placeholder.
 * @internal
 */
export function templateViewFor(t: PanelTemplate): ViewComponent {
  const cached = adapters.get(t);
  if (cached) return cached;
  function TemplatePanelView({ panel }: { panel: PanelSummary }): React.JSX.Element {
    const context = React.useContext(PanelViewContextValue);
    const handle = context?.handleFor(panel.id);
    if (context === undefined || context.manager === undefined || handle === undefined) {
      const Fallback = placeholderFor(t.id);
      return <Fallback panel={panel} />;
    }
    const View = t.view as React.ComponentType<{ panel: PanelSummary; handle: typeof handle; manager: NonNullable<typeof context.manager> }>;
    const view = (
      <FrameBoundary template={t} panel={panel}>
        <View panel={panel} handle={handle} manager={context.manager} />
      </FrameBoundary>
    );
    const Footer = t.footer as React.ComponentType<{ panel: PanelSummary; handle: typeof handle; manager: NonNullable<typeof context.manager> }> | undefined;
    if (Footer === undefined) return view;
    return <PanelFooterContext.Provider value={<Footer panel={panel} handle={handle} manager={context.manager} />}>{view}</PanelFooterContext.Provider>;
  }
  adapters.set(t, TemplatePanelView);
  return TemplatePanelView;
}

/** `resolveView` for a row that has a workspace: a plain view wins, then the workspace's template for `key`, then the placeholder. @internal */
export function resolveViewIn(templateOf: (id: string) => PanelTemplate | undefined, key: string): ViewComponent {
  const plain = plainViewFor(key);
  if (plain) return plain;
  const template = templateOf(key);
  return template ? templateViewFor(template) : placeholderFor(key);
}
