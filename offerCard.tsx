import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { PhonuxLabels } from './labels.js';
import { Avatar, FileIcon, GlyphTile, MIN_TOUCH_PX, daysUntil, formatFileSize, useShareLabels } from './shareParts.js';

/** What an offer says about the file. It is all text: nothing of the file's content, not even a thumbnail, is drawn before it is accepted. @public */
export interface OfferFile {
  /** The file name. */
  name: string;
  /** The kind of file in words the app chose, such as `ZIP archive`. */
  type: string;
  /** Size in bytes; written in decimal units, such as `48 MB`. */
  size: number;
}

/** What `OfferCard` takes. @public */
export interface OfferCardProps {
  /** The name the user saved for the sender; drawn as plain text, and its first letter is the avatar. */
  from: string;
  /** The offered file. */
  file: OfferFile;
  /** Epoch milliseconds the offer goes away at; written as whole days left, at least one. */
  expiresAt: number;
  /** Called when "Accept and save" is pressed. */
  onAccept: () => void;
  /** Called when Decline is pressed. */
  onDecline: () => void;
  /** Called when Report is pressed. */
  onReport: () => void;
  /** Words that replace the host's labels for this card only. */
  labels?: Partial<PhonuxLabels>;
  /** Epoch milliseconds the days left are counted from. Defaults to the current time. */
  now?: number;
}

/**
 * The card that asks whether to accept a file from someone on the user's trusted list: who, which file, and three
 * buttons. It draws no frame or backdrop, so the app places it in its own bottom sheet.
 * @remarks It never renders an image of the file or of the sender; the avatar is a letter.
 * @public
 */
export function OfferCard(props: OfferCardProps): React.ReactElement {
  const { from, file } = props;
  const labels = useShareLabels(props.labels);
  const days = daysUntil(props.expiresAt, props.now ?? Date.now());
  const size = formatFileSize(file.size);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, p: 3, color: 'text.primary' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar name={from} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {labels.offerTitle(from)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {labels.offerTrusted(from)}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.75, border: 1, borderColor: 'divider', borderRadius: 3.5 }}>
        <GlyphTile size={44}>
          <FileIcon />
        </GlyphTile>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.name}</Typography>
          <Typography variant="body2" color="text.secondary">{`${file.type}, ${size}`}</Typography>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
        {labels.offerNote(days)}
      </Typography>
      <Button variant="contained" disableElevation onClick={props.onAccept} sx={{ minHeight: 52, borderRadius: 3.5, fontSize: '1rem', fontWeight: 600, textTransform: 'none' }}>
        {labels.offerAccept}
      </Button>
      <Box sx={{ display: 'flex', gap: 1.25 }}>
        <Button variant="outlined" color="inherit" fullWidth onClick={props.onDecline} sx={{ minHeight: MIN_TOUCH_PX, borderRadius: 3, borderColor: 'divider', fontWeight: 600, textTransform: 'none' }}>
          {labels.offerDecline}
        </Button>
        <Button variant="outlined" color="error" fullWidth onClick={props.onReport} sx={{ minHeight: MIN_TOUCH_PX, borderRadius: 3, borderColor: 'divider', fontWeight: 600, textTransform: 'none' }}>
          {labels.offerReport}
        </Button>
      </Box>
    </Box>
  );
}
