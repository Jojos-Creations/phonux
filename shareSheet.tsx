import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { PhonuxLabels } from './labels.js';
import { AddIcon, Avatar, BackIcon, CheckIcon, MIN_TOUCH_PX, SegmentedTabs, daysUntil, formatFileSize, useShareLabels, useTabState } from './shareParts.js';

/** The tab a `ShareSheet` shows: `nearby` is the QR code, `people` the trusted people, `link` the web link. @public */
export type ShareTab = 'nearby' | 'people' | 'link';

/** The file being shared. @public */
export interface ShareFile {
  /** The file name shown in the sheet's header. */
  name: string;
  /** Size in bytes; the sheet writes it in decimal units, such as `48 MB`. */
  size: number;
}

/** A person the user trusts and can send to. @public */
export interface SharePerson {
  /** Identifies the person in `onSend` and `sentTo`. */
  id: string;
  /** The name the user saved for them; drawn as text only, and its first letter is the avatar. */
  name: string;
}

/** When the web link stops working. Leave a field out for no such limit. @public */
export interface ShareLinkInfo {
  /** Epoch milliseconds the link ends at; the sheet says it as whole days left, at least one. */
  expiresAt?: number;
  /** How many opens the link allows. */
  maxOpens?: number;
}

/** What `ShareSheet` takes. `onSend` and `onCopyLink` are required; every other callback is optional, and a control whose callback is missing is not drawn. @public */
export interface ShareSheetProps {
  /** The file being shared. */
  file: ShareFile;
  /** The QR code, drawn by the app in whatever way it makes them; the sheet frames it on a white tile so it stays scannable in a dark theme. */
  qr: React.ReactNode;
  /** The trusted people the People tab lists, in order. */
  people: readonly SharePerson[];
  /** Ids of `people` already sent this file; each shows `Sent` with a check in place of its Send button. */
  sentTo?: readonly string[];
  /** Called with the person's id when their Send button is pressed. */
  onSend: (id: string) => void;
  /** Called when "Add someone you trust" is pressed; without it the row is not drawn. */
  onAddPerson?: () => void;
  /** When the link ends, for the line under its buttons; without it the line is not drawn. */
  link?: ShareLinkInfo;
  /** Called when Copy link is pressed. */
  onCopyLink: () => void;
  /** Called when More apps is pressed; without it the button is not drawn. */
  onMoreApps?: () => void;
  /** Called when Change, beside the line about when the link ends, is pressed; without it the line has no Change. */
  onChangeLink?: () => void;
  /** The tab shown, when the app controls it. */
  tab?: ShareTab;
  /** The tab shown first when the app does not control it. Defaults to `people`. */
  defaultTab?: ShareTab;
  /** Called with the tab the user picked. */
  onTabChange?: (tab: ShareTab) => void;
  /** Called when the back button is pressed; without it no back button is drawn. */
  onClose?: () => void;
  /** Words that replace the host's labels for this sheet only. */
  labels?: Partial<PhonuxLabels>;
  /** Epoch milliseconds the days left are counted from. Defaults to the current time. */
  now?: number;
}

const GROUP_SX = { bgcolor: 'background.paper', borderRadius: 3.5, display: 'flex', flexDirection: 'column' } as const;
const touchButtonSx = { minHeight: MIN_TOUCH_PX, borderRadius: 4, textTransform: 'none', fontWeight: 600 } as const;

/**
 * The share sheet: a header with the file's name and size, and three tabs (in person with a QR code, people the user
 * trusts, and a web link). It draws no frame or backdrop, so the app places it in a page or its own bottom sheet.
 * @remarks Its words come from `PhonuxLabels` (the host's, or `labels` for this sheet), and it draws the first letter of
 * a person's saved name, never a picture.
 * @public
 */
