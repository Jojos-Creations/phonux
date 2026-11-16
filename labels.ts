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
  /** The accessible name of a panel's close button. Default `Close`. */
  close: string;
  /** The text of the button that creates a workspace where the column has none above or below. Default `New space`. */
  newWorkspace: string;
  /** The accessible name of the button that moves to the workspace called `name`. Default `Go to <name>`. */
  goToWorkspace: (name: string) => string;
  /** The accessible name of the input that holds a workspace's name. Default `Space name`. */
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
  /** Said when a drag is canceled. Default `Cancelled moving <title>`. */
  dragCancelled: (title: string) => string;
  /** Said after a key moved the panel one slot: `steps` is -1 for left and 1 for right. Default `Moved <title> left` or `Moved <title> right`. */
  moved: (title: string, steps: number) => string;
  /** Said when a key could not move the panel because it is at that end of the row. Default `<title> cannot move left` or `<title> cannot move right`. */
  cannotMove: (title: string, steps: number) => string;
  /** Said after a panel closed. Default `Closed <title>`. */
  closed: (title: string) => string;
  /** The undo-close toast's text, given the titles of the panels the undo would bring back (at least one). Default `Closed <title>`, or `Closed <count> panels`. */
  undoCloseMessage: (titles: readonly string[]) => string;
  /** The undo-close toast's button. Default `Undo`. */
  undo: string;
  /** The title a workspace grid gives a panel with no title and no url. Default `Untitled`. */
  workspaceUntitled: string;
  /** Shown in a workspace grid when there are no panels to list. Default `No panels yet.`. */
  workspaceEmpty: string;
  /** The name of a panel's width control and of the group of widths it opens. Default `View Size`. */
  viewSize: string;
  /** What a panel says when its content could not load. Default `This page could not load`. */
  couldNotLoad: string;
  /** The button that loads it again. Default `Try again`. */
  tryAgain: string;
  /** The name of the width that is `slots` phones wide. Default `Phone`, `Fold`, `Tablet`, `Desktop`, `Ultrawide`, then `<slots> phones`. */
  sizeName: (slots: number) => string;
  /** The name of the width control's entry that grows the panel to fill the window. Default `Fullscreen`. */
  fullscreen: string;
  /** Said when a width picked in the width control was refused. Default `Could not resize this panel`. */
  couldNotResize: string;
  /** Said when the browser refused to grow the panel to fill the window. Default `Could not make this panel fullscreen`. */
  couldNotFullscreen: string;
  /** The dot bar oval's spoken value: the places of the first and last panels the window shows, and how many panels the row has. Default `Panels <first> to <last> of <total>`, or `Panel <first> of <total>` for one. */
  dotBarView: (first: number, last: number, total: number) => string;
  /** The accessible name of the row of share tabs. Default `How to share`. */
  shareTabsName: string;
  /** The share sheet's title. Default `Share`. */
  shareTitle: string;
  /** The accessible name of the share sheet's back button. Default `Back`. */
  shareBack: string;
  /** The share sheet's tab for showing a QR code to someone nearby. Default `In person`. */
  shareTabInPerson: string;
  /** The share sheet's tab for sending to people the person trusts. Default `People`. */
  shareTabPeople: string;
  /** The share sheet's tab for a web link. Default `Link`. */
  shareTabLink: string;
  /** The line under the QR code. Default `Show this to someone next to you. Their phone gets the file over your Wi-Fi, or the web if that is faster.`. */
  shareInPersonHint: string;
  /** The line above the list of trusted people. Default `People who trust you get "Accept file from you?" on their phone. Nobody else can send them files.`. */
  sharePeopleHint: string;
  /** A trusted person's send button. Default `Send`. */
  shareSend: string;
  /** The accessible name of the send button for the person called `name`. Default `Send to <name>`. */
  shareSendTo: (name: string) => string;
  /** What a person already sent to shows in place of the send button. Default `Sent`. */
  shareSent: string;
  /** The row that adds a trusted person. Default `Add someone you trust`. */
  shareAddPerson: string;
  /** The line under `shareAddPerson`. Default `Trade a code once, then send any time`. */
  shareAddPersonHint: string;
  /** The note at the foot of the People tab. Default `An offer waits 7 days, then goes away by itself.`. */
  shareOfferWaits: string;
  /** The link tab's copy button. Default `Copy link`. */
  shareCopyLink: string;
  /** The link tab's button that opens the system share sheet. Default `More apps`. */
  shareMoreApps: string;
  /** When the link ends: whole days left, or null for no expiry, and the opens allowed, or null for no limit. Default `Link ends in 7 days or after 20 opens.`. */
  shareLinkEnds: (days: number | null, opens: number | null) => string;
  /** The button that changes when the link ends. Default `Change`. */
  shareChange: string;
  /** The title of the card that offers a file, given the sender's saved name. Default `<from> wants to send you a file`. */
  offerTitle: (from: string) => string;
  /** The line under the offer's title. Default `<from> is on your trusted list`. */
  offerTrusted: (from: string) => string;
  /** The offer's reassurance, given the whole days before it goes away. Default `Nothing downloads until you accept. The offer goes away in 7 days.`. */
  offerNote: (days: number) => string;
  /** The offer's main button. Default `Accept and save`. */
  offerAccept: string;
  /** The offer's decline button. Default `Decline`. */
  offerDecline: string;
  /** The offer's report button. Default `Report`. */
  offerReport: string;
  /** The accessible name of the shared list's tabs. Default `Shared files`. */
  sharedTabsName: string;
  /** The shared list's tab for what the person shared. Default `By you`. */
  sharedByYou: string;
  /** The shared list's tab for what others shared with the person. Default `With you`. */
  sharedWithYou: string;
  /** Shown when a shared list tab has no rows. Default `Nothing here yet.`. */
  sharedEmpty: string;
  /** The button on a row whose link ended. Default `Renew`. */
  sharedRenew: string;
  /** The accessible name of a row's menu button, given the row's file name and, for a `person` row, the other person's name. Default `More for <name>`, or `More for <name> to <person>`. */
  sharedMore: (name: string, person?: string) => string;
  /** A row menu entry. Default `Copy link again`. */
  sharedCopyAgain: string;
  /** A row menu entry. Default `Show QR code`. */
  sharedShowQr: string;
  /** A row menu entry. Default `Change when it ends`. */
  sharedChangeEnd: string;
  /** A row menu entry. Default `Stop sharing`. */
  sharedStop: string;
}

