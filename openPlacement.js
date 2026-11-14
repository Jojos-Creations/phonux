/** `p` against `inView`, the panels in view left to right. @internal */
export function resolveOpen(inView, p) {
    const n = inView.length;
    if (n === 0)
        return { place: 'row-end' };
    const slot = Math.max(0, Math.floor(p.slot));
    if (slot >= n)
        return { place: { after: inView[n - 1] }, leaves: inView[0] };
    const occupant = inView[slot];
    // The anchor is a neighbor that stays; the occupant still holds its room while its close plays, so it is the one that leaves.
    if (p.occupant === 'close')
        return { place: slot > 0 ? { after: inView[slot - 1] } : n > 1 ? { before: inView[1] } : 'row-end', leaves: occupant, closes: occupant };
    if (p.occupant === 'shift-right')
        return { place: { before: occupant }, leaves: inView[n - 1] };
    return { place: { after: occupant }, leaves: inView[0] };
}
