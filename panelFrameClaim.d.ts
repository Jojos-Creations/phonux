/**
 * How a template's view tells the library it draws its own panel frame. The adapter that renders a view puts a
 * boundary above it; a `Panel` or `PanelFrame` that mounts below claims the boundary in a layout effect, so the boundary
 * knows before paint whether to draw the library's frame. A leaf module: Panel and PanelFrame import it, so it imports no component.
 */
import * as React from 'react';
/** A part of the frame a view can draw itself: the `Panel` shell or the `PanelFrame` card. */
export type FramePart = 'panel' | 'frame';
/** What a boundary lends the views below it: a claim for one part, and the function that gives it back. */
export interface FrameClaims {
    claim(part: FramePart): () => void;
}
/** Unset outside a template's view: a `Panel` there claims nothing and nobody is waiting for it. */
export declare const FrameClaimContext: React.Context<FrameClaims | undefined>;
/** Claims the boundary above for as long as the calling component is mounted. */
export declare function useFrameClaim(part: FramePart): void;
