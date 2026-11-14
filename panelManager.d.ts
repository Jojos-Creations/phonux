/**
 * The workspace's manager: every panel by id as a handle, the three configure calls and `resetLayout`, and the pieces
 * every operation on a handle is answered with.
 */
import type { JsonValue } from './hostApi.js';
import { type PanelHandle, type ReadSource } from './panelHandles.js';
import type { PanelRefusal } from './panelManagerError.js';
import type { AddPlacement, PanelId, SettingNote, WorkspaceTuning } from './panelSettings.js';
import type { InstancePatch, SettingsPatch } from './settingsPatch.js';
import type { ListFilter, PanelSnapshot } from './panelTemplate.js';
/**
 * What an operation on a handle answers: `ok` with whether anything was dispatched, or a refusal that touched nothing.
 * @public
 */
export type PanelResult = {
    /** The operation was accepted. */
    readonly ok: true;
    /** True when a change was dispatched; false for an accepted call that had nothing to do. */
    readonly changed: boolean;
} | {
    /** The operation was refused and nothing changed. */
    readonly ok: false;
    /** Why it was refused. */
    readonly code: PanelRefusal;
    /** A sentence saying which panel and what stood in the way. */
    readonly message: string;
};
/**
 * What `resetLayout` answers: a `PanelResult` and the panels it reset, the live panels it parked to make a larger
 * tier fit, and the parked ones the room it freed brings back.
 * @public
 */
export type ResetResult = PanelResult & {
    /** The panels that were reset. */
    readonly panels?: readonly PanelId[];
    /** The panels parked because a tier no longer fits. */
    readonly parked?: readonly PanelId[];
    /** The parked panels that return because the reset freed room. */
    readonly returned?: readonly PanelId[];
};
/**
 * What `configure`, `configureTemplate` and `configureTuning` answer: on success whether anything was stored, the setting
 * names that act in this commit (`now`), the ones that apply at the next use (`later`), the ones a person's override or a
 * forced rule still outvotes (`shadowed`) and the runtime notes the change raised; on refusal the code, a sentence, and the
 * catalog name of the key at fault where one is.
 * @public
 */
export type ConfigureResult = {
    /** The change was accepted. */
    readonly ok: true;
    /** True when a different value was stored; false for an equal or empty patch. */
    readonly changed: boolean;
    /** The catalog names applied in this commit. */
    readonly now: readonly string[];
    /** The catalog names stored for the next time the panel or the workspace reads them. */
    readonly later: readonly string[];
    /** The catalog names the patch set that a person's override or a forced rule outvotes. */
    readonly shadowed: readonly string[];
    /** The notes the change raised. */
    readonly notes: readonly SettingNote[];
} | {
    /** The change was refused and nothing changed. */
    readonly ok: false;
    /** Why it was refused. */
    readonly code: PanelRefusal;
    /** A sentence saying which panel and what stood in the way. */
    readonly message: string;
    /** The catalog name of the key at fault: for `settings-conflict` the conflict's key, for `wrong-scope` and `not-view-settable` the key asked. */
    readonly setting?: string;
};
/** Who an operation is for: code, which leaves the person's arrangement alone, or a person's own gesture, which records it. @internal */
export type PanelOpSource = 'code' | 'person';
/**
 * One panel a completed move or place changed, and who the change was for.
 * @public
 */
export type PanelMove = {
    /** The id of the panel that moved. */
    readonly id: PanelId;
    /**
     * `'person'` for a person's own gesture, which the saved arrangement keeps: a drag or the arrow keys on a grab handle, a row drop, a header
     * button, a host call with source `'person'`, the deprecated host `move` and `reanchor`, and the root's summon on an Embla row. `'code'` for a
     * `move`, `place` or row drop called with source `'code'`, which leaves the person's arrangement as it was.
     */
    readonly source: 'code' | 'person';
};
/** An accepted operation. @internal */
export declare const accepted: (changed: boolean) => PanelResult;
/** A refusal; the caller has touched nothing. @internal */
export declare const refused: (code: PanelRefusal, message: string) => PanelResult;
/**
 * Where the root panel stands: `'shown'` in the view, `'summoned'` brought there by `summonRoot`, `'away'` out of it. On a row with
 * `rowEngine="embla"` a summoned root is an ordinary page, so it reads `'shown'` or `'away'`, never `'summoned'`.
 * @public
 */
export type RootView = 'shown' | 'summoned' | 'away';
/**
 * Every panel of a workspace by id, as handles that can also operate on it, with the calls that configure panels, templates and the workspace's tuning and reset a layout.
 * @public
 */
