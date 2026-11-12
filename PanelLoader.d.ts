/**
 * What a panel shows while its content loads. A placeholder is up from the first frame, so a panel is never an empty space.
 * The host gets a short window to say what the placeholder shows, and the generic one stands in otherwise. The content comes
 * in when `load` resolves. A failed or timed-out load ends in a view with a way to try again, so a load always ends somewhere.
 */
import * as React from 'react';
/** How long the host has to say what the placeholder shows, in ms. @public */
export declare const PANEL_PLACEHOLDER_WINDOW_MS = 200;
/** How long a load may take before the panel offers to try again, in ms. @public */
export declare const PANEL_LOAD_TIMEOUT_MS = 15000;
/** Why a load ended without content. @public */
export type PanelLoadFailure = 'error' | 'timeout';
/** The props of `PanelLoader`. @public */
export interface PanelLoaderProps {
    /** Resolves when the content is ready to show. */
    readonly load: () => Promise<unknown>;
    /** The content, mounted once `load` resolves. */
    readonly children: React.ReactNode;
    /** What the placeholder shows. A promise must resolve inside `windowMs`; a later answer is dropped, so the placeholder never swaps late. */
    readonly placeholder?: () => React.ReactNode | Promise<React.ReactNode>;
    /** The view for a failed load. When omitted, a line of text and a Try again button. */
    readonly failed?: (retry: () => void, why: PanelLoadFailure) => React.ReactNode;
    /** The host's window, in ms. Default `PANEL_PLACEHOLDER_WINDOW_MS`. */
    readonly windowMs?: number;
    /** The load's time limit, in ms. Default `PANEL_LOAD_TIMEOUT_MS`. */
    readonly timeoutMs?: number;
}
/** Shows `placeholder` until `load` resolves, then `children`. Mount it where the content goes; it fills its parent. @public */
export declare function PanelLoader({ load, children, placeholder, failed, windowMs, timeoutMs }: PanelLoaderProps): React.JSX.Element;
