/** WebCrypto only: PBKDF2 for the passphrase, AES-256-GCM for every file, HMAC for file names. */
export declare const PBKDF2_ITERATIONS = 600000;
export declare const utf8: (s: string) => Uint8Array<ArrayBuffer>;
export declare const fromUtf8: (b: Uint8Array) => string;
export declare const randomBytes: (n: number) => Uint8Array<ArrayBuffer>;
export declare function b64url(bytes: Uint8Array): string;
export declare function fromB64url(text: string): Uint8Array<ArrayBuffer>;
export declare function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
/** The account's key file: the random data key, wrapped by a key derived from the passphrase. */
export interface KeyFile {
    v: 1;
    iterations: number;
    salt: string;
    nonce: string;
    wrapped: string;
}
export declare function wrapDataKey(raw: Uint8Array<ArrayBuffer>, passphrase: string): Promise<KeyFile>;
/** Resolves null when the passphrase is wrong: GCM's tag fails, which is indistinguishable from a tampered file. */
export declare function unwrapDataKey(file: KeyFile, passphrase: string): Promise<Uint8Array | null>;
/** The two working keys, split from the data key by HKDF so the name key never encrypts and the file key never names. */
export interface DataKeys {
    file: CryptoKey;
    name: CryptoKey;
}
export declare function dataKeys(raw: Uint8Array<ArrayBuffer>): Promise<DataKeys>;
/** The remote name of a logical document: the provider learns neither the app's names nor how they relate. */
export declare function remoteName(keys: DataKeys, name: string): Promise<string>;
export declare function seal(keys: DataKeys, remote: string, plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
/** Resolves null for a file this key cannot open: an unknown envelope version, a tampered file, or another account's key. */
export declare function open(keys: DataKeys, remote: string, sealed: Uint8Array): Promise<Uint8Array | null>;
