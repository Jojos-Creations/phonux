import { type SyncKv, type SyncProvider } from './syncTypes.js';
/**
 * The file a host's `readme` text is written to, once, beside the documents. `pull` never returns it.
 * @public
 */
export declare const SYNC_README_FILE = "README - DO NOT DELETE.txt";
/**
 * Options for {@link createSync}.
 * @public
 */
export interface SyncOptions {
    /** The provider this account lives on. */
    readonly provider: SyncProvider;
    /** Where sync keeps its own state on this device. Its keys all start with `prefix`. */
    readonly kv: SyncKv;
    /** The redirect URI registered with the provider; the host delivers the URL it lands on to `finishSignIn`. */
    readonly redirectUri: string;
    /** Text for {@link SYNC_README_FILE}, written beside the documents on the first push when the file is missing. */
    readonly readme?: string;
    /** Default `sync:<provider id>:`. */
    readonly prefix?: string;
    /** Replaces the global `fetch`, for tests. */
    readonly fetch?: typeof fetch;
    /** Epoch ms for a document's `updatedAt` when `push` is given none. */
    readonly now?: () => number;
}
/**
 * One logical document: the app's own name and text, and when it last changed.
 * @public
 */
export interface SyncDoc {
    /** The app's own name for the document, unique within the account. It is also the file's name, percent-encoded. */
    readonly name: string;
    /** The document's content, stored as the file's content unchanged. */
    readonly text: string;
    /** Epoch ms of the edit. The newer of two edits wins. */
    readonly updatedAt: number;
}
/**
 * Where this device stands: `signed-out` or `ready`.
 * @public
 */
export type SyncStatus = 'signed-out' | 'ready';
/**
 * A device's view of one account. Each document is one plain file in the provider's app folder, so the folder is
 * also a backup the user can read.
 * @public
 */
export interface Sync {
    /** The provider's sign-in page. The host opens it and later hands the redirect's URL to `finishSignIn`. */
    signInUrl(): Promise<string>;
    /** Completes a sign-in from the URL the provider redirected to. Rejects with `sign-in-failed` on an error or a foreign state. */
    finishSignIn(callbackUrl: string): Promise<void>;
    /** Forgets this device's tokens. The account's files stay. */
    signOut(): Promise<void>;
    /** Reads this device's stored state only; it makes no network call. */
    status(): Promise<SyncStatus>;
    /** The documents another device changed since this device last pulled or pushed them. */
    pull(): Promise<SyncDoc[]>;
    /**
     * Uploads one document. When another device saved a newer edit of it first, nothing is uploaded and that edit is
     * returned for the host to apply; otherwise resolves null.
     */
    push(doc: {
        name: string;
        text: string;
        updatedAt?: number;
    }): Promise<SyncDoc | null>;
}
/**
 * Creates the sync engine for one provider. It needs `fetch` and WebCrypto, and nothing from React or phonux's panels.
 * @public
 */
export declare function createSync(options: SyncOptions): Sync;
