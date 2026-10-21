/**
 * The uid a saved panel carries so two copies of a workspace file can match panels. It is opaque: never a name code
 * asks for, never a handle, and never compared with a key or a runtime id.
 */
/** The form of every uid: `u_` and 32 lowercase hex characters (128 random bits). */
export const PANEL_UID_FORM = /^u_[0-9a-f]{32}$/;
// Math.random only where crypto is missing; a uid needs to be unlikely to repeat, not unguessable.
const systemFill = (bytes) => {
    const c = globalThis.crypto;
    if (c?.getRandomValues !== undefined) {
        c.getRandomValues(bytes);
        return;
    }
    for (let k = 0; k < bytes.length; k += 1)
        bytes[k] = Math.floor(Math.random() * 256);
};
/** A new uid. `fill` is injectable so a test can supply the bytes. @internal */
export function newPanelUid(fill = systemFill) {
    const bytes = new Uint8Array(16);
    fill(bytes);
    let hex = '';
    for (const b of bytes)
        hex += b.toString(16).padStart(2, '0');
    return `u_${hex}`;
}
