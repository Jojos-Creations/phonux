/**
 * The narrowest row container that still shows every fixed column plus a minimum of panels beside them. Pure, from the
 * same numbers the row's fit reads, so a host can bound its window with it.
 */
import { ROW_GAP } from './rowConstants.js';
/** The width of the tablet panel the minimum has always kept room for; the tier table that named it is gone. */
const TABLET_WIDTH = 768;
/**
 * The narrowest row container, in whole px, at which every fixed column plus `phoneSlots` phone slots fit side by side,
 * or every fixed column plus one tablet panel when that is wider.
 *
 * @remarks
 * The row is one gap at each edge, each fixed column and the gap after it, then the wider of the phone slots (with a gap
 * between each two) and the tablet, rounded up:
 * `gap + F x (phoneWidth + gap) + max(N x phoneWidth + (N - 1) x gap, tabletWidth) + gap`,
 * with F the fixed columns and N the phone slots. At this width the row fits that many phones without parking
 * one and draws a tablet panel at its full width; one pixel less fits fewer. The value is the row container's width, so
 * a host whose window is wider than its row adds the difference. A two-slot panel is exactly two phone slots wide.
 *
 * @example
 * History alone at the default phone (390) and gap (16): `minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1 })`
 * is 1234.
 *
 * @throws RangeError when `phoneWidth` is not above 0, `fixedColumnCount` is not a whole number of 0 or more, or
 * `phoneSlots` is not a whole number of 1 or more.
 * @public
 */
export function minWorkspaceWidth(input) {
    const { phoneWidth, fixedColumnCount, phoneSlots = 2, tabletWidth = TABLET_WIDTH, gap = ROW_GAP } = input;
    if (!(phoneWidth > 0) || !Number.isFinite(phoneWidth))
        throw new RangeError(`minWorkspaceWidth: phoneWidth must be above 0, got ${phoneWidth}`);
    if (!Number.isInteger(fixedColumnCount) || fixedColumnCount < 0)
        throw new RangeError(`minWorkspaceWidth: fixedColumnCount must be a whole number of 0 or more, got ${fixedColumnCount}`);
    if (!Number.isInteger(phoneSlots) || phoneSlots < 1)
        throw new RangeError(`minWorkspaceWidth: phoneSlots must be a whole number of 1 or more, got ${phoneSlots}`);
    const phones = phoneSlots * phoneWidth + (phoneSlots - 1) * gap;
    const beside = Math.max(phones, tabletWidth);
    return Math.ceil(gap + fixedColumnCount * (phoneWidth + gap) + beside + gap);
}
