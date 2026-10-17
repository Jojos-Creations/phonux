/**
 * How a template's view is rendered inside a row: the adapter that gives it its handle, and the lookup a row runs for a
 * panel's `view` key.
 */
import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
import { PanelLevelContext } from './panelLevelContext.js';
import { checkPanelApi, NEWEST_SHAPE, reportShapeOnce, SHIPPED_LEVELS, warnIfOldLevel, type LevelTable } from './panelApiLevel.js';
import { FrameBoundary } from './panelFrameBoundary.js';
import { PanelFooterContext } from './panelFooter.js';
import type { PanelTemplate } from './panelTemplate.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { placeholderFor, type ViewComponent } from './viewRegistry.js';

/** One adapter per template object, for the same reason as the placeholders: a fresh component type on every resolve would remount the panel. */
const adapters = new WeakMap<LevelTable, WeakMap<PanelTemplate, ViewComponent>>();

/**
 * The component that renders `t` inside a row: it reads the row's workspace from context and renders `t.view` with the
 * panel, its own read handle and the reader of every panel. Outside a row that has a workspace there is no handle to
 * give, so it renders the unregistered-view placeholder.
 * @internal
 */
export function templateViewFor(t: PanelTemplate, table: LevelTable = SHIPPED_LEVELS): ViewComponent {
  const forTable = adapters.get(table) ?? new WeakMap<PanelTemplate, ViewComponent>();
  adapters.set(table, forTable);
  const cached = forTable.get(t);
  if (cached) return cached;
  checkPanelApi(t.id, t.api, table);
  const level = t.api ?? table.newest;
  warnIfOldLevel(t.id, level, table);
  const entry = table.levels.get(level);
  const adapt = entry?.adapt;
  const shape = entry?.shape ?? NEWEST_SHAPE;
  function TemplatePanelView({ panel }: { panel: PanelSummary }): React.JSX.Element {
    const context = React.useContext(PanelViewContextValue);
    const handle = context?.handleFor(panel.id);
    if (context === undefined || context.manager === undefined || handle === undefined) {
      const Fallback = placeholderFor(t.id);
      return <Fallback panel={panel} />;
    }
    const props = { panel, handle, manager: context.manager };
    const viewProps = adapt === undefined ? props : adapt(props);
    reportShapeOnce(t.id, level, viewProps, shape);
    const View = t.view as React.ComponentType<object>;
    const view = (
      <FrameBoundary template={t} panel={panel}>
        <View {...viewProps} />
      </FrameBoundary>
    );
    const Footer = t.footer as React.ComponentType<object> | undefined;
    const body = Footer === undefined ? view : <PanelFooterContext.Provider value={<Footer {...viewProps} />}>{view}</PanelFooterContext.Provider>;
    return <PanelLevelContext.Provider value={level}>{body}</PanelLevelContext.Provider>;
  }
  forTable.set(t, TemplatePanelView);
  return TemplatePanelView;
}

/** The component a row draws for `key`: the workspace's template for it, else the placeholder. @internal */
export function resolveViewIn(templateOf: (id: string) => PanelTemplate | undefined, key: string): ViewComponent {
  const template = templateOf(key);
  return template ? templateViewFor(template) : placeholderFor(key);
}
