/**
 * The blank space a parking row can rest with: a half slot after the always-shown columns, and slots after the last drawn panel.
 * A rest lets a panel sit in the window's center when no whole-slot row would put it there, and it lives only as long as the row
 * it was made for. Pure: the list hook holds it, the numbers draw it, and capacity counts it, so no parked panel refills a blank.
 */
const NEAR_PX = 1;
/** One whole step further into the blank after the last panel, or null once the last panel is as near the center as the step gets. */
function tailStep(i) {
    if (i.parkable === null)
        return null;
    if (i.lastOff - i.parkable < -NEAR_PX)
        return null;
    return { park: 'left', rest: { lead: 0, tail: (i.rest?.tail ?? 0) + Math.round(i.parkable / i.slot) } };
}
/** One whole step further into the blank before the root, or null once the root is as near the center as the step gets. A row with room to spare recenters, so a blank moves it half as far. */
function headStep(i) {
    if (i.lastParkable == null || i.rootOff == null)
        return null;
    const px = i.roomy === true ? i.slot : i.lastParkable;
    if (i.rootOff + (i.roomy === true ? px / 2 : px) > NEAR_PX)
        return null;
    const rest = { lead: 0, tail: i.rest?.tail ?? 0, head: (i.rest?.head ?? 0) + Math.round(px / i.slot) };
    return i.roomy === true ? { rest } : { park: 'right', rest };
}
/**
 * What a step does to a row that rests or could begin to, or null when it is the row's ordinary step. A half rest snaps back to
 * whole slots on any step. On whole slots a step right past the last panel opens a blank, and a step left closes one.
 * @internal
 */
export function restStep(i) {
    const { direction, rest, canLeft, canRight } = i;
    const head = rest?.head ?? 0;
    if (head > 0) {
        if (direction === 'left')
            return headStep(i);
        const half = head % 1 !== 0;
        const back = { lead: 0, tail: Math.max(0, (rest?.tail ?? 0) - (half ? 0.5 : 0)), head: half ? Math.floor(head) : head - 1 };
        return canRight ? { reveal: 'right', rest: back } : { rest: back };
    }
    if (rest !== null && rest.lead > 0) {
        const back = { lead: 0, tail: Math.max(0, rest.tail - 0.5) };
        const held = { lead: 0, tail: rest.tail + 0.5 };
        if (direction === 'right') {
            if (canRight)
                return { reveal: 'right', rest: back };
            return i.lastOff - i.slot / 2 < -NEAR_PX ? null : { rest: held };
        }
        if (canLeft)
            return { reveal: 'left', rest: back };
        return canRight ? { reveal: 'right', rest: back } : { rest: held };
    }
    const tail = rest?.tail ?? 0;
    if (direction === 'left') {
        if (tail === 0)
            return canLeft ? null : headStep(i);
        return canLeft ? { reveal: 'left', rest: { lead: 0, tail: Math.max(0, tail - i.revealSlots) } } : { rest: { lead: 0, tail: 0 } };
    }
    if (canRight)
        return tail === 0 ? null : { reveal: 'right', rest: { lead: 0, tail: Math.max(0, tail - 1) } };
    return tailStep(i);
}
/** The rest that centers a panel sitting half a slot off: one more blank slot, split as a half on each side of the panels. @internal */
export function halfRest(rest) {
    return { lead: 0.5, tail: (rest?.tail ?? 0) + 0.5 };
}
/** Whether a panel `off` px from the window's center sits half a slot from it, which only a half rest can center. @internal */
export function isHalfOff(off, slot) {
    return Math.abs(Math.abs(off) - slot / 2) <= 2;
}