export function ShareSheet(props: ShareSheetProps): React.ReactElement {
  const { file, qr, people, sentTo = [], link, now } = props;
  const labels = useShareLabels(props.labels);
  const [tab, setTab] = useTabState<ShareTab>(props.tab, props.defaultTab ?? 'people', props.onTabChange);
  const idPrefix = React.useId();
  const at = now ?? Date.now();
  const days = link?.expiresAt === undefined ? null : daysUntil(link.expiresAt, at);
  const opens = link?.maxOpens ?? null;
  const showEnds = link !== undefined && (days !== null || opens !== null);
  const sent = new Set(sentTo);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, p: 2.5, color: 'text.primary' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {props.onClose === undefined ? null : (
          <IconButton aria-label={labels.shareBack} onClick={props.onClose} edge="start" sx={{ width: MIN_TOUCH_PX, height: MIN_TOUCH_PX }}>
            <BackIcon />
          </IconButton>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
            {labels.shareTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {`${file.name}, ${formatFileSize(file.size)}`}
          </Typography>
        </Box>
      </Box>
      <SegmentedTabs
        name={labels.shareTabsName}
        idPrefix={idPrefix}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'nearby', label: labels.shareTabInPerson },
          { id: 'people', label: labels.shareTabPeople },
          { id: 'link', label: labels.shareTabLink },
        ]}
      />
      <Box role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${tab}`} sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        {tab === 'nearby' ? (
          <>
            {/* White whatever the theme: a QR code on a dark ground does not scan. */}
            <Box sx={{ alignSelf: 'center', bgcolor: '#fff', color: '#000', p: 2, borderRadius: 4, border: 1, borderColor: 'divider', display: 'flex' }}>{qr}</Box>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ lineHeight: 1.45 }}>
              {labels.shareInPersonHint}
            </Typography>
          </>
        ) : null}
        {tab === 'people' ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
              {labels.sharePeopleHint}
            </Typography>
            {people.length === 0 ? null : (
              <Box component="ul" sx={{ ...GROUP_SX, listStyle: 'none', m: 0, p: 0 }}>
                {people.map((person) => (
                  <Box key={person.id} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.5, minHeight: MIN_TOUCH_PX, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
                    <Avatar name={person.name} />
                    <Typography sx={{ flexGrow: 1, fontWeight: 500 }}>{person.name}</Typography>
                    {sent.has(person.id) ? (
                      <Typography component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main', fontWeight: 500, fontSize: '0.875rem' }}>
                        <CheckIcon aria-hidden="true" sx={{ fontSize: 16 }} />
                        {labels.shareSent}
                      </Typography>
                    ) : (
                      <Button variant="contained" disableElevation aria-label={labels.shareSendTo(person.name)} onClick={() => props.onSend(person.id)} sx={touchButtonSx}>
                        {labels.shareSend}
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            {props.onAddPerson === undefined ? null : (
              <Box
                component="button"
                type="button"
                onClick={props.onAddPerson}
                sx={{ ...GROUP_SX, flexDirection: 'row', alignItems: 'center', gap: 1.5, p: 1.75, minHeight: MIN_TOUCH_PX, border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              >
                <Box aria-hidden="true" sx={{ width: 40, height: 40, borderRadius: '50%', border: '1.5px dashed', borderColor: 'text.disabled', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                  <AddIcon fontSize="small" />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography sx={{ fontWeight: 500 }}>{labels.shareAddPerson}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {labels.shareAddPersonHint}
                  </Typography>
                </Box>
              </Box>
            )}
            <Typography variant="body2" color="text.secondary" align="center">
              {labels.shareOfferWaits}
            </Typography>
          </>
        ) : null}
        {tab === 'link' ? (
          <>
            <Box sx={{ display: 'flex', gap: 1.25 }}>
              <Button variant="contained" disableElevation fullWidth onClick={props.onCopyLink} sx={{ ...touchButtonSx, minHeight: 52 }}>
                {labels.shareCopyLink}
              </Button>
              {props.onMoreApps === undefined ? null : (
                <Button variant="outlined" color="inherit" fullWidth onClick={props.onMoreApps} sx={{ ...touchButtonSx, minHeight: 52, borderColor: 'divider' }}>
                  {labels.shareMoreApps}
                </Button>
              )}
            </Box>
            {showEnds ? (
              <Typography variant="body2" color="text.secondary" align="center">
                {labels.shareLinkEnds(days, opens)}
                {props.onChangeLink === undefined ? null : (
                  <>
                    {' '}
                    <Button variant="text" size="small" onClick={props.onChangeLink} sx={{ minHeight: MIN_TOUCH_PX, minWidth: MIN_TOUCH_PX, textTransform: 'none', verticalAlign: 'baseline' }}>
                      {labels.shareChange}
                    </Button>
                  </>
                )}
              </Typography>
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
