/**
 * The divider between two spaces a column shows side by side: a focusable slider that moves by whole slots, by pointer or by key.
 * DESIGN.md, "Side by side".
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import { dividerRange, shiftDivider } from './columnSplit.js';
import type { WorkspaceColumnHandle } from './columnHandle.js';
import type { PhonuxLabels } from './labels.js';

/** The width of the strip that takes the pointer, in px, centered on the gap between the two cells. */
const HIT_PX = 24;
const LINE_PX = 2;

/** What a divider needs to draw and to move. @internal */
export interface ColumnDividerProps {
  column: WorkspaceColumnHandle;
  /** Evens the split out; the column's own, which knows each cell's sticky slots. */
  evenSplit: () => void;
  /** The row slots of every cell the window shows, left to right. */
  rows: readonly number[];
  /** The index of the cell on this divider's left. */
  at: number;
  /** The id of the cell it resizes, the one on its left, whose row panels `aria-valuenow` counts. */
  controls: string;
  /** The names of the two spaces it parts. */
  names: readonly [string, string];
  /** The least row slots a side keeps. */
  least: number;
  /** One phone plus one gap, in px: the distance a slot moves the divider. */
  pitch: number;
  /** Where the divider's centre sits, as a CSS length from the column's left edge. */
  center: string;
  labels: PhonuxLabels;
}

/** The divider. Pointer: a press and drag moves it a slot at a time; keys: Left and Right move it one slot, Home and End to the minimums; a double click evens the split. @internal */
export function ColumnDivider({ column, evenSplit, rows, at, controls, names, least, pitch, center, labels }: ColumnDividerProps): React.ReactElement {
  const range = dividerRange(rows, at, least);
  const drag = React.useRef<{ x: number; rows: readonly number[] } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const move = (next: readonly number[]): void => {
    if (next.some((r, k) => r !== rows[k])) column.setSplit(next);
  };
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={labels.splitDivider(names[0], names[1])}
      aria-controls={controls}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={rows[at]}
      aria-valuetext={labels.splitValue(names[0], rows[at]!, names[1], rows[at + 1]!)}
      // Focusable, and reached by Tab only through the column's steering: the dividers follow every cell in the DOM, where the
      // browser's own step out of the last space would land on them.
      tabIndex={-1}
      data-column-divider={at}
      data-column-divider-dragging={dragging ? '' : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, rows };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (start === null) return;
        move(shiftDivider(start.rows, at, Math.round((e.clientX - start.x) / pitch), least));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const to = e.key === 'ArrowLeft' ? rows[at]! - 1 : e.key === 'ArrowRight' ? rows[at]! + 1 : e.key === 'Home' ? range.min : e.key === 'End' ? range.max : undefined;
        if (to === undefined) return;
        e.preventDefault();
        move(shiftDivider(rows, at, to - rows[at]!, least));
      }}
      onDoubleClick={() => evenSplit()}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `calc(${center} - ${HIT_PX / 2}px)`,
        width: HIT_PX,
        zIndex: 5,
        cursor: 'col-resize',
        touchAction: 'none',
        outline: 'none',
        '& [data-column-divider-line]': { position: 'absolute', top: 0, bottom: 0, left: (HIT_PX - LINE_PX) / 2, width: LINE_PX, borderRadius: `${LINE_PX}px`, background: 'currentColor', opacity: dragging ? 0.6 : 0.2, pointerEvents: 'none' },
        '&:hover [data-column-divider-line]': { opacity: 0.5 },
        '&:focus-visible [data-column-divider-line]': { opacity: 1, background: 'var(--phonux-primary, currentColor)' },
      }}
    >
      <div aria-hidden data-column-divider-line="" />
    </Box>
  );
}
