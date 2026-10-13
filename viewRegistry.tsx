/** Maps a panel's open-string `view` to the component that renders it. Why the fallback: DESIGN.md, "The panel-view registry". */
import * as React from 'react';
import { useOptionalHost, type JsonValue, type PanelSummary } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { PanelManagerError } from './panelManagerError.js';

/** A View's own props: what it reads about the panel it renders inside. @public */
export type ViewProps<P = JsonValue> = {
  /** The panel this view renders inside. */
  panel: PanelSummary<P>;
};

/** What any View -- built-in or third-party -- is rendered as. @public */
export type ViewComponent<P = JsonValue> = React.ComponentType<ViewProps<P>>;

const registry = new Map<string, ViewComponent>();
/** One placeholder instance per unregistered key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map<string, ViewComponent>();

/**
 * Registers (or replaces) `key`'s component; this module registers nothing itself. Declare `P` with a `type`,
 * never an `interface`: an interface has no implicit index signature, so it never satisfies `JsonValue`.
 * @public
 */
export function registerView<P extends JsonValue>(key: string, Component: ViewComponent<P>): void {
  registry.set(key, Component as unknown as ViewComponent);
}

/** Throws `template-collision` when a plain view is registered under `id`: the plain view would shadow the template. @internal */
export function assertTemplateIdFree(id: string): void {
  if (registry.has(id)) throw new PanelManagerError('template-collision', `template '${id}' collides with the view registered under the same key`);
}

/** The placeholder view for an unregistered `key`. @internal */
export function placeholderFor(key: string): ViewComponent {
  const cached = placeholders.get(key);
  if (cached) return cached;
  function UnregisteredPanelPlaceholder({ panel }: { panel: PanelSummary }): React.JSX.Element {
    const labels = resolveLabels(useOptionalHost()?.labels);
    return (
      <div data-unregistered-panel-view={key}>
        <span>{panel.title ?? labels.untitledPanel}</span>
        <span data-unregistered-panel-view-key="">{key}</span>
      </div>
    );
  }
  placeholders.set(key, UnregisteredPanelPlaceholder);
  return UnregisteredPanelPlaceholder;
}

/** The plain view registered under `key`, else the placeholder: a template is only known to the workspace that holds it, so see `resolveViewIn`. Never throws, never returns nothing. @public */
export function resolveView(key: string): ViewComponent {
  return registry.get(key) ?? placeholderFor(key);
}

/** The plain view registered under `key`, if any. @internal */
export function plainViewFor(key: string): ViewComponent | undefined {
  return registry.get(key);
}
