/**
 * The one width control every resizable panel shows: a header button whose icon is the panel's own width, opening a menu of
 * the widths that fit the window and Fullscreen. Picking a width goes through the panel's `setSlots`, so it runs the same size
 * glide as any other resize.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { createSvgIcon } from '@mui/material/utils';
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined';
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined';
import SmartphoneOutlinedIcon from '@mui/icons-material/SmartphoneOutlined';
import TabletOutlinedIcon from '@mui/icons-material/TabletOutlined';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { usePanelMaximize } from './panelMaximize.js';
import { PanelSlotContext, type PanelSlotValue } from './panelSlotContext.js';

/** Material has no ultrawide monitor: this is its outlined desktop monitor with the screen drawn wide and short. */
const UltrawideIcon = createSvgIcon(<path d="M21 5H3c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 9H3V7h18v7z" />, 'Ultrawide');
/** Material has no foldable phone: two outlined phones side by side, the fold drawn as the gap between them. */
const FoldIcon = createSvgIcon(<path d="M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v12h6V6h-6z" />, 'Fold');

/** One icon per width, by slots. The outlined set throughout: the filled desktop monitor is solid beside the hollow phone and tablet. */
const SIZE_ICONS = [SmartphoneOutlinedIcon, FoldIcon, TabletOutlinedIcon, DesktopWindowsOutlinedIcon, UltrawideIcon] as const;
const SIZE_KEYS = ['phone', 'fold', 'tablet', 'desktop', 'ultrawide'] as const;

const ICON = { color: 'inherit' } as const;
const ENTRY = { color: 'text.primary' } as const;

/** Whether the control draws anything in this slot, so `Panel` leaves its header's placeholder alone when it does not. */
export const drawsSizeControl = (slot: PanelSlotValue | undefined): boolean =>
  slot?.handle !== undefined && slot.summary !== undefined && slot.resizable && slot.maxSlots >= 2;

/** The props of `PanelSizeControl`. @public */
export interface PanelSizeControlProps {
  /** The height of a bar the page keeps along the window's top edge, which a fullscreen panel stops below. 0 when omitted. */
  readonly topInset?: () => number;
  /** The Fullscreen shortcut as the host spells it, shown in the entry's hover text. */
  readonly fullscreenShortcut?: string;
  /** The Fullscreen shortcut in `aria-keyshortcuts` form. */
  readonly fullscreenKeys?: string;
  /** Called when a picked width or Fullscreen was refused. When omitted, the refusal is announced through the workspace's live region. */
  readonly onRefused?: (what: 'resize' | 'fullscreen') => void;
}

/**
 * The width control of the panel the call is made in, for its header. It draws nothing outside a row, nor for a panel that is
 * not resizable or may take fewer than two slots. The menu offers the widths up to five phones that `maxSlots` allows and the
 * window fits, with the panel's own width pressed, then Fullscreen. Focus goes back to the button once a width is picked.
 * @public
 */
export function PanelSizeControl({ topInset, fullscreenShortcut, fullscreenKeys, onRefused }: PanelSizeControlProps = {}): React.JSX.Element | null {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const announce = React.useContext(AnnounceContext);
  const slot = React.useContext(PanelSlotContext);
  const button = React.useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const refused = (what: 'resize' | 'fullscreen'): void => {
    if (onRefused !== undefined) onRefused(what);
    else announce?.(what === 'resize' ? labels.couldNotResize : labels.couldNotFullscreen);
  };
  const maximize = usePanelMaximize(button, { ...(topInset !== undefined ? { topInset } : {}), onRefused: () => refused('fullscreen') });
  const handle = slot?.handle;
  const summary = slot?.summary;
  if (!drawsSizeControl(slot) || handle === undefined || summary === undefined) return null;
  const maxSlots = slot?.maxSlots ?? 1;
  const limit = Math.min(SIZE_ICONS.length, maxSlots, summary.fitSlots ?? maxSlots);
  const own = summary.savedSlots ?? summary.slots ?? 1;
  const iconOf = (slots: number): React.ReactElement => {
    const Icon = SIZE_ICONS[slots - 1] ?? DesktopWindowsOutlinedIcon;
    return <Icon fontSize="small" />;
  };
  const close = (): void => {
    setAnchor(null);
    button.current?.focus({ preventScroll: true });
  };
  const fullscreenLabel = fullscreenShortcut === undefined ? labels.fullscreen : `${labels.fullscreen} (${fullscreenShortcut})`;
  return (
    <>
      <Tooltip title={labels.viewSize}>
        <IconButton
          ref={button}
          size="small"
          aria-label={labels.viewSize}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          data-panel-size-button=""
          // A press must not move focus first: the row reads a focus change inside a panel as the person choosing it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={ICON}
        >
          {maximize.maximized || own > SIZE_ICONS.length ? <FullscreenOutlinedIcon fontSize="small" /> : iconOf(own)}
        </IconButton>
      </Tooltip>
      {/* No restore on close: a dismissed menu leaves focus where it was, and a pick puts it back on the button itself. */}
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)} disableRestoreFocus>
        <Box role="group" aria-label={labels.viewSize} data-panel-size-group="" sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <Typography variant="caption" component="div" color="text.secondary">
            {labels.viewSize}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {Array.from({ length: limit }, (_, i) => i + 1).map((slots) => (
              <Tooltip key={slots} title={labels.sizeName(slots)}>
                <IconButton
                  size="small"
                  data-view-size={SIZE_KEYS[slots - 1]}
                  aria-label={labels.sizeName(slots)}
                  aria-pressed={(summary.slots ?? 1) === slots}
                  onClick={() => {
                    close();
                    if (!handle.setSlots(slots, 'person').ok) refused('resize');
                  }}
                  sx={ENTRY}
                >
                  {iconOf(slots)}
                </IconButton>
              </Tooltip>
            ))}
            <Tooltip title={fullscreenLabel}>
              <IconButton
                size="small"
                data-view-fullscreen=""
                aria-label={labels.fullscreen}
                {...(fullscreenKeys !== undefined ? { 'aria-keyshortcuts': fullscreenKeys } : {})}
                aria-pressed={maximize.maximized}
                onClick={() => {
                  close();
                  maximize.toggle();
                }}
                sx={ENTRY}
              >
                <FullscreenOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Menu>
    </>
  );
}
