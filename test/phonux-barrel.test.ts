/**
 * The phonux barrel (client/src/shared/phone/index.ts): its runtime export surface. Types are erased by
 * TypeScript before this module ever runs, so Object.keys() on the imported namespace can only ever see
 * the 24 value exports; the type exports are not checked here. The 24-name list here is spelled out
 * literally, never derived from the module or from index.ts, so a name silently added, removed or renamed
 * on either side makes this test red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as phonux from '../client/src/shared/phone/index.js';

const VALUE_EXPORTS = [
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
].sort();

test('the phonux barrel exports exactly the 24 runtime values, no more, no fewer', () => {
  assert.deepEqual(Object.keys(phonux).sort(), VALUE_EXPORTS);
});
