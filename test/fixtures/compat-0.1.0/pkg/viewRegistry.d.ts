/** Maps a panel's open-string `view` to the component that renders it. Why the fallback: DESIGN.md, "The panel-view registry". */
import * as React from 'react';
import type { JsonValue, PanelSummary } from './hostApi.js';
/** A View's own props: what it reads about the panel it renders inside. @public */
export type ViewProps<P = JsonValue> = {
    panel: PanelSummary<P>;
};
/** What any View -- built-in or third-party -- is rendered as. @public */
export type ViewComponent<P = JsonValue> = React.ComponentType<ViewProps<P>>;
/** @public @deprecated use ViewComponent */
export type PanelComponent<P = JsonValue> = ViewComponent<P>;
/**
 * Registers (or replaces) `key`'s component; this module registers nothing itself. Declare `P` with a `type`,
 * never an `interface`: an interface has no implicit index signature, so it never satisfies `JsonValue`.
 * @public
 */
export declare function registerView<P extends JsonValue>(key: string, Component: ViewComponent<P>): void;
/** @public @deprecated use registerView */
export declare const registerPanelView: typeof registerView;
/** Never throws, never returns nothing: an unregistered key is a typo or a plugin missing THIS session, not a corrupt layout. @public */
export declare function resolveView(key: string): ViewComponent;
/** @public @deprecated use resolveView */
export declare const resolvePanelView: typeof resolveView;
