/** The sync engine: sign-in, and newest-edit-wins pull and push of whole documents as readable files. */
import { authorizeUrl, exchangeCode, readJsonKv, refreshTokens, type Tokens } from './syncAuth.js';
import { fromUtf8, utf8 } from './syncBytes.js';
import type { Fetch } from './syncHttp.js';
import { SyncError, type SyncKv, type SyncProvider } from './syncTypes.js';

// Refresh a little early so a token cannot expire between the check and the request.
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The file a host's `readme` text is written to, once, beside the documents. `pull` never returns it.
 * @public
 */
export const SYNC_README_FILE = 'README - DO NOT DELETE.txt';

// A document name becomes a file name the user can read; anything a provider might refuse is percent-encoded.
const fileOf = (name: string): string => encodeURIComponent(name);
const nameOf = (file: string): string | null => {
  try {
    return decodeURIComponent(file);
  } catch {
    return null;
  }
};

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
  /** Text for {@link SYNC_README_FILE}, written beside the documents on the first push when the file is missing. */
  readonly readme?: string;
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
  /** The app's own name for the document, unique within the account. It is also the file's name, percent-encoded. */
  readonly name: string;
  /** The document's content, stored as the file's content unchanged. */
  readonly text: string;
  /** Epoch ms of the edit. The newer of two edits wins. */
  readonly updatedAt: number;
}

/**
 * Where this device stands: `signed-out` or `ready`.
 * @public
 */
export type SyncStatus = 'signed-out' | 'ready';

/**
 * A device's view of one account. Each document is one plain file in the provider's app folder, so the folder is
 * also a backup the user can read.
 * @public
 */
export interface Sync {
  /** The provider's sign-in page. The host opens it and later hands the redirect's URL to `finishSignIn`. */
  signInUrl(): Promise<string>;
  /** Completes a sign-in from the URL the provider redirected to. Rejects with `sign-in-failed` on an error or a foreign state. */
  finishSignIn(callbackUrl: string): Promise<void>;
  /** Forgets this device's tokens. The account's files stay. */
  signOut(): Promise<void>;
  /** Reads this device's stored state only; it makes no network call. */
  status(): Promise<SyncStatus>;
  /** The documents another device changed since this device last pulled or pushed them. */
  pull(): Promise<SyncDoc[]>;
  /**
   * Uploads one document. When another device saved a newer edit of it first, nothing is uploaded and that edit is
   * returned for the host to apply; otherwise resolves null.
   */
  push(doc: { name: string; text: string; updatedAt?: number }): Promise<SyncDoc | null>;
}

/**
 * Creates the sync engine for one provider. It needs `fetch` and WebCrypto, and nothing from React or phonux's panels.
 * @public
 */
export function createSync(options: SyncOptions): Sync {
  const { provider, kv, redirectUri, readme } = options;
  const fetchFn: Fetch = options.fetch ?? ((...a) => fetch(...a));
  const now = options.now ?? Date.now;
  const prefix = options.prefix ?? `sync:${provider.id}:`;
  const K = { tokens: `${prefix}tokens`, pending: `${prefix}pending`, revs: `${prefix}revs` };
  let readmeChecked = false;

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
  const revs = async (): Promise<Record<string, string>> => (await readJsonKv<Record<string, string>>(kv, K.revs)) ?? {};
  const record = async (file: string, rev: string) => {
    const latest = await revs();
    latest[file] = rev;
    await kv.set(K.revs, JSON.stringify(latest));
  };
  const ensureReadme = async () => {
    if (readmeChecked || readme === undefined) return;
    try {
      await withToken((token) => provider.write(token, SYNC_README_FILE, utf8(readme), null, now()));
    } catch (e) {
      // Already there, from this device or another: leave the user's copy alone.
      if (!(e instanceof SyncError && e.code === 'conflict')) throw e;
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
      for (const key of Object.values(K)) await kv.set(key, '');
    },
    status: async () => ((await kv.get(K.tokens)) ? 'ready' : 'signed-out'),
    async pull() {
      const seen = await revs();
      const entries = await withToken((token) => provider.list(token));
      const docs: SyncDoc[] = [];
      for (const entry of entries) {
        const name = nameOf(entry.name);
        if (entry.name === SYNC_README_FILE || name === null || seen[entry.name] === entry.rev) continue;
        const file = await withToken((token) => provider.read(token, entry.name));
        if (!file) continue;
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
      } catch (e) {
        if (!(e instanceof SyncError && e.code === 'conflict')) throw e;
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
