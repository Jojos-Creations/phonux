/**
 * A known phone model and its CSS-pixel frame size, as PHONE_MODELS lists them for the Settings dropdown.
 * @public
 */
export interface PhoneModel {
    /** Stable identifier of the model, as stored in a setting. */
    id: string;
    /** Display name for the Settings dropdown, ending in the CSS-pixel size. */
    label: string;
    /** Frame width in CSS px. */
    width: number;
    /** Frame height in CSS px. */
    height: number;
}
/**
 * Hand-copied from phonux-app's vendor/device-specs/viewport-sizes.json; keep
 * the two in sync by hand (that directory's README.md says which entries are verbatim). No 'default' entry:
 * that is DEFAULT_PHONE_SIZE (hostApi.tsx), so upgrading never resizes anyone who has not chosen a model.
 * @public
 */
export declare const PHONE_MODELS: readonly PhoneModel[];
/** The entry of `PHONE_MODELS` whose `id` is `id`, or undefined when there is none. @public */
export declare function findPhoneModel(id: string): PhoneModel | undefined;
