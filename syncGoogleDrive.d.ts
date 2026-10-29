import { type SyncProvider } from './syncTypes.js';
/**
 * Options for {@link googleDrive}.
 * @public
 */
export interface GoogleDriveOptions {
    /** The OAuth client id from Google Cloud Console. */
    readonly clientId: string;
    /** The client secret Google issues even to public clients and requires at its token endpoint; it is not confidential. */
    readonly clientSecret?: string;
    /** Replaces the global `fetch`, for tests. */
    readonly fetch?: typeof fetch;
}
/**
 * A {@link SyncProvider} over the app's Google Drive appDataFolder, with the `drive.appdata` scope: a space only this
 * app reads, hidden from the user in Drive, so it cannot be deleted by accident. Drive has no
 * conditional upload, so `write` checks the revision just before writing: two devices writing in the same instant can
 * both succeed, and the later one wins.
 * @public
 */
export declare function googleDrive({ clientId, clientSecret, fetch: fetchFn }: GoogleDriveOptions): SyncProvider;
