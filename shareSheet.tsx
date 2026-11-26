import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import NativeSelect from '@mui/material/NativeSelect';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { PhonuxLabels } from './labels.js';
import { SafetyPage } from './shareSafety.js';
import { AddIcon, Avatar, BackIcon, CheckIcon, ItemHeader, MIN_TOUCH_PX, MoreIcon, SegmentedTabs, ShieldCheckIcon, ShieldIcon, capitalized, daysSince, daysUntil, formatFileSize, isEditable, useShareLabels, useTabState, type ShareItem } from './shareParts.js';
import { alpha, type Theme } from '@mui/material/styles';

/** The tab a `ShareSheet` shows: `nearby` is the QR code, `people` the trusted people, `link` the web link. @public */
export type ShareTab = 'nearby' | 'people' | 'link';

/** The file being shared, in the older form: `item` with kind `file` says the same and more. @public */
export interface ShareFile {
  /** The file name shown in the sheet's header. */
  name: string;
  /** Size in bytes; the sheet writes it in decimal units, such as `48 MB`. */
  size: number;
}

/** What others may do with an item: change it, or only look. @public */
export type ShareRole = 'edit' | 'view';

/**
 * A person the item is already shared with. The app holds the list; the sheet draws it and reports what the user asks.
 * @public
 */
export interface ShareMember {
  /** Identifies the person in `onChangeRole` and `onRemove`. */
  id: string;
  /** The email or saved name; drawn as text only, and its first letter is the avatar. Ignored for the user's own row, which says `You`. */
  name: string;
  /** `owner` has no menu and says Owner; `edit` and `view` say Can edit and Can view on an item others can edit. */
  role: 'owner' | ShareRole;
  /** False for a person invited who has not joined yet; the line then says so in place of the role. Defaults to true. */
  joined?: boolean;
  /** True for the user's own row, which is drawn as `You`. */
  you?: boolean;
  /**
   * Set once the person has answered no: they left the item or declined the invite. The sheet draws them under
   * `No longer in this space` (or the item's kind) with a tag, their old access, Invite again and Remove, and no menu.
   * `joined` is ignored when this is set.
   */
  status?: 'left' | 'declined';
  /** Epoch milliseconds they answered at, for `Left, 3 days ago`; read only with `status`. Left out, the row says no time. */
  since?: number;
  /** For a person with `status`: false hides Invite again, for someone the app has no way to invite. Defaults to true. A `name` that is empty never offers it. */
  canInviteAgain?: boolean;
  /**
   * The state of this person's safety code, for a joined person. Left out, the sheet draws nothing about it. The line
   * under the name then says the state, a `not checked` or `changed` state gets a Check or Review button (with `onSafetyCodeOpen`),
   * and `checked` puts a green shield on the avatar.
   */
  safety?: MemberSafety;
}

