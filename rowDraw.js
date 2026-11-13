/**
 * The row's one drawing pass. Where each slot rests is written here once per commit; React's first render writes the same rest,
 * and nothing else does. A slot's own mover (slotMover.ts) only adds how far the slot is from that rest while it moves; Embla
 * moves the strip itself (emblaRow.ts).
 */
import * as React from 'react';
import { restTranslate } from './slotMover.js';
/** Writes every slot's rest under `boxRef` after each commit. A leaving slot keeps the rest it last rendered, so its exit is not carried along by the row it left. @internal */
export function useRowDraw(boxRef) {
    React.useLayoutEffect(() => {
        const anchor = boxRef.current;
        if (anchor === null)
            return;
        for (const slot of anchor.querySelectorAll('[data-row-slot]')) {
            const rest = restTranslate(Number(slot.dataset.rowSlot));
            if (slot.style.translate !== rest)
                slot.style.translate = rest;
        }
    });
}
