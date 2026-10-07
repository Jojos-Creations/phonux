/** Maps a panel's open-string `view` to the component that renders it. Why the fallback: DESIGN.md, "The panel-view registry". */
import * as React from 'react';
import type { JsonValue, PanelSummary } from './hostApi.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelTemplate } from './panelTemplate.js';
import { PanelViewContextValue } from './panelViewContext.js';

/** A View's own props: what it reads about the panel it renders inside. @public */
export type ViewProps<P = JsonValue> = {
  /** The panel this view renders inside. */
  panel: PanelSummary<P>;
};

/** What any View -- built-in or third-party -- is rendered as. @public */
export type ViewComponent<P = JsonValue> = React.ComponentType<ViewProps<P>>;

const registry = new Map<string, ViewComponent>();
const templates = new Map<string, PanelTemplate>();
/** One placeholder instance per unregistered key: AnimatePresence tracks a rendered element's own identity, so a fresh component type on every resolve would remount it on every render instead of once. */
const placeholders = new Map<string, ViewComponent>();
/** One adapter per template object, for the same reason as the placeholders: a fresh component type on every resolve would remount the panel. */
const adapters = new WeakMap<PanelTemplate, ViewComponent>();

/**
 * Registers (or replaces) `key`'s component; this module registers nothing itself. Declare `P` with a `type`,
 * never an `interface`: an interface has no implicit index signature, so it never satisfies `JsonValue`.
 * @public
 */
export function registerView<P extends JsonValue>(key: string, Component: ViewComponent<P>): void {
  registry.set(key, Component as unknown as ViewComponent);
}

/**
 * Registers a template so a workspace can build panels of it. A template whose id is already a `registerView` key
 * throws `template-collision`; registering the same id again replaces it. Returns the function that removes it.
 * @internal
 */
export function registerTemplate(t: PanelTemplate): () => void {
  if (registry.has(t.id)) throw new PanelManagerError('template-collision', `template '${t.id}' collides with the view registered under the same key`);
  templates.set(t.id, t);
  return () => {
    if (templates.get(t.id) === t) templates.delete(t.id);
  };
}

/** The template registered under `id`, or undefined. @internal */
export const getTemplate = (id: string): PanelTemplate | undefined => templates.get(id);

/** Every registered template, in registration order. @internal */
export const listTemplates = (): readonly PanelTemplate[] => [...templates.values()];

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
    return <View panel={panel} handle={handle} manager={context.manager} />;
  }
  adapters.set(t, TemplatePanelView);
  return TemplatePanelView;
}

/** Never throws, never returns nothing: an unregistered key is a typo or a plugin missing THIS session, not a corrupt layout. @public */
export function resolveView(key: string): ViewComponent {
  const plain = registry.get(key);
  if (plain) return plain;
  const template = templates.get(key);
  return template ? templateViewFor(template) : placeholderFor(key);
}
