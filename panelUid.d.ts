/**
 * The uid a saved panel carries so two copies of a workspace file can match panels. It is opaque: never a name code
 * asks for, never a handle, and never compared with a key or a runtime id.
 */
/** The form of every uid: `u_` and 32 lowercase hex characters (128 random bits). */
export declare const PANEL_UID_FORM: RegExp;
/** Fills `bytes` with random values. */
export type RandomFill = (bytes: Uint8Array) => void;
/** A new uid. `fill` is injectable so a test can supply the bytes. @internal */
export declare function newPanelUid(fill?: RandomFill): string;
