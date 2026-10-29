import { type SyncProvider } from './syncTypes.js';
/**
 * Options for {@link dropbox}.
 * @public
 */
export interface DropboxOptions {
    /** The App key from the Dropbox App Console, for an app with App Folder access. */
    readonly clientId: string;
    /** Replaces the global `fetch`, for tests. */
    readonly fetch?: typeof fetch;
}
/**
 * A {@link SyncProvider} over the app's Dropbox App Folder, which the user sees under Apps in their Dropbox, named
 * when the Dropbox app is registered. The Dropbox app needs the `files.content.read`,
 * `files.content.write` and `files.metadata.read` permissions, and the host's redirect URI listed.
 * @public
 */
export declare function dropbox({ clientId, fetch: fetchFn }: DropboxOptions): SyncProvider;
