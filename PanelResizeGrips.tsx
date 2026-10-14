/**
 * The resize grips of a panel: one on each side, a 24 px target in the gap between two panels. Dragging one makes the
 * panel as wide as the pointer pulls it, and the release settles it on the nearest whole slot. DESIGN.md, "The resize grips".
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { holdDragSelection } from './dragToClose.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { CHROME_ATTRIBUTE, CHROME_PARTS, PanelChromeVisibleContext, useChromeFade, usePanelResizing } from './panelChrome.js';
import { PanelSlotContext, type PanelSlotValue } from './panelSlotContext.js';
import { usePhoneSize } from './phoneFit.js';

/** The pointer-target size of a grip, WCAG 2.5.8's minimum. */
const GRIP_PX = 24;

/** A move reported at x 0 once the pointer was well inside the window is Firefox's report of a pointer past the window edge, not a real position. */
const FIREFOX_EDGE_X = GRIP_PX;

type Side = 'left' | 'right';

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  lastX: number;
  releaseSelection: () => void;
}

function Grip({ side, slot, handle }: { side: Side; slot: PanelSlotValue; handle: NonNullable<PanelSlotValue['handle']> }): React.ReactElement {
  const [, setResizing, setDrawnWidth] = usePanelResizing();
  const phone = usePhoneSize();
  const labels = resolveLabels(useOptionalHost()?.labels);
  const fade = useChromeFade(React.useContext(PanelChromeVisibleContext));
  const drag = React.useRef<Drag | null>(null);
  const gap = slot.tuning.rowGap;
  const now = slot.slotRange?.now ?? 1;
  const most = slot.slotRange?.most ?? 1;
  const nearest = (width: number): number => Math.max(1, Math.min(most, Math.round((width + gap) / (phone.width + gap))));

  const follow = (d: Drag, clientX: number): void => {
    const x = clientX === 0 && d.lastX > FIREFOX_EDGE_X ? d.lastX : clientX;
    d.lastX = x;
    const dx = x - d.startX;
    d.width = d.startWidth + (side === 'right' ? dx : -dx);
    setDrawnWidth(d.width, side === 'left' ? 'end' : 'start');
  };
  const finish = (d: Drag, settle: boolean): void => {
    drag.current = null;
    if (settle) handle.setSlots(nearest(d.width), 'person');
    setDrawnWidth(null);
    setResizing(false);
    d.releaseSelection();
  };
  React.useEffect(() => () => {
    const d = drag.current;
    if (d !== null) finish(d, false);
  }, []);

  const step = (grow: boolean): void => {
    const next = Math.max(1, Math.min(most, now + (grow ? 1 : -1)));
    if (next !== now) handle.setSlots(next, 'person');
  };

  return (
    <Box
      ref={fade}
      role="separator"
      aria-orientation="vertical"
      aria-label={labels.resizeGrip(side)}
      aria-valuemin={1}
      aria-valuemax={most}
      aria-valuenow={now}
      aria-valuetext={labels.resizeGripValue(now, most)}
      tabIndex={0}
      data-panel-resize-grip={side}
      {...{ [CHROME_ATTRIBUTE]: CHROME_PARTS.resize }}
      onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || !e.isPrimary || drag.current !== null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: slot.drawn?.width ?? phone.width, width: slot.drawn?.width ?? phone.width, lastX: e.clientX, releaseSelection: holdDragSelection(document) };
        setResizing(true);
      }}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d !== null && d.pointerId === e.pointerId) follow(d, e.clientX);
      }}
      onPointerUp={(e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d === null || d.pointerId !== e.pointerId) return;
        follow(d, e.clientX);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        finish(d, true);
      }}
      onPointerCancel={(e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d !== null && d.pointerId === e.pointerId) finish(d, false);
      }}
      onLostPointerCapture={(e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (d !== null && d.pointerId === e.pointerId) finish(d, false);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        step((e.key === 'ArrowRight') === (side === 'right'));
      }}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side]: `${-gap / 2}px`,
        width: `${GRIP_PX}px`,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'ew-resize',
        touchAction: 'none',
        userSelect: 'none',
        outline: 'none',
        '&:focus-visible > span': { bgcolor: 'primary.main' },
        '&:hover > span': { bgcolor: 'text.secondary' },
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ width: 4, height: 48, borderRadius: (theme: Theme) => `${2 * Number(theme.shape.borderRadius)}px`, bgcolor: 'divider' }} />
    </Box>
  );
}

/**
 * A resize grip on each side of the panel it is drawn in. The width follows the pointer, the release settles the panel on
 * the nearest whole slot, Arrow keys step one slot, and Reduce Motion snaps the settle. It draws nothing when the panel's
 * `resizable` setting is false or fewer than two slots can be shown. The default frame draws it; a view that draws its own
 * `Panel` puts it in `overlay`. `usePanelResizing` stays public for a grip drawn differently.
 * @public
 */
export function PanelResizeGrips(): React.ReactElement | null {
  const slot = React.useContext(PanelSlotContext);
  const handle = slot?.handle;
  if (slot === undefined || handle === undefined || !slot.resizable || (slot.slotRange?.most ?? 1) < 2) return null;
  return (
    <>
      <Grip side="left" slot={slot} handle={handle} />
      <Grip side="right" slot={slot} handle={handle} />
    </>
  );
}
