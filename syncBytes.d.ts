/** Byte helpers for PKCE: random values, SHA-256 and base64url, from WebCrypto only. */
export declare const utf8: (s: string) => Uint8Array<ArrayBuffer>;
export declare const fromUtf8: (b: Uint8Array) => string;
export declare const randomBytes: (n: number) => Uint8Array<ArrayBuffer>;
export declare function b64url(bytes: Uint8Array): string;
export declare function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
