import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { PhonuxLabels } from './labels.js';
import { Avatar, EndedIcon, FileIcon, GlyphTile, KindIcon, LinkIcon, MIN_TOUCH_PX, MoreIcon, SegmentedTabs, useShareLabels, useTabState, type ShareKind } from './shareParts.js';

/** The tab a `SharedList` shows: what the user shared, or what others shared with them. @public */
export type SharedTab = 'byYou' | 'withYou';

/**
 * One shared item in a `SharedList`, of any kind. The app writes the text; the list does not compute dates or counts, so every
 * language and date format stays the app's.
 * @public
 */
export interface SharedRow {
  /** Identifies the row in every callback. */
  id: string;
  /** `link` is a web link, drawn with a link glyph; `person` is a file sent to or from someone, drawn with their initial. */
  kind: 'link' | 'person';
  /** What kind of item the row is, of any kind: picks its glyph (a space, a playlist, a page, and so on). Without it a `link` row draws a link glyph and any other a file glyph. */
  itemKind?: ShareKind;
  /** A glyph that replaces the one the row would get. An ended row still draws the error glyph. */
  icon?: React.ReactNode;
  /** The item's name, the row's first line. */
  name: string;
  /** The second line, such as `Link, opened 3 times, ends Nov 23`. Drawn in the error color while `ended` is true. */
  detail?: string;
  /** The saved name of the other person, for a `person` row; its first letter is the avatar. */
  person?: string;
  /** True once the link or offer ended: the row turns to the error color and offers Renew in place of its menu. */
  ended?: boolean;
}

/** What `SharedList` takes. A menu entry is drawn only when its callback is given. @public */
export interface SharedListProps {
  /** Rows on the "By you" tab: what the user shared. These carry the row menu and Renew. */
  byYou: readonly SharedRow[];
  /** Rows on the "With you" tab: what others shared with the user. Display only, with no menu. */
  withYou: readonly SharedRow[];
  /** The tab shown, when the app controls it. */
  tab?: SharedTab;
  /** The tab shown first when the app does not control it. Defaults to `byYou`. */
  defaultTab?: SharedTab;
  /** Called with the tab the user picked. */
  onTabChange?: (tab: SharedTab) => void;
  /** Called with the row's id when Renew on an ended row is pressed; without it an ended row has no button. */
  onRenew?: (id: string) => void;
  /** Called with the row's id for "Copy link again"; offered on `link` rows only. */
  onCopyLink?: (id: string) => void;
  /** Called with the row's id for "Show QR code"; offered on `link` rows only. */
  onShowQr?: (id: string) => void;
  /** Called with the row's id for "Change when it ends". */
  onChangeEnd?: (id: string) => void;
  /** Called with the row's id for "Stop sharing". */
  onStopSharing?: (id: string) => void;
  /** Words that replace the host's labels for this list only. */
  labels?: Partial<PhonuxLabels>;
}

interface MenuEntry {
  key: string;
  label: string;
  run: () => void;
  danger?: boolean;
}

/**
 * The user's shared items in two tabs, "By you" and "With you". A row says more only when something needs the user: an
 * ended row shows its detail in the error color with a Renew button, and the others carry a menu with copy again, show QR
 * code, change when it ends and stop sharing. It draws no heading or frame; the app's panel supplies those.
 * @public
 */
export function SharedList(props: SharedListProps): React.ReactElement {
  const labels = useShareLabels(props.labels);
  const [tab, setTab] = useTabState<SharedTab>(props.tab, props.defaultTab ?? 'byYou', props.onTabChange);
  const idPrefix = React.useId();
  const menuId = `${idPrefix}-menu`;
  const rows = tab === 'byYou' ? props.byYou : props.withYou;
  const [menu, setMenu] = React.useState<{ id: string; anchor: HTMLElement } | null>(null);
  const menuRow = menu === null ? undefined : props.byYou.find((r) => r.id === menu.id);

  const entries = (row: SharedRow): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (row.kind === 'link' && props.onCopyLink !== undefined) out.push({ key: 'copy', label: labels.sharedCopyAgain, run: () => props.onCopyLink?.(row.id) });
    if (row.kind === 'link' && props.onShowQr !== undefined) out.push({ key: 'qr', label: labels.sharedShowQr, run: () => props.onShowQr?.(row.id) });
    if (props.onChangeEnd !== undefined) out.push({ key: 'change', label: labels.sharedChangeEnd, run: () => props.onChangeEnd?.(row.id) });
    if (props.onStopSharing !== undefined) out.push({ key: 'stop', label: labels.sharedStop, run: () => props.onStopSharing?.(row.id), danger: true });
    return out;
  };
  const menuEntries = menuRow === undefined ? [] : entries(menuRow);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'text.primary' }}>
      <SegmentedTabs
        name={labels.sharedTabsName}
        idPrefix={idPrefix}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'byYou', label: labels.sharedByYou },
          { id: 'withYou', label: labels.sharedWithYou },
        ]}
      />
      <Box role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${tab}`}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
            {labels.sharedEmpty}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, bgcolor: 'background.paper', borderRadius: 3.5 }}>
            {rows.map((row) => {
              const ended = row.ended === true;
              const hasMenu = tab === 'byYou' && !ended && entries(row).length > 0;
              return (
                <Box key={row.id} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.75, minHeight: 68, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
                  {ended ? (
                    <GlyphTile tone="error">
                      <EndedIcon />
                    </GlyphTile>
                  ) : row.kind === 'person' && row.person !== undefined ? (
                    <Avatar name={row.person} />
                  ) : (
                    <GlyphTile>{row.icon ?? (row.itemKind !== undefined ? <KindIcon kind={row.itemKind} /> : row.kind === 'link' ? <LinkIcon /> : <FileIcon />)}</GlyphTile>
                  )}
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.name}</Typography>
                    {row.detail === undefined ? null : (
                      <Typography variant="body2" color={ended ? 'error' : 'text.secondary'}>
                        {row.detail}
                      </Typography>
                    )}
                  </Box>
                  {ended && props.onRenew !== undefined ? (
                    <Button variant="outlined" color="inherit" aria-label={labels.sharedRenewFor(row.name, row.detail)} onClick={() => props.onRenew?.(row.id)} sx={{ minHeight: MIN_TOUCH_PX, borderRadius: 4, borderColor: 'divider', fontWeight: 600, textTransform: 'none' }}>
                      {labels.sharedRenew}
                    </Button>
                  ) : null}
                  {hasMenu ? (
                    <IconButton aria-label={labels.sharedMore(row.name, row.kind === 'person' ? row.person : undefined, row.detail)} aria-haspopup="menu" aria-expanded={menu?.id === row.id} aria-controls={menu?.id === row.id ? menuId : undefined} onClick={(e) => setMenu({ id: row.id, anchor: e.currentTarget })} sx={{ width: MIN_TOUCH_PX, height: MIN_TOUCH_PX }}>
                      <MoreIcon />
                    </IconButton>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
      <Menu open={menu !== null && menuEntries.length > 0} anchorEl={menu?.anchor ?? null} onClose={() => setMenu(null)} slotProps={{ list: { id: menuId } }}>
        {menuEntries.map((entry) => (
          <MenuItem
            key={entry.key}
            onClick={() => {
              setMenu(null);
              entry.run();
            }}
            sx={(t: Theme) => ({ minHeight: MIN_TOUCH_PX, [t.breakpoints.up('sm')]: { minHeight: MIN_TOUCH_PX }, ...(entry.danger === true ? { color: 'error.main' } : {}) })}
          >
            {entry.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
