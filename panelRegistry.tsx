/**
 * The view-keyed component registry: registerView(key, Component) lets the host (or a third party)
 * teach the row how to render an open-string `view` value; resolveView(key) never returns nothing, so
 * a typo'd or uninstalled key renders an honest placeholder instead of crashing or silently becoming a web
 * panel. See DESIGN.md for the fallback's full reasoning.
 */
import * as React from 'react';
import type { JsonValue, PanelSummary } from './phoneViewApi.js';

/** A View's own props: what it reads about the panel it renders inside. */
export type ViewProps<P = JsonValue> = { panel: PanelSummary<P> };

/** What any View -- built-in or third-party -- is rendered as. */
export type ViewComponent<P = JsonValue> = React.ComponentType<ViewProps<P>>;

/** @deprecated use ViewComponent */
export type PanelComponent<P = JsonValue> = ViewComponent<P>;

const registry = new Map<string, ViewComponent>();
/** One placeholder instance per unregistered key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map<string, ViewComponent>();

/**
 * Registers (or replaces) the component rendered for `key`. Desktop-only bootstrap call
 * (registerBuiltinViews.ts); this module registers nothing itself.
 *
 * Declare `P` with a `type`, never an `interface`: an `interface` has no implicit index signature, so it
 * never satisfies the `JsonValue` bound and registration fails to typecheck.
 */
export function registerView<P extends JsonValue>(key: string, Component: ViewComponent<P>): void {
  registry.set(key, Component as unknown as ViewComponent);
}

/** @deprecated use registerView */
export const registerPanelView = registerView;

function placeholderFor(key: string): ViewComponent {
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
export function resolveView(key: string): ViewComponent {
  return registry.get(key) ?? placeholderFor(key);
}

/** @deprecated use resolveView */
export const resolvePanelView = resolveView;
