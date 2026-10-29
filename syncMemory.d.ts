/** An in-memory provider for tests and previews: the same conflict rules as a real app folder, with no network. */
import { type SyncProvider } from './syncTypes.js';
/**
 * A {@link SyncProvider} held in memory. Pass the same instance to two `createSync` calls to model two devices on one
 * account. Its OAuth endpoints are placeholders, so sign-in needs a `fetch` that answers the token request.
 * @public
 */
export declare function memorySyncProvider(): SyncProvider & {
    readonly files: ReadonlyMap<string, {
        rev: string;
        modifiedAt: number;
        bytes: Uint8Array;
    }>;
};