const SIZE_NAMES = ['Phone', 'Fold', 'Tablet', 'Desktop', 'Ultrawide'] as const;

/** The English text every label takes when a host overrides none. @public */
export const DEFAULT_LABELS: Readonly<PhonuxLabels> = {
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
  dotBarView: (first, last, total) => (first === last ? `Panel ${first} of ${total}` : `Panels ${first} to ${last} of ${total}`),
  shareTabsName: 'How to share',
  shareTitle: 'Share',
  shareBack: 'Back',
  shareTabInPerson: 'In person',
  shareTabPeople: 'People',
  shareTabLink: 'Link',
  shareInPersonHint: 'Show this to someone next to you. Their phone gets the file over your Wi-Fi, or the web if that is faster.',
  sharePeopleHint: 'People who trust you get "Accept file from you?" on their phone. Nobody else can send them files.',
  shareSend: 'Send',
  shareSendTo: (name) => `Send to ${name}`,
  shareSent: 'Sent',
  shareAddPerson: 'Add someone you trust',
  shareAddPersonHint: 'Trade a code once, then send any time',
  shareOfferWaits: 'An offer waits 7 days, then goes away by itself.',
  shareCopyLink: 'Copy link',
  shareMoreApps: 'More apps',
  shareLinkEnds: (days, opens) => {
    const inDays = days === null ? null : `in ${days} ${days === 1 ? 'day' : 'days'}`;
    const afterOpens = opens === null ? null : `after ${opens} ${opens === 1 ? 'open' : 'opens'}`;
    const when = [inDays, afterOpens].filter((x) => x !== null).join(' or ');
    return when === '' ? 'Link does not end.' : `Link ends ${when}.`;
  },
  shareChange: 'Change',
  offerTitle: (from) => `${from} wants to send you a file`,
  offerTrusted: (from) => `${from} is on your trusted list`,
  offerNote: (days) => `Nothing downloads until you accept. The offer goes away in ${days} ${days === 1 ? 'day' : 'days'}.`,
  offerAccept: 'Accept and save',
  offerDecline: 'Decline',
  offerReport: 'Report',
  sharedTabsName: 'Shared files',
  sharedByYou: 'By you',
  sharedWithYou: 'With you',
  sharedEmpty: 'Nothing here yet.',
  sharedRenew: 'Renew',
  sharedMore: (name, person) => (person === undefined ? `More for ${name}` : `More for ${name} to ${person}`),
  sharedCopyAgain: 'Copy link again',
  sharedShowQr: 'Show QR code',
  sharedChangeEnd: 'Change when it ends',
  sharedStop: 'Stop sharing',
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
