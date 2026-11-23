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
const members: ShareMember[] = [
  { id: 'me', name: 'You', role: 'owner', you: true },
  { id: 'ann', name: 'ann@example.com', role: 'edit' },
  { id: 'bo', name: 'bo@example.com', role: 'edit', joined: false },
];

document.body.style.fontFamily = 'Roboto, Helvetica, Arial, sans-serif';
document.body.style.background = theme.palette.background.default;

const scene = window.location.hash.slice(1) || 'space';
const item = items[scene === 'offer' ? 'space' : scene] ?? items.space!;

createRoot(document.body.appendChild(document.createElement('div'))).render(
  <ThemeProvider theme={theme}>
    <div style={{ width: 390, margin: '0 auto', background: theme.palette.background.default, color: theme.palette.text.primary }}>
      {scene === 'offer' ? (
        <OfferCard from="sam@example.com" item={item} expiresAt={Date.now() + 7 * 86_400_000} onAccept={noop} onNotNow={noop} onDecline={noop} onReport={noop} />
      ) : (
        <ShareSheet item={item} qr={<QrCode value="https://example.com/s/abc" />} members={members} people={[{ id: 'maya', name: 'Maya' }]} onInvite={noop} onChangeRole={noop} onRemove={noop} onSend={noop} onAddPerson={noop} onCopyLink={noop} onClose={noop} />
      )}
    </div>
  </ThemeProvider>,
);
