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
import { AnnounceContext } from './announce.js';
import { PHONE_FRAME_ATTRIBUTE } from './PanelFrame.js';
import { useOptionalHost } from './hostApi.js';
import { resolveIcons } from './icons.js';
import { resolveLabels } from './labels.js';
import { usePanelMaximize } from './panelMaximize.js';
import { PanelSlotContext, type PanelSlotValue } from './panelSlotContext.js';
import { panelRootOf } from './rowDom.js';

/** The menu's inset from the panel's sides, in px. */
const MENU_INSET_PX = 8;

/** A bar across the top of the panel's frame, a pill inset the same from its top and sides, so the menu never covers the next panel. */
function insidePanel(button: HTMLElement | null): { top: number; left: number; width: number | undefined } {
  const root = button ? panelRootOf(button) : null;
  const frame = root?.querySelector<HTMLElement>(`[${PHONE_FRAME_ATTRIBUTE}]`) ?? root;
  const panel = frame?.getBoundingClientRect();
  return {
    top: panel ? panel.top + MENU_INSET_PX : (button?.getBoundingClientRect().bottom ?? 0),
    left: (panel?.left ?? 0) + MENU_INSET_PX,
    width: panel ? panel.width - 2 * MENU_INSET_PX : undefined,
  };
}

const SIZE_KEYS = ['phone', 'fold', 'tablet', 'desktop', 'ultrawide'] as const;

const ICON = { color: 'inherit' } as const;
const ENTRY = { color: 'text.primary', '&.Mui-disabled': { color: 'primary.contrastText', bgcolor: 'primary.main' } } as const;

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
 * window fits, with the panel's current size highlighted and disabled, then Fullscreen. Focus goes back to the button once a width is picked.
 * @public
 */
export function PanelSizeControl({ topInset, fullscreenShortcut, fullscreenKeys, onRefused }: PanelSizeControlProps = {}): React.JSX.Element | null {
  const host = useOptionalHost();
  const labels = resolveLabels(host?.labels);
  const icons = resolveIcons(host?.icons);
  const announce = React.useContext(AnnounceContext);
  const slot = React.useContext(PanelSlotContext);
  const button = React.useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const place = insidePanel(anchor);
  const refused = (what: 'resize' | 'fullscreen'): void => {
    if (onRefused !== undefined) onRefused(what);
    else announce?.(what === 'resize' ? labels.couldNotResize : labels.couldNotFullscreen);
  };
  const maximize = usePanelMaximize(button, { ...(topInset !== undefined ? { topInset } : {}), onRefused: () => refused('fullscreen') });
  const handle = slot?.handle;
  const summary = slot?.summary;
  if (!drawsSizeControl(slot) || handle === undefined || summary === undefined) return null;
  const maxSlots = slot?.maxSlots ?? 1;
  const limit = Math.min(SIZE_KEYS.length, maxSlots, summary.fitSlots ?? maxSlots);
  const own = summary.savedSlots ?? summary.slots ?? 1;
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
          {maximize.maximized || own > SIZE_KEYS.length ? icons.fullscreen : icons.size(own)}
        </IconButton>
      </Tooltip>
      {/* No restore on close: a dismissed menu leaves focus where it was, and a pick puts it back on the button itself. */}
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        disableRestoreFocus
        anchorReference="anchorPosition"
        anchorPosition={{ top: place.top, left: place.left }}
        marginThreshold={0}
        slotProps={{ paper: { sx: { width: place.width, maxWidth: place.width, borderRadius: 999 } }, list: { sx: { p: 0 } } }}
      >
        <Box role="group" aria-label={labels.viewSize} data-panel-size-group="" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 2, py: 1 }}>
          <Typography variant="caption" component="div" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {labels.viewSize}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {Array.from({ length: limit }, (_, i) => i + 1).map((slots) => {
              const current = !maximize.maximized && (summary.slots ?? 1) === slots;
              return (
                <Tooltip key={slots} title={labels.sizeName(slots)}>
                  {/* The span keeps the hover text on the current size, which is disabled. */}
                  <span>
                    <IconButton
                      size="small"
                      data-view-size={SIZE_KEYS[slots - 1]}
                      aria-label={labels.sizeName(slots)}
                      aria-pressed={current}
                      disabled={current}
                      onClick={() => {
                        close();
                        if (maximize.maximized) maximize.toggle();
                        if (!handle.setSlots(slots, 'person').ok) refused('resize');
                      }}
                      sx={ENTRY}
                    >
                      {icons.size(slots)}
                    </IconButton>
                  </span>
                </Tooltip>
              );
            })}
            <Tooltip title={fullscreenLabel}>
              <span>
                <IconButton
                  size="small"
                  data-view-fullscreen=""
                  aria-label={labels.fullscreen}
                  {...(fullscreenKeys !== undefined ? { 'aria-keyshortcuts': fullscreenKeys } : {})}
                  aria-pressed={maximize.maximized}
                  disabled={maximize.maximized}
                  onClick={() => {
                    close();
                    maximize.toggle();
                  }}
                  sx={ENTRY}
                >
                  {icons.fullscreen}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Menu>
    </>
  );
}
