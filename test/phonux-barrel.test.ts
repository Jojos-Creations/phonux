/**
 * The runtime surface of the phonux barrel (index.ts): types are erased, so Object.keys() sees
 * only value exports. The list is spelled out, never derived, so a name added, removed or renamed turns it red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as phonux from '../index.js';
import { HostProvider, useHost } from '../hostApi.js';
import { CaptureRegistryProvider } from '../snapshots.js';

const VALUE_EXPORTS = [
  'DEFAULT_PHONE_SIZE',
  'DRAG_CLOSE',
  'DragToClose',
  'WindowOverlay',
  'OverlaySlot',
  'OVERLAY_Z',
  'PHONE_MODELS',
  'findPhoneModel',
  'PhoneDetectPrompt',
  'HostMissingProviderError',
  'HostProvider',
  'useHost',
  'Panel',
  'PanelFrame',
  'PANEL_CORNER_RADIUS_UNITS',
  'panelCornerRadiusPx',
  'panelFrameScrollSx',
  'panelFrameBareSx',
  'PanelHeader',
  'PanelHeaderButtons',
  'PanelFooter',
  'PanelHeaderRow',
  'registerView',
  'resolveView',
  'useViewSnapshot',
  'CaptureRegistryProvider',
  'noopCaptureTrigger',
  'useViewState',
  'ViewStateMissingProviderError',
  'DEFAULT_PANEL_SIZE',
  'TIER_SIZES',
  'panelWidthOf',
  'computeRowLayout',
  'computeRowNumbers',
  'PanelRow',
  'PanelSizeBox',
  'GAP',
  'PANEL_TRANSITION',
  'usePanelReorderEligible',
  'usePanelReorderSteps',
  'usePanelTuning',
  'usePanelCapabilities',
  'usePanelCloseEligible',
  'usePanelHeaderButtons',
  'usePanelHidden',
  'usePanelNeighborWidths',
  'usePanelPinned',
  'Workspace',
  'useProvidePanels',
  'reorderStepsForOffset',
  'slideToTransition',
  'PANEL_SETTINGS_CATALOG',
  'LIBRARY_PANEL_DEFAULTS',
  'LIBRARY_TUNING_DEFAULTS',
  'resolvePanelSettings',
  'mergePatch',
  'definePanel',
  'PanelManagerError',
  'createWorkspace',
  'usePanelStates',
  'usePanelState',
  'useWorkspaceManager',
  // Opt-in extras (never applied implicitly).
  'createDefaultTheme',
].sort();

test('the phonux barrel exports exactly the 62 runtime values, no more, no fewer', () => {
  assert.deepEqual(Object.keys(phonux).sort(), VALUE_EXPORTS);
});

// Red if index.ts re-exports a copy or wrapper instead of the defining file's own object: a context from one copy is invisible to the other's hooks.
// The exports map ('phonux', 'phonux/testing') is checked against the packed tarball by the smoke, not here.
test('module identity: the context-bearing exports of the barrel are the very objects their defining source files export', async () => {
  assert.ok(phonux.CaptureRegistryProvider === CaptureRegistryProvider, 'CaptureRegistryProvider: the barrel holds another object');
  assert.ok(phonux.HostProvider === HostProvider && phonux.useHost === useHost, 'HostProvider/useHost: the barrel holds other objects than hostApi');
  // Control: a genuinely separate instance of the same file is NOT ===, so the checks above can fail.
  const secondInstance = '../snapshots.js?second-instance';
  const second = (await import(secondInstance)) as { CaptureRegistryProvider: unknown };
  assert.ok(second.CaptureRegistryProvider !== undefined && second.CaptureRegistryProvider !== CaptureRegistryProvider, 'control: a second module instance must yield a distinct provider');
});

const scrollerNames = (names: readonly string[]): string[] => names.filter((name) => /scroller/i.test(name));

test('the barrel exports nothing named for the row scroller: it stays internal', () => {
  const names = Object.keys(phonux);
  assert.deepEqual(scrollerNames(names), []);
  assert.deepEqual(scrollerNames([...names, 'rowScrollerFor']), ['rowScrollerFor'], 'control: a scratch export with the name is found');
});

const engineControlNames = (names: readonly string[]): string[] => names.filter((name) => /controls/i.test(name));

test('the barrel exports nothing named for the engine controls: they reach the workspace only through its core', () => {
  const names = Object.keys(phonux);
  assert.deepEqual(engineControlNames(names), []);
  assert.deepEqual(engineControlNames([...names, 'getEngineControls']), ['getEngineControls'], 'control: a scratch export with the name is found');
});

test('the barrel exports no flush and no event stream: a workspace is read through snapshots and subscriptions', () => {
  const names = Object.keys(phonux);
  assert.deepEqual(names.filter((name) => /flush|PanelEvent/.test(name)), []);
  assert.deepEqual([...names, 'flushPanels'].filter((name) => /flush|PanelEvent/.test(name)), ['flushPanels'], 'control: a scratch export with the name is found');
});
