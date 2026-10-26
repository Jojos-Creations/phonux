/**
 * The built-in controls of a panel's header: a move menu whose one entry pins or unpins the panel, and an X that closes
 * it. Each control is drawn only when the panel allows its gesture, and nothing is drawn in the panel's body. The grab
 * handle is not drawn here: `Panel` draws it from `grabProps`, so a second one would appear beside it.
 */
import * as React from 'react';
/**
 * The header controls of the panel the call is made in, meant for the header slot (the `actions` of `Panel`, or of
 * `PanelHeaderRow`). It takes no props. It draws nothing outside a panel row.
 *
 * The move menu shows when the panel is movable or pinned and holds one entry, Pin or Unpin, which reads the panel's pinned
 * state; the X shows when the panel is closable. A refused pin or
 * unpin is announced through the workspace's live region.
 * @public
 */
export declare function PanelHeaderMenu(): React.JSX.Element | null;
