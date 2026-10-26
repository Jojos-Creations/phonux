/**
 * The pure half of `configure`, `configureTemplate` and `configureTuning`: which door a key belongs to, the plan a patch
 * makes against the layers a panel resolves under, and the entry that plan writes. Nothing here reads React state or
 * dispatches; the engine takes the plan and applies it in one update.
 */
import type { ConfigureResult } from './panelManager.js';
import type { PanelRefusal } from './panelManagerError.js';
import { type PinChange } from './panelPin.js';
import type { PanelSettings, PanelSettingsResolution, PanelUserLayer, ResolvedPanelSettings, SettingNote, WorkspaceTuning } from './panelSettings.js';
import { type SettingsPatch } from './settingsPatch.js';
import type { PanelWindow } from './panelWindow.js';
/** Which call a patch arrives through: a panel's own `configure`, a view's, `configureTemplate` or `configureTuning`. */
export type ConfigureCall = 'panel' | 'view' | 'template' | 'tuning';
/** A refusal before any state is read or changed. */
export interface PatchRefusal {
    code: Extract<PanelRefusal, 'wrong-scope' | 'not-view-settable'>;
    message: string;
    setting: string;
}
/**
 * The catalog names a patch touches, or the first refusal it earns. A key the catalog does not know throws
 * `invalid-settings` whatever else the patch holds: that is a programmer error, not a state.
 */
export declare function checkPatch(call: ConfigureCall, patch: unknown): {
    names: string[];
} | {
    refusal: PatchRefusal;
};
/** Whether `name` acts at this commit on a panel in `status`. */
export declare function actsNow(name: string, status: 'live' | 'parked' | 'hidden' | 'closed'): boolean;
/** What a plan against one panel's layers decided. */
export type InstancePlan = {
    ok: false;
    code: PanelRefusal;
    message: string;
    setting?: string;
} | {
    ok: true;
    changed: false;
} | {
    ok: true;
    changed: true;
    /** The instance layer after the patch. */
    layer: PanelSettings;
    /** The settings the panel resolves to under that layer. */
    resolution: PanelSettingsResolution;
    now: string[];
    later: string[];
    shadowed: string[];
    notes: SettingNote[];
    /** True when the patch asked for `parkable`: a deferred pin is cancelled. */
    cancelsPin: boolean;
    /** The Host-bag split after the patch; undefined for a panel no view created. */
    split: HostSplit | undefined;
};
/** What `planInstance` reads. */
export interface InstanceInput {
    call: 'panel' | 'view';
    patch: SettingsPatch;
    names: readonly string[];
    /** The instance layer now. */
    base: PanelSettings | undefined;
    workspace: PanelSettings | undefined;
    template: PanelSettings | undefined;
    /** What a view asked for at the Host-bag create of this panel, when it did. */
    split: HostSplit | undefined;
    /** The person's overrides; absent for a closed record. */
    person: PanelUserLayer | undefined;
    /** The settings the entry carries, to tell a `parkable` a pin from code flipped from the layers' own. */
    current: ResolvedPanelSettings | undefined;
    root: boolean;
    /** The slot count the entry is at; absent for a closed record. */
    slots?: number | undefined;
    status: 'live' | 'parked' | 'hidden' | 'closed';
}
/**
 * What a view asked for at a Host-bag create, and which of those keys a configure has set since. The file keeps the asks
 * merged into the instance layer; the resolver reads them as the host layer, under the instance layer, until a configure
 * sets the key, so a `null` shows the ask again.
 */
export interface HostSplit {
    readonly host: PanelSettings;
    readonly touched: ReadonlySet<string>;
}
/** `merged` as the resolver's instance layer: without the keys only the view's ask holds, which the host layer carries. */
export declare function ownLayer(merged: PanelSettings | undefined, split: HostSplit | undefined): PanelSettings | undefined;
/**
 * The plan for patching panel layers: the new instance layer, the whole stack resolved again (a bad value throws
 * `invalid-settings`), the refusals a state or a new conflict earns, and the names split into what acts now and what
 * waits. A patch that changes nothing is `changed: false`.
 */
