/**
 * The turn's operation gate, kept outside React: its tokens live in plain maps so every closure of every render reads
 * the same turn, however many commits a flushSync makes inside one call. usePanelManager owns the React side: it
 * forces a commit on release and calls `settle` from a layout effect with the highest token that commit has seen.
 */
/** What an in-flight operation does to the row, as far as the empty-row rule is concerned. */
export type GateKind = 'hide' | 'close' | 'other';
/**
 * The turn's record of which panels an operation is already acting on: one token per accepted call, deleted by the
 * commit that carries the call's `release`. A manager call that finds a token on its panel answers `busy`; a close is
 * exclusive among manager calls in both directions. A raw mutator takes a 'raw' token and never refuses, except that it
 * does nothing on a panel a manager call holds. `clearAll` takes raw tokens on the panels it removes without ever refusing.
 */
export interface OperationGate {
    /** True when a manager call on `ids` of this `kind` would answer busy. Takes nothing. */
    busy: (ids: readonly string[], kind: GateKind) => boolean;
    /** Takes a manager token on `ids`; undefined, taking nothing, when `busy`. */
    take: (ids: readonly string[], kind: GateKind) => number | undefined;
    /** Takes a raw token on `ids`; undefined, taking nothing, when a manager token holds one of them. */
    takeRaw: (ids: readonly string[], kind: GateKind) => number | undefined;
    /** Takes a raw token on those of `ids` that hold no token yet, and never refuses: a call that is not allowed to be a no-op marks its panels for the rest of the turn this way. Undefined when every id already holds one. */
    takeFree: (ids: readonly string[], kind: GateKind) => number | undefined;
    /** Marks the call that took `token` as finished, forcing a commit so its token is deleted even when the engine ignored the call. */
    release: (token: number) => void;
    /** The ids a hide or a close is acting on this turn. */
    leaving: () => ReadonlySet<string>;
}
/** The gate and the hook's hook into it: `settle(published)` runs after every commit with the highest release it has seen. */
export interface GateStore {
    readonly gate: OperationGate;
    settle: (published: number) => void;
}
/** A new gate with no tokens. `release` is called by the gate's `release` and must force a commit. */
export declare function createOperationGate(release: (token: number) => void): GateStore;
