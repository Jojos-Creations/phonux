/** Opacity is not inherited, so every ancestor counts. A NaN opacity (no computed value, as in jsdom) counts as shown. */
export declare function isFadedOrHidden(el: HTMLElement): boolean;
/** True when every RGBA pixel equals the first one: a blank or transparent picture, not a view of anything. */
export declare function isOneColour(pixels: Uint8ClampedArray): boolean;
/**
 * The pixel size of a picture of a `width` x `height` CSS px view: the view scaled down to fit inside the tile box,
 * never up. Fitting inside (not covering) keeps both sides within the box.
 */
export declare function tilePictureBox(width: number, height: number): {
    readonly width: number;
    readonly height: number;
};
