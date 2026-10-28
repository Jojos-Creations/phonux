/**
 * The contracts of `phonux/sync`: what a host supplies (a device store), what a provider implements, and the one
 * error type. Nothing here knows an app's data shape.
 */

/**
 * A string key-value store on the device, where sync keeps its sign-in tokens, unlocked key and last-seen revisions.
 * An empty string reads the same as a missing key.
 * @public
 */
export interface SyncKv {
  /** The stored value, or undefined. */
  get(key: string): Promise<string | undefined>;
  /** Stores `value`; an empty string clears the key. */
  set(key: string, value: string): Promise<void>;
}

/**
 * The OAuth 2 endpoints and client a provider signs in with. Sign-in always uses PKCE.
 * @public
 */
export interface SyncOAuth {
  /** The provider's authorization endpoint. */
  readonly authorizeUrl: string;
  /** The provider's token endpoint, which must allow cross-origin requests. */
  readonly tokenUrl: string;
  /** The app's public client id at the provider. */
  readonly clientId: string;
  /** Sent with token requests only where the provider requires one from public clients (Google). It is not a secret. */
  readonly clientSecret?: string;
  /** The space-separated scopes; absent uses the app's configured permissions. */
  readonly scope?: string;
  /** Extra query parameters for the authorize URL, such as the one that asks for a refresh token. */
  readonly authorizeParams?: Readonly<Record<string, string>>;
}

/**
 * One file in the provider's app folder, by name, with the provider's opaque revision.
 * @public
 */
export interface SyncRemoteEntry {
  /** The file's name in the app folder. */
  readonly name: string;
  /** The provider's revision, compared only for equality. */
  readonly rev: string;
}

/**
 * A remote file's bytes and revision.
 * @public
 */
export interface SyncRemoteFile extends SyncRemoteEntry {
  /** The file's whole content. */
  readonly bytes: Uint8Array;
}

/**
 * A storage provider: an app folder that lists, reads and writes whole files. Every call gets a current access token.
 * @public
 */
export interface SyncProvider {
  /** A stable id such as `dropbox`, used in the host's own storage keys. */
  readonly id: string;
  /** How the provider signs in. */
  readonly oauth: SyncOAuth;
  /** Every file in the app folder. */
  list(token: string): Promise<SyncRemoteEntry[]>;
  /** Resolves null when the file does not exist. */
  read(token: string, name: string): Promise<SyncRemoteFile | null>;
  /**
   * Writes the whole file and resolves its new revision. It rejects with a `conflict` {@link SyncError} when the
   * remote revision is not `ifRev`; an `ifRev` of null means the file must not exist yet.
   */
  write(token: string, name: string, bytes: Uint8Array<ArrayBuffer>, ifRev: string | null): Promise<string>;
}

/**
 * What went wrong, as a {@link SyncError} carries it.
 * - `signed-out`: no account, or the provider revoked the sign-in.
 * - `locked`: signed in, but this device has not been given the passphrase.
 * - `wrong-passphrase`: the passphrase does not open the account's key.
 * - `conflict`: another device wrote the file first.
 * - `unauthorized`: the access token was refused; sync refreshes it once before reporting this.
 * - `sign-in-failed`: the provider's redirect carried an error or a state this device did not start.
 * - `http`: any other provider failure; `status` holds the HTTP status.
 * @public
 */
export type SyncErrorCode = 'signed-out' | 'locked' | 'wrong-passphrase' | 'conflict' | 'unauthorized' | 'sign-in-failed' | 'http';

/**
 * The only error sync throws on purpose. Network failures from `fetch` pass through unchanged.
 * @public
 */
export class SyncError extends Error {
  /** Which failure this is. */
  readonly code: SyncErrorCode;
  /** The HTTP status, where a provider response caused it. */
  readonly status: number | undefined;
  constructor(code: SyncErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}
