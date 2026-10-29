import * as React from 'react';
/** Marks the cover a first press puts over its panel until the press is over. */
export declare const PRESS_COVER_ATTRIBUTE = "data-panel-press-cover";
/**
 * Makes a press on a panel not in use only put it in use: what the press lands on never sees its mousedown or click, and the
 * pointerdown itself still reaches the row and the window, which judge where a press lands. The release lands on a cover,
 * so the click goes to the slot or the cover, never to a control inside the panel.
 */
export declare function swallowFirstPress(slot: HTMLElement, event: PointerEvent): void;
/**
 * While `asleep`, the frames in `slot` take no pointer, so a first press on one lands in this document and only puts the
 * panel in use. A wheel over such a frame scrolls nothing until the panel is in use.
 */
export declare function useFramesAsleep(slot: React.RefObject<HTMLElement | null>, holdsFrame: boolean, asleep: boolean): void;
