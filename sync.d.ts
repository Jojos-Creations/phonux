/**
 * `phonux/sync`: keep an app's documents in the user's own Dropbox or Google Drive, one plain file each.
 * It moves named text documents and never reads them, so any app can sync its own shapes through it.
 * @packageDocumentation
 */
export { SYNC_README_FILE, createSync } from './syncEngine.js';
export type { Sync, SyncDoc, SyncOptions, SyncStatus } from './syncEngine.js';
export { dropbox } from './syncDropbox.js';
export type { DropboxOptions } from './syncDropbox.js';
export { googleDrive } from './syncGoogleDrive.js';
export type { GoogleDriveOptions } from './syncGoogleDrive.js';
export { memorySyncProvider } from './syncMemory.js';
export { SyncError } from './syncTypes.js';
export type { SyncErrorCode, SyncKv, SyncOAuth, SyncProvider, SyncRemoteEntry, SyncRemoteFile } from './syncTypes.js';
