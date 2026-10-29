import { type SyncKv, type SyncProvider } from './syncTypes.js';
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
    /** The app's own name for the document, unique within the account. */
    readonly name: string;
    /** The document's content, opaque to sync. */
    readonly text: string;
    /** Epoch ms of the edit. The newer of two edits wins. */
    readonly updatedAt: number;
}
/**
 * Where this device stands: `signed-out`, `locked` (signed in, passphrase not yet given) or `ready`.
 * @public
 */
export type SyncStatus = 'signed-out' | 'locked' | 'ready';
/**
 * A device's view of one account. Documents are encrypted on the device; the provider sees only opaque names and
 * ciphertext. The account's passphrase is set by the first device that unlocks, and asked once on every other device.
 * @public
 */
export interface Sync {
    /** The provider's sign-in page. The host opens it and later hands the redirect's URL to `finishSignIn`. */
    signInUrl(): Promise<string>;
    /** Completes a sign-in from the URL the provider redirected to. Rejects with `sign-in-failed` on an error or a foreign state. */
    finishSignIn(callbackUrl: string): Promise<void>;
    /** Forgets this device's tokens and key. The account's files stay. */
    signOut(): Promise<void>;
    /** Reads this device's stored state only; it makes no network call. */
    status(): Promise<SyncStatus>;
    /** True when the account has no key yet, so `unlock` will set the passphrase rather than check it. */
    isNewAccount(): Promise<boolean>;
    /** Opens the account's key with `passphrase`, or creates it on a new account. Rejects with `wrong-passphrase`. */
    unlock(passphrase: string): Promise<void>;
    /** The documents another device changed since this device last pulled or pushed them. Files this key cannot open are skipped. */
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
 * Creates the sync engine for one provider. It needs WebCrypto and `fetch`, and nothing from React or phonux's panels.
 * @public
 */
export declare function createSync(options: SyncOptions): Sync;
