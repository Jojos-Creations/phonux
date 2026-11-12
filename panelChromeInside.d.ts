/**
 * The header and footer drawn inside the frame (`tuning.chrome.where` 'inside'): inset pills over the content, which a panel
 * that scrolls hides while it scrolls down and brings back as soon as it scrolls up, or while Option (Alt) is held. At rest
 * they follow `tuning.chrome.mode` like chrome outside the frame.
 */
import * as React from 'react';
/** The attribute on a panel's root while its header and footer are inside its frame. @public */
export declare const CHROME_INSIDE_ATTRIBUTE = "data-panel-chrome-inside";
/**
 * The room a pill takes from the frame's top or bottom, in px: what a scrolling view pads its content by, through the
 * `--panel-chrome-inset` variable the panel's root carries, so its first rows start clear of the pill.
 * @public
 */
export declare const PANEL_CHROME_INSET_PX: number;
/** The root's rules; set on the root, so they outrank the parts' own offsets without touching them. */
export declare const chromeInsideSx: {
    readonly [x: string]: "48px" | {
        readonly zIndex: 2;
        readonly borderRadius: 999;
        readonly bgcolor: "color-mix(in srgb, var(--mui-palette-background-paper, Canvas) 72%, transparent)";
        readonly backdropFilter: "blur(12px)";
        readonly boxShadow: 1;
        readonly left: string;
        readonly right: string;
        readonly top: 6;
        readonly bottom: "auto";
    } | {
        readonly zIndex: 2;
        readonly left: string;
        readonly right: string;
        readonly top: "auto";
        readonly bottom: 6;
    };
    readonly '--panel-chrome-inset': "48px";
};
/** Tracks scrolling under `root` while `inside`, and slides its header and footer. Returns the root's capture-phase scroll handler. */
export declare function useChromeScrollAway(root: React.RefObject<HTMLElement | null>, inside: boolean): (event: React.UIEvent<HTMLElement>) => void;
