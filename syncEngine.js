/** The sync engine: sign-in, and newest-edit-wins pull and push of whole documents as readable files. */
import { authorizeUrl, exchangeCode, readJsonKv, refreshTokens } from './syncAuth.js';
import { fromUtf8, utf8 } from './syncBytes.js';
import { SyncError } from './syncTypes.js';
// Refresh a little early so a token cannot expire between the check and the request.
const EXPIRY_MARGIN_MS = 60_000;
/**
 * The file a host's `readme` text is written to, once, beside the documents. `pull` never returns it.
 * @public
 */
export const SYNC_README_FILE = 'README - DO NOT DELETE.txt';
// A document name becomes a file name the user can read; anything a provider might refuse is percent-encoded.
const fileOf = (name) => encodeURIComponent(name);
const nameOf = (file) => {
    try {
        return decodeURIComponent(file);
    }
    catch {
        return null;
    }
};
/**
 * Creates the sync engine for one provider. It needs `fetch` and WebCrypto, and nothing from React or phonux's panels.
 * @public
 */
export function createSync(options) {
    const { provider, kv, redirectUri, readme } = options;
    const fetchFn = options.fetch ?? ((...a) => fetch(...a));
    const now = options.now ?? Date.now;
    const prefix = options.prefix ?? `sync:${provider.id}:`;
    const K = { tokens: `${prefix}tokens`, pending: `${prefix}pending`, revs: `${prefix}revs` };
    let readmeChecked = false;
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
    const revs = async () => (await readJsonKv(kv, K.revs)) ?? {};
    const record = async (file, rev) => {
        const latest = await revs();
        latest[file] = rev;
        await kv.set(K.revs, JSON.stringify(latest));
    };
    const ensureReadme = async () => {
        if (readmeChecked || readme === undefined)
            return;
        try {
            await withToken((token) => provider.write(token, SYNC_README_FILE, utf8(readme), null, now()));
        }
        catch (e) {
            // Already there, from this device or another: leave the user's copy alone.
            if (!(e instanceof SyncError && e.code === 'conflict'))
                throw e;
        }
        readmeChecked = true;
    };
    return {
        signInUrl: () => authorizeUrl(provider.oauth, redirectUri, kv, K.pending),
        async finishSignIn(callbackUrl) {
            const t = await exchangeCode(fetchFn, provider.oauth, redirectUri, callbackUrl, kv, K.pending);
            await kv.set(K.tokens, JSON.stringify(t));
        },
        async signOut() {
            for (const key of Object.values(K))
                await kv.set(key, '');
        },
        status: async () => ((await kv.get(K.tokens)) ? 'ready' : 'signed-out'),
        async pull() {
            const seen = await revs();
            const entries = await withToken((token) => provider.list(token));
            const docs = [];
            for (const entry of entries) {
                const name = nameOf(entry.name);
                if (entry.name === SYNC_README_FILE || name === null || seen[entry.name] === entry.rev)
                    continue;
                const file = await withToken((token) => provider.read(token, entry.name));
                if (!file)
                    continue;
                seen[file.name] = file.rev;
                docs.push({ name, text: fromUtf8(file.bytes), updatedAt: file.modifiedAt });
            }
            await kv.set(K.revs, JSON.stringify(seen));
            return docs;
        },
        async push({ name, text, updatedAt = now() }) {
            await ensureReadme();
            const file = fileOf(name);
            const bytes = utf8(text);
            const seen = await revs();
            try {
                await record(file, await withToken((token) => provider.write(token, file, bytes, seen[file] ?? null, updatedAt)));
                return null;
            }
            catch (e) {
                if (!(e instanceof SyncError && e.code === 'conflict'))
                    throw e;
            }
            const theirs = await withToken((token) => provider.read(token, file));
            // Dropbox keeps whole seconds, so an edit is newer only by a later second.
            if (theirs && Math.floor(theirs.modifiedAt / 1000) > Math.floor(updatedAt / 1000)) {
                await record(file, theirs.rev);
                return { name, text: fromUtf8(theirs.bytes), updatedAt: theirs.modifiedAt };
            }
            await record(file, await withToken((token) => provider.write(token, file, bytes, theirs?.rev ?? null, updatedAt)));
            return null;
        },
    };
}
