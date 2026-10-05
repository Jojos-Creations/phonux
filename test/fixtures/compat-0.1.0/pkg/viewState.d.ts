/**
 * useViewState: per-view state that survives the view's own panel being parked (unmounted) and revived.
 * Why it is shaped this way: DESIGN.md, "`useViewState`: per-view state that outlives a park, not a restart".
 */
import * as React from 'react';
import type { JsonValue } from './hostApi.js';
/** Thrown by useViewState() unless it renders under BOTH wrappers a host's panel row supplies. @public */
export declare class ViewStateMissingProviderError extends Error {
    constructor(missing: 'host' | 'view id');
}
/** Mounted once by HostProvider, beside OverlayProvider. Not on the barrel: app code never needs its own store. @internal */
export declare function ViewStateProvider({ children }: {
    children: React.ReactNode;
}): React.ReactElement;
/**
 * useViewState's type, spelled out so the public declaration names none of this file's private helpers.
 * Callers see these call signatures, not useViewStateImpl's, so the JSON bound that counts is the one here.
 * @public
 */
export interface UseViewState {
    <T>(key: [T] extends [JsonValue] ? string : never, initial: T): [T, (next: T | ((prev: T) => T)) => void];
    <T extends JsonValue>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void];
    Provider: React.Provider<string | null>;
    useRetainOnly: (panelIds: Iterable<string>) => void;
}
/**
 * The one hook a view uses for state that must survive its own panel parking and reviving: same
 * `[value, setValue]` pair and same type inference as `React.useState`, but `initial` must be JSON-shaped.
 * `Provider` and `useRetainOnly` are the host's side (PanelRow.tsx), never called by a view.
 * @public
 */
export declare const useViewState: UseViewState;
