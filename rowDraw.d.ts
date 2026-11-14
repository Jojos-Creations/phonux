/**
 * The row's one drawing pass. Where each slot rests is written here once per commit; React's first render writes the same rest,
 * and nothing else does. A slot's own mover (slotMover.ts) only adds how far the slot is from that rest while it moves; Embla
 * moves the strip itself (emblaRow.ts).
 */
import * as React from 'react';
/** Writes every slot's rest under `boxRef` after each commit. A leaving slot keeps the rest it last rendered, so its exit is not carried along by the row it left. @internal */
export declare function useRowDraw(boxRef: React.RefObject<HTMLElement | null>): void;