/** The safety code check of one person, as the host knows it. @public */
export interface MemberSafety {
  /** `unchecked` was never compared, `checked` was compared and the key has not changed since, `changed` is a new key not yet accepted. */
  state: 'unchecked' | 'checked' | 'changed';
  /** The 60 digits, with or without spaces in groups of five. Give it once Check is pressed if it takes time to make; the page waits until it arrives. For `changed`, the code of the new key. */
  code?: string;
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
  /** What is being shared. Wins over `file`; with neither, the header row is not drawn. */
  item?: ShareItem;
  /** The file being shared, for apps that predate `item`; read as an item of kind `file` whose subtitle is its size. */
  file?: ShareFile;
  /** The QR code, such as a `QrCode`; the sheet frames it on a white tile so it stays scannable in a dark theme. */
  qr: React.ReactNode;
  /** The people the item is already shared with, listed first on the People tab; the app puts the user's own row (`you`) where it wants it. */
  members?: readonly ShareMember[];
  /** Called with what the user typed and the access they picked when Invite is pressed; without it the field and button are not drawn. For an item others cannot edit the role is always `view`. */
  onInvite?: (who: string, role: ShareRole) => void;
  /** Called with the person's id and the role picked from their menu; the menu offers roles only on an item others can edit, and only with this callback. */
  onChangeRole?: (id: string, role: ShareRole) => void;
  /** Called with the person's id when Remove is pressed in their menu, or on a person who left or declined; without it neither has a Remove. */
  onRemove?: (id: string) => void;
  /** Called with the id and the access a person who left or declined had, when Invite again is pressed; without it the button is not drawn. */
  onInviteAgain?: (id: string, role: ShareRole) => void;
  /** Called with the person's id when Check, or Review on a changed key, is pressed; the sheet then shows the safety code page for that person. Without it no safety code is drawn except the checked shield. */
  onSafetyCodeOpen?: (id: string) => void;
  /** Called with the person's id when They match is pressed on the page; without it the button is not drawn. The sheet then leaves the page, and the app marks the person `checked`. */
  onSafetyCodeMatch?: (id: string) => void;
  /** Called with the person's id when They do not match is pressed; without it the button is not drawn. The sheet itself then says not to share anything private until they check again in person. */
  onSafetyCodeMismatch?: (id: string) => void;
  /** Called with the person's id when Accept new key is pressed on the page for a `changed` key; without it the button is not drawn. The sheet then leaves the page. */
  onAcceptNewKey?: (id: string) => void;
  /** The trusted people the People tab lists, in order, each with a Send button. */
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
  /** The tab shown first when the app does not control it. Defaults to `people` for an item others can edit (a space, a playlist) and `link` for any other. */
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
 * The share sheet for any kind of item: a title, the item's header row, and three tabs (in person with a QR code, people,
 * and a web link). The People tab invites by email or saved name, lists who has the item with a menu to change their
 * access or remove them, and sends to trusted people. It draws no frame or backdrop, so the app places it in a page or its own bottom sheet.
 * @remarks Its words come from `PhonuxLabels` (the host's, or `labels` for this sheet), and it draws the first letter of
 * a person's saved name, never a picture.
 * @public
 */
export function ShareSheet(props: ShareSheetProps): React.ReactElement {
  const { qr, people, sentTo = [], link, now, members = [] } = props;
  const labels = useShareLabels(props.labels);
  const item: ShareItem | undefined = props.item ?? (props.file === undefined ? undefined : { kind: 'file', name: props.file.name, subtitle: `${capitalized(labels.shareKind('file'))}, ${formatFileSize(props.file.size)}` });
  const editable = item !== undefined && isEditable(item);
  const [tab, setTab] = useTabState<ShareTab>(props.tab, props.defaultTab ?? (editable ? 'people' : 'link'), props.onTabChange);
  const idPrefix = React.useId();
  const at = now ?? Date.now();
  const days = link?.expiresAt === undefined ? null : daysUntil(link.expiresAt, at);
  const opens = link?.maxOpens ?? null;
  const showEnds = link !== undefined && (days !== null || opens !== null);
  const sent = new Set(sentTo);
  const [checkingId, setCheckingId] = React.useState<string | null>(null);
  const checking = checkingId === null || props.onSafetyCodeOpen === undefined ? undefined : members.find((m) => m.id === checkingId && m.safety !== undefined && m.safety.state !== 'checked');
  const here = members.filter((m) => m.status === undefined);
  const gone = members.filter((m) => m.status !== undefined);
  const kindWord = labels.shareKind(item?.kind ?? 'space');

  if (checking?.safety !== undefined) {
    const { id } = checking;
    const done = (call: ((id: string) => void) | undefined): (() => void) | undefined =>
      call === undefined
        ? undefined
        : () => {
            call(id);
            setCheckingId(null);
          };
    return (
      <SafetyPage
        key={id}
        name={checking.name}
        state={checking.safety.state === 'changed' ? 'changed' : 'unchecked'}
        code={checking.safety.code}
        labels={labels}
        onMatch={done(props.onSafetyCodeMatch)}
        onMismatch={props.onSafetyCodeMismatch === undefined ? undefined : () => props.onSafetyCodeMismatch?.(id)}
        onAccept={done(props.onAcceptNewKey)}
        onBack={() => setCheckingId(null)}
      />
    );
  }

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
        </Box>
      </Box>
      {item === undefined ? null : <ItemHeader item={item} />}
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
              {editable ? labels.sharePeopleHintEdit : labels.sharePeopleHint}
            </Typography>
            {props.onInvite === undefined ? null : <InviteRow editable={editable} labels={labels} onInvite={props.onInvite} />}
            {here.length === 0 ? null : (
              <Box component="ul" sx={{ ...GROUP_SX, listStyle: 'none', m: 0, p: 0 }}>
                {here.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    editable={editable}
                    labels={labels}
                    onChangeRole={props.onChangeRole}
                    onRemove={props.onRemove}
                    onSafetyCodeOpen={props.onSafetyCodeOpen === undefined ? undefined : (id) => {
                      setCheckingId(id);
                      props.onSafetyCodeOpen?.(id);
                    }}
                  />
                ))}
              </Box>
            )}
            {gone.length === 0 ? null : (
              <>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography component="h3" variant="body2" color="text.secondary" sx={{ fontWeight: 600, px: 1.25 }}>
                    {labels.shareGoneHeading(kindWord)}
                  </Typography>
                  <Box component="ul" sx={{ ...GROUP_SX, listStyle: 'none', m: 0, p: 0 }}>
                    {gone.map((member) => (
                      <GoneRow key={member.id} member={member} editable={editable} labels={labels} now={at} onInviteAgain={props.onInviteAgain} onRemove={props.onRemove} />
                    ))}
                  </Box>
                </Box>
                {props.onRemove === undefined ? null : (
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                    {labels.shareGoneHint(kindWord)}
                  </Typography>
                )}
              </>
            )}
            {people.length === 0 ? null : (
              <Box component="ul" sx={{ ...GROUP_SX, listStyle: 'none', m: 0, p: 0 }}>
                {people.map((person) => (
                  <Box key={person.id} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.5, minHeight: MIN_TOUCH_PX, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
                    <Avatar name={person.name} />
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{person.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {labels.shareTrustedLine}
                      </Typography>
                    </Box>
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
            <Typography variant="body2" color="text.secondary" align="center" sx={{ lineHeight: 1.45 }}>
              {labels.shareLinkNote}
            </Typography>
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function InviteRow({ editable, labels, onInvite }: { editable: boolean; labels: PhonuxLabels; onInvite: (who: string, role: ShareRole) => void }): React.ReactElement {
  const [who, setWho] = React.useState('');
  const [role, setRole] = React.useState<ShareRole>('edit');
  const trimmed = who.trim();
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (trimmed === '') return;
        onInvite(trimmed, editable ? role : 'view');
        setWho('');
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      <Box sx={{ display: 'flex', gap: 1.25 }}>
        <TextField
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder={labels.shareInviteField}
          fullWidth
          slotProps={{ htmlInput: { 'aria-label': labels.shareInviteField, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, sx: { minHeight: MIN_TOUCH_PX, boxSizing: 'border-box', py: 0 } } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3, minHeight: MIN_TOUCH_PX } }}
        />
        {editable ? (
          <NativeSelect
            value={role}
            onChange={(e) => setRole(e.target.value === 'view' ? 'view' : 'edit')}
            inputProps={{ 'aria-label': labels.shareAccessName }}
            sx={{ minHeight: MIN_TOUCH_PX, minWidth: 112, border: 1, borderColor: 'divider', borderRadius: 3, px: 1.5, '&:before, &:after': { display: 'none' } }}
          >
            <option value="edit">{labels.shareCanEdit}</option>
            <option value="view">{labels.shareCanView}</option>
          </NativeSelect>
        ) : null}
      </Box>
      <Button type="submit" variant="contained" disableElevation disabled={trimmed === ''} sx={{ ...touchButtonSx, minHeight: 48 }}>
        {labels.shareInvite}
      </Button>
    </Box>
  );
}

interface MemberRowProps {
  member: ShareMember;
  editable: boolean;
  labels: PhonuxLabels;
  onChangeRole: ((id: string, role: ShareRole) => void) | undefined;
  onRemove: ((id: string) => void) | undefined;
  onSafetyCodeOpen: ((id: string) => void) | undefined;
}

function MemberRow({ member, editable, labels, onChangeRole, onRemove, onSafetyCodeOpen }: MemberRowProps): React.ReactElement {
  const menuId = React.useId();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const name = member.you === true ? labels.shareYou : member.name;
  const pending = member.joined === false;
  const roleText = member.role === 'owner' ? labels.shareOwner : !editable || member.role === 'view' ? labels.shareCanView : labels.shareCanEdit;
  const canChange = editable && onChangeRole !== undefined;
  const hasMenu = member.role !== 'owner' && (canChange || onRemove !== undefined);
  // The check belongs to a joined person other than the user; a pending invite has no key to compare yet.
  const safety = member.role === 'owner' || member.you === true || pending ? undefined : member.safety;
  const checkable = safety !== undefined && safety.state !== 'checked' && onSafetyCodeOpen !== undefined;
  const line = safety !== undefined && (safety.state === 'checked' || checkable) ? labels.shareMemberSafetyLine(roleText, safety.state) : pending ? labels.shareInvitedNotJoined : roleText;
  const close = (): void => setAnchor(null);
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.25, minHeight: 64, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
      <Box sx={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Avatar name={name} />
        {safety?.state === 'checked' ? (
          <ShieldCheckIcon aria-hidden="true" data-phonux-shield="checked" sx={{ position: 'absolute', right: -5, bottom: -5, fontSize: 18, p: '1px', borderRadius: '50%', bgcolor: 'background.paper', color: 'success.main' }} />
        ) : null}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</Typography>
        {member.role === 'owner' ? null : (
          <Typography variant="body2" color={safety?.state === 'changed' && checkable ? 'warning.main' : 'text.secondary'} sx={safety?.state === 'changed' && checkable ? (t: Theme) => ({ color: t.palette.mode === 'dark' ? t.palette.warning.light : t.palette.warning.dark }) : undefined}>
            {line}
          </Typography>
        )}
      </Box>
      {checkable ? (
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={safety.state === 'changed' ? undefined : <ShieldIcon aria-hidden="true" />}
          aria-label={safety.state === 'changed' ? labels.shareSafetyReviewFor(name) : labels.shareSafetyCheckFor(name)}
          onClick={() => onSafetyCodeOpen(member.id)}
          sx={{ ...touchButtonSx, borderColor: 'divider', flexShrink: 0 }}
        >
          {safety.state === 'changed' ? labels.shareSafetyReview : labels.shareSafetyCheck}
        </Button>
      ) : null}
      {member.role === 'owner' ? (
        <Typography variant="body2" color="text.secondary">
          {roleText}
        </Typography>
      ) : null}
      {hasMenu ? (
        <>
          <IconButton aria-label={labels.shareMemberMore(name)} aria-haspopup="menu" aria-expanded={anchor !== null} aria-controls={anchor === null ? undefined : menuId} onClick={(e) => setAnchor(e.currentTarget)} sx={{ width: MIN_TOUCH_PX, height: MIN_TOUCH_PX }}>
            <MoreIcon />
          </IconButton>
          <Menu open={anchor !== null} anchorEl={anchor} onClose={close} slotProps={{ list: { id: menuId } }}>
            {canChange
              ? (['edit', 'view'] as const).map((r) => (
                  <MenuItem
                    key={r}
                    selected={member.role === r}
                    aria-current={member.role === r ? 'true' : undefined}
                    onClick={() => {
                      close();
                      if (member.role !== r) onChangeRole?.(member.id, r);
                    }}
                    sx={{ minHeight: MIN_TOUCH_PX }}
                  >
                    {r === 'edit' ? labels.shareCanEdit : labels.shareCanView}
                  </MenuItem>
                ))
              : null}
            {onRemove === undefined ? null : (
              <MenuItem
                onClick={() => {
                  close();
                  onRemove(member.id);
                }}
                sx={{ minHeight: MIN_TOUCH_PX, color: 'error.main' }}
              >
                {labels.shareRemove}
              </MenuItem>
            )}
          </Menu>
        </>
      ) : null}
    </Box>
  );
}

interface GoneRowProps {
  member: ShareMember;
  editable: boolean;
  labels: PhonuxLabels;
  now: number;
  onInviteAgain: ((id: string, role: ShareRole) => void) | undefined;
  onRemove: ((id: string) => void) | undefined;
}

/** A person who left or declined: a quiet row with the answer as a tag, and the two things the owner can do about it. */
function GoneRow({ member, editable, labels, now, onInviteAgain, onRemove }: GoneRowProps): React.ReactElement {
  const status = member.status ?? 'left';
  const unknown = member.name.trim() === '';
  const name = unknown ? labels.shareUnknownAccount : member.name;
  const days = member.since === undefined ? null : daysSince(member.since, now);
  const role: ShareRole = editable && member.role !== 'view' ? 'edit' : 'view';
  const canInvite = onInviteAgain !== undefined && !unknown && member.canInviteAgain !== false;
  return (
    <Box component="li" aria-label={labels.shareGoneRow(name, status, days)} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: 1.75, py: 1.5, minHeight: 64, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ opacity: 0.55, display: 'flex' }}>
          <Avatar name={name} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {role === 'edit' ? labels.shareCanEdit : labels.shareCanView}
          </Typography>
          {days === null ? null : (
            <Typography variant="body2" color="text.secondary">
              {labels.shareGoneSince(status, days)}
            </Typography>
          )}
        </Box>
        <Box
          component="span"
          sx={(t: Theme) => ({
            flexShrink: 0,
            px: 1.25,
            py: 0.25,
            borderRadius: 4,
            fontSize: '0.8125rem',
            fontWeight: 600,
            bgcolor: status === 'declined' ? alpha(t.palette.warning.main, 0.16) : t.palette.action.hover,
            color: status === 'declined' ? (t.palette.mode === 'dark' ? t.palette.warning.light : t.palette.warning.dark) : t.palette.text.secondary,
          })}
        >
          {status === 'left' ? labels.shareLeft : labels.shareDeclined}
        </Box>
      </Box>
      {canInvite || onRemove !== undefined ? (
        <Box sx={{ display: 'flex', gap: 1.25 }}>
          {canInvite ? (
            <Button
              variant="contained"
              disableElevation
              fullWidth
              aria-label={labels.shareInviteAgainTo(name)}
              onClick={() => onInviteAgain(member.id, role)}
              sx={(t: Theme) => ({ ...touchButtonSx, bgcolor: alpha(t.palette.primary.main, 0.14), color: t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.dark, '&:hover': { bgcolor: alpha(t.palette.primary.main, 0.22) } })}
            >
              {labels.shareInviteAgain}
            </Button>
          ) : null}
          {onRemove === undefined ? null : (
            <Button variant="outlined" color="error" fullWidth aria-label={labels.shareRemoveFrom(name)} onClick={() => onRemove(member.id)} sx={touchButtonSx}>
              {labels.shareRemove}
            </Button>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
