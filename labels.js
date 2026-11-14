const SIZE_NAMES = ['Phone', 'Fold', 'Tablet', 'Desktop', 'Ultrawide'];
/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS = {
    panelTitle: (id) => `Panel ${id}`,
    untitledPanel: 'Untitled panel',
    untitledHeader: 'Untitled',
    close: 'Close',
    newWorkspace: 'New space',
    goToWorkspace: (name) => `Go to ${name}`,
    workspaceName: 'Space name',
    row: 'Panels',
    panelPosition: (title, place, total) => `${title}, ${place} of ${total}`,
    grabStrip: (title) => `Move or close ${title}`,
    pickedUp: (title) => `Picked up ${title}`,
    dropped: (title) => `Dropped ${title}`,
    dragCancelled: (title) => `Cancelled moving ${title}`,
    moved: (title, steps) => `Moved ${title} ${steps < 0 ? 'left' : 'right'}`,
    cannotMove: (title, steps) => `${title} cannot move ${steps < 0 ? 'left' : 'right'}`,
    closed: (title) => `Closed ${title}`,
    undoCloseMessage: (titles) => (titles.length === 1 ? `Closed ${titles[0]}` : `Closed ${titles.length} panels`),
    undo: 'Undo',
    workspaceUntitled: 'Untitled',
    workspaceEmpty: 'No panels yet.',
    viewSize: 'View Size',
    couldNotLoad: 'This page could not load',
    tryAgain: 'Try again',
    sizeName: (slots) => SIZE_NAMES[slots - 1] ?? `${slots} phones`,
    fullscreen: 'Fullscreen',
    couldNotResize: 'Could not resize this panel',
    couldNotFullscreen: 'Could not make this panel fullscreen',
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
