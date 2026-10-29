/**
 * The contracts of `phonux/sync`: what a host supplies (a device store), what a provider implements, and the one
 * error type. Nothing here knows an app's data shape.
 */
/**
 * The only error sync throws on purpose. Network failures from `fetch` pass through unchanged.
 * @public
 */
export class SyncError extends Error {
    /** Which failure this is. */
    code;
    /** The HTTP status, where a provider response caused it. */
    status;
    constructor(code, message, status) {
        super(message);
        this.name = 'SyncError';
        this.code = code;
        this.status = status;
    }
}