export declare function planInstance(i: InstanceInput): InstancePlan;
/** The success a plan answers with. */
export declare function configured(plan: Extract<InstancePlan, {
    changed: true;
}>): Extract<ConfigureResult, {
    ok: true;
}>;
/** The success of a call that changed nothing. */
export declare const unchanged: () => Extract<ConfigureResult, {
    ok: true;
}>;
/** The refusal a plan carries, as the result for panel `name`. */
export declare const refusedPlan: (name: string, plan: Extract<InstancePlan, {
    ok: false;
}>) => Extract<ConfigureResult, {
    ok: false;
}>;
/** The success of a call whose only effect was to cancel a flip of `parkable` waiting on the panel. */
export declare const cancelled: () => Extract<ConfigureResult, {
    ok: true;
}>;
/** The success of a flip that showed the panel: `plan` answers as it would for a live one, with `shown` true. */
export declare const shownResult: (plan: Extract<InstancePlan, {
    changed: true;
}>) => Extract<ConfigureResult, {
    ok: true;
}>;
/** The refusal of a flip of `parkable` that the panel's `pinningWhenNotLive` turns away. */
export declare const refusedFlip: (name: string, code: PanelRefusal) => Extract<ConfigureResult, {
    ok: false;
}>;
/**
 * The flip of `parkable` that `plan` asks of a panel reading `reads` now, or undefined when the patch does not name
 * `parkable` or leaves the panel reading what it did: already as asked, or outvoted by the person's override.
 */
export declare function askedFlip(patch: SettingsPatch, plan: Extract<InstancePlan, {
    changed: true;
}>, reads: boolean): PinChange | undefined;
/** `patch` and `names` without `parkable`: what a flip that waits or shows leaves for the ordinary write. */
export declare function withoutFlip(patch: SettingsPatch, names: readonly string[]): {
    patch: SettingsPatch;
    names: string[];
};
/** Whether `stored` is the very change `flip` asks for. */
export declare const sameDeferral: (stored: PinChange | undefined, flip: PinChange) => boolean;
/** What a flip that waits answers: the rest of the patch as `rest` plans it, and `parkable` among `later` when the flip is new. */
export declare function deferredResult(rest: Extract<InstancePlan, {
    ok: true;
}>, fresh: boolean): Extract<ConfigureResult, {
    ok: true;
}>;
/**
 * `entry` carrying what `plan` resolved: the fields that mirror the settings follow, the instance layer is kept for an
 * entry code does not re-declare, a title the patch removed goes, and a panel that became a fixed column is live. The
 * slots, size, anchor, `hostData`, `key`, `overrides` and `applied` are the ones `entry` already had.
 */
export declare function reconfigured(entry: PanelWindow, plan: Extract<InstancePlan, {
    changed: true;
}>, patch: SettingsPatch): PanelWindow;
/** `entry` with the rest of the patch written and `flip` waiting on it, or `entry` itself when that changes nothing. */
export declare function deferredEntry(entry: PanelWindow, rest: Extract<InstancePlan, {
    ok: true;
}>, patch: SettingsPatch, flip: PinChange): PanelWindow;
/** `entry` as it is handed to the show path of a flip: the rest of the patch written, the whole patch's instance layer, and nothing left waiting. */
export declare function shownEntry(entry: PanelWindow, rest: Extract<InstancePlan, {
    ok: true;
}>, patch: SettingsPatch, plan: Extract<InstancePlan, {
    changed: true;
}>): PanelWindow;
/** `prev` with `target` replaced by `next`, or `prev` itself when the row no longer holds `target`: something changed the entry between the call and the commit. */
export declare function applyConfigure(prev: PanelWindow[], target: PanelWindow, next: PanelWindow): PanelWindow[];
/** What the engine's `configure` op is handed by the workspace: an answer, and for a change the entry to write and, when the flip shows the panel, the change its show path applies. */
export type ConfigureOutcome = {
    done: ConfigureResult;
} | {
    done: Extract<ConfigureResult, {
        ok: true;
    }>;
    next: PanelWindow;
    show?: PinChange;
};
/** What `planTuning` decided. */
export type TuningPlan = {
    changed: false;
} | {
    changed: true;
    /** The workspace tuning input after the patch. */
    input: WorkspaceTuning;
    now: string[];
    later: string[];
    /** True when the patch moves `rowGap`, which re-prices the row. */
    reprices: boolean;
};
/** The plan for patching the workspace tuning input; a leaf that is out of range throws `invalid-settings`. */
export declare function planTuning(current: WorkspaceTuning | undefined, patch: Record<string, unknown>): TuningPlan;
/** The layer of the three template-scope keys after a patch, or the same layer when nothing changed. */
export declare function planTemplate(base: PanelSettings | undefined, patch: SettingsPatch): {
    layer: PanelSettings;
    changed: boolean;
};
