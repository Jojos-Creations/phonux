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
  /** The accessible name of the phone-detect prompt. Default `Phone connected`. */
  phoneConnected: string;
  /** The prompt's visible line, given the detected device's vendor name. Default `<vendor> connected`. */
  phoneConnectedText: (vendor: string) => string;
  /** The accessible name of the prompt's model picker. Default `Phone model`. */
  phoneModel: string;
  /** The prompt's resize button text. Default `Resize`. */
  resize: string;
  /** The accessible name of the prompt's dismiss button. Default `Dismiss`. */
  dismiss: string;
  /** The name of a pin button or action. Default `Pin`. */
  pin: string;
  /** The name of an unpin button or action. Default `Unpin`. */
  unpin: string;
  /** The name of a lock button or action, which makes a panel not closable. Default `Lock`. */
  lock: string;
  /** The name of an unlock button or action. Default `Unlock`. */
  unlock: string;
}

/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS: Readonly<PhonuxLabels> = {
  panelTitle: (id) => `Panel ${id}`,
  untitledPanel: 'Untitled panel',
  untitledHeader: 'Untitled',
  historyTitle: 'History',
  phoneConnected: 'Phone connected',
  phoneConnectedText: (vendor) => `${vendor} connected`,
  phoneModel: 'Phone model',
  resize: 'Resize',
  dismiss: 'Dismiss',
  pin: 'Pin',
  unpin: 'Unpin',
  lock: 'Lock',
  unlock: 'Unlock',
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
