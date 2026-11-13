/**
 * Applies `intent` to the row's scroller. False when the driver refused it (a hold is in place), true otherwise.
 * @internal
 */
export function applyRowIntent(scroller, intent) {
    switch (intent.kind) {
        case 'step':
            return stepGlide(scroller, intent.to, intent);
        case 'place':
            return scroller.glideTo(intent.to, { durationSec: 0, instant: true, ease: intent.ease });
        case 'settle':
        case 'show':
        case 'summon':
            return scroller.glideTo(intent.to, { durationSec: intent.durationSec, instant: intent.instant, ease: intent.ease });
    }
}
/** Takes the row's scroll for a drag or a resize; null while another holder has it. @internal */
export function holdRow(scroller, o) {
    return scroller.claim(o);
}
/** The shortest a step's glide gets however fast the input comes: quicker reads as a jump cut, not a slide. */
export const FAST_SCROLL_FLOOR_SEC = 0.25;
const lastAsk = new WeakMap();
/**
 * Moves the row for a person's step or dot. A move asked while another glides retargets it, carrying its speed, over the time
 * since the last ask, never less than the floor: fast input reads as one quicker glide, never a queue of slides. Under 'jump'
 * a move of more than a window fades past everything between instead.
 */
export function stepGlide(scroller, to, o) {
    const now = performance.now();
    const since = now - (lastAsk.get(scroller) ?? Number.NEGATIVE_INFINITY);
    lastAsk.set(scroller, now);
    if (o.instant)
        return scroller.glideTo(to, { durationSec: 0, instant: true, ease: o.ease });
    if (o.mode === 'jump' && Math.abs(to - scroller.scrollLeft()) > o.windowWidth)
        return scroller.glideTo(to, { durationSec: o.durationSec, instant: false, ease: o.ease, fade: true });
    if (scroller.glideTarget() === null)
        return scroller.glideTo(to, { durationSec: o.durationSec, instant: false, ease: o.ease });
    const durationSec = Math.min(o.durationSec, Math.max(FAST_SCROLL_FLOOR_SEC, since / 1000));
    return scroller.glideTo(to, { durationSec, instant: false, ease: o.ease, carry: true });
}
