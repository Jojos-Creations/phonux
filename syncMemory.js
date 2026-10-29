/** An in-memory provider for tests and previews: the same conflict rules as a real app folder, with no network. */
import { SyncError } from './syncTypes.js';
/**
 * A {@link SyncProvider} held in memory. Pass the same instance to two `createSync` calls to model two devices on one
 * account. Its OAuth endpoints are placeholders, so sign-in needs a `fetch` that answers the token request.
 * @public
 */
export function memorySyncProvider() {
    const files = new Map();
    let next = 1;
    return {
        id: 'memory',
        oauth: { authorizeUrl: 'https://sync.invalid/authorize', tokenUrl: 'https://sync.invalid/token', clientId: 'memory' },
        files,
        async list() {
            return [...files].map(([name, f]) => ({ name, rev: f.rev, modifiedAt: f.modifiedAt }));
        },
        async read(_token, name) {
            const f = files.get(name);
            return f ? { name, rev: f.rev, modifiedAt: f.modifiedAt, bytes: f.bytes.slice() } : null;
        },
        async write(_token, name, bytes, ifRev, modifiedAt) {
            if ((files.get(name)?.rev ?? null) !== ifRev)
                throw new SyncError('conflict', `${name} changed on another device`);
            const rev = `r${next++}`;
            files.set(name, { rev, modifiedAt, bytes: bytes.slice() });
            return rev;
        },
    };
}
