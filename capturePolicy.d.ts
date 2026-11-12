/** Opacity is not inherited, so every ancestor counts. A NaN opacity (no computed value, as in jsdom) counts as shown. */
export declare function isFadedOrHidden(el: HTMLElement): boolean;
/** What PanelLoader fires from its own root once a panel's real content is up and its placeholder gone. @internal */
export declare const PANEL_LOADED_EVENT = "phonux-panel-loaded";
/** A panel still behind its placeholder, or showing a failed load: a picture of it would stand in for the page in its tile. */
export declare function isStillLoading(el: HTMLElement): boolean;
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
