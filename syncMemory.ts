/** An in-memory provider for tests and previews: the same conflict rules as a real app folder, with no network. */
import { SyncError, type SyncProvider } from './syncTypes.js';

/**
 * A {@link SyncProvider} held in memory. Pass the same instance to two `createSync` calls to model two devices on one
 * account. Its OAuth endpoints are placeholders, so sign-in needs a `fetch` that answers the token request.
 * @public
 */
export function memorySyncProvider(): SyncProvider & { readonly files: ReadonlyMap<string, { rev: string; bytes: Uint8Array }> } {
  const files = new Map<string, { rev: string; bytes: Uint8Array }>();
  let next = 1;
  return {
    id: 'memory',
    oauth: { authorizeUrl: 'https://sync.invalid/authorize', tokenUrl: 'https://sync.invalid/token', clientId: 'memory' },
    files,
    async list() {
      return [...files].map(([name, f]) => ({ name, rev: f.rev }));
    },
    async read(_token, name) {
      const f = files.get(name);
      return f ? { name, rev: f.rev, bytes: f.bytes.slice() } : null;
    },
    async write(_token, name, bytes, ifRev) {
      if ((files.get(name)?.rev ?? null) !== ifRev) throw new SyncError('conflict', `${name} changed on another device`);
      const rev = `r${next++}`;
      files.set(name, { rev, bytes: bytes.slice() });
      return rev;
    },
  };
}
