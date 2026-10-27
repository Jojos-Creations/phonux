/** The one place that turns a name a caller gives into the entry it means: a panel's key, which is its public id, or the counter id the entry held before the key was the only id. */
/** The release that stops resolving a counter id; the warning and the CHANGELOG name it. */
export declare const COUNTER_ID_REMOVED_IN = "0.3.0";
/** Logs once per counter id that the id a caller gave is the old one and names the key to use; silent in production and where `process` is undefined. @internal */
export declare function warnCounterId(counter: string, key: string): void;
/** The entry whose key is `name`, else the entry whose counter id is `name` (with a development warning when that differs from its key); undefined when none. @internal */
export declare function entryNamed<E extends {
    readonly id: string;
    readonly key?: string;
}>(entries: readonly E[], name: string): E | undefined;
