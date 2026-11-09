/**
 * Callers written the way phonux 0.1.0 let an app write them. Nothing here runs: `npm run typecheck` compiles it, and a
 * release that stops one of these shapes compiling breaks every app still written for 0.1.0. A change that has to
 * break one must say so in the changelog and edit this file in the same commit.
 */
import * as React from 'react';
import { HostProvider, Workspace, createWorkspace, useProvidePanels, type PanelSummary, type PanelWindow, type PanelsAPI, type PanelsInput, type ProvidedPanels, type WorkspaceState, type WorkspaceStorage } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import type { Host } from '../fakeHost.js';

/** A literal naming only the fields 0.1.0 required: every later field has to stay optional. */
export const rootEntry: PanelWindow = { id: 'root', url: '', live: true, view: 'history', collapsible: false, listed: false };
export const webEntry: PanelWindow = { id: '1', url: 'https://example.com', live: true, view: 'web', collapsible: true, listed: true };

/** A host-written store: load resolves a saved state or null, save takes one. */
export const storage: WorkspaceStorage = {
  load: async (): Promise<WorkspaceState | null> => null,
  save: (state: WorkspaceState): void => void state,
};

/** An app's own implementation of the views' panel API, every member 0.1.0 declared and no other. */
export const panelsApi: PanelsAPI = {
  panelList: [] as readonly PanelSummary[],
  create: (options?: { view?: string }): void => void options,
  activate: (id: string): void => void id,
  move: (id: string, direction: 'left' | 'right'): void => void [id, direction],
  reanchor: (id: string, anchor: { panel?: string; position: 'left' | 'right'; priority?: number }): void => void [id, anchor],
  close: (id: string): void => void id,
  recentlyClosed: null,
  undoClose: (): void => undefined,
  clearAll: (): void => undefined,
};

/** `setFormFactor` was removed on purpose, with the tiers: a host literal naming it must not compile. */
// @ts-expect-error setFormFactor is gone
export const retiredSetFormFactor: PanelsAPI = { ...panelsApi, setFormFactor: (id: string, next: 'phone' | 'tablet' | 'desktop'): void => void [id, next] };

export const host: Host = createFakeHost();

/** The workspace an app hands useProvidePanels: it holds the storage the row is kept in. */
export const workspace = createWorkspace({ mount: false, storage });

/** The input an app hands useProvidePanels. */
export const panelsInput = (overflowContainerRef: React.RefObject<HTMLDivElement | null>): PanelsInput => ({
  workspace,
  phoneWidth: 390,
  containerWidth: 0,
  overflowContainerRef,
  onPanelsClosed: (entry: { id: string; title: string; url: string; closedAt: string }): void => void entry,
});

/** The settings member a 0.1.0 host wrote (the settings column and its panel caps) was removed on purpose: a host literal naming it must not compile. */
// @ts-expect-error settings is gone
export const retiredSettings: Host = { ...createFakeHost(), settings: { settingsColumn: { visible: false, show: (): void => undefined, hide: (): void => undefined } } };

/** The stored cap a 0.1.0 app passed to useProvidePanels was removed on purpose: an input naming it must not compile. */
export const retiredStoredCap = (overflowContainerRef: React.RefObject<HTMLDivElement | null>): PanelsInput => ({
  workspace,
  // @ts-expect-error storedMaxPanels is gone
  storedMaxPanels: null,
  phoneWidth: 390,
  containerWidth: 0,
  overflowContainerRef,
});

export function CompatApp(): React.ReactElement {
  const overflowContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const provided: ProvidedPanels = useProvidePanels(panelsInput(overflowContainerRef));
  return React.createElement(HostProvider, {
    host,
    children: React.createElement(Workspace, {
      overflowContainerRef,
      rowRef,
      containerWidth: 0,
      rowResizeSettled: true,
      phoneWidth: 390,
      fixedColumnCount: provided.fixedViewCount,
      liveWidths: provided.liveWidths,
      children: null,
    }),
  });
}
