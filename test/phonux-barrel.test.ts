/**
 * The runtime surface of the phonux barrel (shared/phone/index.ts): types are erased, so Object.keys() sees
 * only value exports. The list is spelled out, never derived, so a name added, removed or renamed turns it red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as phonux from '../client/src/shared/phone/index.js';
import * as bare from 'phonux';
import * as bareTesting from 'phonux/testing';
import { HostProvider, useHost } from '../client/src/shared/phone/hostApi.js';
import { CaptureRegistryContext } from '../client/src/shared/phone/snapshots.js';
import { OverlayProvider, OverlayStore } from '../client/src/shared/phone/windowOverlay.js';
import { createFakeHost } from '../client/src/shared/phone/fakeHost.js';

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
  // Opt-in extras (never applied implicitly).
  'createDefaultTheme',
].sort();

test('the phonux barrel exports exactly the 63 runtime values, no more, no fewer', () => {
  assert.deepEqual(Object.keys(phonux).sort(), VALUE_EXPORTS);
});

// Red if bare 'phonux' or 'phonux/testing' loads a second copy of a source file: a context from one copy is invisible to the other's hooks.
test('module identity: context-bearing exports reached via bare phonux and phonux/testing are the very objects their relative source files export', async () => {
  assert.ok(bare.CaptureRegistryContext === CaptureRegistryContext, 'CaptureRegistryContext: two instances');
  assert.ok(bare.HostProvider === HostProvider && bare.useHost === useHost, 'HostProvider/useHost: two instances of hostApi');
  assert.ok(bare.OverlayProvider === OverlayProvider && bare.OverlayStore === OverlayStore, 'OverlayProvider/OverlayStore: two instances of windowOverlay');
  assert.ok(bareTesting.createFakeHost === createFakeHost, 'createFakeHost: two instances of the testing subpath');
  // Control: a genuinely separate instance of the same file is NOT ===, so the checks above can fail.
  const secondInstance = '../client/src/shared/phone/snapshots.js?second-instance';
  const second = (await import(secondInstance)) as { CaptureRegistryContext: unknown };
  assert.ok(second.CaptureRegistryContext !== undefined && second.CaptureRegistryContext !== CaptureRegistryContext, 'control: a second module instance must yield a distinct context');
});
