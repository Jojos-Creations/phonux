/** The sync engine: sign-in, the passphrase unlock, and newest-edit-wins pull and push of whole documents. */
import { authorizeUrl, exchangeCode, readJsonKv, refreshTokens, type Tokens } from './syncAuth.js';
import { type DataKeys, type KeyFile, b64url, dataKeys, fromB64url, fromUtf8, open, randomBytes, remoteName, seal, unwrapDataKey, utf8, wrapDataKey } from './syncCrypto.js';
import type { Fetch } from './syncHttp.js';
import { SyncError, type SyncKv, type SyncProvider } from './syncTypes.js';

const KEY_FILE = 'key.json';
// Refresh a little early so a token cannot expire between the check and the request.
const EXPIRY_MARGIN_MS = 60_000;

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
  push(doc: { name: string; text: string; updatedAt?: number }): Promise<SyncDoc | null>;
}

/**
 * Creates the sync engine for one provider. It needs WebCrypto and `fetch`, and nothing from React or phonux's panels.
 * @public
 */
export function createSync(options: SyncOptions): Sync {
  const { provider, kv, redirectUri } = options;
  const fetchFn: Fetch = options.fetch ?? ((...a) => fetch(...a));
  const now = options.now ?? Date.now;
  const prefix = options.prefix ?? `sync:${provider.id}:`;
  const K = { tokens: `${prefix}tokens`, pending: `${prefix}pending`, key: `${prefix}key`, revs: `${prefix}revs` };
  let keys: DataKeys | null = null;

  const tokens = async (): Promise<Tokens> => {
    const t = await readJsonKv<Tokens>(kv, K.tokens);
    if (!t) throw new SyncError('signed-out', 'not signed in');
    return t;
  };
  const refresh = async (t: Tokens): Promise<Tokens> => {
    try {
      const fresh = await refreshTokens(fetchFn, provider.oauth, t);
      await kv.set(K.tokens, JSON.stringify(fresh));
      return fresh;
    } catch (e) {
      if (e instanceof SyncError && e.code === 'signed-out') await kv.set(K.tokens, '');
      throw e;
    }
  };
  const withToken = async <T>(task: (token: string) => Promise<T>): Promise<T> => {
    let t = await tokens();
    if (t.expiresAt - EXPIRY_MARGIN_MS < Date.now()) t = await refresh(t);
    try {
      return await task(t.access);
    } catch (e) {
      if (!(e instanceof SyncError && e.code === 'unauthorized')) throw e;
      return task((await refresh(t)).access);
    }
  };

  const loadKeys = async (): Promise<DataKeys> => {
    if (keys) return keys;
    const raw = await kv.get(K.key);
    if (!raw) throw new SyncError((await kv.get(K.tokens)) ? 'locked' : 'signed-out', 'sync is not unlocked on this device');
    keys = await dataKeys(fromB64url(raw));
    return keys;
  };
  const revs = async (): Promise<Record<string, string>> => (await readJsonKv<Record<string, string>>(kv, K.revs)) ?? {};
  const decode = async (k: DataKeys, remote: string, bytes: Uint8Array): Promise<SyncDoc | null> => {
    const plain = await open(k, remote, bytes);
    if (!plain) return null;
    const doc = JSON.parse(fromUtf8(plain)) as SyncDoc;
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
      for (const key of Object.values(K)) await kv.set(key, '');
    },
    async status() {
      if (!(await kv.get(K.tokens))) return 'signed-out';
      return (await kv.get(K.key)) ? 'ready' : 'locked';
    },
    isNewAccount: () => withToken(async (token) => (await provider.read(token, KEY_FILE)) === null),
    async unlock(passphrase) {
      for (;;) {
        const file = await withToken((token) => provider.read(token, KEY_FILE));
        if (file) {
          const raw = await unwrapDataKey(JSON.parse(fromUtf8(file.bytes)) as KeyFile, passphrase);
          if (!raw) throw new SyncError('wrong-passphrase', 'that passphrase does not open this account');
          await kv.set(K.key, b64url(raw));
          keys = null;
          return;
        }
        const raw = randomBytes(32);
        const body = utf8(JSON.stringify(await wrapDataKey(raw, passphrase)));
        try {
          await withToken((token) => provider.write(token, KEY_FILE, body, null));
        } catch (e) {
          // Another device created the key in the meantime: go round and open theirs instead.
          if (e instanceof SyncError && e.code === 'conflict') continue;
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
      const docs: SyncDoc[] = [];
      for (const entry of entries) {
        if (!entry.name.endsWith('.doc') || seen[entry.name] === entry.rev) continue;
        const file = await withToken((token) => provider.read(token, entry.name));
        if (!file) continue;
        seen[file.name] = file.rev;
        const doc = await decode(k, file.name, file.bytes);
        if (doc) docs.push(doc);
      }
      await kv.set(K.revs, JSON.stringify(seen));
      return docs;
    },
    async push({ name, text, updatedAt = now() }) {
      const k = await loadKeys();
      const remote = await remoteName(k, name);
      const bytes = await seal(k, remote, utf8(JSON.stringify({ name, text, updatedAt })));
      const seen = await revs();
      const record = async (rev: string) => {
        const latest = await revs();
        latest[remote] = rev;
        await kv.set(K.revs, JSON.stringify(latest));
      };
      try {
        await record(await withToken((token) => provider.write(token, remote, bytes, seen[remote] ?? null)));
        return null;
      } catch (e) {
        if (!(e instanceof SyncError && e.code === 'conflict')) throw e;
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
