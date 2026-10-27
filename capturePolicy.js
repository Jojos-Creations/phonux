// Which panels and which pictures a tile capture may use. A faded or hidden panel, or a picture of one colour, must
// never replace the last good picture of that panel.
/** The largest picture a tile shows: 2x the widest tile in a three-column grid. Pixels past it are encoding cost nobody sees. */
const TILE_PICTURE_MAX_WIDTH = 260;
const TILE_PICTURE_MAX_HEIGHT = 520;
/** Opacity is not inherited, so every ancestor counts. A NaN opacity (no computed value, as in jsdom) counts as shown. */
export function isFadedOrHidden(el) {
    for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 1)
            return true;
    }
    return false;
}
/** True when every RGBA pixel equals the first one: a blank or transparent picture, not a view of anything. */
export function isOneColour(pixels) {
    for (let i = 4; i < pixels.length; i++)
        if (pixels[i] !== pixels[i % 4])
            return false;
    return true;
}
/**
 * The pixel size of a picture of a `width` x `height` CSS px view: the view scaled down to fit inside the tile box,
 * never up. Fitting inside (not covering) keeps both sides within the box.
 */
export function tilePictureBox(width, height) {
    const scale = Math.min(1, TILE_PICTURE_MAX_WIDTH / width, TILE_PICTURE_MAX_HEIGHT / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
