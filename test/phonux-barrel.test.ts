/**
 * The runtime surface of the phonux barrel (index.ts): types are erased, so Object.keys() sees
 * only value exports. The list is spelled out, never derived, so a name added, removed or renamed turns it red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as phonux from '../index.js';
import { HostProvider, useHost } from '../hostApi.js';
import { CaptureRegistryContext } from '../snapshots.js';
import { OverlayProvider, OverlayStore } from '../windowOverlay.js';

const VALUE_EXPORTS = [
  // Old names (kept as @deprecated same-value aliases).
  'DEFAULT_PHONE_SIZE',
  'PhoneAPIsMissingProviderError',
  'PhoneAPIsProvider',
  'usePhoneAPIs',
  'PhoneView',
  'DRAG_CLOSE',
  'DragToClose',
  'shouldCloseOnRelease',
  'WindowOverlay',
  'OverlaySlot',
  'OVERLAY_Z',
  'PhoneFrame',
  'PHONE_CORNER_RADIUS_UNITS',
  'phoneCornerRadiusPx',
  'phoneFrameScrollSx',
  'phoneFrameBareSx',
  'PhoneFrameHeader',
  'PhoneFrameHeaderRow',
  'PHONE_MODELS',
  'findPhoneModel',
  'vendorLabelForUsbVendorId',
  'PhoneDetectPrompt',
  'registerPanelView',
  'resolvePanelView',
  // New names.
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
  'PanelHeaderRow',
  'registerView',
  'resolveView',
  'useViewSnapshot',
  'CaptureRegistryContext',
  'CaptureRegistryProvider',
  'noopCaptureTrigger',
  'useViewState',
  'ViewStateMissingProviderError',
  'OverlayProvider',
  'OverlayStore',
  'computeRowOrder',
  'deriveAnchorsFromOrder',
  'summarisePanel',
  'DEFAULT_PANEL_SIZE',
  'TIER_SIZES',
  'panelWidthOf',
  'computeRowLayout',
  'computeMaxLiveWidth',
  'PanelRow',
  'PanelRowSlot',
  'PanelSizeBox',
  'GAP',
  'PANEL_TRANSITION',
  'usePanelReorderEligible',
  'usePanelCloseEligible',
  'usePanelNeighborWidths',
  'usePanelPinned',
  'Workspace',
  'useProvidePanels',
  'reorderStepsForOffset',
  // Opt-in extras (never applied implicitly).
  'createDefaultTheme',
].sort();

test('the phonux barrel exports exactly the 66 runtime values, no more, no fewer', () => {
  assert.deepEqual(Object.keys(phonux).sort(), VALUE_EXPORTS);
});

// Red if index.ts re-exports a copy or wrapper instead of the defining file's own object: a context from one copy is invisible to the other's hooks.
// The exports map ('phonux', 'phonux/testing') is checked against the packed tarball by the smoke, not here.
test('module identity: the context-bearing exports of the barrel are the very objects their defining source files export', async () => {
  assert.ok(phonux.CaptureRegistryContext === CaptureRegistryContext, 'CaptureRegistryContext: the barrel holds another object');
  assert.ok(phonux.HostProvider === HostProvider && phonux.useHost === useHost, 'HostProvider/useHost: the barrel holds other objects than hostApi');
  assert.ok(phonux.OverlayProvider === OverlayProvider && phonux.OverlayStore === OverlayStore, 'OverlayProvider/OverlayStore: the barrel holds other objects than windowOverlay');
  // Control: a genuinely separate instance of the same file is NOT ===, so the checks above can fail.
  const secondInstance = '../snapshots.js?second-instance';
  const second = (await import(secondInstance)) as { CaptureRegistryContext: unknown };
  assert.ok(second.CaptureRegistryContext !== undefined && second.CaptureRegistryContext !== CaptureRegistryContext, 'control: a second module instance must yield a distinct context');
});
