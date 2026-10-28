/** The sync engine: sign-in, the passphrase unlock, and newest-edit-wins pull and push of whole documents. */
import { authorizeUrl, exchangeCode, readJsonKv, refreshTokens } from './syncAuth.js';
import { b64url, dataKeys, fromB64url, fromUtf8, open, randomBytes, remoteName, seal, unwrapDataKey, utf8, wrapDataKey } from './syncCrypto.js';
import { SyncError } from './syncTypes.js';
const KEY_FILE = 'key.json';
// Refresh a little early so a token cannot expire between the check and the request.
const EXPIRY_MARGIN_MS = 60_000;
/**
 * Creates the sync engine for one provider. It needs WebCrypto and `fetch`, and nothing from React or phonux's panels.
 * @public
 */
export function createSync(options) {
    const { provider, kv, redirectUri } = options;
    const fetchFn = options.fetch ?? ((...a) => fetch(...a));
    const now = options.now ?? Date.now;
    const prefix = options.prefix ?? `sync:${provider.id}:`;
    const K = { tokens: `${prefix}tokens`, pending: `${prefix}pending`, key: `${prefix}key`, revs: `${prefix}revs` };
    let keys = null;
    const tokens = async () => {
        const t = await readJsonKv(kv, K.tokens);
        if (!t)
            throw new SyncError('signed-out', 'not signed in');
        return t;
    };
    const refresh = async (t) => {
        try {
            const fresh = await refreshTokens(fetchFn, provider.oauth, t);
            await kv.set(K.tokens, JSON.stringify(fresh));
            return fresh;
        }
        catch (e) {
            if (e instanceof SyncError && e.code === 'signed-out')
                await kv.set(K.tokens, '');
            throw e;
        }
    };
    const withToken = async (task) => {
        let t = await tokens();
        if (t.expiresAt - EXPIRY_MARGIN_MS < Date.now())
            t = await refresh(t);
        try {
            return await task(t.access);
        }
        catch (e) {
            if (!(e instanceof SyncError && e.code === 'unauthorized'))
                throw e;
            return task((await refresh(t)).access);
        }
    };
    const loadKeys = async () => {
        if (keys)
            return keys;
        const raw = await kv.get(K.key);
        if (!raw)
            throw new SyncError((await kv.get(K.tokens)) ? 'locked' : 'signed-out', 'sync is not unlocked on this device');
        keys = await dataKeys(fromB64url(raw));
        return keys;
    };
    const revs = async () => (await readJsonKv(kv, K.revs)) ?? {};
    const decode = async (k, remote, bytes) => {
        const plain = await open(k, remote, bytes);
        if (!plain)
            return null;
        const doc = JSON.parse(fromUtf8(plain));
        return typeof doc.name === 'string' && typeof doc.text === 'string' && typeof doc.updatedAt === 'number' ? doc : null;
    };
    return {
        signInUrl: () => authorizeUrl(provider.oauth, redirectUri, kv, K.pending),
        async finishSignIn(callbackUrl) {
            const t = await exchangeCode(fetchFn, provider.oauth, redirectUri, callbackUrl, kv, K.pending);
            await kv.set(K.tokens, JSON.stringify(t));
        },
        async signOut() {
            keys = null;
            for (const key of Object.values(K))
                await kv.set(key, '');
        },
        async status() {
            if (!(await kv.get(K.tokens)))
                return 'signed-out';
            return (await kv.get(K.key)) ? 'ready' : 'locked';
        },
        isNewAccount: () => withToken(async (token) => (await provider.read(token, KEY_FILE)) === null),
        async unlock(passphrase) {
            for (;;) {
                const file = await withToken((token) => provider.read(token, KEY_FILE));
                if (file) {
                    const raw = await unwrapDataKey(JSON.parse(fromUtf8(file.bytes)), passphrase);
                    if (!raw)
                        throw new SyncError('wrong-passphrase', 'that passphrase does not open this account');
                    await kv.set(K.key, b64url(raw));
                    keys = null;
                    return;
                }
                const raw = randomBytes(32);
                const body = utf8(JSON.stringify(await wrapDataKey(raw, passphrase)));
                try {
                    await withToken((token) => provider.write(token, KEY_FILE, body, null));
                }
                catch (e) {
                    // Another device created the key in the meantime: go round and open theirs instead.
                    if (e instanceof SyncError && e.code === 'conflict')
                        continue;
                    throw e;
                }
                await kv.set(K.key, b64url(raw));
                keys = null;
                return;
            }
        },
        async pull() {
            const k = await loadKeys();
            const seen = await revs();
            const entries = await withToken((token) => provider.list(token));
            const docs = [];
            for (const entry of entries) {
                if (!entry.name.endsWith('.doc') || seen[entry.name] === entry.rev)
                    continue;
                const file = await withToken((token) => provider.read(token, entry.name));
                if (!file)
                    continue;
                seen[file.name] = file.rev;
                const doc = await decode(k, file.name, file.bytes);
                if (doc)
                    docs.push(doc);
            }
            await kv.set(K.revs, JSON.stringify(seen));
            return docs;
        },
        async push({ name, text, updatedAt = now() }) {
            const k = await loadKeys();
            const remote = await remoteName(k, name);
            const bytes = await seal(k, remote, utf8(JSON.stringify({ name, text, updatedAt })));
            const seen = await revs();
            const record = async (rev) => {
                const latest = await revs();
                latest[remote] = rev;
                await kv.set(K.revs, JSON.stringify(latest));
            };
            try {
                await record(await withToken((token) => provider.write(token, remote, bytes, seen[remote] ?? null)));
                return null;
            }
            catch (e) {
                if (!(e instanceof SyncError && e.code === 'conflict'))
                    throw e;
            }
            const theirs = await withToken((token) => provider.read(token, remote));
            const theirDoc = theirs && (await decode(k, remote, theirs.bytes));
            if (theirs && theirDoc && theirDoc.updatedAt > updatedAt) {
                await record(theirs.rev);
                return theirDoc;
            }
            await record(await withToken((token) => provider.write(token, remote, bytes, theirs?.rev ?? null)));
            return null;
        },
    };
}
