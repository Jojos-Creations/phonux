/** phoneModels.ts's pure lookup and labeling helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPhoneModel, PHONE_MODELS, vendorLabelForUsbVendorId } from '../index.js';

test('PHONE_MODELS is a real, non-trivial curated list', () => {
  assert.ok(PHONE_MODELS.length >= 10);
  assert.ok(PHONE_MODELS.length <= 20);
  for (const m of PHONE_MODELS) {
    assert.ok(m.width > 0 && m.height > 0, `${m.id} must have a positive size`);
    assert.ok(m.id.length > 0);
    assert.ok(m.label.length > 0);
  }
});

test('every model id is unique', () => {
  const ids = PHONE_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('findPhoneModel finds a known id and returns undefined for an unknown one', () => {
  const first = PHONE_MODELS[0]!;
  assert.deepEqual(findPhoneModel(first.id), first);
  assert.equal(findPhoneModel('not-a-real-model'), undefined);
});

test('vendorLabelForUsbVendorId names Apple and Android generically, never a specific model', () => {
  const appleLabel = vendorLabelForUsbVendorId(0x05ac);
  assert.match(appleLabel, /iphone/i);
  assert.doesNotMatch(appleLabel, /\d/); // no model number -- exact model isn't determinable from vendor id alone

  const androidLabel = vendorLabelForUsbVendorId(0x18d1); // Google
  assert.match(androidLabel, /android/i);

  const unknownLabel = vendorLabelForUsbVendorId(0x1058); // Western Digital
  assert.equal(unknownLabel, 'a phone');
});
