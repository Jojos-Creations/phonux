import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import type { PhonuxLabels } from './labels.js';
import { QrCode } from './qrCode.js';
import { Avatar, BackIcon, MIN_TOUCH_PX, SegmentedTabs, WarningIcon } from './shareParts.js';

type View = 'numbers' | 'qr';

/** The safety code's digits cut into the groups of five it is read in. */
export function codeGroups(code: string): string[] {
  const digits = code.replace(/\D/g, '');
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) groups.push(digits.slice(i, i + 5));
  return groups;
}

export interface SafetyPageProps {
  name: string;
  /** What the page is for: a first check, or a key that changed since. */
  state: 'unchecked' | 'changed';
  code: string | undefined;
  labels: PhonuxLabels;
  /** Each action is drawn only when its callback is given. */
  onMatch: (() => void) | undefined;
  onMismatch: (() => void) | undefined;
  onAccept: (() => void) | undefined;
  /** Leaves the page; always drawn, as the back button and as Not now. */
  onBack: () => void;
}

const btn = { minHeight: 48, borderRadius: 4, textTransform: 'none', fontWeight: 600 } as const;

/** The full page that compares a safety code: the digits in 12 numbered groups or their QR code, and what to do about it. */
export function SafetyPage({ name, state, code, labels, onMatch, onMismatch, onAccept, onBack }: SafetyPageProps): React.ReactElement {
  const idPrefix = React.useId();
  const [view, setView] = React.useState<View>('numbers');
  const [mismatched, setMismatched] = React.useState(false);
  const changed = state === 'changed';
  const groups = code === undefined ? [] : codeGroups(code);
  const numbered = groups.map((digits, i) => ({ n: i + 1, digits }));
  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton aria-label={labels.shareBack} onClick={onBack} edge="start" sx={{ width: MIN_TOUCH_PX, height: MIN_TOUCH_PX }}>
          <BackIcon />
        </IconButton>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
          {changed ? labels.shareSafetyNewTitle : labels.shareSafetyTitle}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Avatar name={name} size={48} />
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
      </Box>
    </>
  );
  const frame = { display: 'flex', flexDirection: 'column', gap: 2, p: 2.5, color: 'text.primary' } as const;

  if (mismatched) {
    return (
      <Box sx={frame}>
        {header}
        <Typography role="status" sx={{ lineHeight: 1.45 }}>
          {labels.shareSafetyMismatchNote(name)}
        </Typography>
        <Button variant="contained" disableElevation onClick={onBack} sx={btn}>
          {labels.shareBack}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={frame}>
      {header}
      {changed ? (
        <Box
          role="alert"
          sx={(t: Theme) => ({ display: 'flex', gap: 1.25, p: 1.75, borderRadius: 3.5, bgcolor: alpha(t.palette.warning.main, 0.14), color: t.palette.mode === 'dark' ? t.palette.warning.light : t.palette.warning.dark })}
        >
          <WarningIcon aria-hidden="true" sx={{ color: 'warning.main', flexShrink: 0 }} />
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9375rem' }}>{labels.shareSafetyChangedTitle(name)}</Typography>
            <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
              {labels.shareSafetyChangedBody(name)}
            </Typography>
          </Box>
        </Box>
      ) : null}
      {groups.length === 0 ? (
        <Typography color="text.secondary" role="status">
          {labels.shareSafetyWaiting}
        </Typography>
      ) : (
        <>
          <SegmentedTabs
            name={labels.shareSafetyViewName}
            idPrefix={idPrefix}
            value={view}
            onChange={setView}
            tabs={[
              { id: 'numbers', label: labels.shareSafetyNumbers },
              { id: 'qr', label: labels.shareSafetyShowQr },
            ]}
          />
          <Box role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${view}`} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {view === 'numbers' ? (
              <Box
                component="ol"
                aria-label={labels.shareSafetyGroups(name)}
                sx={(t: Theme) => ({ listStyle: 'none', m: 0, py: 2.25, px: 1, borderRadius: 4, bgcolor: t.palette.action.hover, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', rowGap: 1.75, columnGap: 1 })}
              >
                {numbered.map(({ n, digits }) => (
                  <Box key={n} component="li" data-group={n} sx={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
                      {n}
                    </Typography>
                    <Typography component="span" sx={{ display: 'block', fontFamily: '"Roboto Mono", ui-monospace, "DejaVu Sans Mono", monospace', fontSize: 26, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                      {digits}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              // White whatever the theme: a QR code on a dark ground does not scan.
              <Box sx={{ alignSelf: 'center', bgcolor: '#fff', color: '#000', p: 1.5, borderRadius: 3.5, border: 1, borderColor: 'divider', display: 'flex' }}>
                <QrCode value={groups.join('')} label={labels.shareSafetyQrName(name)} size={236} />
              </Box>
            )}
            <Typography color="text.secondary" sx={{ fontSize: '0.9375rem', lineHeight: 1.45 }}>
              {view === 'numbers' ? labels.shareSafetyHowNumbers(name) : labels.shareSafetyHowQr(name)}
            </Typography>
          </Box>
        </>
      )}
      {changed ? (
        <>
          <Box sx={{ display: 'flex', gap: 1.25 }}>
            <Button variant="outlined" color="inherit" fullWidth onClick={onBack} sx={{ ...btn, borderColor: 'divider' }}>
              {labels.shareSafetyNotNow}
            </Button>
            {onAccept === undefined ? null : (
              <Button variant="contained" disableElevation fullWidth onClick={onAccept} disabled={groups.length === 0} sx={btn}>
                {labels.shareSafetyAccept}
              </Button>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" align="center">
            {labels.shareSafetyNotNowNote(name)}
          </Typography>
        </>
      ) : (
        <>
          {onMatch === undefined ? null : (
            <Button variant="contained" disableElevation onClick={onMatch} disabled={groups.length === 0} sx={btn}>
              {labels.shareSafetyMatch}
            </Button>
          )}
          {onMismatch === undefined ? null : (
            <Button
              variant="text"
              onClick={() => {
                onMismatch();
                setMismatched(true);
              }}
              sx={{ ...btn, minHeight: MIN_TOUCH_PX }}
            >
              {labels.shareSafetyMismatch}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}
