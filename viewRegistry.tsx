/** The component a row draws for a panel whose `view` names no template. */
import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';

/** What a row renders a panel with: given the panel, nothing else. */
export type ViewComponent = React.ComponentType<{ panel: PanelSummary }>;

/** One placeholder instance per unknown key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map<string, ViewComponent>();

/** The placeholder view for a `key` no template answers to. @internal */
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
