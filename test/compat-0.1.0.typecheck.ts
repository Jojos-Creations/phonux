/**
 * Callers written the way phonux 0.1.0 let an app write them. Nothing here runs: `npm run typecheck` compiles it, and a
 * release that stops one of these shapes compiling breaks every app still written for 0.1.0. A change that has to
 * break one must say so in the changelog and edit this file in the same commit.
 */
import * as React from 'react';
import { HostProvider, Workspace, registerView, useProvidePanels, type PanelSummary, type PanelWindow, type PanelsAPI, type PanelsInput, type ProvidedPanels, type WorkspaceState, type WorkspaceStorage } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import type { Host, SettingsAPI } from '../fakeHost.js';

/** A literal naming only the fields 0.1.0 required: every later field has to stay optional. */
export const rootEntry: PanelWindow = { id: 'root', url: '', live: true, locked: true, view: 'history', collapsible: false, listed: false };
export const webEntry: PanelWindow = { id: '1', url: 'https://example.com', live: true, locked: false, view: 'web', collapsible: true, listed: true };

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
  setFormFactor: (id: string, next: 'phone' | 'tablet' | 'desktop'): void => void [id, next],
  reanchor: (id: string, anchor: { panel?: string; position: 'left' | 'right'; priority?: number }): void => void [id, anchor],
  close: (id: string): void => void id,
  recentlyClosed: null,
  undoClose: (): void => undefined,
  clearAll: (): void => undefined,
};

/** The settings member a 0.1.0 host built by hand: these five names and nothing else. */
const settings: SettingsAPI = {
  maxPanelsOnScreen: null,
  fitCount: 4,
  minPanelsOnScreen: 2,
  setMaxPanelsOnScreen: async (n: number | null): Promise<void> => void n,
  settingsColumn: { visible: false, show: (): void => undefined, hide: (): void => undefined },
};
export const host: Host = { ...createFakeHost(), settings };

/** The input a 0.1.0 app handed useProvidePanels, with the stored cap it still passed. */
export const panelsInput = (overflowContainerRef: React.RefObject<HTMLDivElement | null>): PanelsInput => ({
  initialEntries: [rootEntry],
  rootId: 'root',
  storedMaxPanels: null,
  phoneWidth: 390,
  containerWidth: 0,
  overflowContainerRef,
  storage,
  onPanelsClosed: (entry: { id: string; title: string; url: string; closedAt: string }): void => void entry,
});

registerView('compat-probe', ({ panel }) => React.createElement('span', null, panel.id));

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
