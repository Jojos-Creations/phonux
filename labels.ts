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
  /** The accessible name of the grip on one side of a resizable panel. Default `Resize from the left edge` or `Resize from the right edge`. */
  resizeGrip: (side: 'left' | 'right') => string;
  /** The spoken value of a resize grip, given the slots the panel is wide and the most it can take. Default `<slots> of <most> slots wide`. */
  resizeGripValue: (slots: number, most: number) => string;
}

/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS: Readonly<PhonuxLabels> = {
  panelTitle: (id) => `Panel ${id}`,
  untitledPanel: 'Untitled panel',
  untitledHeader: 'Untitled',
  historyTitle: 'History',
  pin: 'Pin',
  unpin: 'Unpin',
  lock: 'Lock',
  unlock: 'Unlock',
  newWorkspace: 'Create new workspace',
  goToWorkspace: (name) => `Go to ${name}`,
  workspaceName: 'Workspace name',
  resizeGrip: (side) => `Resize from the ${side} edge`,
  resizeGripValue: (slots, most) => `${slots} of ${most} slots wide`,
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
