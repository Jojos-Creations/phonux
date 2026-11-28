import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { OfferCard, QrCode, ShareSheet } from '../../index';
import type { ShareItem, ShareMember } from '../../index';

// One share view, drawn for a space, a playlist and the incoming offer; the hash picks the scene.
const noop = (): void => {};
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const theme = createTheme({ palette: { mode: dark ? 'dark' : 'light', primary: { main: dark ? '#6aa8f5' : '#1976d2' } } });

const items: Record<string, ShareItem> = {
  space: { kind: 'space', name: 'Trip to Lisbon', subtitle: 'Space, 3 tabs' },
  playlist: { kind: 'playlist', name: 'Road trip songs', subtitle: 'Playlist, 24 tracks' },
};
const NOW = Date.now();
const CODE = '19896 56652 89711 42431 13353 29651 69207 07134 80072 66512 41361 36167';
const NEW_CODE = '40217 88130 05946 71352 29864 13075 66291 80443 17509 32688 95120 04731';
const safetyScenes: Record<string, ShareMember['safety']> = {
  safety: { state: 'unchecked', code: CODE },
  'safety-checked': { state: 'checked', code: CODE },
  'safety-changed': { state: 'changed', code: NEW_CODE },
};
const members = (safety: ShareMember['safety']): ShareMember[] => [
  { id: 'me', name: 'You', role: 'owner', you: true },
  { id: 'ann', name: 'ann@example.com', role: 'edit' },
  { id: 'bo', name: 'bo@example.com', role: 'edit', joined: false },
  ...(safety === undefined ? [] : [{ id: 'maya', name: 'Maya', role: 'edit' as const, safety }]),
  { id: 'dana', name: 'dana.okafor@example.com', role: 'edit', status: 'left', since: NOW - 3 * 86_400_000 },
  { id: 'marcus', name: 'marcus.webb@example.org', role: 'view', status: 'declined', since: NOW - 5 * 86_400_000 },
];

document.body.style.fontFamily = 'Roboto, Helvetica, Arial, sans-serif';
document.body.style.background = theme.palette.background.default;

const scene = window.location.hash.slice(1) || 'space';
const item = items[scene === 'offer' || scene in safetyScenes ? 'space' : scene] ?? items.space!;
const safety = safetyScenes[scene];

createRoot(document.body.appendChild(document.createElement('div'))).render(
  <ThemeProvider theme={theme}>
    <div style={{ width: 390, margin: '0 auto', background: theme.palette.background.default, color: theme.palette.text.primary }}>
      {scene === 'offer' ? (
        <OfferCard from="sam@example.com" item={item} expiresAt={Date.now() + 7 * 86_400_000} onAccept={noop} onNotNow={noop} onDecline={noop} onReport={noop} />
      ) : (
        <ShareSheet item={item} qr={<QrCode value="https://example.com/s/abc" />} members={members(safety)} people={safety === undefined ? [{ id: 'maya', name: 'Maya' }] : []} onInvite={noop} onChangeRole={noop} onRemove={noop} onInviteAgain={noop} onSafetyCodeOpen={noop} onSafetyCodeMatch={noop} onSafetyCodeMismatch={noop} onAcceptNewKey={noop} onSend={noop} onAddPerson={noop} onCopyLink={noop} onClose={noop} />
      )}
    </div>
  </ThemeProvider>,
);
