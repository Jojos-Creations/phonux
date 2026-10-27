/**
 * A known phone model and its CSS-pixel frame size, as PHONE_MODELS lists them for the Settings dropdown.
 * @public
 */
/**
 * Hand-copied from phonux-app's vendor/device-specs/viewport-sizes.json; keep
 * the two in sync by hand (that directory's README.md says which entries are verbatim). No 'default' entry:
 * that is DEFAULT_PHONE_SIZE (hostApi.tsx), so upgrading never resizes anyone who has not chosen a model.
 * @public
 */
export const PHONE_MODELS = [
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
/** The entry of `PHONE_MODELS` whose `id` is `id`, or undefined when there is none. @public */
export function findPhoneModel(id) {
    return PHONE_MODELS.find((m) => m.id === id);
}
