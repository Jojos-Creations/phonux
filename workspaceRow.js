import * as React from 'react';
/** @internal */
export const WorkspaceRowContext = React.createContext(null);
/**
 * The mounted row's numbers, entries and fit, for a component `wrap` renders around the row. Only valid inside `wrap`.
 * @public
 */
export function useWorkspaceRow() {
    const row = React.useContext(WorkspaceRowContext);
    if (row === null)
        throw new Error('phonux: useWorkspaceRow() is only valid inside a workspace wrap');
    return row;
}
