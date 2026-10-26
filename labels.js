/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS = {
    panelTitle: (id) => `Panel ${id}`,
    untitledPanel: 'Untitled panel',
    untitledHeader: 'Untitled',
    historyTitle: 'History',
    pin: 'Pin',
    unpin: 'Unpin',
    pinFailed: 'Could not pin this panel',
    unpinFailed: 'Could not unpin this panel',
    move: 'Move',
    close: 'Close',
    lock: 'Lock',
    unlock: 'Unlock',
    newWorkspace: 'Create new workspace',
    goToWorkspace: (name) => `Go to ${name}`,
    workspaceName: 'Workspace name',
    row: 'Panels',
    panelPosition: (title, place, total) => `${title}, ${place} of ${total}`,
    grabStrip: (title) => `Move or close ${title}`,
    pickedUp: (title) => `Picked up ${title}`,
    dropped: (title) => `Dropped ${title}`,
    dragCancelled: (title) => `Cancelled moving ${title}`,
    moved: (title, steps) => `Moved ${title} ${steps < 0 ? 'left' : 'right'}`,
    cannotMove: (title, steps) => `${title} cannot move ${steps < 0 ? 'left' : 'right'}`,
    closed: (title) => `Closed ${title}`,
    closedPagesTitle: 'Closed pages',
    closedPagesSearch: 'Search closed pages',
    closedPagesLoading: 'Loading',
    closedPagesEmpty: 'No closed pages yet',
    closedPagesNoMatches: 'No matches',
    closedPagesUntitled: 'Untitled',
    closedPagesShowMore: 'Show more',
    workspacePinned: 'Pinned',
    workspaceViewing: 'Viewing',
    workspaceHidden: 'Hidden',
    workspaceSearch: 'Search panels',
    workspaceUntitled: 'Untitled',
    workspaceEmpty: 'No panels yet.',
    workspaceNoMatches: 'No panels match.',
};
/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export function resolveLabels(given) {
    const out = { ...DEFAULT_LABELS };
    if (given === undefined)
        return out;
    for (const key of Object.keys(DEFAULT_LABELS)) {
        const value = given[key];
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
