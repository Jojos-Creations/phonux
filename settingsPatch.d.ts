/**
 * The shapes a change to a settings layer takes, and the one pure step that applies it. `null` deletes a value
 * from the instance layer; `undefined` never changes anything. The patch is not validated here: the layer it
 * produces is validated when the whole stack is resolved again.
 */
import type { AnchorRequest, PanelId, PanelSettings, WorkspaceTuning } from './panelSettings.js';
/** A change to one settings layer; `null` deletes that key from the layer. @public */
export type SettingsPatch = {
    [K in keyof PanelSettings]?: PanelSettings[K] | null;
};
/** What `configure(id, ...)` accepts: every key except the four that belong to a template. @public */
export type InstancePatch = Omit<SettingsPatch, 'hostCreatable' | 'hollowDot' | 'multiple' | 'maxInstances'>;
/** Exactly the keys a view may set on its own panel; any other key is not-view-settable. @public */
export type ViewPatch = {
    /** The panel's title; `null` removes the view's value. */
    title?: string | null;
    /** Whether the panel appears in `PanelReader.list` and the panel list; `null` removes the view's value. */
    listed?: boolean | null;
    /** Whether the panel is drawn with the base panels or raised above them; `null` removes the view's value. */
    layer?: 'base' | 'raised' | null;
    /** `false` locks the panel against closing; a view cannot ask for `true`, and `null` removes the lock. */
    closable?: false | null;
    /** How many phone widths wide the panel is; the row draws at most the slots that fit. `null` removes the view's value. */
    slots?: number | null;
    /** Where the panel goes whenever it is added, as an anchor on another panel; `null` removes the view's value. */
    placeOnAdd?: {
        anchor: AnchorRequest & {
            panel: PanelId;
        };
    } | null;
    /** `'anchor'` makes the panel enter from the panel it is anchored to; `null` removes the view's value. */
    enterFrom?: 'anchor' | null;
};
/**
 * Applies a patch to a settings layer and returns the new layer; the layer and the patch are never changed. `null`
 * deletes a value, and inside `headerButtons` it deletes one slot. An empty patch, or one that
 * changes nothing, returns the very same layer object.
 * @public
 */
export declare function mergePatch(layer: PanelSettings, patch: SettingsPatch): PanelSettings;
/**
 * Applies a `configureTuning` patch to the workspace's tuning input, leaf by leaf and member by member; `null` deletes a leaf
 * or a member. Returns the very same object when nothing changes.
 * @internal
 */
export declare function mergeTuningPatch(current: WorkspaceTuning | undefined, patch: Record<string, unknown>): WorkspaceTuning;
