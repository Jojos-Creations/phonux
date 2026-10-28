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

// Apple and Google ship one app file for phones and tablets, so a phone and a tablet pick share one build.
export const TARGETS: readonly Target[] = [
  { id: 'android-phone', label: 'Android phone', platform: 'android', stage: 'build' },
  { id: 'android-tablet', label: 'Android tablet', platform: 'android', stage: 'build' },
  { id: 'iphone', label: 'iPhone', platform: 'ios', stage: 'build' },
  { id: 'ipad', label: 'iPad', platform: 'ios', stage: 'build' },
  { id: 'desktop', label: 'Desktop (Electron)', platform: 'desktop', stage: 'build' },
];

/** Looks targets up by id, throwing on an id the list does not have. */
export function targetsById(ids: readonly string[]): Target[] {
  return ids.map((id) => {
    const target = TARGETS.find((t) => t.id === id);
    if (!target) throw new Error(`Unknown target "${id}". Choose from: ${TARGETS.map((t) => t.id).join(', ')}`);
    return target;
  });
}

/** Xcode's TARGETED_DEVICE_FAMILY for the picked Apple devices: 1 is iPhone, 2 is iPad. */
export function iosDeviceFamily(targets: readonly Target[]): string {
  const ids = new Set(targets.map((t) => t.id));
  return [ids.has('iphone') ? '1' : '', ids.has('ipad') ? '2' : ''].filter(Boolean).join(',');
}
