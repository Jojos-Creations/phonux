/** OAuth 2 with PKCE: no client secret to keep and no server of our own, so it runs in a page or an Electron renderer. */
import { b64url, randomBytes, sha256, utf8 } from './syncBytes.js';
import { SyncError } from './syncTypes.js';
export async function readJsonKv(kv, key) {
    const text = await kv.get(key);
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
export async function authorizeUrl(oauth, redirectUri, kv, pendingKey) {
    const pending = { state: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)) };
    await kv.set(pendingKey, JSON.stringify(pending));
    const params = new URLSearchParams({
        client_id: oauth.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        state: pending.state,
        code_challenge: b64url(await sha256(utf8(pending.verifier))),
        code_challenge_method: 'S256',
        ...(oauth.scope ? { scope: oauth.scope } : {}),
        ...oauth.authorizeParams,
    });
    return `${oauth.authorizeUrl}?${params}`;
}
async function tokenRequest(fetchFn, oauth, fields, previousRefresh = '') {
    const body = new URLSearchParams({ client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}), ...fields });
    const res = await fetchFn(oauth.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    // 400 and 401 here mean the grant itself is dead (revoked, expired, reused): only a new sign-in recovers.
    if (res.status === 400 || res.status === 401)
        throw new SyncError('signed-out', `token request refused: ${await res.text().catch(() => '')}`, res.status);
    if (!res.ok)
        throw new SyncError('http', `token request failed: HTTP ${res.status}`, res.status);
    const t = (await res.json());
    // Google omits refresh_token on a refresh; the old one stays valid.
    return { access: t.access_token, refresh: t.refresh_token ?? previousRefresh, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
}
export async function exchangeCode(fetchFn, oauth, redirectUri, callbackUrl, kv, pendingKey) {
    const pending = await readJsonKv(kv, pendingKey);
    await kv.set(pendingKey, '');
    const params = new URL(callbackUrl).searchParams;
    const error = params.get('error');
    if (error)
        throw new SyncError('sign-in-failed', `provider said ${error}: ${params.get('error_description') ?? ''}`.trim());
    const code = params.get('code');
    if (!pending || !code || params.get('state') !== pending.state)
        throw new SyncError('sign-in-failed', 'this sign-in was not started on this device');
    const tokens = await tokenRequest(fetchFn, oauth, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: pending.verifier });
    if (!tokens.refresh)
        throw new SyncError('sign-in-failed', 'the provider returned no refresh token');
    return tokens;
}
export const refreshTokens = (fetchFn, oauth, tokens) => tokenRequest(fetchFn, oauth, { grant_type: 'refresh_token', refresh_token: tokens.refresh }, tokens.refresh);
