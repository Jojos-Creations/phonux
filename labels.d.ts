/**
 * Every visible string the library draws or invents itself, so a host in another language or voice replaces them
 * instead of forking a component. Each takes English text by default.
 * @public
 */
export interface PhonuxLabels {
    /** The title of a panel `create()` opens without one, given the new panel's id. Default `Panel <id>`. */
    panelTitle: (id: string) => string;
    /** The title the unregistered-view placeholder shows for a panel with none. Default `Untitled panel`. */
    untitledPanel: string;
    /** The text a `PanelHeaderRow` shows when its title is empty. Default `Untitled`. */
    untitledHeader: string;
    /** The name of a pin button or action. Default `Pin`. */
    pin: string;
    /** The name of an unpin button or action. Default `Unpin`. */
    unpin: string;
    /** The text a host announces when a pin request is refused. Default `Could not pin this panel`. */
    pinFailed: string;
    /** The text a host announces when an unpin request is refused. Default `Could not unpin this panel`. */
    unpinFailed: string;
    /** The accessible name of a panel's move menu button, which holds Pin or Unpin. Default `Move`. */
    move: string;
    /** The accessible name of a panel's close button. Default `Close`. */
    close: string;
    /** The text of the button that creates a workspace where the column has none above or below. Default `Create new workspace`. */
    newWorkspace: string;
    /** The accessible name of the button that moves to the workspace called `name`. Default `Go to <name>`. */
    goToWorkspace: (name: string) => string;
    /** The accessible name of the input that holds a workspace's name. Default `Workspace name`. */
    workspaceName: string;
    /** The accessible name of the row of panels, a region. Default `Panels`. */
    row: string;
    /** The accessible name of one panel's group: its title and its place among the panels drawn. Default `<title>, <place> of <total>`. */
    panelPosition: (title: string, place: number, total: number) => string;
    /** The accessible name of a panel's grab strip, a button that takes ArrowLeft, ArrowRight and Delete. Default `Move or close <title>`. */
    grabStrip: (title: string) => string;
    /** Said when a drag picks the panel up. Default `Picked up <title>`. */
    pickedUp: (title: string) => string;
    /** Said when a drag lets the panel go. Default `Dropped <title>`. */
    dropped: (title: string) => string;
    /** Said when a drag is cancelled. Default `Cancelled moving <title>`. */
    dragCancelled: (title: string) => string;
    /** Said after a key moved the panel one slot: `steps` is -1 for left and 1 for right. Default `Moved <title> left` or `Moved <title> right`. */
    moved: (title: string, steps: number) => string;
    /** Said when a key could not move the panel because it is at that end of the row. Default `<title> cannot move left` or `<title> cannot move right`. */
    cannotMove: (title: string, steps: number) => string;
    /** Said after a panel closed. Default `Closed <title>`. */
    closed: (title: string) => string;
    /** The title a workspace grid gives a panel with no title and no url. Default `Untitled`. */
    workspaceUntitled: string;
    /** Shown in a workspace grid when there are no panels to list. Default `No panels yet.`. */
    workspaceEmpty: string;
    /** The name of a panel's width control and of the group of widths it opens. Default `View Size`. */
    viewSize: string;
    /** The name of the width that is `slots` phones wide. Default `Phone`, `Fold`, `Tablet`, `Desktop`, `Ultrawide`, then `<slots> phones`. */
    sizeName: (slots: number) => string;
    /** The name of the width control's entry that grows the panel to fill the window. Default `Fullscreen`. */
    fullscreen: string;
    /** Said when a width picked in the width control was refused. Default `Could not resize this panel`. */
    couldNotResize: string;
    /** Said when the browser refused to grow the panel to fill the window. Default `Could not make this panel fullscreen`. */
    couldNotFullscreen: string;
}
/** The English text every label takes when a host overrides none. @public */
export declare const DEFAULT_LABELS: Readonly<PhonuxLabels>;
/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export declare function resolveLabels(given?: Partial<PhonuxLabels>): PhonuxLabels;