export interface PanelManager {
    /** The handle of the panel with this id, or undefined when the workspace knows none. `P` is an unchecked cast: nothing compares it with the panel's template. */
    get<P extends JsonValue = JsonValue>(id: PanelId): PanelHandle<P> | undefined;
    /** A handle for every panel `f` keeps; all panels when `f` is left out. */
    list(f?: ListFilter): readonly PanelHandle[];
    /**
     * Changes settings of one panel after it was added; `null` removes an instance value. All or nothing, in one update. A flip of `parkable` on a panel that is not live is refused with `would-reshape-row` or `is-closed`.
     * @throws PanelManagerError with code `invalid-settings` when the patch is not an object or names an unknown key.
     */
    configure(id: PanelId, patch: InstancePatch): ConfigureResult;
    /**
     * Changes the template-scope settings (`hostCreatable`, `multiple`, `maxInstances`) of a template for panels made from now on. Kept for this session only.
     * @throws PanelManagerError with code `unknown-template` for a template that is not registered, or `invalid-settings` when the patch is not an object or names an unknown key.
     */
    configureTemplate(templateId: string, patch: Pick<SettingsPatch, 'hostCreatable' | 'hollowDot' | 'multiple' | 'maxInstances'>): ConfigureResult;
    /**
     * Changes the workspace's tuning keys; a per-panel key sets the workspace default. Kept for this session only.
     * @throws PanelManagerError with code `invalid-settings` when the patch is not an object or names an unknown key.
     */
    configureTuning(patch: {
        [K in keyof WorkspaceTuning]?: WorkspaceTuning[K] | null;
    }): ConfigureResult;
    /** Clears the person's overrides of one panel, or of every panel but the root with 'all', and applies the cascade defaults now, in one update. */
    resetLayout(target: PanelId | 'all'): ResetResult;
    /**
     * Replaces what the row shows in one update: parks the panels of `hide` and brings in those of `show`, each a parked panel's id
     * or `{ id, place }` to land it where `place` says (else where its `placeOnShow` says). The shows are priced against the row
     * without the hides, so the whole change lands in one commit and one motion: every leaving panel shrinks as a close does and
     * every arriving one grows as an open does, and the row re-centers once. Nothing is scrolled to. A live panel in `show` or a
     * parked one in `hide` is left as it is. Refused as a whole, changing nothing, for a panel that is unknown, pending or closed,
     * a fixed column in `hide`, the root in `show`, one that already has an operation this turn (`busy`), or a change that would
     * leave the row empty.
     */
    swap(show: readonly (PanelId | {
        id: PanelId;
        place?: AddPlacement | 'in-place';
    })[], hide?: readonly PanelId[]): PanelResult;
    /** Where the root panel stands: in the view, summoned there, or out of it. A row that is not on screen reads as 'shown'. */
    rootView(): RootView;
    /**
     * Brings the root panel, out of the view, to the view's edge on the side it lies: the panels in that edge's slot park, and return when the root goes.
     * A wide panel in that slot moves over instead, and runs off the far edge. False when the root is already in view.
     *
     * With `rowEngine="embla"` the root is an ordinary page: the summon moves it in the page order to the slot just outside the view on
     * the side it lies on (the left when on neither), as a person's move that the saved order keeps, and the row then glides it in as it
     * glides to any page. Nothing parks, nothing is undone later, and it stays where it landed. False when it is already wholly in view.
     */
    summonRoot(): boolean;
    /**
     * Sends a summoned root back out and returns what it parked. False when no summon stands; a step of the row away from the root does the same.
     * With `rowEngine="embla"` there is nothing to undo: it does nothing and returns false.
     */
    dismissRoot(): boolean;
    /**
     * The panel `id` and every panel it opened, directly or through the panels it opened, in row order (see `PanelState.openedBy`).
     * Empty when the row holds no panel `id`: a pending, closed or unknown panel has no family.
     */
    familyOf(id: PanelId): readonly PanelId[];
    /** A readonly picture of the whole workspace, the same object until something changes. */
    getSnapshot(): PanelSnapshot;
    /** Calls `l` when the workspace changes; returns a function that stops the calls. */
    subscribe(l: () => void): () => void;
    /**
     * Calls `l` once for every panel a completed `move` or `place` changed (its place in the row or what it is anchored to), the person's gestures included, after the
     * snapshot that shows the change is published. A panel carried along by the one that moved (one anchored to it, such as a panel it
     * opened) is reported too, with the same source, after it. An operation that is refused, changes nothing, or whose panel leaves the row
     * before the change is drawn reports nothing; a park, show, close, open or resize is not a move. Returns a function that stops the calls.
     */
    subscribeMoves(l: (move: PanelMove) => void): () => void;
}
/** The manager over `source`. @internal */
export declare function makePanelManager(source: ReadSource): PanelManager;
