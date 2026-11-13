/**
 * The one width control every resizable panel shows: a header button whose icon is the panel's own width, opening a menu of
 * the widths that fit the window and Fullscreen. Picking a width goes through the panel's `setSlots`, so it runs the same size
 * glide as any other resize.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
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
const STOP_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

/** Arrow keys, Home and End step focus along the group's enabled buttons without wrapping; the disabled current size takes no focus. */
function stepFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (!STOP_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  const at = stops.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  event.preventDefault();
  const to = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : at + (event.key === 'ArrowRight' ? 1 : -1);
  stops[Math.min(Math.max(to, 0), stops.length - 1)]?.focus({ preventScroll: true });
}
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
 * window fits, with the panel's current size highlighted and disabled, then Fullscreen. Focus lands on the first width that is not the current size when it opens, the arrow keys move along the widths, and focus goes back to the button when Escape closes it or a width is picked.
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
  // Focus goes back to the button only once the menu has closed: while open, its focus trap pulls focus back into the menu, which then
  // unmounts holding it with no blur React can see, and the panel would read itself as focused, its chrome shown, from then on.
  const refocus = React.useRef(false);
  React.useEffect(() => {
    if (anchor !== null || !refocus.current) return;
    refocus.current = false;
    button.current?.focus({ preventScroll: true });
  }, [anchor]);
  if (!drawsSizeControl(slot) || handle === undefined || summary === undefined) return null;
  const maxSlots = slot?.maxSlots ?? 1;
  const limit = Math.min(SIZE_KEYS.length, maxSlots, summary.fitSlots ?? maxSlots);
  const own = summary.savedSlots ?? summary.slots ?? 1;
  const isCurrent = (slots: number): boolean => !maximize.maximized && (summary.slots ?? 1) === slots;
  const widths = Array.from({ length: limit }, (_, i) => i + 1);
  // Focus opens on the first width that takes it: the current size is disabled, and with no other width it is Fullscreen.
  const firstWidth = widths.find((slots) => !isCurrent(slots));
  const close = (): void => {
    refocus.current = true;
    setAnchor(null);
  };
  const fullscreenLabel = fullscreenShortcut === undefined ? labels.fullscreen : `${labels.fullscreen} (${fullscreenShortcut})`;
  return (
    <>
      <Tooltip title={labels.viewSize}>
        <IconButton
          ref={button}
          size="small"
          aria-label={labels.viewSize}
          aria-haspopup="dialog"
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
      {/* No restore on close: a click-away leaves focus where it was, and Escape and a pick put it back on the button themselves. */}
      <Popover
        anchorEl={anchor}
        open={anchor !== null}
        onClose={(_event, reason) => (reason === 'escapeKeyDown' ? close() : setAnchor(null))}
        disableRestoreFocus
        anchorReference="anchorPosition"
        anchorPosition={{ top: place.top, left: place.left }}
        marginThreshold={0}
        slotProps={{ paper: { role: 'dialog', 'aria-label': labels.viewSize, sx: { width: place.width, maxWidth: place.width, maxHeight: 'calc(100% - 96px)', borderRadius: 999 } } }}
      >
        <Box role="group" aria-label={labels.viewSize} data-panel-size-group="" onKeyDown={stepFocus} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 2, py: 1 }}>
          {/* MUI 9's Typography takes the text colors as textPrimary/textSecondary; 'text.secondary' falls through to the primary text color. */}
          <Typography variant="caption" component="div" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
            {labels.viewSize}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {widths.map((slots) => {
              const current = isCurrent(slots);
              return (
                <Tooltip key={slots} title={labels.sizeName(slots)}>
                  {/* The span keeps the hover text on the current size, which is disabled. */}
                  <span>
                    <IconButton
                      size="small"
                      data-view-size={SIZE_KEYS[slots - 1]}
                      autoFocus={slots === firstWidth}
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
                  autoFocus={firstWidth === undefined}
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
      </Popover>
    </>
  );
}
