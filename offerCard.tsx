import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { PhonuxLabels } from './labels.js';
import { Avatar, ItemHeader, MIN_TOUCH_PX, daysUntil, formatFileSize, useShareLabels, type ShareItem } from './shareParts.js';

/** What an offer says about a file, in the older form: `item` with kind `file` says the same.  It is all text: nothing of the file's content, not even a thumbnail, is drawn before it is accepted. @public */
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
  /** What is offered, of any kind. Wins over `file`. */
  item?: ShareItem;
  /** The offered file, for apps that predate `item`; read as an item of kind `file` whose subtitle is its type and size. */
  file?: OfferFile;
  /** Epoch milliseconds the offer goes away at; written as whole days left, at least one. */
  expiresAt: number;
  /** Called when the main button, `Add to my` and the kind in the plural, is pressed. */
  onAccept: () => void;
  /** The main button's words, such as `Add to my spaces`; defaults to the sheet's label for the item's kind. */
  acceptLabel?: string;
  /** Called when Not now is pressed, which leaves the offer waiting; without it the button is not drawn. */
  onNotNow?: () => void;
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
 * The card that asks whether to add an item someone on the user's trusted list shared, of any kind: who, which item, the
 * promise that nothing downloads first, and the buttons Add, Not now, Decline and Report. It draws no frame or backdrop, so the app places it in its own bottom sheet.
 * @remarks It never renders an image of the file or of the sender; the avatar is a letter.
 * @public
 */
export function OfferCard(props: OfferCardProps): React.ReactElement {
  const { from } = props;
  const labels = useShareLabels(props.labels);
  const days = daysUntil(props.expiresAt, props.now ?? Date.now());
  const item: ShareItem = props.item ?? {
    kind: 'file',
    name: props.file?.name ?? '',
    subtitle: props.file === undefined ? undefined : `${props.file.type}, ${formatFileSize(props.file.size)}`,
  };
  const kind = labels.shareKind(item.kind);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, p: 3, color: 'text.primary' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar name={from} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {labels.offerTitle(from, kind)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {labels.offerTrusted(from)}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ p: 1.75, border: 1, borderColor: 'divider', borderRadius: 3.5 }}>
        <ItemHeader item={item} size={44} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
        {labels.offerNote(days)}
      </Typography>
      <Button variant="contained" disableElevation onClick={props.onAccept} sx={{ minHeight: 52, borderRadius: 3.5, fontSize: '1rem', fontWeight: 600, textTransform: 'none' }}>
        {props.acceptLabel ?? labels.offerAccept(labels.shareKindPlural(item.kind))}
      </Button>
      <Box sx={{ display: 'flex', gap: 1.25 }}>
        {props.onNotNow === undefined ? null : (
          <Button variant="outlined" color="inherit" fullWidth onClick={props.onNotNow} sx={{ minHeight: MIN_TOUCH_PX, borderRadius: 3, borderColor: 'divider', fontWeight: 600, textTransform: 'none' }}>
            {labels.offerNotNow}
          </Button>
        )}
        <Button variant="outlined" color="inherit" fullWidth onClick={props.onDecline} sx={{ minHeight: MIN_TOUCH_PX, borderRadius: 3, borderColor: 'divider', fontWeight: 600, textTransform: 'none' }}>
          {labels.offerDecline}
        </Button>
      </Box>
      <Button variant="text" color="error" onClick={props.onReport} sx={{ alignSelf: 'center', minHeight: MIN_TOUCH_PX, minWidth: MIN_TOUCH_PX, fontWeight: 600, textTransform: 'none' }}>
        {labels.offerReport}
      </Button>
    </Box>
  );
}
