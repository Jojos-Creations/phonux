/**
 * The view-keyed component registry: registerPanelView(key, Component) lets the host (or a third party)
 * teach the row how to render an open-string `view` value; resolvePanelView(key) never returns nothing, so
 * a typo'd or uninstalled key renders an honest placeholder instead of crashing or silently becoming a web
 * panel. See DESIGN.md for the fallback's full reasoning.
 */
import * as React from 'react';
import type { JsonValue, PanelSummary } from './phoneViewApi.js';

/** What any panel view -- built-in or third-party -- is rendered as. */
export type PanelComponent<P = JsonValue> = React.ComponentType<{ panel: PanelSummary<P> }>;

const registry = new Map<string, PanelComponent>();
/** One placeholder instance per unregistered key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map<string, PanelComponent>();

/** Registers (or replaces) the component rendered for `key`. Desktop-only bootstrap call (registerBuiltinViews.ts); this module registers nothing itself. */
export function registerPanelView(key: string, Component: PanelComponent): void {
  registry.set(key, Component);
}

function placeholderFor(key: string): PanelComponent {
  const cached = placeholders.get(key);
  if (cached) return cached;
  function UnregisteredPanelPlaceholder({ panel }: { panel: PanelSummary }): React.JSX.Element {
    return (
      <div data-unregistered-panel-view={key}>
        <span>{panel.title ?? 'Untitled panel'}</span>
        <span data-unregistered-panel-view-key="">{key}</span>
      </div>
    );
  }
  placeholders.set(key, UnregisteredPanelPlaceholder);
  return UnregisteredPanelPlaceholder;
}

/**
 * Never throws, never returns nothing: an unregistered key is a typo or an uninstalled plugin THIS
 * session, not a corrupt layout -- see DESIGN.md.
 */
export function resolvePanelView(key: string): PanelComponent {
  return registry.get(key) ?? placeholderFor(key);
}
