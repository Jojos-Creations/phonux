import type { Fetch } from './syncHttp.js';
import { type SyncKv, type SyncOAuth } from './syncTypes.js';
export interface Tokens {
    access: string;
    refresh: string;
    /** Epoch ms. */
    expiresAt: number;
}
export declare function readJsonKv<T>(kv: SyncKv, key: string): Promise<T | null>;
export declare function authorizeUrl(oauth: SyncOAuth, redirectUri: string, kv: SyncKv, pendingKey: string): Promise<string>;
export declare function exchangeCode(fetchFn: Fetch, oauth: SyncOAuth, redirectUri: string, callbackUrl: string, kv: SyncKv, pendingKey: string): Promise<Tokens>;
export declare const refreshTokens: (fetchFn: Fetch, oauth: SyncOAuth, tokens: Tokens) => Promise<Tokens>;
