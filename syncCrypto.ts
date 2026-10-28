/** WebCrypto only: PBKDF2 for the passphrase, AES-256-GCM for every file, HMAC for file names. */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 600_000;
const KEY_AAD = enc.encode('phonux-sync-key');
const ENVELOPE_V1 = 1;
const NONCE_BYTES = 12;

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => enc.encode(s);
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);
export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** The account's key file: the random data key, wrapped by a key derived from the passphrase. */
export interface KeyFile {
  v: 1;
  iterations: number;
  salt: string;
  nonce: string;
  wrapped: string;
}

async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapDataKey(raw: Uint8Array<ArrayBuffer>, passphrase: string): Promise<KeyFile> {
  const salt = randomBytes(16);
  const nonce = randomBytes(NONCE_BYTES);
  const kek = await passphraseKey(passphrase, salt, PBKDF2_ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: KEY_AAD }, kek, raw));
  return { v: 1, iterations: PBKDF2_ITERATIONS, salt: b64url(salt), nonce: b64url(nonce), wrapped: b64url(wrapped) };
}

/** Resolves null when the passphrase is wrong: GCM's tag fails, which is indistinguishable from a tampered file. */
export async function unwrapDataKey(file: KeyFile, passphrase: string): Promise<Uint8Array | null> {
  const kek = await passphraseKey(passphrase, fromB64url(file.salt), file.iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(file.nonce), additionalData: KEY_AAD }, kek, fromB64url(file.wrapped)));
  } catch {
    return null;
  }
}

/** The two working keys, split from the data key by HKDF so the name key never encrypts and the file key never names. */
export interface DataKeys {
  file: CryptoKey;
  name: CryptoKey;
}

export async function dataKeys(raw: Uint8Array<ArrayBuffer>): Promise<DataKeys> {
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const derive = (info: string, alg: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }, base, alg, false, usages);
  return {
    file: await derive('phonux-sync file', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    name: await derive('phonux-sync name', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
  };
}

/** The remote name of a logical document: the provider learns neither the app's names nor how they relate. */
export async function remoteName(keys: DataKeys, name: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.name, utf8(name)));
  return `${Array.from(mac.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')}.doc`;
}

// The remote name is bound in as AAD, so a file copied under another document's name fails to open.
export async function seal(keys: DataKeys, remote: string, plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8(remote) }, keys.file, plain));
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length);
  out[0] = ENVELOPE_V1;
  out.set(nonce, 1);
  out.set(ct, 1 + NONCE_BYTES);
  return out;
}

/** Resolves null for a file this key cannot open: an unknown envelope version, a tampered file, or another account's key. */
export async function open(keys: DataKeys, remote: string, sealed: Uint8Array): Promise<Uint8Array | null> {
  if (sealed[0] !== ENVELOPE_V1 || sealed.length < 1 + NONCE_BYTES) return null;
  try {
    const iv = sealed.slice(1, 1 + NONCE_BYTES);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(remote) }, keys.file, sealed.slice(1 + NONCE_BYTES)));
  } catch {
    return null;
  }
}
