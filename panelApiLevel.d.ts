import type { PanelViewProps } from './panelTemplate.js';
/** A panel API level a template may declare with `api`: the package major version its panel code was written for. @public */
export type PanelApiLevel = 1;
/** The newest panel API level, equal to the package's major version from 1.0.0; a template that leaves `api` out is on it. @public */
export declare const PANEL_API: PanelApiLevel;
/** What a template's view and footer are rendered with at the newest level. @internal */
export type NewestViewProps = PanelViewProps;
/** What a member's value is: its `typeof`, or `any` for a member that holds any JSON value. @internal */
export type MemberKind = 'string' | 'number' | 'boolean' | 'function' | 'object' | 'any';
/** One member a level promises; `optional` is required by the type exactly where the described member may be absent or undefined. @internal */
export type MemberShape<T, K extends keyof T> = {
    readonly kind: MemberKind;
} & (undefined extends T[K] ? {
    readonly optional: true;
} : {
    readonly optional?: false;
});
/** The members of `T` by name and kind; a member added to or removed from `T` fails to compile until this is updated. @internal */
export type ShapeOf<T> = {
    readonly [K in keyof T]-?: MemberShape<T, K>;
};
/** The props a level hands a view and footer: each prop by name, with the members it promises. @internal */
export type PropsShape = Readonly<Record<string, Readonly<Record<string, {
    readonly kind: MemberKind;
    readonly optional?: boolean;
}>>>>;
/** The newest level's props, member by member. Optional members are marked so a panel without them is no mismatch. @internal */
export declare const NEWEST_SHAPE: {
    readonly [K in keyof NewestViewProps]-?: ShapeOf<NewestViewProps[K]>;
};
/** One level the library serves: how it turns the newest props into the ones that level promised, and what those props contain. A level whose props are the newest props has neither `adapt` nor `shape`. @internal */
export type LevelEntry = {
    /** The release that removes the level, set when the level is deprecated and named in the warning; absent while the level is served. */
    readonly droppedIn?: string;
} & ({
    readonly adapt?: undefined;
    readonly shape?: undefined;
} | {
    readonly adapt: (props: NewestViewProps) => object;
    readonly shape: PropsShape;
});
/** Which levels are served and which is the newest; tests pass their own to exercise a level the shipped table does not have. @internal */
export interface LevelTable {
    readonly newest: number;
    readonly levels: ReadonlyMap<number, LevelEntry>;
    /** Levels that were served once, with the release that removed each; absent means none. */
    readonly dropped?: ReadonlyMap<number, string>;
}
/** The levels this package serves. @internal */
export declare const SHIPPED_LEVELS: LevelTable;
/** Throws `invalid-template` when `api` is set to anything but a level `table` serves; an omitted `api` is the newest level. @internal */
export declare function checkPanelApi(templateId: string, api: unknown, table?: LevelTable): void;
/** Why `table` is not a complete account of levels 1 to `newest` (each served or dropped, never both, none outside the range), or undefined when it is. @internal */
export declare function levelCoverageProblem(table: LevelTable): string | undefined;
/** Logs once per template id that it is on a level older than the newest, naming the removal release only for a deprecated level; silent in production. @internal */
export declare function warnIfOldLevel(templateId: string, level: number, table: LevelTable): void;
/** What differs between one object and the members described for it, as lines prefixed with `label`; empty when they match. Reads descriptors only. @internal */
export declare function memberProblems(value: object, members: PropsShape[string], label: string): string[];
/** What differs between `props` and `shape`, one line per missing or wrong member; empty when they match. Reads descriptors only, so it never runs a getter or a method. @internal */
export declare function shapeMismatches(props: object, shape: PropsShape): string[];
/** Runs `check` the first time `key` is seen and logs its lines as one console.error under `heading`; silent in production and never throws. @internal */
export declare function reportOnce(key: string, heading: string, check: () => string[]): void;
/** Logs one console.error the first time a template at a level is rendered, listing every mismatch between `props` and `shape`. @internal */
export declare function reportShapeOnce(templateId: string, level: number, props: object, shape: PropsShape): void;
