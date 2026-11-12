import type { Target } from './targets.js';
/** The picker's state: the highlighted row and the checked ids. */
export interface PickerState {
    cursor: number;
    checked: Set<string>;
}
/** A key the picker reacts to, already named. */
export type PickerKey = 'up' | 'down' | 'toggle' | 'all';
/** Applies one key to the picker state. */
export declare function pickerStep(state: PickerState, key: PickerKey, targets: readonly Target[]): PickerState;
/** The picker as text, one line per target. */
export declare function renderPicker(state: PickerState, targets: readonly Target[], notes: ReadonlyMap<string, string>): string;
/** Shows the list in the terminal and resolves with the picked ids, or null if the developer quits. */
export declare function pickTargets(targets: readonly Target[], initial: readonly string[], notes: ReadonlyMap<string, string>): Promise<string[] | null>;
