/**
 * The built-in controls of a panel's header: a move menu whose one entry pins or unpins the panel, and an X that closes
 * it. Each control is drawn only when the panel allows its gesture, and nothing is drawn in the panel's body. The grab
 * handle is not drawn here: `Panel` draws it from `grabProps`, so a second one would appear beside it.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CloseIcon from '@mui/icons-material/Close';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { usePanelCapabilities, usePanelPinned } from './PanelRow.js';
import { usePanelDragProps } from './panelChrome.js';
import { PanelSlotContext, type PanelSlotValue } from './panelSlotContext.js';
import { focusMoveWhenBack, quietly } from './quietMove.js';
import type { ViewHandle } from './panelTemplate.js';

/** The slot's handle plus the pin verbs. The row types its handle with the members it reads; the verbs are on the same object. */
type SlotHandle = NonNullable<PanelSlotValue['handle']> & Pick<ViewHandle, 'pin' | 'unpin'>;

const INHERIT = { color: 'inherit' } as const;

/** The props of `PanelHeaderMenu`. @public */
export interface PanelHeaderMenuProps {
  /** Called once a Pin or Unpin from the menu has been applied or refused: `ok` is whether the panel's pin changed. */
  onPinChange?: (verb: 'pin' | 'unpin', ok: boolean) => void;
}

/**
 * The header controls of the panel the call is made in, meant for the header slot (the `actions` of `Panel`, or of
 * `PanelHeaderRow`). It draws nothing outside a panel row.
 *
 * The move menu shows when the panel is movable or pinned and holds one entry, Pin or Unpin, which reads the panel's pinned
 * state; the X shows when the panel is closable. The pin never scrolls the row, and focus returns to the move button without
 * the row reading it as a choice. A refused pin or unpin is announced through the workspace's live region.
 * @public
 */
export function PanelHeaderMenu({ onPinChange }: PanelHeaderMenuProps = {}): React.JSX.Element | null {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const announce = React.useContext(AnnounceContext);
  const { onClose } = usePanelDragProps();
  const { movable } = usePanelCapabilities();
  const pinned = usePanelPinned();
  const handle = React.useContext(PanelSlotContext)?.handle as SlotHandle | undefined;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const moveRef = React.useRef<HTMLButtonElement>(null);
  const [returnFocus, setReturnFocus] = React.useState(false);
  // Focus goes back in the layout effect of the render that closes the menu: its focus trap is off by then, and the row is quiet.
  React.useLayoutEffect(() => {
    if (!returnFocus) return;
    setReturnFocus(false);
    quietly(() => moveRef.current?.focus({ preventScroll: true }));
  }, [returnFocus]);
  // A pinned panel reads as not movable, and its Unpin entry must stay reachable.
  const showMove = movable || pinned;
  if (handle === undefined || (onClose === undefined && !showMove)) return null;

  const closeMenu = (): void => {
    setAnchor(null);
    setReturnFocus(true);
  };
  const togglePin = (): void => {
    closeMenu();
    const verb = pinned ? 'unpin' : 'pin';
    const rowId = moveRef.current?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
    const result = quietly(() => handle[verb]('person'));
    // A pin can drop the header slot for a render, so the move button is found again over the next frames.
    if (rowId !== undefined) focusMoveWhenBack(rowId);
    if (!result.ok) announce?.(pinned ? labels.unpinFailed : labels.pinFailed);
    onPinChange?.(verb, result.ok);
  };

  return (
    <Box data-panel-header-menu="" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      {showMove ? (
        <>
          <IconButton
            ref={moveRef}
            size="small"
            aria-label={labels.move}
            aria-haspopup="menu"
            aria-expanded={anchor !== null}
            data-panel-move=""
            onClick={(event) => setAnchor(event.currentTarget)}
            sx={INHERIT}
          >
            <ControlCameraIcon fontSize="small" />
          </IconButton>
          <Menu open={anchor !== null} anchorEl={anchor} onClose={closeMenu} disableRestoreFocus>
            <MenuItem data-panel-pin-toggle="" onClick={togglePin}>
              <ListItemIcon>{pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}</ListItemIcon>
              {pinned ? labels.unpin : labels.pin}
            </MenuItem>
          </Menu>
        </>
      ) : null}
      {onClose !== undefined ? (
        <IconButton size="small" aria-label={labels.close} data-panel-close="" onClick={onClose} sx={INHERIT}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Box>
  );
}
