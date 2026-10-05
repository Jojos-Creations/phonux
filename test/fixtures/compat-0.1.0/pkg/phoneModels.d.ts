/**
 * A known phone model and its CSS-pixel frame size, as PHONE_MODELS lists them for the Settings dropdown and
 * the USB-detect prompt.
 * @public
 */
export interface PhoneModel {
    id: string;
    label: string;
    width: number;
    height: number;
}
/**
 * Hand-copied from phonux-app's vendor/device-specs/viewport-sizes.json; keep
 * the two in sync by hand (that directory's README.md says which entries are verbatim). No 'default' entry:
 * that is DEFAULT_PHONE_SIZE (hostApi.tsx), so upgrading never resizes anyone who has not chosen a model.
 * @public
 */
export declare const PHONE_MODELS: readonly PhoneModel[];
/** @public */
export declare function findPhoneModel(id: string): PhoneModel | undefined;
/**
 * A short, friendly noun phrase for a just-detected USB vendor id, for the connect prompt's copy. Never more
 * specific than "iPhone" or "Android phone": a bare USB vendor/product id cannot tell the exact model.
 * @public
 */
export declare function vendorLabelForUsbVendorId(vendorId: number): string;
