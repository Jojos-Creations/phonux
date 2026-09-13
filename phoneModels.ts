/**
 * phone-size-auto-detection: the Settings dropdown's (and the USB-detect
 * popup's) list of known phone models, each with its own CSS-pixel
 * PhoneFrame size. Pure and unit-testable, same reasoning as this
 * codebase's other neighbors (e.g. SettingsPanel.tsx's keyStatusMessage).
 *
 * Hand-copied from vendor/device-specs/viewport-sizes.json (not imported
 * directly -- that file lives outside client/'s own tsconfig root, and
 * cross-project JSON module resolution isn't worth the build-config
 * complexity for a ~14-entry static list). See that directory's own
 * README.md for exactly which entries are verbatim from DevExpress/
 * device-specs vs. hand-supplemented for newer devices; keep the two in
 * sync by hand if either changes.
 */

export interface PhoneModel {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** id 'default' is deliberately NOT in this list -- it means "the app's own built-in default", handled separately (DEFAULT_PHONE_SIZE in phoneSize.ts) so upgrading this app never silently resizes anyone who hasn't chosen a model. */
export const PHONE_MODELS: readonly PhoneModel[] = [
  { id: 'iphone8', label: 'iPhone 8 / SE (2nd/3rd gen) (375 × 667)', width: 375, height: 667 },
  { id: 'iphonex', label: 'iPhone X (375 × 812)', width: 375, height: 812 },
  { id: 'iphonexr', label: 'iPhone XR (414 × 896)', width: 414, height: 896 },
  { id: 'iphone11', label: 'iPhone 11 (414 × 896)', width: 414, height: 896 },
  { id: 'iphone1214', label: 'iPhone 12/13/14 (390 × 844)', width: 390, height: 844 },
  { id: 'iphonepromax', label: 'iPhone 14/15 Pro Max (430 × 932)', width: 430, height: 932 },
  { id: 'samsunggalaxys10', label: 'Samsung Galaxy S10 (360 × 740)', width: 360, height: 740 },
  { id: 'galaxys21', label: 'Samsung Galaxy S21/S22 (360 × 800)', width: 360, height: 800 },
  { id: 'galaxys23ultra', label: 'Samsung Galaxy S23 Ultra (384 × 824)', width: 384, height: 824 },
  { id: 'googlepixel3', label: 'Google Pixel 3 (393 × 786)', width: 393, height: 786 },
  { id: 'pixel67', label: 'Google Pixel 6/7 (412 × 915)', width: 412, height: 915 },
  { id: 'pixel8pro', label: 'Google Pixel 8 Pro (412 × 892)', width: 412, height: 892 },
  { id: 'oneplus11', label: 'OnePlus 11 (412 × 919)', width: 412, height: 919 },
];

export function findPhoneModel(id: string): PhoneModel | undefined {
  return PHONE_MODELS.find((m) => m.id === id);
}

/**
 * A short, friendly noun phrase for a just-detected USB vendor id, used by
 * the one-time connect popup's copy. Deliberately vague past "iPhone" vs.
 * "Android phone" -- plans/records/phone-size-auto-detection.md: exact
 * model can't be determined from a bare USB vendor/product id.
 */
export function vendorLabelForUsbVendorId(vendorId: number): string {
  if (vendorId === 0x05ac) return 'an iPhone';
  const knownAndroidVendors = new Set([0x18d1, 0x04e8, 0x12d1, 0x2717, 0x2a70, 0x0bb4, 0x22b8, 0x1004, 0x0fce, 0x2ae5]);
  if (knownAndroidVendors.has(vendorId)) return 'an Android phone';
  return 'a phone';
}
