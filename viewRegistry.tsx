/** Maps a panel's open-string `view` to the component that renders it. Why the fallback: DESIGN.md, "The panel-view registry". */
import * as React from 'react';
import type { JsonValue, PanelSummary } from './hostApi.js';

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

/** Never throws, never returns nothing: an unregistered key is a typo or a plugin missing THIS session, not a corrupt layout. @public */
export function resolveView(key: string): ViewComponent {
  return registry.get(key) ?? placeholderFor(key);
}
