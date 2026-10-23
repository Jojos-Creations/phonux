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
  /** The title `createHistoryPanel` gives the History root entry. Default `History`. */
  historyTitle: string;
  /** The name of a pin button or action. Default `Pin`. */
  pin: string;
  /** The name of an unpin button or action. Default `Unpin`. */
  unpin: string;
  /** The text a host announces when a pin request is refused. Default `Could not pin this panel`. */
  pinFailed: string;
  /** The text a host announces when an unpin request is refused. Default `Could not unpin this panel`. */
  unpinFailed: string;
  /** The name of a lock button or action, which makes a panel not closable. Default `Lock`. */
  lock: string;
  /** The name of an unlock button or action. Default `Unlock`. */
  unlock: string;
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
  /** The title of the closed-pages panel when a template is made without one. Default `Closed pages`. */
  closedPagesTitle: string;
  /** The placeholder and accessible name of the closed-pages search field. Default `Search closed pages`. */
  closedPagesSearch: string;
  /** The text the closed-pages panel shows until its stored log is read. Default `Loading`. */
  closedPagesLoading: string;
  /** The text the closed-pages panel shows when nothing has been closed. Default `No closed pages yet`. */
  closedPagesEmpty: string;
  /** The text the closed-pages panel shows when the search matches nothing. Default `No matches`. */
  closedPagesNoMatches: string;
  /** The text a closed page with no title shows. Default `Untitled`. */
  closedPagesUntitled: string;
}

/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS: Readonly<PhonuxLabels> = {
  panelTitle: (id) => `Panel ${id}`,
  untitledPanel: 'Untitled panel',
  untitledHeader: 'Untitled',
  historyTitle: 'History',
  pin: 'Pin',
  unpin: 'Unpin',
  pinFailed: 'Could not pin this panel',
  unpinFailed: 'Could not unpin this panel',
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
};

/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export function resolveLabels(given?: Partial<PhonuxLabels>): PhonuxLabels {
  const out: PhonuxLabels = { ...DEFAULT_LABELS };
  if (given === undefined) return out;
  for (const key of Object.keys(DEFAULT_LABELS) as (keyof PhonuxLabels)[]) {
    const value = given[key];
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}
