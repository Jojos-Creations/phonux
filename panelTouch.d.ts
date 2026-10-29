/**
 * Touch handling for a template declared with `touch: true` or `touch: 'content'`: while such a panel is active and the pointer is inside it, a mouse
 * drag scrolls the content under it as a finger does and coasts on release. It never moves the row, which stays the wheel's
 * and the keys'. Anywhere else, or with Option (Alt) held at the press, the mouse is a mouse. A press that stays put clicks.
 */
import * as React from 'react';
import type { PanelTouch } from './panelTemplate.js';
/** The `touch` of the template the panel is made from. @internal */
export declare const PanelTouchContext: React.Context<PanelTouch>;
/** The attributes and listeners a panel root needs for touch: `rootRef` is the root, `touch` the context value. @internal */
export declare function usePanelTouch(rootRef: React.RefObject<HTMLElement | null>, touch: PanelTouch): Record<string, string>;
