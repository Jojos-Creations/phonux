/** Which native project a target is built from. */
export type Platform = 'android' | 'ios' | 'desktop';
/** One entry in the list a developer picks from. */
export interface Target {
    /** Stable id, used on the command line and in the remembered selection. */
    id: string;
    /** What the picker shows. */
    label: string;
    platform: Platform;
    /** Every target today builds; a publish target will name the build it uploads. */
    stage: 'build';
}
export declare const TARGETS: readonly Target[];
/** Looks targets up by id, throwing on an id the list does not have. */
export declare function targetsById(ids: readonly string[]): Target[];
/** Xcode's TARGETED_DEVICE_FAMILY for the picked Apple devices: 1 is iPhone, 2 is iPad. */
export declare function iosDeviceFamily(targets: readonly Target[]): string;
