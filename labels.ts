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
  /** The accessible name of the divider between two spaces shown side by side, a slider the person drags or moves with the arrow keys. Default `Resize <left> and <right>`, naming the two spaces it parts. */
  splitDivider: (left: string, right: string) => string;
  /** The spoken value of a divider: the space on its left and its row panels, the space on its right and its row panels. Default `<left> <n> panels, <right> <n> panels`. */
  splitValue: (left: string, leftPanels: number, right: string, rightPanels: number) => string;
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
  /** The line under the QR code. Default `Show this to someone next to you. Their phone gets it over your Wi-Fi, or the web if that is faster.`. */
  shareInPersonHint: string;
  /** The line above the list of trusted people. Default `Accounts and people you trust. They get an offer on their phone, and nothing downloads until they add it.`. */
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
  /** The note at the foot of the People tab. Default `An invite waits 7 days, then goes away by itself.`. */
  shareOfferWaits: string;
  /** The link tab's copy button. Default `Copy link`. */
  shareCopyLink: string;
  /** The link tab's button that opens the system share sheet. Default `More apps`. */
  shareMoreApps: string;
  /** When the link ends: whole days left, or null for no expiry, and the opens allowed, or null for no limit. Default `Link ends in 7 days or after 20 opens.`. */
  shareLinkEnds: (days: number | null, opens: number | null) => string;
  /** The button that changes when the link ends. Default `Change`. */
  shareChange: string;
  /** The title of the card that offers an item, given the sender's saved name and the item's kind in words (`space`, `file`). Default `<from> shared a <kind> with you`, with `an` before a vowel. */
  offerTitle: (from: string, kind: string) => string;
  /** The line under the offer's title. Default `<from> is on your trusted list`. */
  offerTrusted: (from: string) => string;
  /** The offer's reassurance, given the whole days before it goes away. Default `Nothing downloads until you add it. The offer goes away in 7 days.`. */
  offerNote: (days: number) => string;
  /** The offer's main button, given the item's kind in the plural (`spaces`). Default `Add to my <plural>`. */
  offerAccept: (kindPlural: string) => string;
  /** The offer's button that leaves the offer waiting. Default `Not now`. */
  offerNotNow: string;
  /** The offer's decline button. Default `Decline`. */
  offerDecline: string;
  /** The offer's report button. Default `Report`. */
  offerReport: string;
  /** The kind of a shared item in words, lower case and singular. Default the kind as given (`space`, `playlist`, `track`, `page`, `file`); a host in another language maps each kind. */
  shareKind: (kind: string) => string;
  /** The same kind in the plural, lower case. Default the kind with an `s`. */
  shareKindPlural: (kind: string) => string;
  /** The People tab's note when others can edit the item. Default `Accounts and people you trust. Can edit lets them change it, Can view lets them look.`. */
  sharePeopleHintEdit: string;
  /** The accessible name and placeholder of the field that names who to invite. Default `Email or saved name`. */
  shareInviteField: string;
  /** The accessible name of the choice between Can edit and Can view. Default `Access`. */
  shareAccessName: string;
  /** The access choice that lets the person change the item. Default `Can edit`. */
  shareCanEdit: string;
  /** The access choice that lets the person only look. Default `Can view`. */
  shareCanView: string;
  /** The button that invites the person in the field. Default `Invite`. */
  shareInvite: string;
  /** The name of the signed-in person's own row. Default `You`. */
  shareYou: string;
  /** The role of the item's owner. Default `Owner`. */
  shareOwner: string;
  /** The line of a person who was invited and has not joined. Default `Invited, not joined yet`. */
  shareInvitedNotJoined: string;
  /** The line of a trusted person the item can be sent to. Default `On your trusted list`. */
  shareTrustedLine: string;
  /** The accessible name of a person's menu button, given their name. Default `Change access or remove <name>`. */
  shareMemberMore: (name: string) => string;
  /** The menu entry that takes a person off the item. Default `Remove`. */
  shareRemove: string;
  /** The line under the link buttons about who can open it. Default `People who open it need an account, and nothing downloads until they add it.`. */
  shareLinkNote: string;
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
  /** The accessible name of a `Renew` button, given the row's file name and detail line, so no two buttons in a list share a name. Default `Renew <name>, <detail>`. */
  sharedRenewFor: (name: string, detail?: string) => string;
  /** The accessible name of a row's menu button, given the row's file name, the other person's name for a `person` row, and the row's detail line, so no two buttons in a list share a name. Default `More for <name>`, then ` to <person>` and `, <detail>` when given. */
  sharedMore: (name: string, person?: string, detail?: string) => string;
  /** A row menu entry. Default `Copy link again`. */
  sharedCopyAgain: string;
  /** A row menu entry. Default `Show QR code`. */
  sharedShowQr: string;
  /** A row menu entry. Default `Change when it ends`. */
  sharedChangeEnd: string;
  /** A row menu entry. Default `Stop sharing`. */
  sharedStop: string;
  /** The trust screen's first title. Default `Add someone you trust`. */
  trustTitle: string;
  /** The accessible name of the trust screen's close button. Default `Close`. */
  trustClose: string;
  /** The field for the name the person goes by to the other side. Default `What you call yourself`. */
  trustNameLabel: string;
  /** The button that makes a code. Default `Make a code`. */
  trustMakeCode: string;
  /** The accessible name of the code's QR code. Default `QR code for the code below`. */
  trustQr: string;
  /** The button that copies the code. Default `Copy`. */
  trustCopy: string;
  /** The copy button once the code is copied. Default `Copied`. */
  trustCopied: string;
  /** The line under the code. Default `Works for 24 hours, for one person.`. */
  trustCodeNote: string;
  /** The button that leaves the code to wait for the other side. Default `Done, wait for them`. */
  trustDoneWait: string;
  /** The button that switches to typing a code. Default `I have a code`. */
  trustHaveCode: string;
  /** The button that switches back to making a code. Default `Make a code instead`. */
  trustMakeInstead: string;
  /** The title while typing a code. Default `Join with a code`. */
  trustJoinTitle: string;
  /** The field for a code. Default `Code`. */
  trustCodeLabel: string;
  /** The button that takes a typed code. Default `Join`. */
  trustJoin: string;
  /** Shown when the typed text is no code. Default `That is not a code. Check what they sent you.`. */
  trustNotACode: string;
  /** Shown when a typed code has ended. Default `That code has ended. Ask them for a new one.`. */
  trustCodeEnded: string;
  /** Shown when the person's own code ended before anyone joined. Default `This code has ended. Make a new one.`. */
  trustCodeEndedMaker: string;
  /** Shown when a code could not be checked. Default `Could not check the code. Try again.`. */
  trustCouldNotReach: string;
  /** The title while waiting, given the other side's name once known. Default `Waiting for <name>`, or `Waiting for them` while the name is null. */
  trustWaitingFor: (name: string | null) => string;
  /** The line while nobody has joined the person's code. Default `Nobody has joined yet. You can close the app, this picks up when you open it again.`. */
  trustWaitingBody: string;
  /** The line while waiting for the code's maker to answer. Default `<name> has not answered yet. You can close the app, this picks up when you open it again.` */
  trustWaitingAnswer: (name: string) => string;
  /** How long the person's code still works, in whole hours. Default `<hours> more hours on this code.`, or `Less than 1 more hour on this code.` at 1 or less. */
  trustHoursLeft: (hours: number) => string;
  /** The button that shows the code again. Default `Show code`. */
  trustShowCode: string;
  /** The button that drops the exchange. Default `Cancel`. */
  trustCancel: string;
  /** The title when someone joined the person's code. Default `<name> wants to be able to send you files`. */
  trustWantsToSend: (name: string) => string;
  /** The field for the name the other side is saved under. Default `Save them as`. */
  trustSaveAs: string;
  /** The accessible name of the choice of how long they can send. Default `How long they can send`. */
  trustHowLong: string;
  /** A choice of how long they can send. Default `No end`. */
  trustNoEnd: string;
  /** A choice of how long they can send. Default `1 week`. */
  trustOneWeek: string;
  /** A choice of how long they can send. Default `1 month`. */
  trustOneMonth: string;
  /** The maker's button that says no. Default `Decline`. */
  trustDecline: string;
  /** The maker's button that says yes. Default `Allow`. */
  trustAllow: string;
  /** The title when the person joined someone's code. Default `Let <name> send you files`. */
  trustLetThemTitle: (name: string) => string;
  /** The line under that title. Default `<name> made this code. Say yes and <name> can send files to you. <name> then decides whether you can send to them.` */
  trustLetThemBody: (name: string) => string;
  /** The joiner's button that says no. Default `Not now`. */
  trustNotNow: string;
  /** The joiner's button that says yes. Default `Let them`. */
  trustLetThem: string;
  /** The title when the maker said yes. Default `<name> said yes`. */
  trustSaidYes: (name: string) => string;
  /** The line under that title. Default `You can send files to <name> now.` */
  trustSaidYesBody: (name: string) => string;
  /** The title when the maker said no. Default `<name> declined`. */
  trustDeclined: (name: string) => string;
  /** The line under that title. Default `<name> did not add you, so you cannot send files to them.` */
  trustDeclinedBody: (name: string) => string;
  /** The button that ends the exchange. Default `Done`. */
  trustDone: string;
  /** Shown when an answer did not go through. Default `That did not work. Try again.`. */
  trustFailed: string;
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
  splitDivider: (left, right) => `Resize ${left} and ${right}`,
  splitValue: (left, leftPanels, right, rightPanels) => `${left} ${leftPanels} ${leftPanels === 1 ? 'panel' : 'panels'}, ${right} ${rightPanels} ${rightPanels === 1 ? 'panel' : 'panels'}`,
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
  shareInPersonHint: 'Show this to someone next to you. Their phone gets it over your Wi-Fi, or the web if that is faster.',
  sharePeopleHint: 'Accounts and people you trust. They get an offer on their phone, and nothing downloads until they add it.',
  shareSend: 'Send',
  shareSendTo: (name) => `Send to ${name}`,
  shareSent: 'Sent',
  shareAddPerson: 'Add someone you trust',
  shareAddPersonHint: 'Trade a code once, then send any time',
  shareOfferWaits: 'An invite waits 7 days, then goes away by itself.',
  shareCopyLink: 'Copy link',
  shareMoreApps: 'More apps',
  shareLinkEnds: (days, opens) => {
    const inDays = days === null ? null : `in ${days} ${days === 1 ? 'day' : 'days'}`;
    const afterOpens = opens === null ? null : `after ${opens} ${opens === 1 ? 'open' : 'opens'}`;
    const when = [inDays, afterOpens].filter((x) => x !== null).join(' or ');
    return when === '' ? 'Link does not end.' : `Link ends ${when}.`;
  },
  shareChange: 'Change',
  offerTitle: (from, kind) => `${from} shared ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind} with you`,
  offerTrusted: (from) => `${from} is on your trusted list`,
  offerNote: (days) => `Nothing downloads until you add it. The offer goes away in ${days} ${days === 1 ? 'day' : 'days'}.`,
  offerAccept: (kindPlural) => `Add to my ${kindPlural}`,
  offerNotNow: 'Not now',
  offerDecline: 'Decline',
  offerReport: 'Report',
  shareKind: (kind) => kind,
  shareKindPlural: (kind) => `${kind}s`,
  sharePeopleHintEdit: 'Accounts and people you trust. Can edit lets them change it, Can view lets them look.',
  shareInviteField: 'Email or saved name',
  shareAccessName: 'Access',
  shareCanEdit: 'Can edit',
  shareCanView: 'Can view',
  shareInvite: 'Invite',
  shareYou: 'You',
  shareOwner: 'Owner',
  shareInvitedNotJoined: 'Invited, not joined yet',
  shareTrustedLine: 'On your trusted list',
  shareMemberMore: (name) => `Change access or remove ${name}`,
  shareRemove: 'Remove',
  shareLinkNote: 'People who open it need an account, and nothing downloads until they add it.',
  sharedTabsName: 'Shared files',
  sharedByYou: 'By you',
  sharedWithYou: 'With you',
  sharedEmpty: 'Nothing here yet.',
  sharedRenew: 'Renew',
  sharedRenewFor: (name, detail) => `Renew ${name}${detail === undefined ? '' : `, ${detail}`}`,
  sharedMore: (name, person, detail) => `More for ${name}${person === undefined ? '' : ` to ${person}`}${detail === undefined ? '' : `, ${detail}`}`,
  sharedCopyAgain: 'Copy link again',
  sharedShowQr: 'Show QR code',
  sharedChangeEnd: 'Change when it ends',
  sharedStop: 'Stop sharing',
  trustTitle: 'Add someone you trust',
  trustClose: 'Close',
  trustNameLabel: 'What you call yourself',
  trustMakeCode: 'Make a code',
  trustQr: 'QR code for the code below',
  trustCopy: 'Copy',
  trustCopied: 'Copied',
  trustCodeNote: 'Works for 24 hours, for one person.',
  trustDoneWait: 'Done, wait for them',
  trustHaveCode: 'I have a code',
  trustMakeInstead: 'Make a code instead',
  trustJoinTitle: 'Join with a code',
  trustCodeLabel: 'Code',
  trustJoin: 'Join',
  trustNotACode: 'That is not a code. Check what they sent you.',
  trustCodeEnded: 'That code has ended. Ask them for a new one.',
  trustCodeEndedMaker: 'This code has ended. Make a new one.',
  trustCouldNotReach: 'Could not check the code. Try again.',
  trustWaitingFor: (name) => (name ? `Waiting for ${name}` : 'Waiting for them'),
  trustWaitingBody: 'Nobody has joined yet. You can close the app, this picks up when you open it again.',
  trustWaitingAnswer: (name) => `${name} has not answered yet. You can close the app, this picks up when you open it again.`,
  trustHoursLeft: (hours) => (hours <= 1 ? 'Less than 1 more hour on this code.' : `${hours} more hours on this code.`),
  trustShowCode: 'Show code',
  trustCancel: 'Cancel',
  trustWantsToSend: (name) => `${name} wants to be able to send you files`,
  trustSaveAs: 'Save them as',
  trustHowLong: 'How long they can send',
  trustNoEnd: 'No end',
  trustOneWeek: '1 week',
  trustOneMonth: '1 month',
  trustDecline: 'Decline',
  trustAllow: 'Allow',
  trustLetThemTitle: (name) => `Let ${name} send you files`,
  trustLetThemBody: (name) => `${name} made this code. Say yes and ${name} can send files to you. ${name} then decides whether you can send to them.`,
  trustNotNow: 'Not now',
  trustLetThem: 'Let them',
  trustSaidYes: (name) => `${name} said yes`,
  trustSaidYesBody: (name) => `You can send files to ${name} now.`,
  trustDeclined: (name) => `${name} declined`,
  trustDeclinedBody: (name) => `${name} did not add you, so you cannot send files to them.`,
  trustDone: 'Done',
  trustFailed: 'That did not work. Try again.',
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
