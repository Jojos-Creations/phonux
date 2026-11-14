/**
 * Two checks that tie a template to its panel API level: the settings and header button members it uses against the level
 * that introduced each, and the shape of the header button items its views read. Both are development diagnostics
 * that log one console.error per template and never throw; a malformed value is the resolver's `invalid-settings`, not this.
 */
import { type ShapeOf } from './panelApiLevel.js';
import type { PanelHeaderIconItem, PanelHeaderTextItem } from './panelHeaderButtons.js';
/** The level that introduced each setting and each header button member; a level before it does not promise it. @internal */
export interface LevelSince {
    readonly settings: Readonly<Record<string, number | undefined>>;
    readonly headerButton: Readonly<Record<string, number | undefined>>;
}
/** The levels that introduced the shipped settings and header button members. @internal */
export declare const SHIPPED_SINCE: LevelSince;
/** The settings and header button members of `settings` that a template on `level` was written before; empty when it uses none. Unknown names are the resolver's to refuse. @internal */
export declare function levelTieProblems(settings: unknown, level: number, since: LevelSince): string[];
/** Logs one console.error per template naming every setting or header button member newer than its level; called when the template is registered. @internal */
export declare function reportLevelTieOnce(templateId: string, level: number | undefined, settings: unknown, since?: LevelSince): void;
/** The header button item as a view reads it from `usePanelHeaderButtons`, one description per form. @internal */
export declare const HEADER_ITEM_SHAPE: {
    readonly icon: ShapeOf<PanelHeaderIconItem>;
    readonly text: ShapeOf<PanelHeaderTextItem>;
};
/** What differs between the listed items and the description of their form; an item is judged by its own `form`. @internal */
export declare function itemProblems(items: readonly unknown[]): string[];
/** Logs one console.error the first time a template's view lists header buttons that do not match their form; nothing is marked checked while the list is empty. @internal */
export declare function reportItemShapeOnce(templateId: string, level: number | undefined, items: readonly unknown[]): void;
