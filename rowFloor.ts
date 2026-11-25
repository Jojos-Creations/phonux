import * as React from 'react';

/**
 * The fewest scrolling slots the row below it keeps beside its sticky panels, over the workspace's `tuning.minScrollSlots`. A column
 * whose spaces share its window gives each cell the row slots its split asks for, so a sticky panel goes back into the row before the
 * row gives up a slot it was given.
 * @internal
 */
export const RowFloorContext = React.createContext<number | undefined>(undefined);
