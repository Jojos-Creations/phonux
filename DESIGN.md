# phonux: design notes

This package is the seam between a host app and any view -- Settings, History, a live web panel, or a
third-party one. Nothing here may depend on the app that hosts it.

The panel-facing API is additive from here: breaking changes ship as a new API level, not by changing an existing one.

## Import boundary

`hostApi.tsx`, and the rest of this folder, import only React, MUI, motion, `@dnd-kit/core` and itself -- never
`localStorage`, any host-specific bridge, or any other app-internal module. A view written against these
contracts must work under ANY host, not just this one.

## The provider is rebuilt every render

`HostProvider`'s `host` value (a `HostInput`, defaults filled in) is never memoised, on either side: the host's handlers close over
render-time state (the panel list, the column count), so a memoised bag would hand a view a stale closure.

## Testing without a host

`fakeHost.ts` lives beside the contracts, not in the app's test folder, specifically so a third-party
view (with no access to the app's own test utilities) can still write a test against these APIs. It records
every call rather than simulating real behavior, since simulating real behavior would require importing the
app's own logic -- exactly what this boundary exists to avoid. It has no test-runner dependency and
imports only the contracts and the data-only phone model list.

`phonux/testing/row` (`testingRow.ts`) is a separate tool beside it, not a second fake. It renders a workspace with the real
engine, because a test of a drag, a resize or a park decision has nothing to assert on a recording. Its price is what the fake
refuses: it loads the engine, installs a jsdom window as the process globals (`jsdom` is an optional peer dependency) and
replaces `requestAnimationFrame` and `performance.now` with one counter that moves only when a test steps it. That is why the
entry must be imported before `react` and `motion`, and why it lives on its own subpath: a view test that only records never pays
for it. Timers stay real: the save's quiet period, for one, waits on a real `setTimeout`, so a test of `memoryWorkspaceStorage.saved`
sets `tuning.saveQuietMs` small. The driver reports one window size to every row scroller, so one process draws one window.

### A view test holds one panel

`createFakePanel(state?)` is the one fake that holds state: the single panel state it was given, never changed. It exists because a
view's props are a `ViewHandle` and a `PanelReader`, and building those by hand means casting. Its handle is typed as `ViewHandle`
and its reader as `PanelReader`, so a member added to the real handle fails to compile in `fakeHost.ts` until the fake has it. An
operation records a call (`api: 'handle'`) and answers an accepted result that changed nothing; a test that wants the effect of an
operation uses a real workspace. The fake imports only `panelSettings.ts` to resolve the settings, never `workspaceCore.ts`, React or
motion.

### Named view props

`PanelViewProps<P>` is what a template's `view` and `footer` receive: `panel`, `handle` and `manager`. The panel API level table
(`NewestViewProps`) is that same type, so a member added to the props fails to compile until the level shape names it.
`usePanelState(id)` listens to that one panel (`reader.get(id).subscribe`), reads its value from the snapshot, and until the panel
exists listens to the workspace and switches to the panel once it appears.

## Behavior flags cross this boundary as data only

The panel model (`PanelWindow`, `panelWindow.ts`) adds behavior flags (`collapsible`, `listed`, `view`, ...)
and, for an entry made from settings, the resolved `settings` and a `key`, to decide overflow, listing,
permissions and rendering -- but `PanelSummary` (a view's own read of a panel) exposes only what a view needs to
render a row: id, url, title, live, slots, and the drawn size. A view never sees the entry, its flags or its
settings. What it may ask is what its own panel permits, and that crosses as data too: `usePanelCapabilities()`
returns the three booleans and the widest slot count a person can act on by gesture (`closable`, `movable`,
`resizable`, `maxSlots`), read from the slot context `panelSlotContext.ts` holds, never a reference to the
entry. A view mounted outside a row is told the library defaults.

`maxSlots` is exposed once per audience: `usePanelCapabilities().maxSlots` for a view's own controls, and `PanelSummary.maxSlots`
for a host reading `panelList`, which has no slot context. `resizable` is the on/off switch and `maxSlots` only the upper bound,
so nothing reads `maxSlots === slots` as "not resizable". `pinned` has one source, `isPinned` (`panelPin.ts`) read under the
entry's own `pinning`; the slot's flag, `PanelState.pinned` and `pinnedIds` all come from it.

### An entry carries the settings it was made under

`effective(p)` (`panelSettings.ts`, internal) is the one reader of an entry's settings: `p.settings` itself when
the entry has them, otherwise values read from the fields a hand-built entry carries (`collapsible` gives
`parkable`, `closable`, `movable`, `resizable` and `clearable`; a
collapsible entry's `overflow` is 'park', a fixed column's 'scroll'), with every other key at its library
default. So a hand-built 0.1.0 entry behaves as it did. `applyTemplate(entry, resolved, mode)` is the one writer
of the fields that mirror the settings: 'create' writes `collapsible` (`parkable`),
`listed`, `layer`, `anchoredEnter`, `slots`, `title`, `settings` and `key`; 'reconfigure'
writes only `listed`, `layer`, `anchoredEnter`, `title`, `settings` and, for a parkable flip,
`collapsible`, and leaves the slots, anchor, `live`, `hostData` and `key` as the person and the row left
them. `appendPanel`, `restorePanel` and `hydrateWorkspaceState` write no `key`, so a hand-built entry has none
and a reader uses `p.key ?? p.id`. Every guard that decides a permission reads `effective(p)`: `movePanel`
(`crossable` of every array slot from the source to the target, parked ones included), `setSlots` (`maxSlots`),
the `clearAll` filter (`clearable`), and the engine's operations, which read `closable`, `movable` and `resizable`
for a person's gesture only (see "The capability flags limit a person's gestures"). Reads of `.collapsible` that remain
are about presence and parking, and test/source-invariants.test.ts lists the functions that make them.

## The panel-view lookup: never a crash, never a silent substitution

`PanelWindow.view` is an open string instead of a closed union: the id of a template the row's workspace holds
(`resolveViewIn`, `templateView.tsx`). There is no app-wide registry of plain components; a plain component is a template,
`definePanel({ id, view })`. The lookup never returns nothing: a key no template answers to -- a typo, or a plugin that failed to
register -- renders a visible, inert placeholder naming the title and the key, rather than throwing (which
would take the whole row down with it) or silently falling back to some default view (which would
render a blank shell for what is actually broken, more confusing than an honest placeholder). `view`
is read ONLY at this one render-selection site; every overflow/collapse/close decision elsewhere reads
`collapsible`/`listed` instead, never `view`, so widening it to an open string cannot change any of
those decisions.

## Position, layer and enter-direction are per-panel metadata, not per-view rules

`PanelWindow.anchor`/`layer`/`anchoredEnter` replace three separate hard-coded special cases for History
(always the leftmost column, a higher zIndex, entering unconditionally via the anchor formula) with one field
each, read by exactly the site that decides that one behavior: `anchor` by the function that orders the row
(see "Row order is anchor metadata" below), `layer` by the row's per-slot zIndex, `anchoredEnter` by the row's
enter-direction choice, which resolves against that panel's own anchor target. `layer` and `anchoredEnter` are
set once at creation; `anchor` is set at creation and changed by `reanchor` and by a drag. A custom panel can
opt into any of History's behaviors without becoming History-shaped in any other way -- `listed`,
and `collapsible` stay independent of all three.

### `permanent` is the one door to a collapsible:false column

`CreatePanelOptions.permanent` (`AppendPanelOptions.permanent` underneath it) is the only way a spawned panel
can become a permanent column -- there is no raw `collapsible` key. Setting it forces
`listed:false` regardless of any `listed` the caller also passes: the framework's History-row trash
(suppressed by `listed:false`, History's own precedent) must never be the close affordance for a column whose
own component owns its own close control. It adds no fourth field alongside `anchor`/`layer`/`anchoredEnter`
above -- those three already work on any entry, collapsible or not, unchanged (`create({ permanent: true,
anchor })` places the column like any panel). A permanent column is exempt from every row gesture, capacity
park and from being dragged by a person, for free, by already being `collapsible:false`, the same way History
already is. Other panels can still be dragged past it -- see `PanelsAPI.move`'s own section below.

The "own control only" guarantee also has to hold for the host's default view, not just a custom one: `view`
left unset resolves to `PanelsInput.defaultView` (with none, the unregistered-view placeholder), a host's own panel component, which otherwise wraps
EVERY panel in a framework drag-to-close handle unconditionally. That component reads
`usePanelCapabilities().closable`, which is false for a column with `collapsible:false` and for an entry whose
`closable` setting is false, through the per-slot context (`panelSlotContext.ts`). It renders no DragToClose wrapper -- no grab bar at all -- when it reads false,
exactly like History's own Panel today.

## `size?` is additive: omitted means the slot's drawn size inside a row, else the shared device size

Inside a row an omitted `size` on `Panel`, `PanelFrame` and `PanelSizeBox` is the size the row draws the slot at (`PanelSlotValue.drawn`: the slot's
width, at the row's tuned gap, and the row's height), so a view computes no width of its own and a size box cannot come out
a few px off its slot. Outside a row the rule below holds as written. The first paragraph describes the rule from before
slots, when one panel was always one phone wide.

`Panel`/`PanelFrame` (`Panel.tsx`/`PanelFrame.tsx`) each gain an optional `size?: PanelSize`
(`PanelSize`, `hostApi.tsx`, beside `PanelSummary`). A caller that omits it -- every
caller today -- gets exactly what it got before this prop existed: `useHost().device.size`, read live, so it
still reacts to a phone-size change the same way. This is the whole point of making it optional rather than
required with a default: a third-party view compiled against an OLDER phonux (one with no `size` prop at
all) is still a valid caller of the current `Panel`/`PanelFrame` -- passing nothing is not a special case, it
is the type's own default state, so there is no version where "the new field" could be missing versus
"explicitly opted out." The omitted default is never a static constant (e.g. a fixed phone pixel
size) -- it is the live, shared value every panel already read, so a host that resizes its window mid-session
never leaves a size-less view rendering stale dimensions.

`PanelSummary.slots`/`size` are themselves optional, not required: a `PanelSummary` is a structural type, so any
object shaped like one satisfies it, including hand-built fixtures that never set these two fields. Required fields
would force every such fixture, in this app and any third party's, to add them just to keep compiling.
`size` is derived, never stored: `PanelWindow` has no `size`, and the row writes `PanelSummary.size` for the view from
the slot's drawn width and height (`PanelSlotValue.drawn`), so it is never stale. `Panel`/`PanelFrame` never read it; only their own
separate `size` prop, passed explicitly by the view, does -- see "The width source" below. `summarisePanel()` forwards
`slots` when the record carries it and omits the key when it does not, never a key present with the value `undefined`.
A saved workspace never held a size, and a hand-built entry that still carries one has it ignored.

### Where a panel's size comes from

`panelWindow.ts` is part of this folder: the `PanelWindow` record and every pure transition over a
`PanelWindow[]` (`appendPanel`, `createHistoryPanel`, `closePanel`, `restorePanel`, ...). It sits inside the
import boundary above, so it imports only its siblings and never the desktop app. The main barrel exports
`PanelWindow` and `reorderStepsForOffset` from it; every other name stays `@internal`, reached by no
entry point, and the package's own tests import `panelWindow.ts` by relative path.
Its functions are pure and take no device-state argument (`test/panel-window.test.ts` builds panels with no device store
initialized at all). A size would need the live device size, so the record holds none: a panel is its `slots`, and its
size is derived where it is drawn, from the slots and the measured phone width (see "The width source" below).
`DEFAULT_PANEL_SIZE` (`panelTiers.ts`) stays exported as the built-in phone size.

## `PanelsAPI.move` is directional (move-by-one), not "move to index"

The handle's `move(by, source)` takes that step as a signed count, `by` slots in one gated call, so a drag crossing several neighbours is one call and one `PanelResult`; it stops at an end or at a panel that cannot be crossed, and is accepted unchanged at an end or for 0. The Host bag's `move(id, 'left' | 'right')` swaps `id` past whichever OTHER shown panel currently sits toward that side,
rather than taking a raw target index. A raw index is meaningless across the `panelList`/internal-array
split (`panelList` only ever lists panels, `collapsible: false` columns like History are never addressable
targets) and would leak the internal array's own indexing into the public surface. The row's own
drag-to-reorder gesture (the host's panel component) converts a pointer's cumulative offset into a step count and calls
`handle.move(steps)` once -- the same primitive a future keyboard/single-pointer
alternative (WCAG 2.5.7) would call with 1 or -1 per key press. `usePanelDragProps()` hands `DragToClose` that close and that reorder for the panel it is called in; the default frame spreads it. Panels can differ in width, so the step count is not
`offset / one slot`: a hop past a neighbour moves the dragged panel by that NEIGHBOUR's span (its width plus
the gap), so each hop lands half-way across the next neighbour's span (`reorderStepsForOffset`, over the
neighbour widths the row supplies per slot). With equal widths this is exactly one hop per slot.
The same count drives a live preview during the drag (see "Live reorder" under `DragToClose`), so the panels the drop would cross
already sit where the drop leaves them.

`collapsible: false` panels are excluded as a drag SOURCE only: they render no grab bar, through a plain React
context PanelRow.tsx provides per slot (a resolved view only ever receives `PanelSummary`, which carries no
`collapsible` field to check locally), and `move` is a no-op on their id. As a NEIGHBOUR they are crossable
like any other panel: a drag passes History or a permanent column, one hop per that column's own span, so a
drag is one way a panel ends up left of History. After every `move` each panel's anchor is re-read from the
row as it then stands -- see "The drag contract" in the next section.

## Row order is anchor metadata: `{ panel, position, priority }`

Every panel's place in the row comes from its own anchor, never from a fixed rule about History. History is
the root: it carries no anchor, and every other panel sits on one side of one panel. For a view, the one
shape is `{ panel?: string; position: 'left' | 'right'; priority?: number }`.

- **Where it is set.** `CreatePanelOptions.anchor` when a panel is created, and
  `PanelsAPI.reanchor(id, anchor)` for a panel that already exists, live or parked. `reanchor` is a no-op for
  an unknown id or a permanent column (History included). Both reorder the row at once.
- **Defaults.** `panel` omitted means History; otherwise it is another panel's `PanelSummary.id`. `priority`
  omitted means one past the highest priority already on that side of that panel: the far end. `create()`
  with no `anchor` at all is `{ position: 'right' }`, so a plain create lands at the row's far right end.
  `{ position: 'left' }` on a row with nothing left of History puts the panel immediately left of History; a
  second one lands farther left.
- **Priority.** Within one (panel, side), priorities compare numerically and LOWER is NEARER the anchor, on
  both sides; ties keep the current row order. After every placement the host renumbers each side 0, 1, 2 ...
  from the nearest, so `-1` always means "nearest": `{ position: 'right', priority: -1 }` opens a panel
  immediately right of History, whatever is already there.
- **Anchored to another panel.** A panel anchored to P sits next to P, before P's other neighbours on that
  side: with [History, A, B], opening C with `{ panel: A, position: 'right' }` gives [History, A, C, B].
  When P closes, every panel anchored to P takes over P's own anchor, so they close up in the place P held.
  An anchor naming a panel that is not in the row, or one that closes a cycle, falls back to
  `{ History, 'right' }` with its own priority -- never a crash, never a lost panel.
- **Placement only, never protection.** `reanchor` never parks or reveals by itself: whether the live panels
  fit depends only on their widths and how many there are, never their order. A panel anchored left of
  History parks by the same rules as any other -- a capacity drop, for one, parks the leftmost of equally
  wide panels first, and that can be it.
- **The drag contract.** A user drag -- and `PanelsAPI.move`, which the drag calls -- re-derives EVERY panel's
  anchor from the row as it then stands, relative to History: each panel becomes `{ History, the side it is on,
  its distance rank }`. The order is unchanged by that step, but an anchor naming another panel lasts only
  until the next drag. `undoClose` does the same when it puts a panel back at its old index. `create` and
  `reanchor` are the ways to set an anchor on purpose.
- **Saved with the workspace.** Row order and anchors are workspace state (see "Workspace state persistence:
  shape, ownership and timing" below): saved when a host passes `storage` to `useProvidePanels`, written nowhere
  otherwise. `PanelSummary` never carries `anchor`, so a view reads the resulting order from `panelList`, never
  anyone's anchor.

## `PanelsAPI.setSlots`: one panel's own width, resized in place

`setSlots(id, slots)` gives ONE panel a new slot count (see "Slot sizing"). Every other panel keeps its own size; panels to its
right slide over by the width change. It is a size change, never a park: the panel stays live and mounted,
its content stays the same DOM node, and nothing is captured or evicted for it. If the wider panel no longer
fits, OTHER panels park by the host's ordinary capacity rule (as few as a narrower window would park), never
the one just resized, and in the same update, so no frame shows the row overflowing; when it alone cannot
fit, it stays live anyway (the row always keeps at least one panel).
Shrinking it gives the room back, and parked panels return as for a wider window. No-op for an unknown id, a
permanent column such as History (it always stays one slot, like `move`'s own exemption), a panel that is not
`resizable`, or a panel already at the clamped count. A parked panel may change its count and stays parked.
`create({ slots })` opens a panel at a count directly (ignored with `permanent`). The record holds the count only; its size is derived.

Several calls in one handler (resizes, `create`, `activate`) each keep their own panel live the same way.
When they cannot all fit together, the earlier calls keep their room and a later panel parks, as it would had
it come second. A row gesture or a close later in the same handler prices the resize at its new width.

### The fit cap

A panel is never wider than the widest ONE live panel can be beside the fixed columns in
the current window: `max(phone width, row width - 2 x gap - fixed columns - gap)` (`computeMaxLiveWidth`, from the same
budget arithmetic the row's fit count uses), and it is drawn at the whole slots that fit that width. So a wide panel always
fits in the row instead of overflowing it, at every window size. With History as the only fixed column, a 390 phone and a
16 px gap:

| window width | cap | slots that fit | widest panel drawn |
| --- | --- | --- | --- |
| 1280 (the default) | 842 | 2 | 796 |
| 1920 | 1482 | 3 | 1202 |
| 844 (the window minimum) | 406 | 1 | 390 |

The floor is the phone width: when not even a phone fits beside the fixed columns, a wider panel is just one slot. A
one-slot panel is never capped (the window minimum already fits History plus one phone). The cap moves with the window, so a
capped panel widens and narrows as the window does; the chosen `slots` is never rewritten. Before the first measurement there is no cap.

A panel at the cap fills the row beside the fixed columns, so nothing else fits beside it, which is also
true of the same panel at its full chosen width. The capacity rules therefore park and reveal exactly the same
panels either way, for the panels whose `overflow` is 'park'; the cap changes how wide the panel is drawn,
never which panels are live.

A row whose entries carry settings with `overflow: 'scroll'` (the library default for every panel built through
the settings cascade) has no such cap on a fixed column's account: `computeRowNumbers` prices it from the window
alone. The window is the container less one gap each side; a panel is as many whole slots as fit it (see "Slot sizing":
two slots, 796 of 968, at a container of 1000). Every drawn entry is laid out, and a strip wider than the
window scrolls instead of parking anything. The shell, the row and the capacity all read that one result, so they
cannot disagree: `ProvidedPanels.rowNumbers`.

### The minimum workspace width

A window must not shrink below every fixed column plus two phone slots, or plus one tablet panel when that is wider, so
a panel opened beside another always has the two slots it needs. `minWorkspaceWidth` is that width, from the numbers the
row's fit reads: `gap + F x (phone + gap) + max(N x phone + (N - 1) x gap, tablet) + gap`, with F the fixed columns, N
the phone slots (2) and `tablet` the tier table's width (768). At that container width `computeRowLayout` fits exactly N
phones beside the fixed columns, a scrolling row's strip is exactly its window, and `computeMaxLiveWidth` leaves a tablet
uncapped; one pixel less breaks each, and the tests hold the function to all three. A two-slot panel is two phone slots
wide, so the tablet branch only decides for a phone narrower than 376 px at the default gap.

A fixed column is priced at one phone width, as `PanelsAPI.maxFitPanels` and the fit cap price it, so the three agree on
the same row. `PanelsAPI.minWorkspaceWidth` is the provider's value for the live row (phone width, `tuning.rowGap`, the
fixed columns seated now), on the channel a host already reads `maxFitPanels` from, so no hook or tuning key is added; a
host that wants another N calls the function with its own count. It is the row container's width: a host whose window
is wider than its row adds the difference before it sets its window minimum.

The value never reads the container width, but it is priced from the phone width the provider is given. With `phoneFit` off that
is the host's preferred size and the value is constant, so it is a floor. With `phoneFit` on the drawn phone follows the window,
so the same value is not a floor, and neither is one priced from the smallest phone the fit draws (`phoneFitMin` x preferred): the
window at that minimum draws a larger phone, and the guarantee breaks (Profile and History at gap 24 and phone 390 price to 1504
from the 320 px smallest phone; there the fit draws 346 px, and two 346 px slots beside the fixed columns need 1556). What a floor
under `phoneFit` must meet is this: at the reported minimum, with the phone the fit draws there, N phone slots fit beside the fixed
columns and a tablet panel is uncapped. Holding that is the job of the plan that gives a host a floor under `phoneFit`; until it
lands, a host with `phoneFit` on sets no window minimum from this value. A phone width that is not a positive finite number leaves
`PanelsAPI.minWorkspaceWidth` unset, because the function throws on it and a number a host only reads must not take the row down.

### Row numbers and overflow

`computeRowNumbers` is the one place a row's widths, resting offsets, margin and strip width are derived. It
reads `p.settings?.overflow`, never `effective(p).overflow`: a hand-built fixed History reads 'scroll' under
`effective()`, and a row of hand-built entries must keep its 0.1.0 numbers (`computeMaxLiveWidth` and
`computeRowLayout`'s margin). Within a scrolling row the margin is 0 once the strip is wider than the window (the first stop's
margin in a stepping row, see below) and centres it otherwise; before the first measurement the window is unbounded and nothing scrolls.

Only an entry whose `overflow` is 'park' is parked for room. Its capacity is `computeRowLayout` over the widths
of the live park entries, with the widths of every other drawn entry (the fixed columns and the scroll panels)
subtracted as `reservedWidths`; the existing floor of one park panel stands, so a crowded row overflows and
scrolls instead of refusing a panel. A park exit in a scrolling row travels one span from the slot's own rest, not
to the row's origin, because the strip extends far past the window.

#### The live panel cap

`tuning.maxLivePanels` (an integer of 1 or more; `null`, the default, is no cap and leaves everything above as it was)
limits how many unpinned panels are live. A panel counts when its `overflow` is 'park' and it does not read as pinned
(`pinnedIds`: left of the root under the default pinning, or by `parkable` under a definition that says so); a pinned
panel, live or parked, is neither counted nor parked by the cap. The capacity of a set of live park panels becomes
`min(fit, N + the pinned panels in the set)`, with `fit` the window's fit above, and a row with a scroll entry takes no
`fit`: History is one, so there the window's width no longer decides how many panels are live, exactly N unpinned ones
are, at 600 px as at 1920. That one capacity answers every question the window's fit answered, through the row's one
`pricing`: the park that settles a row, the park that an open, a `show`, a History click or an undo makes, the free slots
an 'until-room' hold waits for, and the returns a `resetLayout` reports.

`PanelsAPI.maxFitPanels` is the window's phone-width ceiling: `effectiveMaxPanels` over `rowFitCount` with no live widths, the same
`rowFitCount` the row's capacity calls, so the two cannot disagree. It is `null` while `containerWidth` is 0 and is not lowered by
pinned panels or by a scrolling row. A host reads it to default a cap (`tuning.maxLivePanels`) that follows the window.

No row that reaches the document holds more unpinned live panels than the cap. A row that lands over it (the panels of a
restore or of a replayed `addPanel`, a seeded `initialEntries`, a row after a lower value from `configureTuning`, class NOW)
is settled in the render that would show it, which React then renders again, so the first committed row has the excess
parked and a panel the cap parks is never mounted. While a cap is set that settle also takes the window's fit; without
one the reconcile effect parks for the window one commit after the row lands, as before. The settle keeps the panels an
action has just marked, as the effect does, and the effect records its parks once the row has committed, as it records
any park for room: under `capacityReturn: 'manual'` each is held until shown or until `maxLivePanels` is raised (the capacity-parked ones are kept in park order beside the hold, so a raise tells them from a host hide), under 'auto' it goes on the stack and
returns by `returnTieBreak`. A higher value, or `null`, returns what has room for it under 'auto', and under 'manual' the panels the capacity parked, most recently parked first, up to the new value; never one the host hid.

Opening, showing or undoing a panel parks the unpinned panel touched longest ago, and never a pinned one, nor the panel just
opened, moved or unpinned. A panel's touch time is set when it is created and set again when it is shown from parked or
focused (or pressed) in the row; a tie goes to the panel nearer the start of the row. Touch times are session state and
are not saved: a restored row starts every panel tied, so the row order decides until something is touched. A park the
window forces (a capacity drop, a resize) is a different rule and still parks the fewest panels, the leftmost first. A pin change moves a panel
across the root and so changes the count: pinning a live panel leaves one fewer unpinned panel live and returns nothing
under 'manual' (under 'auto' the most recently parked comes back), and unpinning one parks exactly one other. A move, a
place or a drop across the root does the same and, as a pin does, keeps the moved panel live. A parked pinned panel takes
no slot: shown, it parks nobody, and it comes back by its own `capacityReturn`.

The cap reveals nothing. With `revealOnScroll` 'never' a wheel step, Shift+wheel, arrow key or swipe only scrolls the
strip, in a row that scrolls and in one whose strip fits (the `scrollRow` swap reads the setting too). A hidden panel comes
back by `show`, a History click or an undo of its close, each of which parks one other to stay at N.

#### Whole-panel stops

In a scrolling row with `rowGesture` `'step'` whose strip is wider than the window, `computeRowNumbers` (called with
`wholePanels`) returns `stops`: the `scrollLeft` values at which the window shows only whole panels. From panel `i` the
shown set is the greedy run of panels that fit the window, at least one, and the leftover width is split evenly as
margin `m_i`. `rowMarginLeft` is the first set's margin, stop `i` is `rowMarginLeft + leftOffset_i - m_i`, the stops end at
the first panel from which everything after it fits. The space after the strip is a spacer element, a sibling of the strip inside
the scroll container so a drag's end cap still reads the strip's own edge. `endPad` is always 0, so the last stop is the row's end
(`maxScrollOf`) and rests the last panel one row gap from the window edge; the last set's margin is not added to the range, which
would leave blank room after the last panel. The element is the row gap wide on every scrolling row and the container's right padding is 0
there, because engines disagree on what the scrollable width counts: WebKit leaves a flex item's end margin out, and Firefox an
empty box (so the element has no `height: 0`). A non-empty element is counted by all three, whatever each does with padding, and
`maxScrollOf` is then the browser's range. A row that does not scroll keeps its padding to centre in.
The strip's margin snaps instead of gliding while stops exist, or `scrollWidth` would lag `maxScrollOf`, except in a panel resize: a
grow that overflows the window adds its stops in the render that moves the margin, so the margin glides there (a panel's width changed
under an unchanged container width, or a width is held), and the settle onto a stop waits for the slide. A window resize keeps the snap. A strip that fits
the window keeps its centring and has no stops; an `off` row has none either, so its margin is 0 on overflow.

Padding does not clip scrolled content, so a neighbour of the shown set peeks `m_i` px at each edge, cut by the window
edge and drawn at its own size: nothing fades or shrinks. A slot the window does not reach at all is `inert` and takes no
pointer events, so Tab and find-in-page cannot scroll the row off a stop; Workspace writes that on scroll events and on every
render. A click or focus in the cut-off neighbour makes the browser scroll, and the row then settles onto the nearest stop that
shows that panel. Steps, `scrollTo`, the initial scroll, a drag released after edge scrolling and the settle after a change of
stops (a resize, a pin, a close, a reorder) all land on a stop; `scrollTo` with `align` `'start'` or `'center'` lands on
the nearest stop that shows the panel, not at that alignment.

#### Step stops

`stops` is the one-phone grid: every `phoneWidth + gap` from scroll 0, then the row's end (`maxScrollOf`), so the last stop may be
shorter. Every stop a row can rest on is on that grid, whatever the mix of widths: a step, a drag release and the layout settle
all land on it. A wide panel is not a stop of its own. A grid stop shows the whole panels the window holds from that point, and a
window cut through a wide panel shows the next phone width of it. A wide panel is centred only where the grid lands on the centred
position (the visible count minus its width is even); otherwise the nearest grid stop is used, and centring can be impossible.
This replaces the whole-panel stop contract of the 297 tests. A row that does not scroll has no stops and keeps the old step.
The row's margin still comes from the whole-panel groups: it sets the grid's phase, which decides where a wide panel can centre.
Removing it would move every centred cell, so it stays; it no longer defines a stop, and the end pad no longer adds one either
(`endPad` is 0, so the grid ends at `maxScrollOf`). `snapToStop` picks,
among the grid stops whose window shows the panel, the one nearest the target; for a panel wider than the window that is the
grid stop near its left edge. Drag release, resize and pin release read the same grid through `snapToStop` and `nearestStop`.

#### Whole panels only

Panels are whole slots, so the window holds a whole number of slots `u = floor((window + gap) / (phone + gap))`. A grid stop shows
the greedy run of whole panels from its point, and the window edge cuts the neighbour in the margin, drawn at its own size. There is no other mode:
the Shrink (`'visible'`) and Hide (`'hidden'`) values of `tuning.shrinkOutOfView` are removed, and a row never resizes a panel to fit
the window.

A panel as wide as the window shows alone, and the next stop would start at the panel after it, dropping the wide one at the first step. So whenever a panel follows it, a stop is added after it that slides the panel left. The slide leaves the window ending at the edge of the whole panels that fit beside its right part (at least a phone's width of it stays); when no whole panel fits there, it slides one slot (phone width plus gap), so the panel keeps all but one slot of the window and the next panel's first slot comes in as the cut neighbour. The step after that starts at the next panel.

`tuning.shrinkOutOfView` stays on `WorkspaceTuning` only so a settings file or an app that still names it is told. `'off'` is
accepted without a word; `'visible'` and `'hidden'` log one `console.error` each (in development, through the same helper as the
removed per-panel settings), name the value as removed, and act as `'off'`. The next rc refuses them with `invalid-settings`. The key
is no longer in `PANEL_SETTINGS_CATALOG` or `ResolvedWorkspaceTuning`, and `configureTuning` reports no change for it.

Capacity (the cap, fit pricing, refill) reads
chosen widths only, so a step never parks or returns a panel. `usePanelResizing()` marks a panel being resized by hand, and also
marks it dragging; while it is marked every other panel keeps the width it had been drawn at, the row holds its scroll (a step is
ignored and no settle runs), and the release settles onto the nearest stop once.

`setDrawnWidth(px, pin?)`, the third item of `usePanelResizing()`, draws the marked panel at a width a host holds, so a grabber can
make it follow a pointer while `slots` stays the person's choice. The width reaches the row through the chrome store and the
PanelRow that draws it, and nowhere else: `PanelRow` replaces the panel's drawn width, the running offsets of the panels after it,
its height and its size box; `rowNumbers`, the stop list, the chosen widths, capacity and the live set never read it, so a drag across
the whole range parks nothing and the hold above (other panels, scroll) is unchanged. It is held between one slot and the
fewest of `maxSlots` and the slots that fit, and a value that is not a finite non-negative number is ignored. While one is set every slot
moves and every size box resizes in no time (`tracking` in the slot context), the centring margin is the one the numbers give, which
is unchanged for the whole drag, and calls within one animation frame draw once with the last value. The height is the slots the width
rounds to, so it steps half a slot in, the point the release snaps to, and the panels around it realign on the same frame. `pin` names the
edge that stays still: `'start'` leaves the left edge and the panels before it where they were, so the right edge follows a grabber on the
right; `'end'` shifts the whole strip left by the growth, so the right edge and every panel after it stay where they were and the panels
before make room, which is what a grabber on the left needs, with the row box (and so the scroll extent) as long as before. The release is
`setSlots(nearest)`, then `setDrawnWidth(null)`, then `setResizing(false)`: the first fixes what the panel is, the second lets it
glide from the held width to that one (a snap under Reduce Motion, which also snaps the centring margin), and the third lifts the hold,
so the row settles once onto a stop. When the release moves the centring margin, that settle starts once the margin's slide has ended. Ending the mark, or the panel leaving the row, drops a
width still set.

The settle holds the edge `pin` named. When the mark begins the Workspace reads that panel's rect from the element, after its claim has
stopped any scroll glide, so a centring margin still gliding or a panel drawn shrunk counts as drawn; the numbers can be ahead of it.
The pin is latched while a width is drawn, because the host clears the width before it ends the mark. At the release the row lands on the
stop nearest the scroll that puts the pinned edge back where it was read: the right edge for `'end'` (a grabber on the left), the left edge
for `'start'`, one rule for both. With no width drawn, or a panel that is not in the row, it is the stop nearest the scroll it has, as
before. The target needs numbers that carry the new slot count: when `setSlots` comes before the mark ends, as in the order above, they
already do; when it comes in a later commit the settle waits for the commit in which the panel's width changes, and runs on the next
frame at the latest if none does. The edge comes to rest on a stop, so it is held exactly only where a stop is at that scroll; otherwise it
rests within half the gap between the two stops around it. A row whose panels all fit has no stops and nothing scrolls.

### Scrolling to a panel

`rowScroller.ts` holds one `RowScroller` per scroll container and it is the only writer of that container's
`scrollLeft`: a glide (the slide duration, instant under reduced motion), `stop`, and `claim()`,
an exclusive writer whose bound comes from `setMaxScroll` and never from the DOM, because a dragged box that is a
transformed descendant would grow `scrollWidth` and a DOM bound would never be reached. A glide stops at pointer-down
and on a scroll it did not write (more than 1 px from the last value it wrote); the claim holder's writes count as the
scroller's own. Workspace marks its container `data-row-scroller`, and `closestRowScroller` finds it from any
descendant by that mark, not by computed overflow.

A request to scroll to a panel (a create, an activate, an undo that restores a live panel, `scrollTo`, and
`followPanel` from a moved or resized panel that was in view) is recorded in a handler and run in the layout effect of
the commit that draws the panel, from that commit's row numbers: the target margin of the commit, clamped to
`maxScrollOf`, never read back from the DOM. One request is pending at a time and the last wins. A request for a panel
that is not in the row is kept for two commits and then dropped with the note `scroll-request-dropped`; one made while
a drag holds the claim is dropped with `scroll-dropped-during-drag`. A panel created hidden, a restore, a first paint
and an automatic return record nothing.

With `rowGesture` `step` a sideways wheel, Shift+wheel or arrow key asks for a step. A wheel step starts a lock of `tuning.gestureLockMs` (60 ms; later events do not extend it); a swipe is one step. Per gesture the hook keeps the previous magnitude, its sign and a trough (the smallest magnitude seen since the last step, once the deltas have fallen; null until then). An event steps when the lock is over and it is the first of a gesture (nothing before it in `tuning.gestureQuietMs`), or it reverses direction (which also arms the next event, even one that arrives inside the lock), or the trough is set and the event is at least 1.5 times the trough and at least 4 delta units above it, a new swipe starting in the tail (the floor keeps a tail rounded to whole pixels, 1, 1, 2, 1, from stepping). Every step clears the trough. A ramp up, a plateau of equal deltas and jitter in a tail (14, 12, 13, 11) never step again, so a held mouse wheel is one step per gesture and each notch after a quiet gap is a fresh one; where a plateau and a mouse wheel cannot be told apart the swipe wins. The rule reads ratios only, so Firefox's whole-line deltas (`deltaMode` 1) take the same path. `tuning.gestureQuietMs` (150 ms) without a wheel event starts a fresh gesture. On a scrolling row whose strip is
wider than its window the step goes through `gestureTarget`: it shows the nearest hidden panel in the direction when
its `revealOnScroll` allows and no live panel lies between the window's edge and its slot, and otherwise scrolls to
the next stop (the next panel start in a row without stops), from the in-flight glide's target. A row with nothing to scroll toward keeps the 0.1.0 swap
(`scrollRow`), which swaps in no panel whose `revealOnScroll` is 'never'. The gesture does nothing while a claim is held.

The row's own overflow is `overflowY: hidden` for every rowGesture: a vertical wheel over the row or a plain panel does nothing to the row, so it cannot move up off its workspace. A panel's own inner scroller still scrolls, because the wheel reaches it first.

The row listens for the arrow keys on the window, so a control that uses an arrow key itself (a resize grabber, the header buttons'
roving focus) must call `preventDefault()` on it: the row skips a keydown whose default was prevented, and a key nothing handles steps the row.
The row and the workspace column share one guard, `arrowKeyBelongsElsewhere` (`arrowKeys.ts`), so neither steps for a key a handler took, a
modified key, one typed in a field or a widget that uses the arrows, one while a dialog is open or an IME is composing, or one during a keyboard
or pointer drag. A held key is the one clause that differs: the column ignores a repeat and the row keeps stepping on it, so the guard does not judge it.

The row is a `region` named `labels.row` and each panel a `group` named `labels.panelPosition(title, place, total)` ("Notes, 2 of 4"), counting the
panels drawn. The Workspace renders one polite live region (`role="status"`) and `AnnounceContext` carries `announce(text)`; a key that
moves or closes a panel says so there, because nothing visible changes for a screen reader user.

`tuning.initialScroll` runs once per mount, in a layout effect gated on the restore having settled, on a measured row
with an entry, with no animation, and not at all when a wheel, a pointer-down or a glide got there first. A rest saved
by a previous launch (see "Where the row rests" under the persistence section) takes its place.

#### The seam for a custom scrollbar

A custom scrollbar is deferred. Nothing here blocks it: it would read the strip from `computeRowNumbers`
(`windowWidth` and `stripWidth`) and the position from `scrollLeft` through the same `RowScroller`, scroll by
`claim()` the way edge scrolling does, and be switched on by a new workspace tuning key beside `rowGesture`. Three
tested facts hold the seam: `rowScrollerFor` returns one object per element, `claim()` is exclusive, and a claim's
writes keep the scroller's last-value bookkeeping so a glide never mistakes them for foreign scrolls. `RowScroller`
stays internal until the scrollbar exists.

### The width source

A panel's width is ALWAYS computed from the live phone width -- the model the user picked, `device.size` -- and
never read from a stored size: none is stored, and a stored one would freeze every panel at
390-wide slots whatever the model. An entry with `slots` is that many live phone widths with the gap between them, no more
than `maxSlots` and what fits; an entry without `slots` (a hand-built one) is one phone width. One host helper
(`panelWidthOf`) owns this rule and the fit cap, and every width sum reads through it: the row's capacity,
the row's centring margin, each slot's position and width, the size box, and the
neighbour widths a drag crosses. A view follows the same rule: pass `panel.size` to
`Panel`/`PanelFrame` only for a panel of more than one slot, and omit it for a one-slot one so the device size applies.

### How the resize animates

The row's slot (`PanelRowSlot`) owns the enter/exit animation, so the resize never lives on the slot
itself: Motion's docs warn against `layout` and `exit` on one element. It lives on an inner size box
(`PanelSizeBox`) that the built-in web view renders inside its slot, under its drag box. That box eases its real
width and height from the size on screen to the new one, over the same 0.6 s transition the slots slide with, growing
from the left edge because the slot's own `x` already animates position. It is not Motion's
`layout="size"`: that animation starts in the frame after the commit while the slot's slide starts in the commit,
so a commit that janks (the default frame's MUI render does) would draw the box and its neighbour from different
moments. The box starts its glide in the commit's layout effect, and both it and the slot's slide are given that same
commit's time as their `startTime` (`slideStart()`), because Motion otherwise starts a slide from the moment its
keyframes resolve when that is over 40 ms after the commit; so a neighbour of a growing panel stays one gap from it
at any frame rate. It is the panel's own width and the row's own height,
so a `'fill'` view's percentage height resolves inside it. A column that is not collapsible (History, a
permanent column) never changes its slot count and renders no size box. A third-party view may change its slot count too: its
slot, position and the row's capacity follow, but its content snaps to the new size, since only the built-in
view renders a size box. The row's centring margin glides with the resize even right after a window resize,
when a window-driven margin change would snap.

The box eases its real width and height, not a scale, so its content reflows on every frame of the glide, as a maximize
does, and the chrome the library draws (the corner radius, the 1 px edge, the header pill) is never squashed. A height of the slot's
own (`'100%'`) has no number to ease, so only the width eases then.

The size box follows any change of the panel's width, not only a slot-count change. Choosing a different phone
model resizes every panel's size box too, so their width and height glide over the same 0.6 s while
the slots slide to their new positions; History, which has no size box, takes the new size at once. Every
panel lands exactly on its slots at the new phone size. A window resize that moves the fit cap resizes a capped panel the
same way.

### How a view reads and changes its own width

A view reads its own count from the `panel` prop it is rendered with: `panel.slots ?? 1`. The field is optional, so a
summary without it is a one-slot panel. `panel.size` is the size the panel is drawn at, already within the fit cap; pass
it to `Panel`/`PanelFrame` for a panel of more than one slot and omit it for a one-slot one (see "The width source").
`panel.maxSlots` and `panel.fitSlots` give the widest count the panel may take and the widest that fits the window now,
so a size control offers counts up to the smaller of the two. A view can offer its own control through
`useHost().panels.setSlots(panel.id, next)`; its slot, its neighbours and the row's capacity follow, while its content
snaps (see above). Keep such a handler to `setSlots` alone: a close in the same handler can leave panels the resize
parked unable to return to the row.

### Slot sizing

An entry that carries `slots` is n whole slots wide. A slot is one phone width, and the row gap sits between
slots, so `n` slots are `n x phone + (n - 1) x gap` wide and every edge lands on the row's stop grid. The count drawn is
`min(slots, maxSlots, fit)`, where `fit = floor((maxLive + gap) / (phone + gap))` and `maxLive` is the window (the
container less one gap each side) or, in a parking row, what is left beside the fixed columns. The choice (`slots`) is
never rewritten to the drawn count, so a window that grows gives the width back. A panel keeps the phone height at any slot count.
The slot-out motion of a closing panel drops by the row height. History keeps its own size and is centred like the rest.
Unmeasured widths use `UNMEASURED_SLOTS` (3).

At 844, 1280 and 1800 px windows the fit is 2, 3 and 4 slots.

`slots` defaults to 1 and `maxSlots` to every visible slot (`ALL_SLOTS`, 64), both plain library defaults. A request for more than
the fit or `maxSlots` is clamped silently. An entry built without `slots` (a hand-built one) is one phone width;
`appendPanel` always writes `slots`, and the settings cascade does too.

`PanelsAPI.setSlots(id, slots)` and the handle verb resize by a count, clamped to `maxSlots` and refused with
`not-resizable` when the panel is not `resizable`. A person's resize is saved as `overrides.slots` and, on the panel, as `slots` when
it is not 1. History's count is saved as `rootSlots`.

C1 is relaxed for the size settings as a group (`resizable`, `slots`, `maxSlots`): when the
panel's own template, host or instance layer asked a fixed column for any of them, they all stand (History is resizable
when the app says so, and a pinned panel may be); otherwise they are forced to one slot. A workspace
default never unlocks a fixed column. A fixed column wider than a phone is priced into the capacity like any scroll panel.
A `resizable: true` beside `maxSlots` 1 resolves, but notes `resizable-capped` (it cannot grow).

### Phone fit

`tuning.phoneFit: 'fit'` draws the phone at a size scaled from the host's preferred one so whole slots fill the window.
`device.size` stays the person's preference (Settings reads it); `usePhoneSize()` returns the size in force and is what `Panel`,
`PanelFrame`, `PanelRow` and the default frame read, so a frame, its size box and the row's slots agree. Off, the hook returns
`device.size` and nothing is drawn differently.

`usePhoneFit(containerRef, containerWidth, preferred, tuning, topInset?)` computes that size from the container the row scrolls in.
The default mount calls it itself. A hand-wired flow calls it before `useProvidePanels` and gives the result to both
`useProvidePanels` (`phoneWidth`) and `Workspace` (`phoneWidth` and `phoneHeight`); the Workspace publishes the pair to `usePhoneSize()`,
so the capacity, the row numbers and the drawn widths price one phone width. A `Workspace` given no `phoneHeight` publishes nothing.

`fitPhone` (`phoneFit.ts`, pure) takes the window width, the row's height budget (`RowHeightContext`'s value: the container
less its padding), the preferred size, the gap, the edge space (the row gap) and the band `phoneFitMin` to `phoneFitMax`
(0.82 to 1.13, 320 to 441 px on 390, inside the real phone range). With W the window less the edge space each side, N slots
are `floor((W + gap) / N) - gap` px wide each (whole pixels, so the sums compare exactly) and the height follows the width at the preferred
aspect. The height cap is the height budget over the preferred height, never above the band's top. Then, in order:

1. the smallest N whose scale is inside the band and under the cap: the exact fill;
2. else the most slots inside the band at the cap's scale, whole slots with the leftover centred as the row centres it;
3. else the band's minimum wins, with as many slots as fit at it (at least one), and the row scrolls vertically. A phone below the minimum is
   unreadable, and one slot would leave the window empty.

No count ever cuts a panel at rest. Exact fill is not promised where the height cap binds. `rowCount` is a parameter of the function
(each row gets an equal share of the height and all share one scale), not a tuning key: the plan that lays out two rows adds it.

The count follows the window only once width and height have held still for the resize settle (`resizeSettleSlides` slide
durations; at once under the OS Reduce Motion setting, which the mount reads itself because it sits above any `wrap`), so between settle events the previous count and widths hold and a webview is not re-laid out per
frame. A change of count also needs margin: a step to more slots needs that count's scale at least 2 percent above the band's minimum, and a
step back needs the larger phone at least 2 percent under the cap. The panel's size box glides the new size on the slide timing,
as any size change does.

## `params` is opaque and JSON-serializable by construction

`PanelSummary.params`/`PanelsAPI.create({ params })` carry per-component data the registry and the row never
interpret. `JsonValue` (not `unknown`) is the type on purpose: the saved workspace carries every panel's
data, so it must already be serializable, and starting from `unknown` would have meant redesigning the field the
day persistence was added.

## `create()` is two overloads, and its own implementation still guards the positional case

`PanelsAPI.create` is `create(): void; create(options: CreatePanelOptions): void;`, never one
`create(options?: CreatePanelOptions)`. A single optional-argument signature is structurally assignable to
a DOM `MouseEventHandler`, and `MouseEvent`'s own required `view: Window` field collides with this bag's
`view?: string` -- a host that writes the ordinary React idiom `onClick={panels.create}` would fail to
typecheck, or worse, silently spread the click event's `view` into the new panel at runtime. The overload
form is assignable to a handler type (a function accepting fewer arguments always is); the real
implementation additionally treats any event-shaped positional argument (duck-typed by a `preventDefault`
function) as "no options", so a bare `onClick={panels.create}` reference behaves exactly like zero-arg
`create()` even though nothing here can stop a caller from writing that reference.

## A resolved panel component only ever sees a `PanelSummary`

`PanelRow.tsx` takes the row-only `PanelRowEntry` record (not `PanelSummary`) because it alone reads
`anchor`/`layer`/`anchoredEnter`/`collapsible`, but every component it resolves through the workspace's templates --
built-in or third-party -- is written against `ViewComponent<P>` `= ComponentType<{ panel: PanelSummary<P>
}>`. It narrows through the same `summarisePanel()` projection `PanelsAPI.panelList`/`recentlyClosed` use
(`panelRowEntry.ts`), so a view can never read a row-only or host-only field (`hostData`, `collapsible`,
`anchor`, `layer`, `anchoredEnter`) just because it happens to be a plain variable, not an object literal,
and so escapes TypeScript's excess-property check at the call site.

## Building, packing and publishing

The repository root is the package. Its `package.json` is private and its `exports` map points at `.ts` source, so the tests and
the API reports run against source and nothing is published from the root. `npm run build` compiles to `dist/` and generates the
publishable `dist/package.json` with its paths rewritten relative to `dist/` (never hand-edited, never committed). `description` and
`license` come from the root `package.json` (the build refuses a source manifest without them), the generated manifest has no
`private` key and sets `publishConfig.access` to `public`, and `LICENSE`, `README.md` and `DESIGN.md` ship beside it.

`npm run smoke` is the publish gate: it asserts the manifest inside the packed tarball, then proves the tarball installs and
resolves in a throwaway app outside this checkout, with the real peer set from the registry, in eight checks.
`npm run smoke -- --from <tarball path or registry spec>` runs the same checks on an already-packed or already-published
artifact. The bare `--` is required: npm keeps a `--from` placed before it for itself, and the smoke refuses to run rather than
check the local `dist/` in its place. `npm run release:check` confirms that `name@version` is still free on the registry, runs the build and the smoke, and prints
the `npm publish` command for the maintainer to run with their own login (a prerelease version prints `npm publish --tag next`); it never publishes. `npm publish --dry-run` is not
evidence, because it accepts a `private: true` manifest.

## `index.ts` splits values from types on purpose

TypeScript's `interface` and `type` declarations produce no JavaScript: they are erased before a module
ever runs, so a runtime membership check (`Object.keys(namespace)`) can only ever see the value half of
this file's exports. `index.ts` re-exports values with `export { ... }` and types with
`export type { ... }` as two separate statements per source file specifically so that split is visible
in the file, not just in the type checker's head -- a reviewer (or a future editor) can tell which half
of a name governs a runtime test versus a compile-time one just by which statement it is in.

## The test fakes are a subpath; `directionalTransition` is not exported

`directionalTransition.ts` is an animation timing helper for the package's own slot components, not a
contract a view is meant to depend on, so no entry point exports it: exposing it would invite a consumer to
couple to an implementation detail that owes nothing to any view contract.
`./testing` exists as its own subpath, rather than being re-exported from `.`, so that importing the
production barrel can never pull test-only fake implementations into a real bundle; a consumer opts into
fakes by importing the subpath explicitly, and a bundler that only ever sees `.` never sees them at all.

`directionalTransition` holds the timing, easing and opacity contract `PanelRowSlot` uses, not its position math. A live panel is
absolutely positioned (`index * (phoneWidth + GAP)`) and leaves for two reasons: a close slides down, and an auto-collapse
slides left to a fixed spot just past the row's left edge whatever the panel's own index. One generic `exit` would lose the
index-independent collapse target, so this is a preset, not a wrapper component. It returns `initial`/`animate` (`distance`
past rest, faded out), the shared `transition` and a symmetric `exit`; `PanelRowSlot`, its one caller, builds its own two exits
and takes only `transition`. A host that animates rows of its own builds them over the public `PANEL_TRANSITION`, the same object
as `SLOT_TRANSITION`.

## `createDefaultTheme` carries the no-motion rule only, never the brand

The optional default theme ports phonux-app's own no-animation MUI settings (disabled
`transitions.create`, and a CssBaseline reset scoped to `transition`/`animation`, never
`transform`/`opacity`) because a consumer's phonux views run the same slide animations
that rule protects. It deliberately leaves out phonux-app's palette, typography and
per-component style overrides: those are this product's own branding, not something a
third-party consumer should inherit just by taking the default.

## The hierarchy: `WorkspaceGrid` > `Workspace` > `PanelRow` > `Panel` > `View`

A `WorkspaceGrid` holds many `Workspace`s, a `Workspace` holds one or more `PanelRow`s, a `PanelRow` holds
`Panel` slots of one or more phone widths, and each `Panel` renders one `View` -- the component a
developer writes and registers. This folder owns `PanelRow`, the `Panel` shell and the `View` registry, plus
the host contract that connects them; the `Panel` shell and the `View` registry are the two levels a View
author actually touches.

`PanelRow` lives in this folder; `Workspace` is a phonux component too. This section names the split the `Workspace`
extraction moves code against, so that extraction is a rename-and-relocate pass, not a fresh design.

**What phonux owns: `PanelRow`.** `PanelRow` renders N animated slots from a plain entries array --
`PanelRow.tsx` (the composition) and `PanelRowSlot.tsx` (one slot's motion), over this folder's own animation
primitives -- with the row's order math (`panelRowOrder.ts`), slot widths (`panelTiers.ts`) and fit math
(`panelRowLayout.ts`) beside it. It does not consume `PanelSummary`: the row needs fields that decide overflow
and motion (id, view, collapsible, anchor, layer, anchoredEnter) that a View must never see, so it takes its
own row-only entry type, `PanelRowEntry`, rather than reusing the View-facing one. The host passes the row's
root entry as a required `rootId` prop with no default here, so no host's own panel id is baked into this
folder.

**What phonux owns: `Workspace`.** `Workspace` is the shell around the row: the scroll
container, the centered/animated-margin math `workspaceShellStyle` (in `Workspace.tsx`)
computes, and the `OverlaySlot` mounts. Like `PanelRow`, it does not consume `PanelSummary`.

**What phonux owns: the panel state machine.** The hooks that decide which panels exist and which are live sit in
`panels/` in this folder: `usePanelManager` (capacity, parking, reveal, reorder), `usePanelClosing` (close, the undo
window, Undo), `useRowScrollGesture` (the row's wheel and arrow-key gesture) and `useProvidePanels`, which composes
the other three. A host mounts `useProvidePanels` with its seed entries (`initialEntries`, `rootId`) and the row's
measured inputs, plus optional hooks: `onPanelsClosed`, `onPanelsRestored`, `resetHostDataOnRestore`,
`defaultHostData`, `capture` and `storage`. It gets back `ProvidedPanels`: `PanelsAPI` plus the row's animation sets,
`entries`, `fixedViewCount`, `liveWidths` and `maxLiveWidth`. The provider owns the list from the first render,
seeded once from `initialEntries`, so a host never holds a `setPanels`; it seeds its always-shown columns through
`initialEntries` too (the History column is one, and it is still host code). `entries` is the raw list with
`hostData` in it and stays off `PanelsAPI`, so a host hands its views only `PanelsAPI`'s own members. `hostData`
stays opaque: phonux never reads inside it, which is why the two places that would need its shape (a created panel,
a restored one) are host callbacks. Host callbacks must not throw: phonux does not guard them, and a throwing
callback leaves the operation half-applied. A throwing `onPanelsClosed` leaves the panel out of the list with no
Undo offered for it; a throwing `resetHostDataOnRestore` part-way through an undo restores the panels before it and
loses the rest.

**What stays host.** The window's own chrome (a draggable title-bar region and the clearance the platform's
window controls need) and every other window-chrome concern; the IPC calls a panel's own actions make; and
mounting real web content inside a resolved View. None of that is row layout, and none of it can move here
without this package depending on the host's runtime.

**The second row is one field, not a second shape.** An entry's `row: number` (default 0) groups the flat
panel array into one `PanelRow` per group, instead of restructuring the array into rows-as-list-of-lists. A
second row appears once the fit count -- the same pure function of container width and panel widths a single
row already uses -- says more panels fit than one row should hold; there is no fixed pixel threshold for when
a second row starts. One field keeps every function that already operates on the flat array (append, close,
restore, promote) working unchanged, filtered by row, instead of duplicated per row.

**Workspace state.** A Workspace's open panels and their order live in the plain `useState` the provider owns.
When a host passes `storage`, the provider restores that list once at mount and saves it after every change that
settles; with none, nothing is loaded and nothing is saved. The shape, the ownership split and the save/restore
timing are in "Workspace state persistence: shape, ownership and timing" below.

## The workspace column

`createWorkspaceColumn` (`columnHandle.ts`, React-free) holds the ordered list of workspaces, their names and the current one;
`WorkspaceColumn` (`WorkspaceColumn.tsx`) draws it. A column is a handle like a workspace: `addWorkspace(options)` is the only way to
add one (no controlled props, no second way), and the column creates every workspace with `mount: false` and renders it in a cell
of its own, so the column owns `wrap`, `device`, `tuning`, `labels` and the other live members; `update` reaches all of them. An app that
draws its own rows passes `mount: false` to the column and a render function to `WorkspaceColumn`.

**Identity and names.** A workspace has a stable `id`, unrelated to its name. The id is the storage key: `ColumnStorage.workspace(id)`
gives the panel storage of that workspace, so a rename never moves saved panels. An app that already has a workspace adopts it as
the first one with `addWorkspace({ id })` and a `workspace(id)` that returns its existing storage for that id. `addWorkspace` takes
no storage or content of its own: the list saves only ids and names, so a workspace rebuilt from it could not find them, and the column has one content. `Workspace <n>` is
chosen at creation (the smallest number no name in the column uses) and stored, so a later delete or move never renumbers. The rename rules
(`workspaceName.ts`): the name is trimmed and cut to `MAX_WORKSPACE_NAME` (60) characters; a name empty after trimming changes nothing and
the input shows the old name again; Escape discards the draft; two workspaces may share a name. Deleting a workspace is out of scope.

**Switch motion.** Every way of moving the column (ArrowUp/ArrowDown, the neighbour buttons, `scrollTo`, `step`, and a new workspace made current) changes the track's `translateY` with the slide from `resolveWorkspaceTuning(...).slide`. The track snaps instead when Reduce Motion is on, from MotionConfig or from the system query alone, and the regression tests pin each source (`test/workspace-switch-scroll*.test.ts`); `proof/rc4-workspace-switch-scroll` samples the transform every frame in Chromium. A row that moves horizontally inside a workspace is a separate mechanism (`rowScroller.ts`) and is not part of this.

**Saved list.** `ColumnState` is `{ version: 1, workspaces: [{ id, name }], current }`. It is read once; workspaces code added before it
arrived keep their handle and take the saved name, the saved order wins, and any that the list does not know follow it. A record that
fails the guard reads as nothing saved. Saves run one after another after each change to the list, a name or the current workspace.

**Moving.** The column is moved only by `step`, `scrollTo`, the keys and the two buttons, never by a wheel or trackpad, so it cannot chain
a scroll out of a panel. Its track slides by `translateY` with the workspace slide tuning and snaps under Reduce Motion (the system
setting or an app `MotionConfig`). A button where there is no neighbour reads `labels.newWorkspace` and creates one on that side, then scrolls to it.
ArrowDown at the last workspace does nothing: only a button creates.

**Moving a panel.** `column.movePanel(from, panelId, to)` is the one way a panel changes workspace. A workspace keeps its panels in the row it is drawn into and saves them from there, so the move is made through both rows, not through their storage: the target creates the panel (`CreateRequest.carried` carries its `uid`, title and size) and the source removes it with `EngineOps.release`, which skips the closed-panel log and the undo window because the panel did not close. Both sides are checked before either acts, and the target adds before the source removes, so a failure in between could leave the panel twice and never lose it. The panel lands at the end of the target's row whatever its template's `placeOnAdd` says, because the person chose the workspace, not a place in it; the old row's anchor means nothing in the new one and is not carried, and neither is the person's choice of whether the panel may be parked. A size the person chose is recorded as theirs in the target, as a resize there would. The current workspace never changes: the answer carries the target workspace, its index and the panel's id, so a host that wants to follow calls `scrollTo` on it. Moving a panel code declares at every launch (`addPanel` before the workspace is ready) is allowed only when its `afterClose` is `stay-closed` and it is closable, because only the tombstone keeps it from being declared into the source again; any other would be back at the next launch, so it answers `not-movable`. `useViewState` values live in the `HostProvider` of one workspace's tree and do not move: the view starts again from its `initial`. A workspace keeps its panels in its drawn row, which is why both ends must be drawn and loaded. `hostData` is session data and is built afresh by the target's `defaultHostData`; a parked panel arrives live, as any new panel does. A refusal is an answer, not a throw, as for every operation a person's gesture can reach, and the result type adds `unknown-workspace` and `same-workspace` to `PanelRefusal`. `addWorkspace({ index: 0 })` and `addWorkspace({ index: workspaces.length })` already place a workspace above the first and below the last without moving the current one.

**Keys.** ArrowUp/ArrowDown act unless `arrowKeyBelongsElsewhere`: a handler already took the key (`defaultPrevented`), a modifier is
held, the key repeats or an IME composes, the target or the focused element is an input, textarea, select, contenteditable or an element
with a role that owns the arrows (textbox, searchbox, combobox, listbox, slider, spinbutton, menu, menubar, tablist, tree, grid,
radiogroup), the item is pressed under dnd-kit's keyboard drag, a panel is being dragged, or a modal dialog is open. A web view swallows keys, so the buttons are the way out of one.

**Mounted, inert, focus.** Every cell stays mounted, so panels keep their state, and the cells that are not current are `inert` and
`aria-hidden`. When the current cell changes while focus was inside the one left, focus moves to the new cell (`tabIndex -1`), so the arrow keys keep working.

**Vertical budget.** Each cell is as tall as the column. The column's `topInset` is clearance for chrome the app draws over the window (0 by default): the controls start below it, and the row's top padding is `topInset` plus `COLUMN_TOP_BAND` (76) plus the row gap (16), 92 px with no inset. Every control is 24 px high, the least pointer target. A panel's header hangs 56 px above its 700 px body, so from the window's top edge down: the button naming the workspace above at 0 to 24 px, the name input at 24 to 48 px, the headers from 48 px, the bodies, then the bottom button 24 px high ending 2 px above the bottom edge (`COLUMN_BOTTOM_BAND` is 26). The phone keeps its height. Measured in Chromium (`phonux-workspace-column-proof`): at 832 px high the headers start at 48, the bodies run 104 to 804 and the bottom button 806 to 830, so nothing overlaps and 832 is the least window height for that. With a `topInset` the least height is the inset plus 830: at 832 with an inset of 32 the input ends at 80 over headers that start at 68. At 1080 the row is centred in the 972 px between its paddings: headers at 172, bodies 228 to 928, bottom button 1054 to 1078. Under 832 the row sits at the top of its padding and the headers climb under the name input; the phone never shrinks for it.

## Naming rules R1-R4

- **R1. Name by the hierarchy.** A `Panel` slot's own parts are named `Panel*`, what a developer writes is
  named `View*`, and the bag a `View` reaches the host through is named `Host*`.
- **R2. Phone-only things keep "Phone".** A name keeps "Phone" when the thing it names is phone-specific no
  matter how big its panel gets -- the phone-model catalog, the phone size -- so the
  prefix still means something once panels stop being phone-shaped.
- **R3. Size-neutral names stay.** A name that already says nothing about phones is not renamed just because
  its folder is; renaming a name that was never phone-specific would buy nothing.
- **R4. Every rename keeps the old name as an alias.** The old name is marked `@deprecated`, and wherever the
  export is a value the alias is the same value as the new export, never a separate wrapper, so instanceof
  and identity checks on the old name keep working after the rename.

## The alias policy

A renamed export keeps its old name working as a same-value `@deprecated` alias, not a rewritten wrapper,
until a later minor release removes it. The owner decides when, because only whoever wires the consumers
knows once nothing outside still resolves the old name.

This is why a rename here is never a breaking change by itself: an existing import keeps compiling and keeps
returning the same value, only flagged deprecated, for as long as the alias stays in place.

## Workspace state, not "session"

A `Workspace`'s own saved state -- which panels are open, their order, sizes and params -- is named
*workspace state* in this package, never "session". "Session" already names something else: a host's own
saved sessions, a separate record stored in a file
that must never change shape. The two are different data owned by different code, so reusing one word for
both would leave every future name ambiguous about which it meant.

## Workspace state persistence: shape, ownership and timing

This section describes phonux's own half of workspace-state persistence: the saved `JsonValue` shape, the pure
project/hydrate functions, phonux's own storage contract, and the save/restore timing. It defines no
`WorkspaceGrid` mechanism -- one workspace, one row, a single `{version, panels}` envelope is enough, by design -- and it does not say where or how the data reaches disk; the host's own choices there are
out of scope (see "Ownership and scope" below).

### The shape

Declared as `type`, never `interface`, for the same reason `viewRegistry.tsx`'s documented rule already gives:
an interface has no implicit index signature, so it silently fails to satisfy `JsonValue` the moment anything
typed as `JsonValue` touches it. For the same reason `anchor` is an inline object type, not `PanelAnchor`, which
is an interface.

```ts
type WorkspaceState = {
  version: 1;
  panels: WorkspacePanelState[];
};

type WorkspacePanelState = {
  id?: string;
  view: string;
  url: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  live: boolean;
  anchor: { panel: string; position: 'left' | 'right'; priority: number };
  slots?: number;
  permanent?: boolean;
  layer?: 'base' | 'raised';
  uid?: string;
};
```

The saved file also holds `scroll?: { panel: string; offset: number }`, the row's rest, which "Where the row rests" below defines.

`version` is a literal `1`, bumped only on a breaking shape change; an unrecognized value is handled in
"Versioning and failure" below. `panels` holds one entry per saveable panel, in row order; the host's own root
column (History today) is never one of them (see "Permanent columns" below). `id` is read from an older file and never written: it was the panel's counter id, the name another entry's
`anchor.panel` used within the array, and counter ids restart at 1 each launch, so a file that carried them was
rewritten by every relaunch. A file now names a panel by its `uid` (its `key` for an entry with no uid) in every `anchor.panel`,
`overrides.anchor.panel` and `scroll.panel`; the host's root column keeps its own id. A restore reads `id` only as one more name an
anchor may use, in a file that holds it, and draws a fresh runtime id for every entry. `view` is the registry key; an unrecognized key renders the existing placeholder, the same as it does outside
restore, never dropped. `params` is opaque and view-supplied, carried verbatim and never interpreted, and the
guard does not look inside it. `listed` defaults to `true` when a panel isn't `permanent`, but `permanent:true`
forces `listed:false` regardless of any `listed` also present in the same saved entry -- the identical forcing
rule `appendPanel` already applies at create time, and hydrate applies it again rather than trusting a saved
`listed` value on a permanent entry. A saved entry with `permanent:true` and `listed:true` together is not a
shape-guard failure (both fields individually type-check); it is a combination `create()` itself can never
produce today, most likely from a hand-edited file, and hydrate resolves it silently by letting `permanent`
win, exactly as `appendPanel` would if both were passed to it. `live` is honored verbatim on restore, except on
a permanent column (see "Permanent columns" below). `anchor` composes through the existing anchor-fallback logic
when its `panel` is dangling or cyclic (see "How hydrate builds the list" below). `slots` defaults to
1 and is written only when it is not 1. `permanent` and `layer` are covered in "Permanent columns" and "What's saved, and what's never" below.

**`uid`.** Each saved entry also carries an optional `uid` so two copies of a file, on two devices, can match panels. It
is opaque: `u_` and 32 lowercase hex characters (128 random bits, from `crypto.getRandomValues`, with `Math.random`
where crypto is missing). It is not the panel's `key` and not its public id, and is never used as a handle; inside a file it
is the name entries use for one another (see above), and a counter id a panel holds at runtime is never saved. `appendPanel` is the one place a panel gets its uid (so a
plain, a template, a declared and a restored panel all do), and a closed panel that `undoClose` brings back is the same
entry, so it keeps it. A restore reads a saved uid back for each entry; a uid that is repeated, empty, not of that form
or not a string is dropped with an `invalid-saved-setting` note and made again. A panel already in the row (a declared
panel made at mount) takes the uid the file holds for it in place of the one it made. Version stays 1 and the field is
optional: a file without it restores unchanged. Minting happens after the declarations claim saved entries, which
read `key` and never `uid`, so a 0.1.0 singleton is still claimed once. A restore that had to make a uid, or found a
present panel's entry without one, sets the save baseline to nothing so one save follows at once; a restore that made
none writes nothing. A library older than this one reads the file, ignores `uid`, and its next save drops it, so the uids
are made again at the next launch of a newer one and panels match only between devices on a version that writes them.

### What's saved, and what's never

- **Saved.** `view`, `url`, `title`, `params`, `listed`, `live`,
  `anchor`, `slots`, `permanent`, `layer`, and the file-level `scroll` (see "Where the row rests"). `listed` and `layer` are written whenever the panel
  has them, `slots` only when it is not 1, `title` and `params` only when defined, and `permanent` only when true; no key is ever written as
  `undefined`. A panel with no anchor of its own is saved with the one its position in the row implies.
- **Never saved -- `hostData`.** The host's own opaque per-panel data, which a host may use for its
  runtime handles (a live web view's id, say). No runtime handle is ever saved, and phonux cannot tell a handle from any other
  value inside the blob, so none of it is saved: `WorkspacePanelState` has no field for it. A restored panel
  gets `defaultHostData()` like a created one, so a host that needs a fresh handle per panel builds it there;
  with no `defaultHostData`, or when it returns `undefined`, the panel has no `hostData` key at all.
- **Never saved -- `size`.** Always recomputed from `slots` (`sizeOfSlots`), never round-tripped.
- **Read from an older file -- `formFactor`.** A new file never writes `formFactor`. A file that has one, on an entry or in
  `overrides.formFactor`, is still read as a slot count: `phone` is 1, `tablet` 2 and `desktop` `ALL_SLOTS` (64, which the fit
  and `maxSlots` clamp). When an entry or its `overrides` holds both `formFactor` and `slots`, `slots` wins. An
  `overrides.formFactor` that is none of the three is dropped with an `invalid-saved-setting` note (`overrides.formFactor:
  expected phone, tablet or desktop; dropped`); an entry's own such value fails the shape guard like any other malformed field.
- **Never saved -- `collapsible`.** Not an independent stored fact: it is `appendPanel`'s own `!info.permanent`
  derivation, recomputed from the saved `permanent` field on restore rather than round-tripped.
- **Never saved -- `anchoredEnter`.** A creation-time enter-animation hint, defaulted on restore, not a fact
  about the panel worth persisting.
- **Never saved -- History's own entry.** Host-supplied and reseeded fresh every launch (see "Permanent
  columns" below).

### Ownership and scope

phonux owns the `WorkspaceState`/`WorkspacePanelState` types, the guard `isWorkspaceState`, the pure
`projectWorkspaceState`/`hydrateWorkspaceState` function pair, the restore and save timing, and a small
`WorkspaceStorage` (load/save) contract phonux defines but never puts on the public `Host`/`PanelsAPI` bag. Only
the three types are public, exported from the package entry point so a host can implement the contract; the
guard and the pair live in `workspaceState.ts` and stay inside the package, because only `useProvidePanels`
(through its persistence hook, `panels/useWorkspacePersistence.ts`) and the tests call them. Keeping a capability
off the public bag has a real precedent already in this package:
`CaptureRegistryContext` keeps the write side of a picture out of `Host`/`SnapshotsAPI` entirely, as its own
second context that app code mounts through `CaptureRegistryProvider`, AROUND `HostProvider` (see "Snapshots"
below) -- `HostProvider` itself never mounts it. `HostProvider` does mount two contexts internally, for its own concerns kept off
the public bag: `OverlayProvider` and `ViewStateProvider` (see "useViewState" below). `WorkspaceStorage` follows
the same "keep it off the public bag" idea as all three, but not any of their context-based wiring: unlike
`CaptureRegistryContext` and `ViewStateProvider`, each reached by arbitrary descendant `Panel`/view instances
independently, `WorkspaceStorage` is consumed at exactly one call site -- inside `useProvidePanels`, by its
persistence hook (`panels/useWorkspacePersistence.ts`), the only thing that ever calls `load()`/`save()` -- so a
plain injected value on `useProvidePanels`'s own input, `PanelsInput.storage`, is enough and no context is
needed. That is the same single-call-site injection an
existing dependency already uses on that same input (`PanelsInput.capture`). The host owns the storage entirely:
the file's real name and on-disk location, the IPC channel names, and the write mechanics (including whether the
write is atomic) are the host's own choice, out of this design's scope. With no `storage`, nothing is loaded and
nothing is saved: no state is set and no promise or timer is created.

```ts
declare function isWorkspaceState(value: unknown): value is WorkspaceState;
declare function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string): WorkspaceState;
declare function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[];

type WorkspaceStorage = {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): void | Promise<void>;
};
```

`projectWorkspaceState` and `hydrateWorkspaceState` are pure and phonux-owned, operating on `PanelWindow`, the
panel model in `panelWindow.ts`; `rootId` is threaded through like every function there, because which entry is
the root is the app's choice. `WorkspaceStorage` is phonux's own contract, not an implementation: the host
supplies a real `load`/`save` pair. `save` returns nothing or a promise, and phonux guards it: a throw or a rejection is
reported once through `WorkspaceOptions.onError` (`console.error` when it is unset) and never rethrown out of the save
timer, and the failed save is retried by the next change (see "Save timing"). The provider validates whatever `load()`
resolves with, so a host may hand it unvalidated JSON.

### How hydrate builds the list

Hydrate draws a fresh id for EVERY saved entry before it does anything else, so a saved name that happens to
equal a fresh id is never reused. It then builds each entry through `appendPanel`, the one creation function,
so every default and every creation rule (`permanent` forcing `listed:false` and one slot, a slot count's
size from `sizeOfSlots`) has no second copy, and overwrites `anchor` and `live` from the file. It copies only
the keys it knows, which is what makes a later optional field additive (see "Versioning and failure" below).

An anchor's target is mapped as follows: the root stays the root; a saved name maps to the fresh id of that entry (its `uid`
first, then the `id` an older file holds, then its `key`; a name two entries claim goes to the first);
anything else (an entry closed before the file was written, or a hand-edited name) maps to ONE id drawn lazily
after the entries, which no panel holds. A saved name kept as it stood could equal a fresh id -- both count up
from 1 each launch -- and would attach the panel to a stranger; with the unheld id, `computeRowOrder`'s own
fallback for a missing target applies (the root's right side, the priority kept), the same one a self-anchor or a
cycle gets. Hydrate then runs ONE `computeRowOrder` over the whole set: placing the entries one at a time would
rewrite an anchor that names a later entry.

### Save timing

Once the initial restore attempt has settled, phonux computes `projectWorkspaceState` on every committed panels
change, or on a change of the row's rest, and compares its JSON with the baseline: the JSON the file is known to hold, which is the restore's baseline
(see below) until a save succeeds. An equal projection is skipped. Otherwise it schedules `save()` 500 ms later
(`WORKSPACE_SAVE_QUIET_MS`) and every further change restarts that wait, so a drag is one save and a change that puts
the row back to what was saved saves nothing.

The baseline advances when a save succeeds, not when the timer fires. A `save` that returns nothing has succeeded at
once; one that returns a promise has succeeded when it resolves. A throw or a rejection leaves the baseline where it was
and is reported exactly once. Nothing retries on a timer of its own: the next committed change to the panels (a new
`panels` array, including one whose projection equals the failed one) saves the full current state again.
Overlapping saves follow three rules. A save that settles after a newer one has started neither advances nor resets the
baseline, because it says nothing about what the file holds now. When the timer fires while a save of the same JSON is
still in flight, no second save is made; if that save fails, the next change saves the same content again. And while a
save is in flight, a change back to the baseline is still saved, because the save in flight may land after it.

The gate is React state, not a ref: opening it must re-run the save effect, or a change committed while `load()`
was pending and then found nothing to restore would never be saved. The hazard the gate exists for is real:
A host's synchronous seed initializer runs before any async `load()` can possibly resolve, so an
unconditional save fired before the gate would let that transient boot state clobber a real saved file.

There is no flush when the window closes or the provider unmounts: a change made in the last 500 ms before a
quit is lost. A lost save is the accepted cost; the host's own writing decides whether a file can be torn.

### Restore timing and the storage-hook contract

`load()` is necessarily async, so first paint is always the app's existing default (the synchronous seed), and
the restored list applies via one later state update once `load()` resolves -- never inside a synchronous
initializer. `WorkspaceStorage.load(): Promise<WorkspaceState | null>` is called once per mount, from a mount
effect (StrictMode runs that effect twice in development, so `load()` is then called twice and only the call
that was not cancelled applies). `null`, a rejection, and a `load()` that throws before it returns a promise all
mean nothing saved, silently. A result that fails `isWorkspaceState`, or names a version this build does not
recognize, also means nothing saved, and logs one console warning.

Fresh ids and `defaultHostData` are drawn in the promise callback, never inside a state updater, because React
may run an updater twice; the fresh ids come from the same counter `create()` uses, so a restored id never
equals a created one. The restored panels are merged with `computeRowOrder([...current, ...restored])` and
skipped when there are none, so a panel created while `load()` was pending survives the restore. A priority tie
follows `computeRowOrder`'s own rule: the entry later in the array is nearer on the left of the root and the
earlier one is nearer on the right. Restored panels come after the ones already there, so on the right of History
the panel that was already in the row is nearer, and on the left the restored one is.

The baseline for the save comparison is the JSON of the projection of the list just hydrated, not of the file:
the file's ids differ from the fresh ones whenever a panel was closed in an earlier session, and project writes
runtime ids, so comparing against the file would save at every launch. When nothing was restored the baseline is
the empty projection, so opening the app saves nothing while a panel created earlier than the restore is saved.
`WorkspaceStorage.save(state)` is called only from that debounced, settled-gated path, never from any other
call site. The hook reads `storage`, `rootId`, `freshId` and `defaultHostData` at mount only.

### Restore behavior

Restore honors each panel's saved `live` flag verbatim, unconditionally and with no prompt, except that a
permanent column is always live: a panel that was showing a page reloads it, a parked panel stays parked. Capacity
still applies after a bulk restore exactly as it does for any width change: `usePanelManager`'s
capacity-reconcile effect parks live overflow on the current panels array regardless of what produced that
array, so a restore that brings back more live panels than the current width holds gets parked the same way an
ordinary resize does, with no separate fit-checking logic needed in hydrate. The parked flags are then saved like
any other change.

### What a panel remembers: overrides, applied, and the one reconcile

An entry made under settings also saves `key` (the template id for a singleton, the declaration's id for a
code-declared panel, `<template>~<id>` for a multiple template, the panel's id for an anonymous one), `instance`
(the layer the panel was made with: a Host-bag create's asks, or a plain `permanent`; left out for a code-declared
panel, whose declaration is the source of truth), `overrides` (`anchor`, `slots`, `parkable`: what a person did
with a gesture), `applied` (the `placeOnAdd` that placed the entry last) and `closable: false` when the panel is
unclosable. The file also carries `dismissed` (at most 256 keys of declared panels a person closed, the oldest dropped) and
`root` (the root entry's `key`). All of them are additive, so a 0.1.0 reader ignores them and a 0.1.0 file restores
unchanged.

- **Ownership.** An entry with no `overrides` is a 0.1.0 entry and owns its anchor and slots as saved. With `overrides`
  it owns each key present, applied as a user layer on top of the cascade. The gestures that write them
  (`move`, `reanchor`, `setSlots`) call `recordOverride` in the same updater as the change; `clearOverrides`
  empties them. Only those two and `reconcileWorkspace` write `overrides` on an entry, and `projectWorkspaceState`
  builds the saved member.
- **Gestures are gated, restoring is not.** A stored `slots` or `anchor` restores although the template now says
  `resizable: false` or `movable: false`. A count above `maxSlots` is clamped to it, and `parkable: false` on a panel that
  resolves to more than one slot is dropped with an `override-dropped` note and is absent from the next save.
- **`applied`.** An entry with no override keeps its saved place only while the resolved `placeOnAdd` equals
  `applied.placeOnAdd`; when the default changed it is placed again.
- **`restoreVisibility`** decides each restored `live`: `saved` keeps the file's flag, `live` and `parked` force it. A
  fixed column is live whatever it says (C1).
- **One pure reconcile.** `reconcileWorkspace` draws every fresh id first, then claims a saved entry for each
  declaration (by key, else the first unkeyed entry of that template, so a 0.1.0 singleton is not made twice), resolves
  each entry through the cascade with `lenient`, and returns the new entries, the notes and `dismissed`. A saved panel
  with an unusable instance key restores with the valid ones and a note; a file it cannot read restores nothing and the
  workspace still settles. It runs inside the load success handler, and a throw there takes the failed-load path.
- **Creation paths.** A Host-bag `create({ view: templateId })` obeys `hostCreatable`, `multiple` and `maxInstances`;
  a restore is exempt from all three. `permanent` on a template view is ignored with a `not-view-settable` note
  naming the host layer's `parkable`, and keeps its 0.1.0 meaning for a plain view. Without `workspaceDefaults`,
  `templates` or `declared` a create builds the 0.1.0 entry, with no settings.
- **Declarations need storage.** Code-declared panels are made by the reconcile, which runs inside the persistence
  hook, so a provider with no `storage` makes none.

### Where the row rests

`WorkspaceState.scroll` is the row's rest. `panel` is the id of the first panel the window shows at the stop the row rests
on (`stopSpans[k].first`), and `offset` is how many phone widths that stop lies from that panel's left edge, negative when
the stop is left of it. The offset is the stop's distance from the panel's edge over `phoneWidth + rowGap`, so a rest at
the edge is 0. The margin before the first panel puts most stops off an edge, so the offset is usually not 0; it is what
lets a rest inside a panel as wide as the window come back to that stop and not to its edge.

Only a person's move writes it. A wheel, a pointer-down or a key starts a watch on the row, which records the stop the row
comes to rest on once it has stood still for 150 ms, and only if it moved in that time. Opening never records one, and nor
does a row the restore left where it was, so a file that holds none is not changed by opening. The rest is saved with the
same debounced save as the panels (see "Save timing"), and the restore baseline holds the marker it restored, so opening a
file that holds one saves nothing.

On restore, `panel` is matched to this launch's entry by the entry's `uid`: a file keeps one per saved panel, and the root,
which is never saved, keeps its id. The once-per-mount layout effect in `useProvidePanels` then goes to the stop that shows
that panel nearest its left edge moved by the offset (`snapToStop`), in the commit that measures the row, with `glideTo` at
duration 0, so no frame shows another position. A saved rest wins over `tuning.initialScroll`. It is not used when its panel
is gone or not drawn, when the row has no stops, or when a wheel or pointer-down reached the row before the restore settled
(the same rule `initialScroll` follows).

A `scroll` that is not `{ panel: non-empty string, offset: finite number }` is dropped with an `invalid-saved-setting`
note and the file restores as it would without one; `version` stays 1, and `isWorkspaceState` ignores the field. A
resized window lands on a stop that shows the panel at the same offset in phone widths, not at the same pixels.

### Versioning and failure

- **Missing.** A missing file -- no saved data at all -- is treated the same as first launch: no saved state, nothing restored.
- **Corrupt.** A corrupt file -- unparsable JSON, or content that fails the shape guard -- likewise yields no saved state, logged once and otherwise silent.
- **Version.** An unrecognized `version` yields no saved state and no migration path: hydrate never guesses at an old shape, and the next save overwrites that file.
- **Extension rule.** `version` stays `1` while the format only grows. A later optional field is additive: `isWorkspaceState` ignores keys it does not know and hydrate copies only the keys it knows. Only a breaking change bumps `version`, and a build that then meets a version it does not know sees no saved state.
- **Not a new failure case: anchors and view keys.** A dangling or cyclic `anchor.panel` and an unregistered `view` key are not new failure cases: hydrate composes through the existing anchor-fallback and view-placeholder mechanisms already used at runtime, the same ones either can hit outside restore.
- **Not a new failure case: slot fit.** A restored panel whose `slots` no longer fit the live window width is likewise not a new failure case needing its own fit-checking: `usePanelManager`'s capacity-reconcile effect already fires on any panels-array change, including a bulk restore, and parks the overflow the same way it parks an ordinary width overflow.

A panel closed inside the undo window does not survive a restart or quit, by design: `usePanelClosing`'s
`close()` removes the panel from the live panels array synchronously, and the separate closed/undo state that
keeps it available for the undo window is never saved.

### Permanent columns

A view-created permanent column is saved with `permanent: true` and restored as permanent, and only the host's
root column (History today) is never saved, because the host reseeds it fresh every launch. A permanent column is
always live on restore: as for `listed`, `permanent` wins, because an always-shown column is never parked, so one
saved as parked would never render and could never be revealed. No app code creates a permanent column at mount today, so
a view-created one would otherwise vanish on restart, against the rule that every saved panel comes back; if
a host later creates a permanent column at mount itself, it must not also be restored from saved state, a case to
revisit then.

`PanelWindow` has no `permanent` field to read, only `collapsible` (set once at creation from `appendPanel`'s own
`!info.permanent` derivation and never itself retained as `permanent`), so `projectWorkspaceState` derives the
saved value as `!collapsible`, excluding the host's own root column, which is never saved at all regardless of
its `collapsible` value.

### Known limitations

- **Panels parked by capacity do not come back by themselves.** A panel parked because the window was too narrow
  is saved parked. After a restart it stays parked when the window is later widened, because the stack that
  reveals the most recently parked panel is not saved.
- **A panel restored parked has no picture in History** until it has been live once this session. phonux takes a
  picture only when a panel goes from live to parked, and pictures are session memory. `Host.snapshots` is
  optional, so this shows as no picture, never as a failure.
- **A restored title can repeat.** A restored panel keeps its saved title, so a later default `Panel N` title,
  numbered from this launch's counter, can repeat it.
- **Restored panels enter with the ordinary animation,** because `anchoredEnter` is not saved.
- **`params` freezes at creation.** There is no way to update a panel's `params` after it is created, so
  persistence saves a view's resumable content as it was when the panel was created.

## The header-to-frame gap is a constant, and the grab handle does not follow it

`HEADER_GAP_PX` (`rowConstants.ts`, 4) is the space between a panel's header and its frame, and the one number `PanelFrame`'s
header offset and the footer's padding measure against. It is a constant, not tuning: a developer who wants another look
passes `sx` to `PanelFrame` or `PanelFooter`. The grab handle is `GRAB_HANDLE_PX` (24), WCAG 2.5.8's minimum pointer target
both ways, so changing the gap never shrinks the handle. The footer is bare like the header (no border, shadow or fill) and has the header's height.

The footer floats `HEADER_GAP_PX` below the frame, mirroring the header's gap above it, and is `BAR_HEIGHT_PX` (36, `panelChromeSize.ts`) tall, the same constant the header's height reads, in every theme. The row's bottom padding and the phone-fit height budget both use `rowBottomReservePx(gap)` = `max(gap, FOOTER_ROOM_PX)` (`panelChromeSize.ts`, 4 + 36 = 40), so the footer's whole box lies inside the row and a click at its centre reaches it. `test/footer-room.test.ts` and `test/phone-fit-reserve.test.ts` pin the chain.

`Panel`'s `grabProps` is a separate prop from `headerProps`, not a field folded into it, because the header
and the grab handle are two different elements: the handle is a grip icon inside the header row, left of the
title, and `grabProps`'s `onPointerDown`/`sx` reach only it, so clicking the title text or an action icon is
never mistaken for a drag start. It is one element with the same role, name and keys wherever it sits. It fades
with the header it lives in, so it takes no fade of its own there. A `Panel` with `grabProps` and no `title` has no
header row, and the icon is drawn alone above the frame's top-left corner instead. Omitting `grabProps` renders no
handle at all, which is the correct shape for a view that cannot be closed or moved (nothing to drag).

## `DragToClose`: drag down to close, optionally sideways to reorder

`DragToClose` (`dragToClose.tsx`) knows nothing about panels or the app, only "the user dragged this box down
far enough, call `onClose`". `onClose` is optional: a box without one has nothing to close, so a release past the
line snaps back. Its render prop hands out a handle for `Panel`'s `grabProps`:

```tsx
<DragToClose onClose={() => panels.close(id)}>
  {(handle) => <Panel title="Mine" grabProps={{ ...handle }}>...</Panel>}
</DragToClose>
```

The handle is the grab bar and nothing else, so the body keeps its own scrolling and clicks. The box follows
the pointer vertically, up and down. On release `shouldCloseOnRelease` decides: close (the box leaves
downward, then the latest `onClose` runs) or snap back on a spring. `@dnd-kit/core`'s pointer sensor, one
`DndContext` per box with its auto-scroll off, decides when a press becomes a drag and when it ends or is cancelled,
with its events on `document`, so a drag survives leaving the handle; Motion draws the box and runs the springs.

**Reporting the pointer, and dropping elsewhere.** `onDragMove({ x, y, clientX, clientY })` runs on every pointer move from the move that engages the
drag (`x` and `y` are the pointer's travel from the press, `clientX` and `clientY` its viewport position), and `onDragEnd({ offsetX, offsetY, clientX, clientY })`
runs once at release, before `reorder.onDragEnd` and before any close. Both read the pointer's own events, so they are exact whatever the box's
drawn offset is. A press that never engages, and a cancelled gesture (a native pan, Escape), report no release: an app that previews a drop target clears it
when its own pointer tracking ends, not on `onDragEnd` alone. An app hit-tests its own targets with `clientX` and `clientY`; the library draws none. `closeOnRelease={false}`
keeps the box from closing on release: whatever the distance or speed, and whichever way it was dragged, the release springs home and `onClose` is not called by the
drag (the Delete key still calls it). These are props of `DragToClose`, not panel settings: a callback is a closure over the app's own state, and a setting is
data that is configured, saved and restored. While a drag is engaged on either axis the panel's slot is lifted to `ROW_LAYER_Z.DRAGGED` (never below its own
layer), read from the same dragging mark as `usePanelDragging()`, so the box paints over the row's other slots and over an app element at a lower z; the lift
ends with the spring home, when the mark does. The row's scroll container still clips what is drawn outside it.

**Keys and names.** When `onClose` or `reorder.onStep` is set the handle is a focusable `button` (`role`, `tabIndex`, `aria-label`
`labels.grabStrip(title)`, `aria-keyshortcuts` and `onKeyDown` are in the handle) where ArrowLeft and ArrowRight call
`reorder.onStep(-1 | 1)`, Delete calls `onClose`, and each says what happened through the Workspace's live region. A key with a modifier, or one
aimed at something inside the handle, is left alone. Because the handle is itself a button, the press rule skips a control inside the handle,
never the handle. Inside a row the pointer drag says `labels.pickedUp`, `dropped` and `dragCancelled` with the panel's title through dnd-kit's own
live region, in place of "draggable item" and a React id; a close by drag says `labels.closed` through the Workspace's.

**Coexistence.** `touch-action` is `pan-x` on the handle: a horizontal swipe still scrolls the row, a vertical
one is the gesture's. A press on a button, link or field is left alone, and only the primary button grabs.
While a drag is live every vertically scrolling ancestor is locked (`overflow-y: hidden`, because a
transformed box would add a scrollbar). The lock ends with the spring back (or a press that stops it) and
when the box unmounts.

**No selection while dragging.** From the press until the pointer lifts or is cancelled (and until the box unmounts), the
document element's `user-select`, `-webkit-user-select` and `-webkit-user-drag` are `none`, and a capture `dragstart`
listener cancels a native drag: `-webkit-user-drag` does not inherit, so a photo inside a panel would otherwise start one,
and a native drag ends the pointer events this gesture runs on. Safari reads the prefixed `-webkit-user-select`, so all
three go on the same element. The holds share one record per document (`holdDragSelection`): the first takes the inline
values and priorities the host had, the last gives them back, so overlapping drags (two touches, a press landing on a
spring still unlocking) cannot restore each other's `none`. The document is the handle's `ownerDocument`, so a panel
rendered into another window works. The press itself clears nothing, so a click on a grab bar keeps what the person
selected; dnd-kit clears the selection when it activates the drag. There is no setting to turn this off: a drag that
highlights text and photos is never wanted, and no host has asked for one that does. If one does, it is a `tuning` leaf
defaulting on. A hide and show in the middle of a drag (Activity) gives the hold back and takes it again.

**Tuning and closability.** Inside a row the box reads its numbers from the slot it sits in, which are the workspace's: the close rule from
`dragToClose`, and the exit's length from `slide.closeExitSeconds`, which the slot's own down exit shares so a trash-button close and a drag close read as one
motion, along the curve of `slide.closeExitEase` (`'easeIn'`: a Motion name or a cubic bezier). The direction lock (8 px), the snap-back spring, the speed window (100 ms) and the rest time (50 ms) after which a lift has no speed are
constants in `rowConstants.ts`, not tuning. A row's own scroll glides (a step, `scrollTo`, the settle after a resize or a
drag) travel along `slide.glideEase`, `'cubic-out'` by default (1 - (1 - t)^3, not `slide.ease`), so a host that wants
one curve sets it equal to `ease`. The slots' stacking is the exported `ROW_LAYER_Z` (base 1, raised 2, dragged 3), below
every `OVERLAY_Z` layer; layers are structure, so they are not tuning. Outside a row it reads the library defaults. It also reads the slot's `closable` (alone: not `collapsible`,
which only decides whether the view wraps a box at all) at the release and again when the exit animation ends. A
release that finds `closable` false starts no exit; one that finds it turned false at the end of the exit does not
call `onClose` and springs the box back to rest, unlocks the scroll ancestors and takes presses again.

**Effects that run twice.** The box's effect cleanup never stops a running spring: React 19.2 runs a cleanup and its
setup again for a keyed child that a reorder moves under StrictMode, and Activity runs it on a hide, and a stopped
release spring leaves the box at its drag offset.

**A close is final for the box.** A close never unlocks (the box is parked below the fold), so `onClose` must
remove the view. Once a release has decided to close, the box takes no more presses: one would stop the exit
and the close would never run. If the caller brings the box back while `AnimatePresence` still holds it (the
same key returns, as on an undo), it becomes a fresh box at once: at rest, unlocked, taking presses, its
pending exit stopped.

**Reduced motion.** No exit animation and no spring: a far drag calls `onClose` at once, and a short one (or a
horizontal reorder release) puts the box back at once.

**Reorder on the same handle.** With `reorder` set, the handle also drags horizontally. The box reads the pointer's
own events, not the sensor's reports, because the sensor reports a move only after its activation distance and a
release right after it would read no offset; a keep-alive step in Motion's frame loop applies the offset once per frame.
The first `DIRECTION_LOCK_PX` of movement decides which axis wins, and the losing axis's own MotionValue is zeroed on
every step after that. The sensor has no velocity, so the close rule's velocity is read from the last
100 ms of those samples. A `pointercancel`, which a native pan sends, is the sensor's own cancel: the box springs
home with no hop and no close. A gesture locked
horizontal never evaluates `shouldCloseOnRelease`, so residual vertical jitter can never close the view; one
locked vertical, or one that never locks (a sub-threshold jiggle), runs the close logic unchanged. Without
`reorder`, for a handle that only closes (History's bar, never a reorder source), only the vertical offset is followed.

**Live reorder.** While a horizontal drag is held, the box publishes its offset to the row (the slot's `previewReorder`): the
release's own expression, the pointer offset (edge-held) or the drag offset, plus the row's scroll distance, never the drawn
`x`, which `cap` may clamp. The box applies no hop rule itself; `PanelRow` turns the offset into hops with
`reorderStepsForOffset`, keeps `{ id, steps }` as state (a frame that changes no hop count changes no state) and moves each
panel the drop would cross by the DRAGGED panel's width plus the gap, left when dragged right and right when dragged left, as
the `leftOffset` handed to its `PanelRowSlot` only: the row numbers, the rests a parked entry keeps and the order are untouched,
so a refused or no-op drop leaves nothing to undo. The crossed ids and the widths `reorderStepsForOffset` reads come from one
walk (`neighborsAt`), so the preview and the release cannot disagree. Nothing is published for a panel that is not `movable`. The root is no exception: with `movable: true` it publishes like any panel, and the panels it would cross slide aside by its span.
Panels render in the order they first appeared, not in reading order, so a reorder moves no DOM node: a node that React moved would restart what it hosts (a web view reloads). Position on screen comes from `leftOffset` alone. Tab order would then follow the open order, so `PanelRow` handles Tab and Shift+Tab at a panel's last or first tabbable element and hands focus to the drawn neighbour's (`panelRowTabOrder.ts`); inside a panel and past the row's ends the browser's own movement runs. A Tab pressed inside an iframe (a web view) goes to the iframe's own document, so the row sees no keydown; a slot that holds an iframe (or frame, embed, object; watched by a MutationObserver) therefore renders a zero-size `tabindex=0` sentinel first and last, and the browser's step out of the iframe lands on it in this document, where the same hand-over runs (`steerSentinel`). A sentinel carries no `aria-hidden` (a focusable element must not) and no role, and it forwards focus at once, so it rests only at the end of the document, one extra stop before the browser's own chrome. Slots without a frame render none. Focus arriving from outside the row is redirected to the first (Shift+Tab: last) tabbable element in reading order only when a Tab key press caused it (recorded by a capturing document keydown listener, so a first Tab from the page or browser chrome counts too); focus from a click or a script is left where it went. One entry is not reordered: when the Tab comes from browser chrome into a row whose DOM-first (Shift+Tab: DOM-last) panel holds a frame, Chromium reports no source element, which looks the same as a step out of an iframe, so focus stays in the panel the browser chose.
The dragged slot is drawn at `zIndex` 3 from the first publish until the spring home ends (the box publishes `null` there, when
a press stops the spring, on a revive and under reduced motion at the release). The release publishes offset 0 (no hops) after
`reorder.onDragEnd` returns, so the host's `move` calls and the cleared preview land in one React batch and the neighbours
already rest where the new order puts them. This holds for a host that applies `move` synchronously (a
`handle.move(steps)` from a row's view, or a raw `move` loop); a host that applies it later sees the neighbours slide back and forward
once. A host with a different hop rule gets a preview that does not match its drop.
Under Reduce Motion (the system setting, which the drag box reads itself, or the app's `MotionConfig`) the slot hands Motion an instant
transition inside its animate target for as long as a preview is set, so the neighbours' shifts, their return and the dragged slot's move to
its new rest snap; the release then clears the preview one frame after the host's move, so that move is still judged as part of the preview.
Exit and park slides keep their own transitions.

**Edge scrolling.** A mouse or pen drag that locks horizontal in a scrolling row (the slot's `dragScroll`, built from
`tuning.edgeScroll` and the row numbers) takes the row scroller's claim,
found by its `data-row-scroller` mark and never by computed overflow, so a hidden-overflow container is found too. A
`requestAnimationFrame` loop then scrolls it while the pointer rests inside a band of `zonePx` at either edge of that
container (`edgeScrollSpeed`, a linear ramp to `maxPxPerSec`; `edgeScrollStep`, one frame capped at 50 ms), and the
claim's bound is the row numbers' `maxScroll`, never `scrollWidth`, which a box drawn past the row's end would inflate. The
box is therefore never drawn past it: its drawn offset is capped by how far it sits from the row's end (measured once when
the drag locks), so the scrollable width stays as it was. Under
reduced motion the row instead jumps to the next panel start every `reducedStepMs` the pointer
stays in a band. The box is drawn at Motion's `x`, which the loop sets to the pointer offset, plus the scroll distance
as the CSS `translate` property, which Motion's rewrites of `transform` never touch; the release reports the pointer
offset plus the scroll distance, so the hop rule sees where the box really is, and one spring takes both home, since
two springs over distances this different would land in different frames. The claim goes back before the hop is
reported, so the scroll the hop causes is not dropped; a `pointercancel`, which a native pan sends, ends the hold with
no hop. A touch drag never edge-scrolls: the handle is `touch-action: pan-x`, so a touch swipe is a native pan.
The hold keeps the mode and the three edge numbers (`zonePx`, `maxPxPerSec`, `reducedStepMs`) the drag locked with,
so a `configure` made while the pointer is down reaches the next drag; the bound and the panel stops are
read again every frame, and the hold ends when the row stops scrolling.

**Alternatives to the gesture.** WCAG 2.5.7 asks for a single-pointer alternative: offer a button that calls
the same `onClose`, as History's trash buttons do. The row's drag-to-reorder needs one too; `handle.move(1)` and `handle.move(-1)`
exist for it, but no such control is built.

## A drag that starts outside the row: `usePanelRowDrop`

A tile in a view (a Workspace or History tile) drags a panel into the row with `usePanelRowDrop()`: `begin(id, source)`, `update(clientX)`,
`end()` and `cancel()`. PanelRow provides the controller through a context, so the hook works in any view the row renders and answers
false, doing nothing, outside one.

**One hop rule.** The header drag and this drag count hops through the same `stepsFor(entry, offset)` in PanelRow
(`reorderStepsForOffset` over `neighborsAt`), and part the row through the same `partShifts`, so for the same offset the neighbours
sit in the same places. The offset counts from the centre of the panel's slot, or, for a panel that is not in view, from the centre of the
gap it would hold at its place in the array. The preview is state in PanelRow; the order changes only at the drop.

**A panel in view** is drawn at the slot its hops end in, the crossed neighbours slide aside by its span, and `end()` is one `move`. **A parked or
hidden panel** is not in the row, so the row holds a gap its own width (`dropParts`): every present panel after its place in the array moves right
by the span and the ones the drag crossed take that back. The gap is a transient element carrying `data-panel-row-drop-gap`, not a public contract.
`end()` lands it with `landPanelIn`, an internal verb of the workspace core: place and show are two gated verbs that answer `busy` to each other
in one turn, so one gated engine op (`land`) does both in one update. A live panel handed to it is only placed.

**Refusals.** `begin` refuses an unknown, closed or pending panel, the root, a second drag while one runs, and a panel whose `movable` is false when
the source is `'person'` (the default; `'code'` is not limited by `movable`, as the handle verbs are not). A panel that is not `crossable` stops the
walk, so a pinned panel cannot hop over one either.

**Edge scroll.** The drag takes the row scroller's claim at `begin` and runs the same frame (`stepEdgeHold`, with `edgeScrollSpeed` and
`edgeScrollStep`) that `DragToClose` runs; the two share `panelRowDropScroll.ts`. The hop count is read again every frame, because the row scrolls
under a pointer that has not moved. The claim goes back at `end`, `cancel` and when the row unmounts.

## PanelFrame's inset, scrollbar and header

Every view renders inside `PanelFrame` so each section reads as one phone silhouette; a view that grew its
own border/radius/background declarations would drift from the others. The frame is the phone's size unless
`size` or `expanded` says otherwise: a slot never grows to fill space.

**The view owns its content.** `PanelFrame` applies no padding, scrollbar or scroll behaviour to what it holds, and the
library exports no look value for it: no inset, no scrollbar width, no scroller recipe (issue 309). Its inner box is a
plain flex column styled only by its `sx` prop. A view that scrolls sets its own padding and `::-webkit-scrollbar` rules on
the element that scrolls. Nothing is measured at runtime. The phone's look is the frame's border, radius and size; the
inside is the developer's.

**Why a classic scrollbar (for a view that wants one).** The default here in WebKit and Blink engines is an overlay scrollbar: it floats over content,
reserves no layout width (`offsetWidth === clientWidth` on a scroller with real overflowing content) and
draws with its own built-in inset from the scroller's edge, which no padding or box-model change on this
side can remove. Splitting the frame into an outer box (border, radius, size, `overflow: hidden` clipping, no
padding) and an inner scroll container (the padding, `flex: 1`, `minHeight: 0`) is therefore not enough on
its own. The explicit `::-webkit-scrollbar` rules force a classic scrollbar, which reserves real width
(`offsetWidth - clientWidth` equals the declared `width`) and sits flush against the edge like a web page's
own scrollbar. Those rules style only the element they are set on, so a nested scroller needs its own copy
or it falls back to the engine's default-width bar and breaks the arithmetic above.

**No reserved twice.** Because the frame adds no padding or gutter, there is nothing for a nested scroller to
cancel. `panelFrameBareSx` is a deprecated empty object kept so existing imports compile.

**The corner radius and the ring.** The frame's 1 px edge is an inset shadow on the outer box, drawn under its children, with 1 px of padding of the same width (one constant in `PanelFrame.tsx`), so the content box begins where the ring ends. The outer box rounds at `panelCornerRadiusPx(theme)` (24 px by default). The content box takes `border-radius: inherit` and clips its children, so opaque full-bleed content (a photo, a web view) cannot cover the ring along a corner arc, which would read as a border that fades out at the corners. It inherits rather than computing the theme radius minus the edge, because a host may set the frame's radius by a stylesheet rule, an inline style or an animation, and only the cascade follows those live; the content box then sits at most 0.4 px inside the ring's inner curve at a 24 px radius, never over it. A view's `sx` on the frame is layered last, so a view that wants its own radius or overflow on that box can set it. `tools/proof/frame-corner-ring-probe.mjs` scores the ring pixels along all four arcs in headless WebKit and Chromium, at the theme's radius and at 40 px written onto the mounted frame.

**border-box.** Row-layout width math treats `device.size` as the frame's real rendered size. Under
content-box the border and padding land on top of it: a 390px phone rendered 416px wide by
`getBoundingClientRect()`, about 26px of silent under-fit per phone.

**The header.** `PanelHeader` floats above the frame (it needs a `position: relative` parent) with no background, border or shadow: the title and header buttons sit on the panel's own surroundings, and their colour is the theme's `text.primary`, so a light theme reads and the dark default stays white. Its height is `BAR_HEIGHT_PX` (36) in every theme, fixed, so wrapping content never changes it. Its horizontal padding is 13px (the 1px edge plus the 12px inset the frame used to give content), so header
text keeps the line it had before the frame stopped styling its content. Internal layout is left to callers (`sx`), since one centers an ellipsis title and
another spaces out an icon row. `PanelHeaderRow` is the shared title-left/actions-right layout, so call sites
stop re-implementing flex/ellipsis markup, and it substitutes placeholders for a falsy `title`/`actions` (a
dimmed "Untitled", a dimmed "more" glyph) so the header never blanks or changes shape. Its emptiness check
mirrors JSX's own falsy-child rules, so `0` or whitespace still counts as content.

## `WindowOverlay`: window-level content with no Portal

A view (the app's own or a third party's) shows something over the whole window -- a dialog, a full-screen
viewer, a toast -- by rendering `WindowOverlay` anywhere in its tree, with no host wiring:

```tsx
function NotesView() {
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Notes">
      <button onClick={() => setOpen(true)}>About</button>
      <WindowOverlay open={open}><AboutSheet onClose={() => setOpen(false)} /></WindowOverlay>
    </Panel>
  );
}
```

`WindowOverlay` registers its children with a store (from a layout effect, never during render) and renders
null; the host mounts two `<OverlaySlot>`s once, and each renders what was registered for it, as plain
fragments with no wrapper element. Hoisting matters because a view's own box is the wrong place: History's
column is a `zIndex: 2` stacking context (capped under the 1400 drag strip), and every live panel sits inside
a transformed slot, which re-anchors `position: fixed` to itself.

The layer adds no wrapper, so it cannot enforce the contract the CONTENT must keep:

1. Its root element is `position: fixed` and sets its own zIndex from `OVERLAY_Z`. A non-fixed root would
   become a flex item of the row and mis-centre it.
2. It renders where the SLOT is. Context (theme, `useHost()`) comes from the slot's position; React events
   bubble through the slot's ancestors, not the view's; a provider the view installs itself is not visible
   to it.
3. `open={false}` removes the content at once. Content that must animate out (MUI Snackbar) stays registered
   and takes its own `open`.
4. Content that stays registered while idle should be a MODULE-LEVEL constant element that reads what it
   needs through `useHost()`: an element built inline is a new node every render and costs one store
   notification per view render.
5. Never key an effect inside overlay content on a `useHost()` member: the provider value is rebuilt every
   render on purpose, so such an effect re-fires on every host render. Use `[]` for "once per open".
6. Stacking inside a slot is open order (later on top at equal z-index). Two slots never mix.
7. Lifetime is the registering view's: unmounting the view removes its overlays.
8. With no provider, or under `renderToStaticMarkup` (effects do not run), the children render IN PLACE.
   That is what makes a view testable without a host; where an overlay LANDS is only ever asserted in a
   mounted test.
9. Under a `HostProvider` with NO slot mounted (a test that wraps a view in the provider with the fakes), the
   overlay registers with nobody to show it: it never appears, and one `console.error` per mount names the
   missing slot. Such a test mounts `<OverlaySlot name="dialog" />` and `<OverlaySlot name="toast" />` beside
   the view, as the host does.

`WindowOverlay` is not `Panel`'s `overlay` prop, which decorates ONE view inside its own relative box
(History's "+" Fab) and is meant to be clipped to it.

## Snapshots: a picture is data, capturing one is not

`snapshots.ts` splits a view's picture into two surfaces on purpose. `ViewId` (a panel's id, or a fixed
`'settings'`/`'history'`), `ViewSnapshot` (`src`/`width`/`height`/`extent`/`capturedAt`/`stale`) and
`SnapshotsAPI` (`get`/`subscribe`) are plain data plus a read/subscribe contract -- `Host.snapshots?:
SnapshotsAPI` (optional: a host mid-rollout, or one that never wires this, degrades to "no picture" rather
than being forced into a no-op implementation) and `useViewSnapshot(viewId)` (a `useSyncExternalStore` wrapper)
are the only way a view ever touches a picture. Neither this file nor any view ever decides WHEN a capture
happens or HOW pixels are produced -- that is a second, independent surface:

`CaptureRegistry`, `CaptureRegistryProvider` and the context behind it (`CaptureRegistryContext`, package-internal) let `Panel` (`Panel.tsx`) hand its own
root DOM node to whatever real registry the host mounts, without that capability ever becoming part of
`Host`/`SnapshotsAPI`. This is the same pattern `HostProvider` already uses internally for `OverlayProvider`
(`hostApi.tsx`: `<HostContext.Provider value={host}><OverlayProvider>{children}</OverlayProvider></HostContext.Provider>`)
-- a second context, mounted alongside the first, for a concern that is not part of the public host bag. A
view rendered under a bare `<HostProvider>` (the common case in a test) sees no `CaptureRegistryContext`
provider at all, so `Panel`'s registration effect is a no-op and nothing here ever throws for a missing
registry, the same "missing capability degrades gracefully" convention `Host.snapshots` itself uses.

The two contexts nest in opposite directions. `HostProvider` mounts no `CaptureRegistryProvider`, so the
real one may wrap it; but it always mounts its own `OverlayProvider`, so a caller's
`<OverlayProvider store={...}>` (this package's own tests reading `ids()`/`notifications`; neither is exported) must
sit INSIDE `<HostProvider>`, around the `OverlaySlot`s and the views. Placed as `HostProvider`'s ancestor instead,
it is shadowed by the nearer built-in provider and silently receives nothing, with no error.

Only a host (phonux-app's capture controller, for one; never this package -- see "Import boundary" above) implements a
real `CaptureRegistry`, the DOM-redraw pixel engine, and the `SnapshotsAPI` store those pixels land in, and
only it renders `<CaptureRegistryProvider registry={realRegistry}>`, wrapping `<HostProvider>`. `PanelSummary`
never gains a `snapshot` field for the same reason `PanelWindow`'s host-only fields never leak into it
(see "A resolved panel component only ever sees a `PanelSummary`" above): a picture is read on demand through
`useViewSnapshot`, not pushed into every row's own summary object.

`CaptureTrigger` -- what `useProvidePanels` calls at a park or close to (re)capture a view's picture or to drop
it -- is declared in `snapshots.ts`, beside `CaptureRegistry`. phonux only says WHEN. A provider with no `capture`
input uses `noopCaptureTrigger`, so phonux never captures by itself; a host that wants real pictures passes its own
trigger. A panel is captured at both a park and a close. The two eviction paths differ in timing: `clearAll` evicts every dropped panel's picture at once, because
a dropped panel can never be shown again; and a closed panel's picture waits for its undo window (Undo keeps it;
the window's natural elapse evicts it). Known limit: a capture already in flight can still store its picture after
an evict, because the store has no per-id generation, so a panel parked and then cleared within one engine call can
end up with a picture nothing evicts.

## `useViewState`: per-view state that outlives a park, not a restart

`viewState.ts` gives a view a `[value, setValue]` pair -- the same tuple shape `React.useState` returns --
that survives its OWN panel being parked (`live: false`; `PanelRow.tsx`'s `present` filter fully unmounts a
parked entry) and revived. The store is a plain `Map<panelId, Map<key, cell>>` outside React state, copying
`windowOverlay.tsx`'s `OverlayStore` shape (a private `Map` plus per-cell subscribers via
`useSyncExternalStore`), mounted once by `HostProvider` as `ViewStateProvider`, alongside `OverlayProvider`,
the same way `HostProvider` already mounts a second context for a concern that is not part of the public host
bag. Close then `undoClose` inside the undo window keeps the value too: both keep the SAME panel id
(`panelWindow.ts`'s close/restore, `usePanelClosing.ts`'s `undoClose`), and the id stays in
`PanelsAPI.recentlyClosed` until then, so its cells are still held when the view remounts. It does not
survive an app restart: a pure in-memory store, no local storage. Surviving a park is the
whole contract; surviving a restart is not part of it.

A panel's state is released once nothing can show that panel again, as `OverlayStore.remove` releases an
overlay. Panel ids never repeat within a session, so that is when the id is in neither the row's own list nor
`PanelsAPI.recentlyClosed`: when its undo window elapses, or at once on `clearAll`. Without this, every panel
closed during a long-running session would keep its state until the app quits. `PanelRow` reports the ids
it can still show by calling `useViewState.useRetainOnly(ids)` on every render. The release runs one task
after that render's commit, and any newer commit cancels it. That delay is load-bearing: when restoring a
live panel parks another one to its right, `undoClose` commits once with `recentlyClosed` already cleared
and the restored id not yet back in the row. A view still mounted when its panel is released, such as one
mid exit animation after `clearAll`, keeps showing its value, and its cells go when it unmounts. Nothing is
stored for a key until its first `setValue`, so until then each mount reads its own `initial`.

`useViewState(key, initial)` takes no id argument at all: a view never wires its own identity. The id is
ambient, read from a context set exactly once, at the ONE place a resolved View is actually rendered
(`PanelRow.tsx`'s `<Component panel={renderedSummary(p, widths[index]!)} />`) -- never by the view itself. That setter is
exposed as `useViewState.Provider`, a property of the hook function, rather than a second value on the phonux
barrel, and `useViewState.useRetainOnly` travels the same way: the barrel's public surface stays the two names
a view genuinely depends on (`useViewState`, `ViewStateMissingProviderError`); the ambient id and the release
are row-render-loop wiring a view never touches directly. Their one caller, `PanelRow.tsx`, sits inside this
folder; anything outside it reaches this folder only through a bare `'phonux'` import (phonux-app's boundary
tests check this), so both travel through the SAME public entry point `useViewState` already does, not a separate one.

Types read exactly as `React.useState`'s do. With no type argument, `useViewState('count', 0)` infers
`number`, an object literal's `true` infers `boolean`, and a value already typed `'idle' | 'loading'` keeps that
union. An explicit type argument is kept as given, so `useViewState<'idle' | 'loading' | 'done'>('status',
'idle')` rejects `setStatus('nonsense')`. As with `useState`, a type argument is needed only to name a type
wider than the initial value, e.g. `useViewState<number | null>('id', null)`. `setValue` keeps one identity
for the component's lifetime, as `useState`'s setter does, even when `initial` is a fresh object each render.

The JSON rule cannot be a constraint on the hook's type parameter. TypeScript keeps a literal as a literal
(`0`, not `number`) for any type parameter whose constraint includes primitives, and `JsonValue` does. Instead,
the type parameter stays unconstrained, which is the same inference `useState<S>` gets, and the first overload
checks `[T] extends [JsonValue]` through `key`'s parameter type. A second overload, `T extends JsonValue`,
serves a caller that is itself generic over `JsonValue`, where that check cannot resolve. A non-JSON `initial`
fails both overloads. `viewState.typecheck.ts` compares these types against `useState` directly and pins the
literal-union case.

## The settings catalog and its one resolver

Every behaviour that can differ between panels is a named setting. Each setting is three things that must agree: a
descriptor in `PANEL_SETTINGS_CATALOG` (exported data), a library default in `LIBRARY_PANEL_DEFAULTS` or
`LIBRARY_TUNING_DEFAULTS`, and a check in `resolvePanelSettings`, the one pure function that interprets a settings
layer (internal: it is not exported from the package). The library picks no policy: each default reproduces what 0.1.0 did, except the few the table words
otherwise. A test (`test/panel-settings-catalog.test.ts`) holds the descriptors, the defaults and the table below
equal, so a changed default is a one-value edit in the constant and in its table row, and the test fails until both
are done.

A setting enters the catalog only when a consumer sets it or a handle, ViewPatch or PanelsAPI verb reads it; the
next section lists who. A behaviour nobody varies is a constant in the code, not a setting, so the 1.0 freeze
covers only what a panel author can use.

### Who reads each setting

Set by the reference app (14): `multiple`, `hostCreatable`, `pinningWhenNotLive`, `restoreVisibility`, `overflow`,
`capacityReturn`, `revealOnScroll`, `headerButtons`, `title`, `listed`, `layer`, `resizable`, `closable`, `scrollOnMove`.
The second known consumer is not in this repository, so these 14 are proven for the app only.

Read by a verb or a view patch: `parkable`, `pinning`, `slots`, `maxSlots`, `movable`, `crossable`,
`hideStickiness`, `startVisibility`, `placeOnAdd`, `placeOnShow`, `scrollOnOpen`, `showWhenClosed`,
`toggleWhenClosed`, `afterClose`, `enterFrom`, `clearable` (`clearAll`) and `maxInstances` (`configureTemplate`).

### Settings this version removed

Eighteen settings are gone from `PanelSettings`, the catalog and every patch type, and each panel behaves as the
setting's default did. A template that still names one gets one development `console.error` per key and the value is
ignored; the next rc refuses it with `invalid-settings`. A saved file's instance layer that holds one loads, drops
the key with an `invalid-saved-setting` note and keeps every other value.

| Removed | Fixed at |
| --- | --- |
| `hideWhenLast` | `allow`: a hide is never refused for emptying the row |
| `returnPriority`, `evictionRank` | 0: no ranking, so the workspace's tie-break tuning and the order of the row decide |
| `evictionOrder` | `least-recently-touched`: room is made by parking the panel touched longest ago |
| `scrollOnDrag` | `edge` |
| `viewState` | `keep` |
| `keepMounted` | false |
| `frame` | `auto` |
| `placeOnReturn` | `in-place` |
| `placeFallback` | `row-end` |
| `undoPlacement` | `old-slot` |
| `closeExit` | `down`: an `exitTo` of `auto` closes downward |
| `animated` | true |
| `persist`, `rememberLayout` | `saved` and true |
| `undoWindowMs` | 10000 |
| `reportClose` | true |
| `snapshot` | `both` |

Coupling rules C3 and C6 went with their settings; the other rules keep their numbers.

`draggable` and `placeable` merged into `movable`, and a template that still names either throws `invalid-settings`
naming `movable`, as one that carries `tuning` does. A saved instance layer that holds both with the same boolean loads as `movable` with an `invalid-saved-setting`
note; one that holds only one of them, or two that disagree, drops the key with that note, because either alone
does not say what `movable` should be.

### The capability flags limit a person's gestures

`closable`, `movable` and `resizable` say what a person may do by gesture: the drag-down close and the close button,
the reorder drag and a drop at a placement, the resize grabbers. They never limit the developer's own calls. Every
engine operation knows its source (`'person'` from a gesture, `'code'` otherwise, see `PanelOpSource`) and checks the
flag only for `'person'`, answering `not-closable`, `not-movable` or `not-resizable`; `close()`, `move()`, `place()`,
`setSlots()` and a pin with a placement from code succeed whatever the flags say. What stays enforced for code is
structure, not these flags: the root cannot be closed (`not-closable`) and cannot be anchored to itself, so `place()`,
`pin()` and `unpin()` on it answer `root-fixed` (whatever its `movable` says, so it is not `not-movable`); `move()` reorders the root like any panel (it re-anchors the panels
around it, never the root), whatever its `movable` says, and `movable` on the root gates only the person's drag.
`maxSlots` clamps every slot count, `crossable` still bars a hop across a neighbour, and `parkable: false` still
refuses `hide()`. `movePanel`, `reanchorPanel` and `setSlots` (the pure functions) read none of the three flags.
`usePanelCapabilities().closable` is also false for an always-shown column (`collapsible: false`), since the row's
close gesture is never offered for one; it is the one place a view reads whether a close is offered.

### Layers and the cascade

Lowest to highest: library defaults, workspace defaults, template, host (what a view asked for in a Host-bag
`create`), instance, and the person's own overrides. The last defined value wins field by field and `undefined`
never overrides. `placeOnAdd`, `placeOnShow`, `pinning` and
`pinningWhenNotLive` are replaced whole; `tuning` merges per leaf and member; `headerButtons` merges per slot id (a
later layer's slot replaces that id whole, `false` removes it). The resolver's `source` map names the winning layer
for every key: one of `library`, `workspace`, `template`, `host`, `instance`, `user`, `derived` (filled from another
resolved field) or `forced` (overridden by a coupling rule, which runs last and so wins over every layer).

`mergePatch(layer, patch)` (internal) is the one pure step that edits the instance layer: `null` deletes a value (and, inside
`tuning` or `headerButtons`, one leaf or slot), `undefined` changes nothing, and a patch that changes nothing returns
the very same layer object. Deleting an instance value lets the host's ask, then the rest of the cascade, show
through again.

### Derived defaults and coupling rules

`movable` and `listed` follow `parkable`; `clearable` follows `parkable` and `closable`. Any layer may
set them, and a value a layer sets is never forced.

| Rule | When | Forces |
| --- | --- | --- |
| C1 | `parkable: false` (a fixed column) | `resizable: false`, `slots: 1`, `maxSlots: 1` (all three stand when the panel's own template, host or instance asked for any of them), `overflow: 'scroll'`, `startVisibility: 'live'`, `restoreVisibility: 'live'` |
| C2 | `closable: false` | `clearable: false` |
| C4 | `slots` above `maxSlots` | `slots` is `maxSlots` |
| C5 | the root | `parkable: false`, `closable: false` (`movable` is not forced: it follows the fixed column to `false` until a layer sets it) |

The root's rule runs first because it feeds C1 and C2. A conflict is recorded only when a template, host or instance
layer asked for a value a rule overrides; the same collision caused by the library or the workspace defaults is
overridden silently, with source `forced`. A conflict carries `key`, `layer`, `kind`, `asked`, `applied` and
`message`, plus `rule` and `forcedBy` when the kind is `forced`. Two more kinds exist: `wrong-scope` (a template-scope
key or a workspace-only tuning key at the instance or host layer, ignored) and `not-view-settable` (a key a view may
not set, at the host layer, ignored).

Notes never throw: `park-lever-inert` when a layer sets the park lever `capacityReturn` on a panel that resolves to `overflow: 'scroll'`, `pin-unlists` when a pinned half
names `parkable: false` and `listed` is unset, `override-dropped` when the person's fixed column would be wider than one slot, `max-instances-moot` when `configureTemplate` names `maxInstances`
on a template that resolves to `multiple: false`, `hold-unlisted` when a hold lands on an unlisted panel (a hide, or a
panel added or restored parked; through `onNote`, once per panel) and when a `configure` call leaves a held panel
unlisted (`{ listed: false }`, or a `null` that restores an unlisted derived value, also while a flip of `parkable`
waits; in `ConfigureResult.notes` and through `onNote`, once per call, whatever the panel's `revealOnScroll`; none when
the same call shows the panel or is refused), and `invalid-saved-setting` for each key a lenient resolve dropped.

### Who may set what

The `doors` of a descriptor name the configure call that accepts the key: `instance` (`configure(id)`), `template`
(`configureTemplate`: `hostCreatable`, `multiple`, `maxInstances`) and `tuning` (`configureTuning`). These tuning
leaves are workspace-only (`rowGap`, `saveQuietMs`, `gestureLockMs`, `gestureQuietMs`, `resizeSettleSlides`, `returnTieBreak`, `dropTieBreak`, `rowGesture`,
`initialScroll`, `maxLivePanels`, `chrome`, `phoneFit`, `phoneFitMin`, `phoneFitMax`); these are per panel and also workspace-wide (`dragToClose`, `slide`, `hopFraction`, `edgeScroll`).
A workspace-only leaf at the template layer throws, at the instance or host layer it is a `wrong-scope` conflict, and
any tuning key in the workspace defaults throws. A view's own door, the host layer, accepts only `title`, `listed`,
`layer`, `slots`, `closable: false`, `placeOnAdd: { anchor }` and `enterFrom: 'anchor'`. A view can lock its own panel at any time and
remove the lock with `null`, but never set `closable: true`; the root still answers `settings-conflict` to `closable: true` through the instance door (C5).

### Configure

`configure(id, patch)` plans against the panel's layers (`planInstance`), refuses whole before anything is written, and
hands the engine one update that replaces the entry; the call takes a manager token on the panel, so a second verb on it
in the same turn answers `busy` and a close excludes every other call. `configureTemplate` stores an override layer for
the three template keys that only future creations read, and `configureTuning` stores the workspace tuning input,
re-pricing the row in one commit when `rowGap` moves. `configureTuning` needs no mounted row and no finished load: before
the first load it writes the checked patch straight into the input and the resolved tuning together (there is no layout to re-price)
and the load reads it; only a disposed workspace refuses. `column.configureTuning(patch)` does the same for the column: it keeps its
own merged input, hands the patch to every workspace in it, and a workspace added or rebuilt later starts from that input. A tuning leaf set on a panel outranks the workspace's. A configure
queued behind another call's update of the same entry in one turn applies to the entry that update left, planned from the
layer the call saw; a panel the update removed stays removed. What a view asked for at a Host-bag `create` is kept apart for
the session as the panel's host layer, under the instance layer: `null` on a key the view asked for shows the ask again with
source `host`, and the file keeps the ask merged into the instance layer, so a new launch reads it as the instance layer's own.

`configureTemplate` naming `maxInstances` on a template that resolves to `multiple: false` still stores the limit, which has
no effect until `multiple` is true, and answers one `max-instances-moot` note in `ConfigureResult.notes` and through
`onNote`, once per call. A refused call or a call that changes nothing answers none.

`configureTemplate(id, { multiple: false })` counts the template's row entries, its declared panels that are closed (inside
the undo window or past it) and its anonymous panels inside the undo window, and counts no panel of another template. It is
accepted only when none exists or the only one is the instance named like the template; any other count answers
`instance-limit` with that number and writes nothing. Lowering `maxInstances` counts row entries and panels still being
added only, because a closed panel competes for a slot when it reopens and does not occupy one. The creation paths use that
same count, so a reopen never counts the record it reopens.

A `configure` of `parkable` on a panel that is not live follows `pinningWhenNotLive` as `pin` does; see "Pinning and reset".

### Pin definitions

A `pinning` definition is valid only if a drag cannot make it unreadable, because pinned is read from the panel and
never stored. Either both halves name `parkable` with opposite values, or the pinned half is `row-start` and the
unpinned half `row-end` or `after-fixed`. If both hold, both are read. Other placements may appear only beside the
parkable pair. An empty definition is valid and reads false. `parkable` in one half only, equal values, `in-place` in
a half, an unknown key, or a definition that is neither readable form throws `invalid-settings`.

### Restore reads leniently

A saved file may hold settings an older or newer build wrote. With `lenient`, the instance and user layers drop an
invalid key with an `invalid-saved-setting` note and keep the rest; the workspace and template layers are the
developer's own and throw in both modes.

### Leaf modules

`panelSettings.ts` imports no value except `rowConstants.ts` and `panelManagerError.ts`, so the table and the
resolver load without React, Motion or any row code. `rowConstants.ts` is the one place each default number is
written. `GAP`, `DRAG_CLOSE`, `SLOT_TRANSITION` and `WORKSPACE_SAVE_QUIET_MS` keep their names and values and read it
(`GAP` is `ROW_GAP` under a deprecated name), and `test/rowconstants-drift.test.ts` asserts that no row file writes a second copy.

### One tuning value per render

`panelTuning.ts` resolves a `WorkspaceTuning` over `LIBRARY_TUNING_DEFAULTS` member by member. A member the resolver
would refuse keeps its default and nothing throws, because a prop has no caller to refuse it to (a settings layer
still throws). `Workspace` resolves its `tuning` and provides the result by context; `useProvidePanels` resolves
the same input for the capacity and `maxLiveWidth` and returns it as `ProvidedPanels.tuning`. `PanelRow` takes its
`tuning` prop, else the context, else the defaults, and warns once per instance in development when a given prop
differs from the context. A panel's own `settings.tuning` supplies its `dragToClose`, `slide`, `hopFraction` and
`edgeScroll`; an entry without `settings` follows the workspace live. The `rowGap` is always the workspace's.
Everything arrives through props and context in one render, so no commit holds two gaps.

### The catalog

One row per setting, between the markers below; the docs-drift test parses every row and compares its name, values,
default and class word with the descriptor. The class word opens the on_configure cell: NOW (a button, a History row,
a z-index or the row's price changes at that commit), NEXT (stored, read by the next event that uses it), STATE (a
flip with a transition rule of its own) or SCOPE (a template-scope key).

<!-- catalog:start -->
| Setting | Values | Default | On configure |
| --- | --- | --- | --- |
| `closable` | true, false | true (root: false) | NOW. L, T: true->false removes the drag-down close and makes a person's close answer not-closable at this commit (close() from code still works); clearable re-derives false (C2); a DragToClose release already decided re-checks at its animation end and snaps back. false->true restores them. A view may set false or null on its own panel at any time. K, H: History row only. Root: closable:true is settings-conflict (C5); explicit clearable:true beside closable:false is settings-conflict. |
| `parkable` | true, false | true | STATE. L, T: true->false needs a panel of one slot (slots-above-max) and no conflicting explicit value (settings-conflict); listed, movable, clearable re-derive false at this commit unless named; the row re-prices and the reconcile settles it (two commits). false->true lifts C1. K, H: per pinningWhenNotLive (place-only and refuse: would-reshape-row; show: shown true then flips; apply-on-next-show: stores deferredPin { parkable }). C, U: place-only, refuse, show answer is-closed; apply-on-next-show stores on the record. A person's overrides.parkable outvotes the flip (shadowed). |
| `movable` | true, false | derived: parkable | NOW. L, T: true->false removes the reorder grab and makes a person's move or placement answer not-movable from this commit; a drag in flight ends with no hops; move(), place() and a placement-bearing pin() from code are not limited. K, H: stored. Root: false until a layer sets true, which is accepted and gates only the person's drag; move() from code reorders the root whatever it says, and place(), pin() and unpin() on it answer root-fixed. |
| `crossable` | true, false | true | NOW. L, T: the next drag of any other panel sees it at once; a drag already released is judged by movePanel (changed:false). K, H: a non-crossable parked panel is a barrier for the next drag too. |
| `resizable` | true, false | true (C1) | NOW. L, T, K, H: true->false removes the resize grabbers and makes a person's resize answer not-resizable (setSlots() from code still resizes, within maxSlots); the size and the person's saved size are never changed or dropped by this call. C1: forced false on a fixed column unless the panel's own layers asked for a size. |
| `slots` | integer >= 1 | 1 | NEXT. The panel is that many phone widths wide with the row gap between them, drawn at no more than `maxSlots` and no more than fit the window; the next layout pass draws it. A person's drag-resize writes it, and it is saved with the workspace. Above `maxSlots` it is forced down to `maxSlots` (C4). |
| `maxSlots` | integer >= 1 | every visible slot (C1) | STATE. L, T, K, H: lowering below the panel's current slots needs the panel to be narrower first (slots-above-max); raising lets the panel be resized wider. C1: a fixed column is one slot. A host-set `resizable` with `maxSlots` 1 is kept and noted (resizable-capped). |
| `clearable` | true, false | derived: parkable and closable (C2) | NEXT. Read by the next clearAll. C2: clearable:true with closable:false is settings-conflict; null re-derives it. |
| `hostCreatable` | true, false (template scope) | true | SCOPE (configureTemplate). Applies to the next Host-bag create naming the template; existing instances and code addPanel are untouched. configure(panelId) and configureTuning answer wrong-scope; an unknown template throws. Before ready: not-ready. |
| `hollowDot` | true, false (template scope) | false | SCOPE (configureTemplate). The dot bar draws this panel's dot hollow; the library reads the flag, never the panel's name. Applies to the next render of the dot bar. configure(panelId) and configureTuning answer wrong-scope. |
| `multiple` | true, false (template scope) | false | SCOPE (configureTemplate). false->true: ok. true->false: ok only if every existing instance (row, declared closed records, undo-window records) is the singleton whose id equals the template id, else instance-limit with the count; nothing is closed or renamed. |
| `maxInstances` | integer >= 1, unlimited (template scope) | unlimited | SCOPE (configureTemplate). Raising it or null: ok. Lowering below the instances that exist: instance-limit with the count; no instance is closed. Moot without multiple (a note). |
| `listed` | true, false | derived: parkable | NOW. L, T, K, H: the panel appears in or leaves panelList at this commit; its slot and state do not change. false on a hidden panel whose hold the gesture cannot release leaves it showable by code only (note). |
| `startVisibility` | live, parked | live (C1) | NEXT. Governs panels created after the commit; every existing panel keeps its state. C: used by the next open(). C1: parked on a fixed column is settings-conflict. |
| `hideStickiness` | sticky, until-room | sticky | NEXT. Governs hides after the commit. A hidden panel keeps the hold it has; configure shows nothing. K: unaffected. L, T: the next hide() uses the new value. |
| `capacityReturn` | auto, manual | auto | NEXT. Governs parks decided after the commit. A panel on the stack stays returnable; one already held stays held; no reveal. |
| `overflow` | scroll, park | scroll for every panel built through the cascade (a template, workspace defaults, a Host-bag create, or a restore inside a workspace; C1: scroll for a fixed column); a hand-built 0.1.0 entry in a row with no workspace defaults: park | NEXT. Read at the next park decision. L: park->scroll protects it from then on; scroll->park makes it eligible; nothing parks, returns or scrolls at configure. K, H: stored; a K panel already on the stack still returns. C1: park on a fixed column is settings-conflict. |
| `revealOnScroll` | edges, any, never | edges (a design default the owner never fixed; Q1 holds under it) | NEXT. Read by the next gesture. K: edges->any makes an engine-parked panel reachable. H: edges and any reach it. Nothing is revealed by configure. |
| `scrollOnOpen` | into-view, start, center, none | into-view (owner-confirmed, Q21) | NEXT. Read by the next open, show or click of this panel. L, T, K, H: stored. No scroll happens at configure. Use handle.scrollTo() to scroll now (its align defaults to this setting, 'into-view' when it is none). |
| `scrollOnMove` | follow, none | follow (owner-confirmed, Q21) | NEXT. Read by the next move, place, setSlots, pin, unpin or resetLayout of this panel. L, T, K, H: stored. Nothing scrolls at configure. |
| `toggleWhenClosed` | ignore, reopen | ignore | NEXT. Read by the next toggleVisibility() on a closed declared panel. C, U: the record's value is used by the next toggle. |
| `showWhenClosed` | refuse, reopen | refuse | NEXT. Read by the next show() on a closed declared panel. C, U: the record's value is used. |
| `placeOnAdd` | row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor} | row-end | NEXT. Read by the next add of this panel and by resetLayout; no live, parked or hidden panel moves (use place()). in-place throws invalid-settings; a missing target uses placeFallback. |
| `placeOnShow` | the same plus in-place | in-place | NEXT. Read by the next show. K, H: configure does not re-place or reveal. |
| `layer` | base, raised | base | NOW. L, T: the z-index changes at this commit; a slot mid-exit keeps the one it left with. Row order and widths do not change. |
| `enterFrom` | auto, left, right, anchor, top, bottom, fade, expand | auto | NEXT. Read at the next enter; a slide in progress keeps its start side, and an entrance in progress keeps its style. |
| `exitTo` | auto, left, right, top, bottom, fade, shrink | auto | NEXT. Read at the next park or close; an exit in progress keeps its style. |
| `title` | string | none ('Panel N' for the bag) | NOW. L, T, K, H: the summary title changes at this commit (header pill, History row); the closed-pages log entry keeps the old title. U: undo rebuilds with it. null restores the cascade value. |
| `pinning` | object { pinned: PinHalf, unpinned: PinHalf }; PinHalf = { placement?, parkable? }; valid only if readable after a drag (6A); empty = no pin | { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } (0.1.0's one pin rule) | NOW. PanelState.pinned and a slot's pressed state re-read at this commit; nothing moves, parks, shows or scrolls. A deferred pin keeps its direction. An unreadable definition or in-place throws. |
| `pinningWhenNotLive` | place-only, refuse, show, apply-on-next-show; or { parked?, hidden?, closed? } (closed: refuse or apply-on-next-show) | place-only | NEXT. Read by the next pin change. A stored deferred pin is neither applied nor dropped by a flip of this setting. C, U: the record's value governs. |
| `headerButtons` | object: slot id (1-32 chars a-z0-9-) to HeaderButton or false; HeaderButton = { icon?, label, onClick, side?, order?, pressed?, description?, tooltip?, disabled?, hidden?, sx? } (section 6); with icon the label is the accessible name, without it the label is the text drawn | {} (no button drawn) | NOW. L, T: a slot appears, changes or disappears at this commit; a focused button that leaves moves focus to the header row; a press already dispatched completes. K, H: stored, first drawn when it returns. null deletes the instance entry; false removes the slot. |
| `restoreVisibility` | saved, live, parked | saved (C1) | NEXT. Read only at the next launch's restore. C1: anything but live on a fixed column is settings-conflict. |
| `afterClose` | stay-closed, return-next-launch | stay-closed | NEXT. Read when the panel next leaves the list. An existing tombstone is neither added nor removed by the flip. |
| `tuning.rowGap` | integer px 0 to 200 (workspace only) | 16 (GAP) | NOW (configureTuning only). The whole row re-prices at this commit; in park mode a smaller capacity parks the fewest park panels through the reconcile effect; a scrolling row only re-prices and clamps scrollLeft. Slides in progress retarget. Unmeasured: stored. Busy while any panel has a token. Outside 0-200 throws. |
| `tuning.dragToClose` | object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50 (workspace only) | 0.25, 80, 40, 700, -300 (DRAG_CLOSE) | NEXT (configureTuning only). Read at the next release; a drag in flight is judged by the values current at release. Leaves merge. The direction lock, rest time, velocity window and snap-back spring are constants in rowConstants.ts. |
| `tuning.slide` | object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5], closeExitEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers), glideEase ('cubic-out', 'linear' or four numbers) (workspace only) | 0.6, [0.4, 0, 0.2, 1], 0.18, 'easeIn', 'cubic-out' (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds, CLOSE_EXIT_EASE, GLIDE_EASE) | NEXT (configureTuning only). Read at the next enter, exit, close or scroll; animations running keep their timing. The edge-scroll drag settle and a header dot click glide along `glideEase`. |
| `tuning.hopFraction` | number in (0, 1] (workspace only) | 0.5 | NEXT (configureTuning only). Read by the dragged panel's view at its next release. Outside (0, 1] throws. |
| `tuning.edgeScroll` | object: zonePx integer [8, 200], maxPxPerSec integer [100, 5000], reducedStepMs integer [100, 5000] (workspace only) | 48, 900, 500 (owner-confirmed, Q21; the numbers live in rowConstants.ts) | NEXT (configureTuning only). Read at the next drag start; a drag in flight keeps its numbers. Leaves merge. |
| `tuning.saveQuietMs` | integer ms >= 0 (workspace only) | 500 | NEXT (configureTuning only). A timer already armed keeps its deadline; the next arm uses the new value. Session-only. |
| `tuning.gestureLockMs` | integer ms >= 0 (workspace only) | 60 | NEXT (configureTuning only). A lock already armed keeps its remaining time. Session-only. |
| `tuning.gestureQuietMs` | integer ms >= 1 (workspace only) | 150 | NEXT (configureTuning only). A quiet timer already running keeps its length; the next wheel event arms the new one. Session-only. |
| `tuning.resizeSettleSlides` | number [0, 10], multiplies slide.durationSec (workspace only) | 1.25 | NOW (configureTuning only). 0 settles at once. A settle timer already running keeps its length; the next width change arms the new one. Session-only. |
| `tuning.returnTieBreak` | latest-first, earliest-first, row-order (workspace only) | latest-first | NEXT (configureTuning only). Read at the next stack walk; nothing returns now. |
| `tuning.dropTieBreak` | leftmost, rightmost (workspace only) | leftmost | NEXT (configureTuning only). Read at the next capacity drop or resize; nothing parks now. |
| `tuning.rowGesture` | step, off (workspace only; a design-derived key from Q15, not requested) | step | NEXT (configureTuning only). The listener set is re-read at the next render; a gesture in flight finishes; no panel moves. Session-only. |
| `tuning.initialScroll` | start, end, root, { panel: PanelId } (workspace only; a design-derived key from Q15, not requested) | start (the library default, a design default the owner did not rule on; phonux-app sets 'end', owner Q20: the newest closable panels in view at launch) | NEXT (configureTuning only). Read at the next mount; nothing scrolls now. Session-only. |
| `tuning.chrome` | object: mode 'always' or 'hover-or-active', fadeMs integer [0, 10000], fadeEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers, x1 and x2 in [0,1]) (workspace only) | always, 120, easeOut (CHROME) | NOW (configureTuning only). A member patch keeps the other members. The chrome shows or hides at this commit; a fade in progress retargets. `easeOut` is the curve Motion applies to a fade given only a duration, measured in Chromium. The header gap, grab handle, header inset and footer padding are constants in rowConstants.ts; a developer restyles them through the `sx` of `PanelFrame` or `PanelFooter`. Session-only. |
| `tuning.maxLivePanels` | integer >= 1, or null for no cap (workspace only) | null (no cap) | NOW (configureTuning only). A lower value parks the excess unpinned panels at this commit through the reconcile effect; a higher one or null returns the most recently parked, under `capacityReturn` auto as under manual (manual returns only the panels the capacity parked, never one the host hid), up to the new value, in one commit. Unmeasured: applies. Outside integers of 1 or more throws; null removes the cap. Session-only. |
| `tuning.phoneFit` | off, fit (workspace only) | off (PHONE_FIT) | NOW (configureTuning only). Whether the default mount fits the phone size to the window; see "Phone fit". Other values throw. |
| `tuning.phoneFitMin` | number above 0 and up to 1 (workspace only) | 0.82 (PHONE_FIT_MIN) | NOW (configureTuning only). The smallest scale of the preferred phone size the fit gives; see "Phone fit". Other values throw. |
| `tuning.phoneFitMax` | number from 1 to 4 (workspace only) | 1.13 (PHONE_FIT_MAX) | NOW (configureTuning only). The largest scale of the preferred phone size the fit gives; see "Phone fit". Other values throw. |
| `tuning.defaultEnterFrom` | auto, left, right, anchor, top, bottom, fade, expand (workspace only) | auto | NEXT (configureTuning only). Read at each panel's next enter; an entrance in progress keeps its style. |
| `tuning.defaultExitTo` | auto, left, right, top, bottom, fade, shrink (workspace only) | auto | NEXT (configureTuning only). Read at each panel's next park or close; an exit in progress keeps its style. |
<!-- catalog:end -->

## Placement, the root marker, key-aware undo and motion

### Where a panel lands

`panelPlacement.ts` holds the pure half. `resolvePlacement(row, rootId, self, value, o)` turns one value into an
anchor request against the row without the panel itself, and `placePanel(row, id, value, o)` applies it to a panel
already in the row. The row is then ordered by `computeRowOrder`, so a placement is only ever an anchor. It is the
developer's own ask: nothing here reads `movable`, and no placement is recorded as a person's override.

Every "immediately next to" request carries priority -1. Only -1 lands nearest, because an equal priority on the
right of the anchor goes to the entry earlier in the row and on the left to the later one. `row-end` has no priority,
so the far end of the root's right side is filled, which is where 0.1.0 put a new panel. `parkable-start` and
`parkable-end` are the first and last parkable entry, and resolve like `row-start` and `row-end` when that entry is
already at the edge of the row. `after-fixed` is the last non-parkable entry, or the row start when there is none.
`order` lands after the nearest earlier name of the developer's list that is in the row, else before the nearest later
one. A target that is missing or is the panel itself, and an `order` that cannot place it, lands at `row-end`
and raises one `placement-fallback` note.

`placeOnShow` is applied in `activate` before `promoteToLive`; where the shown panel stands does not change which panel
room-making parks, the one touched longest ago. A panel that returns automatically (a capacity rise, or the reveal after a close)
stays where it is. `undoClose` puts a panel back with `restorePanel` at the recorded index.

A placed panel's enter side is an explicit mark, the side of the live range its landing slot is on, not the anchor
formula: the formula reads the slot's neighbours, and a root-less row has none. A row without a History panel reads
every entry as the root's right side, so such a row renders and orders as it did.

### The root marker

An entry with `marker: true` (collapsible false) holds the anchor point of a row with no History panel. It orders the
row like a root and nothing else reads it: `isPresent(p)` is `marker !== true && (!collapsible || live)`, and it is
the one reader of presence. The row draws, prices and offsets only present entries, so `[marker, A, B]` is two slots,
a row 796 wide, and `usePanelNeighborWidths` for A sees `{ left: [], right: [390] }`. `movePanel` hops over the
entries that are not present, so the first present panel cannot go left of the marker. The marker is not a fixed
column: `fixedViewCount` is 0 beside it, and History in a row with a root still counts 1.

### Key-aware undo

`undoClose` takes the batch from a ref that the first call empties, so a second call in the same handler finds
nothing and reports nothing. A closed panel whose key (`panelKey`: its `key`, else its id) is already in the row is
skipped and its log id is not reported.

### Motion

A panel's entrance is its `enterFrom` and its exit, for a park and a close alike, its `exitTo`. Each has one
workspace-wide default, `tuning.defaultEnterFrom` and `tuning.defaultExitTo`: a panel whose own value is `auto` takes the
workspace's, and any other value of its own wins. Both workspace defaults are `auto`, which is the behaviour below
the row had before either existed. `anchor` is the 0.1.0 `anchoredEnter` flag as a setting, and that flag counts as
the panel's own `anchor`.

Entrances. `auto` is the row's order: a mark, then the formula for an entry entering via an anchor, then the right.
`anchor` takes the formula at every enter. `left`, `right`, `top` and `bottom` slide in from that side (a vertical
slide travels the row's height), `fade` fades in at the slot's rest, and `expand` grows the slot's width from 0 to its
full width at its rest while the neighbours to its right slide apart to make room. Every value but `auto` and `anchor`
is a constant that beats the engine's mark and the anchor formula.

Exits. `auto` parks toward the exit-right marks, else left, and closes downward along `slide.closeExitSeconds` and
`slide.closeExitEase`, the curve a drag close shares. `left`, `right`, `top` and `bottom` slide out to that side, `fade`
fades out at the rest, and `shrink` eases the slot's width to 0 at its rest while the neighbours close up. An
explicit `exitTo` is the same for a park and a close.

Every entrance and exit but the `auto` close takes the workspace's `slide` timing: the transition is the shared
`PANEL_TRANSITION` object itself while `slide` is at its defaults (0.6 s, in-out), and every one fades the opacity as
a slide does. The neighbours' moves are the slide every slot makes to a new rest, started on the same clock, so the
gap at an expanding or shrinking slot never closes over it. An expanding or shrinking slot clips what it holds across (never up or down, where the frame draws its header) and
leaves it at the full width: the frame draws the content at the slot's drawn width from the row's numbers, not from
the slot's box, so the content is revealed, never squashed or reflowed.

Reduced motion is honoured as the slide honours it: under Motion's reduced-motion setting a slide's move lands at
once and its fade still runs, so an `expand` or `shrink` width lands at once and the fade still runs. A slot that
mounts at its rest (a restored panel, or one added while a width is held) does not grow.

Both settings are NEXT: the style is read when the panel next enters or leaves, and one in progress keeps its style. An
interrupted width animation carries on from the width on screen: a re-priced row eases it to the new width, a panel
that returns mid-shrink grows back from where it is, and a panel that leaves mid-expand holds its drawn width while it
leaves, or shrinks from it. `layer` sets the stacking.

### A parked view unmounts

A parked panel's view is unmounted and mounts again, fresh, when the panel is shown.

## The workspace core is React-free, and a row only reads it

`createWorkspace` keeps everything a workspace is outside React: the template registry, the declared panels, the options and the last committed list. `useProvidePanels({ workspace })` is its one consumer: it attaches in a layout effect that runs once, and it publishes the committed list and a few controls (`create`, `lateRegister`) in a layout effect that runs after every commit. Both are written after commit, never during render, so a handle read from an event handler sees what the screen shows.

- **Intents, not calls.** `addPanel` before the row is ready records an intent; the restore replays the intents as declared panels when it settles, so a saved file and code agree on one list. After ready, the call goes straight to the controls the hook published. A first paint therefore never scrolls, and an `addPanel` after ready asks for the scroll of the panel's `scrollOnOpen`.
- **A narrow surface.** Handles and the reader read through one internal source, and a verb reaches the engine through the controls the hook published, never through an export. A handle's members are fixed by a source test: the reader's handle has the read members only, the handle a view receives has those and every verb, and no export name may match `/controls/`. A view's handle has no manager, so it acts on its own panel only; to act on another it calls `useWorkspace()`, which gives the operable manager (`get(key)` returns a handle with the verbs) and `addPanel`, and none of the workspace's `dispose`, `update` or `rename`. Outside a row that has a workspace it is `undefined`. The reader `useWorkspaceManager()` stays read-only. The library draws no Undo toast after a close: a host that offers one reads `recentlyClosed` and calls `undoClose`.
- **Render-phase observation.** The core is told the list a render is about to draw (`observe`) so a handle read during the same render, before the layout effect publishes, answers from it instead of `pending`. Nothing is notified from there; the publish effect does that.
- **Tombstones.** A declared `stay-closed` panel that leaves the list is added to the file's `dismissed`; a panel back in the list is removed. The restore skips a dismissed declared panel unless the template is no longer closable or no longer `stay-closed`, and then drops the tombstone and saves. The diff is on the list, so an unmount, which empties nothing, is never a mass close.
- **Pin state.** `PanelState.pinned` is the pure `isPinned(entry, row, definition)`: a definition naming `parkable` in both halves reads the resolved `parkable`, one naming `row-start` against `row-end` or `after-fixed` reads the side of the root, and both are read when both are named. Nothing stores it, so a drag that re-anchors entries cannot change it. A root with `movable: true` is the one drag that flips several entries at once: moving it across N panels re-anchors those N to its other side in one commit (the same `deriveAnchorsFromOrder` read as any move, so the root's own index is never saved) and each reads pinned or unpinned by its new side; a parked panel between the root and its drop target is re-anchored with them. Under `maxLivePanels` the flipped panels are priced by their new side in the next commit, like a panel dragged across the root.
- **Errors.** A storage whose `save` throws or rejects reaches `onError`, or `console.error` when it is unset; the row and the next save are unaffected.

## Two layers: the workspace mounts itself, and the components stay public

The default start is `definePanel`, `createWorkspace` and `addPanel`: the workspace creates its own full-window element (`position: fixed; inset: 0`, appended to `document.body`, removed by `dispose()`), measures it, calls `useProvidePanels` and renders `HostProvider`, `Workspace` and `PanelRow` itself. A custom flow writes out the same three components and the same hook, so there are two layers and one implementation: `autoMount.tsx` is built from the exported components and hooks and takes no `@internal` shortcut, and a test renders the same panels both ways and compares the DOM. The mount maps what `useProvidePanels` returns onto the props of the shell and the row in two small functions (`workspaceProps`, `rowProps`), so a prop the row gains has one place to be added.

- **Turning it off.** `mount: false` is the migration for a caller that renders the workspace itself. A `document`-free run mounts nothing either. A `mount` element is rendered into a child of its own and is never emptied. The mount module is loaded by a dynamic `import()` from `workspaceCore.ts` only when a mount happens, so importing the workspace module never requests `react-dom/client`; a test proves it from a child process that records every module request. Mounting is therefore async by a microtask: `addPanel` before and after it behaves as before, and a failed load reaches `onError`.
- **Said once.** A `PanelRow` given a workspace that also mounts itself warns once in development, naming `mount: false`.
- **Always with a workspace.** The components (`PanelRow`, `Workspace`, `HostProvider`) and `useProvidePanels` stay public, but a row is always fed by a workspace: `PanelRow`'s `workspace` prop and `PanelsInput.workspace` are required, and a plain component is `definePanel({ id, view })`, not a registered view. A custom flow differs from the mount by who writes the tree, never by where the rules come from.
- **The theme.** The mount draws one `ThemeProvider` and one `CssBaseline`, with `theme(mode)` when the app gave that option and `createDefaultTheme(mode)` when it did not. `mode` is the window's `prefers-color-scheme`, the only mode source: an app whose mode is chosen some other way needs a later option. The function runs once per mode change; a throw, or a value that is not a MUI theme, reaches `onError` once and the default theme is drawn. A `wrap` must not draw its own `ThemeProvider` or `CssBaseline`, which would reset twice. A column draws the theme once above every cell (`ColumnOptions.theme`); the cells a `WorkspaceColumn` renders with its default cell draw none of their own, and a workspace inside a column takes the column's theme.
- **Absence.** `history`, `snapshots` and `labels` are optional on `Host`, and a view reads each with a fallback; no library view reads `history`. The first frame of an auto-mounted workspace holds exactly the values given to `createWorkspace`, so a caller that has them at creation passes them there, and one whose data arrives later renders that frame without it and calls `workspace.update` when it lands. There is no second door that defers the first paint. `createFakeHost({ absent: ['history', 'snapshots'] })` renders the absent frame in a view test.
- **Defaults.** `HostProvider` takes a `HostInput`: a `Host` whose `settings` and `device` may be left out. The defaults are module constants (`DEFAULT_SETTINGS`, `DEFAULT_DEVICE`) so `useHost()` returns the same objects every render, and a host that names both is passed through as it is.
- **Typed templates.** `templates`, `root`, `registerTemplate` and the hook's `templates` take `AnyPanelTemplate` (`PanelTemplate<any>`), because `PanelTemplate<P>` is invariant in `P` and a template made for typed params would otherwise need a cast. `addPanel` keeps `P`, so `params` stay checked where they are passed, and `PanelManager.get<P>` is an unchecked cast, not a second typed getter.
- **Templates are per workspace.** A workspace holds its own templates and its row resolves a panel's template through them (`resolveViewIn`), so two workspaces on one page can define different templates under one id. The module-level template map is gone, and so is the plain-view registry: a row is always fed by a workspace, so `resolveViewIn` resolves a key one way, the workspace's template for it, else the placeholder. `PanelRow` and `useProvidePanels` stay public but take a `workspace`, which supplies the root, storage, templates, declared panels, defaults and tuning that a hand-fed row used to be given piece by piece.

What stays at module level, and why none of it is a workspace's data:

- `placeholders`: one placeholder component per unregistered key, so AnimatePresence sees one component type.
- `adapters` (templateView.tsx): a WeakMap keyed by template object, one adapter component per template; the template itself is held by the workspace.
- `BARE_TEMPLATES` (panelFrameBoundary.tsx): a WeakMap keyed by template object, whether that template's view was last found to draw no frame. It decides how to draw the next panel of the template, never what a workspace holds.
- `CORES`: a WeakMap from a handle to its own core.
- `nextEngineIdValue`: an id counter, so ids stay unique across workspaces.
- `EMPTY_SET` and `EMPTY_MAP`: defaults for an omitted `PanelRow` prop, never written.

## Workspace options, wrap and update

An auto-mounted workspace needs no hand-built `Host`: what an app hands `HostProvider`, `Workspace` and `useProvidePanels` is an
option on `createWorkspace`. The members of `WorkspaceLive` (`device`, `settings`, `history`, `snapshots`, `labels`, `topInset`,
`panels`) are the starting values and the only ones `workspace.update(live)` can change; `root`, `templates`, `storage`, `mount`,
`wrap` and the other options are fixed for the workspace's life, and `update` naming one throws `invalid-options` and applies
nothing, not even the live members named beside it. The option names are the `Host` member names, so an option and the same value in
a hand-built `Host` give the same view result; `settingsColumn` is `settings.settingsColumn`. `panels` is `Partial<PanelsInput>`
minus what the mount measures (`phoneWidth`, `containerWidth`, `overflowContainerRef`) and what the workspace supplies (`workspace`,
`rootId`, `storage`, `templates`, `declared`, `workspaceDefaults`, `tuning`, `initialEntries`) and `labels`, which is its own
option, so there is no member list to keep in step with the hook. `topInset` is an option (the `Workspace` top padding), not a
tuning leaf: the catalog holds 20 tuning leaves, counted from `PANEL_SETTINGS_CATALOG`, and a test pins the number.

**`wrap`.** A component, `ComponentType<{ children, workspace }>`, rendered inside `HostProvider` and around `Workspace`. A
`CaptureRegistryProvider` and the app's own contexts go in it (the theme goes in the `theme` option), a hook in it may call `useHost()` and `workspace.update`, and
anything drawn beside the row is a sibling of `children`. It is read once at creation, so it has one identity for the workspace's
life and updates re-render it but never remount it. The order of an app's own hooks inside it is the app's.

Providers go here, not in a mounting wrapper: `wrap` is rendered around the row inside the host, so StrictMode, `MotionConfig` and
the app's contexts placed in it reach every panel view, footer and the shell. What it cannot reach is the mount's own hooks
(`usePhoneFit`, `useProvidePanels` and the live-store subscription run above it), so StrictMode's double render there is not
exercised, and the theme is the `theme` option, never a `ThemeProvider` in `wrap`. A workspace in a column gets the column's `wrap`
(the column passes it down) and renders it once per workspace.

```tsx
const wrap = ({ children }: WorkspaceWrapProps) => (
  <React.StrictMode>
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  </React.StrictMode>
);
createWorkspace({ templates, theme: buildTheme, wrap });
```

**`update`.** An app that builds its objects with fresh closures every render may call it from an effect on every render. The
latest values are always stored, so a closure an app rebuilt is the one a later render hands on, but readers are told only when the
data of a member changed: functions compare equal whatever their identity, a function against none does not, and objects and arrays
compare by their members. The caller is not subscribed to its own push. Values given to `createWorkspace` are on the first paint; an
update from a layout effect in `wrap` is applied in the task that rendered the row, before the browser paints. The callbacks of
`panels` are live: the mount hands `useProvidePanels` a stand-in for each, which calls the latest one. The mount leaves
`rowResizeSettled` to `Workspace`, which calls the width settled after `tuning.resizeSettleSlides` slide durations, so a window drag
snaps the row's margin and a panel resize glides it, as the app's own shell did.

| Passed today | Option | Fixed or live |
| --- | --- | --- |
| `HostProvider` `host.device` | `device` | live (`update`) |
| `HostProvider` `host.settings` (the settings column) | `settings` | live |
| `HostProvider` `host.history` | `history` | live |
| `HostProvider` `host.snapshots` | `snapshots` | live |
| `HostProvider` `host.labels`, `useProvidePanels` `labels` | `labels` | live |
| `HostProvider` `host.panels` | the mount's own `useProvidePanels` result | mount-owned |
| `Workspace` `topPadding` | `topInset` | live |
| `Workspace` `phoneWidth` | `device.size.width` | live |
| `Workspace` `overflowContainerRef`, `rowRef`, `containerWidth`, `rowResizeSettled` | none: the mount measures and `Workspace` settles | mount-owned |
| `Workspace` `fixedColumnCount`, `liveWidths`, `rowScroll`, `rowNumbers`, `tuning` | none: taken from `useProvidePanels` | mount-owned |
| `Workspace` `beforeRow` | none: its one user, the phone-detect notice, is gone; a custom flow keeps `Workspace` | missing setting (no consumer) |
| `PanelRow`'s ten props | none: taken from `useProvidePanels` | mount-owned |
| `useProvidePanels` `defaultView`, `defaultHostData` | `panels.defaultView`, `panels.defaultHostData` | live, read at each create |
| `useProvidePanels` `capture` | `panels.capture` | live |
| `useProvidePanels` `onPanelsClosed`, `onPanelsRestored`, `resetHostDataOnRestore` | `panels.*` | live (latest callback runs) |
| `useProvidePanels` `onPanelResize` | `panels.onPanelResize` | live |
| theme | `theme` | fixed at creation |
| `CaptureRegistryProvider`, the app's own contexts | `wrap` | fixed at creation |
| anything drawn beside the row (a window drag strip) | `wrap`, a sibling of `children` | fixed at creation |

## The default frame

A template's view that draws no `Panel` and no `PanelFrame` is drawn inside the library's frame: the header with the panel's
title (`labels.untitledPanel` when it has none), the grab bar of the drag-down close and the reorder drag, the phone frame and the
template's footer, built from the exported `Panel`, `PanelFrame` and `DragToClose` and sized by the panel's slots like any other
panel. A view that draws any part of a frame itself is left exactly as it was. There is no opt-out setting.

**How the library knows.** The adapter that renders a template's view puts a boundary above it (`FrameBoundary`, no DOM). A
`Panel`, a `PanelFrame` or a `PanelFooter` that mounts below claims the boundary in a layout effect, before paint. A boundary that
heard no claim after the view's own layout effects draws the frame, and remembers the verdict for the template object, so the next
panel of the same template is framed at once. One consequence is documented, not hidden: the first panel of a bare template mounts
its view twice, once bare and once inside the frame, so a bare view must not do work in a mount effect that cannot be repeated.

**The cases between.** Any claim means self-framed, as today: a view that draws only a `PanelFrame` (or only a `Panel`, or only
`PanelFooter`) gets no library frame and no warning. A view that renders nothing first and a `Panel` later (lazy, or `null` while it
loads) claims late; the boundary then takes the library frame back and the view mounts again without it, so state that decides
whether the `Panel` renders belongs outside the view. React.lazy resolves from its cache on that second mount and is unaffected.
Under StrictMode the claim is made and given back by the same effect pair, so the verdict is the same. A panel that parks and
returns keeps the verdict; it is not probed again.

**Who gets the grab bar.** The frame follows `PanelRow`'s own rule: a panel that cannot be closed (`closable: false`, or not parkable) gets the header and the phone frame but no grab bar and no `DragToClose`, and a panel that cannot be moved (`movable: false`) keeps the grab bar and the drag-down close but not the reorder. The grab bar carries both gestures, so a panel with `closable: false` and `movable: true` has no reorder handle in the default frame, and the root has none even when its `movable` is on: a root view that wants to be dragged draws its own `Panel`, gives `grabProps` the `DragToClose` handle and spreads `usePanelDragProps()` onto `DragToClose`, which gives it the reorder and the Arrow keys and no close.

**Rejected.** (a) An outer frame that every view sits in, with the inner `Panel` hiding itself when it finds one: a `Panel` the view
configures (`grabProps`, `overlay`, `headerProps`, `sx`, its rest props) would have to hand every one of those up to the outer
frame, and a prop missed is a view that changed. (b) An outer frame that is taken away when a claim arrives: every self-framed view
would mount twice at launch, once inside a frame it does not want. The boundary instead leaves a self-framed view's tree as it was,
and golden DOM recorded before the frame existed (test/golden/default-frame-self-framed.json) holds that, with mount and unmount
counts of one and none.

**Size.** The frame animates its size like a `PanelSizeBox` view: `DefaultFrame` draws one box (`SizeBox`) around the whole
`Panel`, so the header, with the grab handle in it, above the phone frame, the frame and the footer inside it all take the box's size
and their edges stay on the frame's at every frame. The box is the panel's width and height (the device size for a phone,
`panel.size` otherwise, `'100%'` of the row for a `'fill'` height); at rest the frame's rect is what it was
before the box existed. A box below another draws a plain `div` of the same size (`SizeBoxContext`), because two glides of one size
would fight, so a bare view that draws its own `PanelSizeBox` is unchanged. Nothing is eased from a size the box never had: a
first mount, the frame drawn again after a late claim, a parked panel that returns and a snap (Reduce Motion, a
held width) all draw at the new size at once. Rejected: one box per part, which lets a part trail the frame by a frame.

**Cost.** No setting: every template view that claims no part of a frame is drawn inside the library's. The boundary reads nothing from the slot.

## Operations on a handle

A verb names a panel, never a row index, and resolves it on every call: a handle holds a key and asks the core what is behind it now (live, parked, closed, pending), so a handle taken before a close still answers after it. The answer is a `PanelResult`: `ok` with whether anything was dispatched, or a refusal whose code is a `PanelRefusal`. A refusal is decided before the engine is touched, so it changes no list, schedules no commit and records no scroll.

- **The table.** Each verb reads the panel's state and its settings and gives the outcome listed here. `show` on a live panel only scrolls (`changed` is true only when a scroll was recorded); on a parked one it activates, places at `placeOnShow` and scrolls. `toggleVisibility` is `hide` on a live panel and `show` on a parked one. A closed declared panel is reopened by `open`, by `show` when `showWhenClosed` is `reopen`, and by `toggleVisibility` when `toggleWhenClosed` is `reopen`; a closed anonymous instance, which no code can name again, answers `is-closed`. `close` on a closed panel is accepted with nothing to do.
- **The gate.** Every accepted call takes a token on the engine ids it touches before it calls the engine and gives it back after, so a second call on the same panel in the same turn answers `busy`. A close is exclusive: while a handle close holds a token every other handle call is busy, and a close is busy while any handle call holds one. `scrollTo` takes no token and is never busy. The tokens are deleted by the first commit rendered after the call finished, never by a commit inside it, so a `flushSync` in the call cannot clear its own token and the table gives the same answers from a handler, a timer, a promise continuation and a passive effect.
- **Raw mutators.** `ProvidedPanels.close`, `undoClose`, `activate`, `move`, `reanchor` and `setSlots` take a raw token the same way and never refuse, but a raw call on a panel a handle call holds does nothing. `create` and `clearAll` take no token. Two raw calls on one panel still apply in call order, and two raw closes before a re-render still undo in the wrong order (`LIMIT:3`); only the handles prevent it.
- **Closed records.** Closing a panel code can name again (a declared one, or one added with an explicit id) leaves a record, which `open` uses; closing any other instance retires it, and a retired handle keeps answering `closed` from a small cache. A thousand add and close cycles therefore leave the snapshot at the declared panels plus the live ones. `open` on a key whose close sits in the undo window drops that record, so `undoClose` has nothing to skip or report for it.
- **Reapply.** `undoClose` asks the core to rebuild the closed entry from the panel's current layers (`applyTemplate` with `reconfigure`) and to say where it goes: the entry keeps the recorded index. Without a workspace the entry returns unchanged, as in 0.1.0.
- **Source.** Every verb takes an internal last parameter, `'code'` (the default) or `'person'`. A person's `move`, `place` or `setSlots` records the override a gesture records; code leaves the person's arrangement alone.
- **Scroll.** An accepted `move`, `place` or `setSlots` on a panel in view follows it per `scrollOnMove`; `show` of a parked, hidden or out-of-view live panel and `open` of a closed declared one record one `scrollOnOpen` request.

### Pinning and reset

- **Applying a half.** `pin` and `unpin` apply the panel's pinning definition in one commit, all or nothing. `pin` places, then fixes; `unpin` frees first, then places, so a fixed pin can always be unpinned. `movable` gates none of it. A fixing half needs a panel of one slot (`slots-above-max`) and no explicit setting the fix would override (`settings-conflict`, with the offending catalog name in `setting`). A fixed pin never needs room: there is no `no-room` refusal.
- **Not live.** `pinningWhenNotLive` answers for a parked or hidden panel: `place-only` applies a placement-only half in place and answers `would-reshape-row` for a half naming `parkable`; `refuse` always answers `would-reshape-row`; `show` shows the panel and applies the half in one commit; `apply-on-next-show` stores the half on the entry. A closed declared panel stores it on its record instead.
- **Deferred pins.** A stored half is applied inside the update of every path that makes the panel live: `show`, a History click, a Host-bag activate, the row gesture, an automatic return, an undo and `open`. It is re-checked there and dropped with the note `deferred-pin-dropped` when it no longer applies. A fixing half sets `live` so a fixed column is never parked. It is session only and never saved.
- **The person's pin.** A person's pin records `overrides.anchor` (every id, when the half names a placement) and `overrides.parkable` (when it names `parkable`) through `recordOverride`; a code pin flips `parkable` for the session and records nothing.
- **Configure of parkable.** A `configure` that names `parkable` on a parked, hidden or closed panel goes through `decidePinChange` like `pin`, reading `pinningWhenNotLive` as it stood before the patch: `place-only` and `refuse` answer `would-reshape-row` (`is-closed` for a closed panel), `show` shows the panel and flips it in one commit with `shown: true`, `apply-on-next-show` stores the half as a deferred pin and lists `parkable` in `later`. A closed panel's stored half lives on its record, is never saved, and is applied by `open` or an undo. A flip that changes nothing the panel reads, as when the person's override outvotes it, is no pin change and is never refused or stored. A `configure` that names `parkable` cancels a stored half on a parked, hidden or closed panel alike, even when the patch changes no layer value. The rest of the patch is written with a stored flip, and a refused flip refuses the whole patch.
- **Reset.** `resetLayout` writes `overrides` only through `clearOverrides`, clears stored deferrals and re-places each named panel by its resolved `placeOnAdd`. `'all'` scrolls nothing; one id follows `scrollOnMove`.

## Panel chrome

The active and dragging panel are ephemeral facts held by the Workspace in a small external store (`panelChrome.ts`), one per
Workspace and never module-wide, so two workspaces share nothing. They are not in the manager's snapshot or in storage.
Each panel subscribes to its own entry, so a press that moves the mark re-renders the panel that lost it and the one that
gained it. `PanelRowSlot` activates its panel from React capture handlers (`onPointerDownCapture`, `onFocusCapture`), which
follow the React tree and so count a portaled dialog the panel opened; a focused iframe fires neither, so the slot also
listens for the window's `blur` and activates when the focused element is an iframe inside it. The row clears the mark of a
panel that closes or parks. `usePanelSetDragging()` writes the same dragging entry for any drag a host runs but a resize grabber, which uses `usePanelResizing()`. The store holds one dragging id, so a panel has one mark and the last write wins; the setter clears only what its own call raised when its view unmounts.

`Panel` writes `data-panel-active` and `data-panel-dragging` on its root box, and `data-panel-chrome-part="header"`,
`"grab-bar"` or `"footer"` on the parts `tuning.chrome` fades (the grab handle sits inside the header and fades with it). Hosts style from these names, so `index.ts` exports them
(`ACTIVE_ATTRIBUTE`, `DRAGGING_ATTRIBUTE`, `CHROME_ATTRIBUTE`, and `CHROME_PARTS` for the part values) and the components write
their values from the same constants; a test pins them. `data-panel-grab-bar`, `data-panel-footer` and `data-panel-size-box`
are not a public contract.

The fade changes opacity only. `pointer-events`, `inert`, `visibility` and `display` stay as they are, so a hidden header
keeps its space, receives the pointer that reveals it, and holds Tab focus. It runs through Motion's `animate`, which uses the
Web Animations API and so is not stopped by a theme's `transition: none !important`. Mode `'always'` leaves no inline opacity.

`PanelHeaderButtons` is a toolbar with a roving tab stop kept in its runtime: the stop follows focus, falls to the first
enabled button when its holder is removed or disabled, and Arrow, Home and End skip disabled buttons.

The Workspace derives the row's resize settle from `tuning.slide`: the row snaps while the width moves and glides once it has
held for `tuning.resizeSettleSlides` (1.25) slide durations, at once under Reduce Motion. A `rowResizeSettled` the host supplies wins.

## Doc comments

An export reachable from `index.ts` or `fakeHost.ts` is documented with TSDoc, the `/** */` syntax API Extractor already
reads for the release tag. Every export, and every property or method of an exported interface, type literal or class,
gets one. An undocumented one prints `// (undocumented)` in `etc/*.api.md`, and `npm run check:api-report` fails on that
line, so the reports are also the audit.

- A doc comment says what a consumer may rely on: what it is, what a value means or what it is measured in, what a call
  returns, when it throws. It does not say why the code is shaped that way; that is a `//` comment on the line it
  governs, or a section of this file.
- Open with one sentence that stands alone, as it renders in an editor tooltip. A property gets a fragment
  ("Width in px.") rather than a restated name.
- Types stay in the signature: write `@param name - what it means` and `@returns what it gives back` only where the name
  and type do not already say it, and `@throws` for an error a caller is meant to catch. Use `@example` for the one call
  a reader would otherwise have to guess, `@remarks` for what does not fit in the opening sentence, `@defaultValue`
  for an optional property's default, and `{@link Name}` for a cross-reference.
- Every declaration keeps its single `@public` tag (see "The API reports in `etc/`").
- Internal helpers are documented only where the contract is not obvious from the name; they come after the public API.

## The API reports in `etc/`

`etc/phonux.api.md` and `etc/phonux-testing.api.md` are API Extractor's reading of this package's surface, one
per `exports` key in `package.json` (`.` and `./testing`). They are committed so that a change to what a
consumer can import shows up as a diff in review. Only `npm run api-report:update` writes them.
`npm run check:api-report` regenerates each one in a temp folder and fails if it differs from the committed
copy, so a hand edit fails the next check.

There is one `api-extractor*.json` config per entry point, because API Extractor analyses one entry point per
run. The report script checks the `exports` map against the configs key by key, so an entry point with no
config, or two configs pointed at each other's entry, fails before anything runs. The declarations it reads
are emitted into `api-extractor-temp/` at the repository root (git-ignored), so they never reach
`npm run typecheck` or the published package.

Every declaration an entry point reaches carries exactly one release tag in its own doc comment, `@public`;
`.` and `./testing` reach nothing `@internal`, and an underscore-less `@internal` tag on one of their exports
fails the check. A deprecated alias keeps `@deprecated` beside its tag. A tag above a re-export line (`export { X } from ...`) does nothing, because API
Extractor reads only the declaration's own comment.
`ViewStateProvider`, `OverlayProvider`, `OverlayStore` (with its `Item` and `Entry`),
`CaptureRegistryContext`, `PanelRowSlot`, `shouldCloseOnRelease` (with its `ReleaseMeasure`), `computeRowOrder`,
`deriveAnchorsFromOrder`, `summarisePanel` and `computeMaxLiveWidth` are exported
for this package's own files and tests but reached by no entry point, and are tagged `@internal` to say so.

A public signature pins every type it names. Each one must be exported by the same entry point (otherwise
`ae-forgotten-export`), which is why `fakeHost.ts` re-exports `Host`'s whole type closure. Each one must also be at least as public as
the signature (otherwise `ae-incompatible-release-tags`), which is why `ReorderHandle`, named by
`DragToClose`'s public `reorder` prop, is `@public` rather than `@internal`. It is a type, so it never joins
the runtime values the barrel test pins.

The script fails on warnings written into the reports, not only on API Extractor's exit code or stdout.
Several messages, `ae-forgotten-export` among them, go into the report file instead of the console, some only
into its trailing "Warnings were encountered" footer. Once such a report is committed, the next check
regenerates the same text, matches it, and API Extractor exits 0. So the script also scans each committed
report for an embedded warning or message id, and fails on any.

## Pinning and header buttons

A panel is pinned when its definition reads so from the row (see "Pin definitions"): `pin()` and `unpin()` on a handle apply the
two halves of `pinning` in one commit, a person's pin is saved as an override and a code pin is not, and `resetLayout` clears
overrides and deferred pins. The title bar's buttons are the other half of this surface, and they are generic: the library draws
no built-in button.

### Slots

`headerButtons` is a map from a slot id to `{ icon?, label, onClick, side, order, pressed, description, tooltip, disabled, hidden, sx }`
or `false`. It cascades like any setting: a template's slot and an instance's slot both apply, `false` on a later layer removes that
id, and a layer never holds `null` (a patch's `null` removes the instance's own slot, which gives the template's back). The
validator in `panelSettings.ts` checks every field of a slot, so a bad slot throws `invalid-settings` naming its layer. A label
function that returns an empty string is the one value it cannot judge; that slot is hidden at runtime.

PanelRow puts the resolved slots and the panel's own handle in the slot context, and `Panel` draws them: buttons of `side: 'start'`
before the title, the view's own `actions` first among the end side, then the end buttons, each a plain MUI IconButton of size
small. A slot with only icon, label and onClick renders exactly the markup of such a button written by hand.

A slot has one of two forms, told apart by the `icon` key alone: with `icon` it is the icon form (the label is only the accessible
name), without it the text form (the label is also the button's text, a plain MUI Button of size small that keeps the label's
case). `icon: undefined` is neither form and the validator rejects it, so a forgotten icon is never silently a text button; an
icon function that returns null is still the icon form and draws an empty button. A text button is at most 9em wide and clips
longer text with an ellipsis; the title truncates before any button does. When no `tooltip` is declared, the full label becomes the
tooltip only while the text is clipped. The text button is inside the header part, so it fades with `tuning.chrome` like an icon
button, and there is no tuning leaf of its own. `usePanelHeaderButtons` lists the form as `form: 'icon' | 'text'`, and `icon` is
undefined in the text form. A panel that declares
none, or whose slots are all hidden, renders the markup it always did; the header row takes `tabindex="-1"` only while a slot is
drawn, so focus has somewhere to go when the button that held it leaves (the one row that holds focus when its last slot is removed
takes it then). `Panel`'s `headerButtons={false}` keeps the cluster out of
its header; a view with its own header calls `usePanelHeaderButtons()` for the list or renders `PanelHeaderButtons`. A view that
draws its own pin as well as declaring a pin slot shows two buttons: the library does not merge them.

### Click and safety

`onClick` receives the panel's own handle and a context with `announce`. The verbs it calls go through the manager's in-flight gate,
so a second press in the same turn is answered `busy` by the verb. A verb called synchronously inside `onClick` is the person's
gesture and records their override; the same verb after an `await`, and any call from code, records nothing. A refused verb returns
its typed code to the function and the library draws nothing for it; `announce(text)` writes to a polite status region that exists
from the first announce on and is the cluster's last child. A throwing `onClick` or a rejecting promise goes to
`WorkspaceOptions.onError`, else `console.error`, and changes nothing. Each slot has its own error boundary: a throwing icon or label
function, an icon element that throws while rendering, or an empty label hides only that slot and delivers one `header-button-error`
note through `onNote`. A disabled slot stays focusable and its press does nothing. A slot of a panel that is exiting is inert and
its press reaches no verb.

### Focus

After a press that reorders the panel the pressed button is focused again with `preventScroll`. When the button that held focus is
hidden by a predicate or its slot is removed, the panel's last one included, focus goes to the same panel's header row; when the press closes or parks its own panel, to the header row of
the panel now at that index, else the previous one's. Focus is never left on `body`. Whether a real browser keeps focus across a
DOM move is for the real-layout gate.

## Panel footer

A template declares `footer`, a component given the same `panel`, `handle` and `manager` props as `view`, and every panel made
from it shows the footer below its `PanelFrame`, floating as the header floats above it: a sibling after the frame, absolutely
positioned at the header's gap below the frame's bottom edge. It takes no panel height, so the frame keeps its phone size with or
without a footer, and the frame's clip cannot cut it off. The parent must be `position: relative`, as for `PanelHeader`. It is a template field and not a setting:
header buttons are settings because a person or an instance may change them, and a footer has no layer to cascade.

The view adapter (`templateViewFor`) puts the footer element in a context, and `PanelFooter` reads it. A `PanelFrame` outside
a template view, or of a template with no footer, draws nothing. A frame nested in another draws the footer in each; a view
that wants one passes `footer={false}` to the inner frame. A footer that throws while rendering is hidden by its own boundary,
which tells `console.error` once; the rest of the panel stays. A window-wide bottom bar is a different feature and is not built.

## Panel API levels

A template may declare `api`, the panel API level it was written against, so a panel can stay on the panel-facing API it was written for while the container (`createWorkspace`, `Workspace`, `PanelRow`) moves on. Leaving it out means the newest level, `PANEL_API`; the key is the one way to ask to stay on an older one.

### A level is the package's major version

Level N means panel code written for phonux N.x. `PANEL_API` equals the package's major version from 1.0.0, so a minor or patch release never adds a level and the single number to remember is the major. Every level that is still served keeps receiving fixes and security updates through ordinary minor and patch releases of the one package.

- A template with no `api` moves with each major: on upgrading from 2.x to 3.0 it receives level 3's props. `api: 2` is how a panel stays. The guarantee covers panel code only; a host that upgrades across a major still migrates the container API (`createWorkspace`, `Workspace`, `PanelRow`, tuning options and saved state), which a level does not cover.
- A major that changes nothing for panels adds an entry with no adapter. A major that changes panels adds a level and rewrites the older levels' adapters from the new newest props, since an adapter always starts from the newest props. `PanelApiLevel` grows (`1 | 2`) with each major, and `PanelTemplate` becomes a union keyed on `api` at the first major that changes panel props.
- Every level from 1 to `PANEL_API` is either served (in the table) or recorded as dropped with the release that dropped it, and nothing else; a dropped level answers `invalid-template` with that release.
- Before 1.0.0 level 1 moves with the prereleases: no adapter is written for a 0.x change and `test/fixtures/panel-api-1` is edited with it. At the 1.0.0 release level 1 is frozen and the fixture rule below applies from then.
- `npm run release:check` refuses a version whose major needs a level that `PANEL_API` does not name; a prerelease of N.0.0 already needs level N, and a 0.x version is exempt.

### What a level covers

| Covered (the panel side) | Not covered (the container side) |
| --- | --- |
| The props a template's `view` and `footer` receive: `panel`, `handle`, `manager` | `createWorkspace`, `Workspace` and `PanelRow` props |
| The slot context hooks a view calls (`usePanelPinned`, `usePanelTuning` and the rest) and `useViewState`, snapshots | Workspace tuning options and the theme |
| Header button items, the chrome attribute and part names | The saved workspace format, which has its own `version` |
| The template's own `settings` keys and `params` | Peer dependency ranges (React, MUI) |
| `useHost().panels` (`PanelsAPI`): the verbs a view calls and the summaries they return | The workspace-only tuning options (`rowGap`, `saveQuietMs`, `gestureLockMs`, `gestureQuietMs`, `resizeSettleSlides`, `returnTieBreak`, `dropTieBreak`, `rowGesture`, `initialScroll`, `maxLivePanels`, `chrome`, `phoneFit`, `phoneFitMin`, `phoneFitMax`, `dragToClose`, `slide`, `hopFraction`, `edgeScroll`, `defaultEnterFrom`, `defaultExitTo`): a host sets them on the workspace, and a view only reads what `usePanelTuning` returns |
| The frame components a view renders and their props: `PanelFrame`, `PanelHeader`, `PanelHeaderRow`, `PanelFooter`, `DragToClose`, `PanelSizeBox`, `WindowOverlay` | |
| The view hooks: `usePanelStates`, `usePanelState`, `useWorkspace`, `useWorkspaceManager`, `useActivePanel`, `usePhoneSize` | |

The `useHost().panels` row is covered only until the deprecated Host-bag verbs (`create`, `activate`, `move`, `setSlots`, `reanchor`, `close`) are removed: when they are, the row and the fixture's `PanelsAPI` block go with them. The auto mount gives a view only the `PanelsAPI` members (`hostPanelsOf`); `maxFitPanels`, `undoClose` and `clearAll` stay on it.

A panel has one public id, its key: a singleton's template id, an explicit instance's given id, or `${templateId}~${n}`. `panel.id`, `handle.id`, `PanelState.id`, every `PanelsAPI` verb, `useActivePanel`, the id the snapshot trigger is given and `tuning.initialScroll.panel` all name a panel by it. The row keeps its own counter id for layout and saved anchors, and `summarisePanel` is the one place that turns an entry into the public id. Where an id is read (`PanelsAPI` verbs, `useActivePanel`'s setter, `initialScroll.panel`, a view handle lookup) `entryNamed` in `panelIds.ts` takes the key first and then the counter id, so the id a view held before keys were the only id still resolves; it logs one development warning per counter id, naming the key, and the counter alias is removed in a later release. A hand-built entry has no key, so its key is its id.

`api` is not saved: templates are registered each launch and the saved state names the template id, so no migration reads it.

### How a level is served

- One package serves every kept level. React and MUI are peer dependencies and the workspace, registry and contexts are module singletons, so a second installed copy could not share a workspace with the first; a security fix is therefore one ordinary release that every level receives, with no dist-tags or backport branches.
- `panelApiLevel.ts` holds the level table: level to adapter, and which level is the newest. `templateViewFor` (`templateView.tsx`) is the one place a template's view and footer props are built; an older level's adapter turns the newest props into the ones that level promised. The shipped table has only level 1, so no adapter runs today. A test passes its own table to exercise a second level; the fake never enters the shipped table.
- The check runs in `definePanel`, which `createWorkspace({ templates, root })` and `workspace.registerTemplate` call, so every door answers `invalid-template` the same way. `PanelTemplate` is an interface with an optional `api?: PanelApiLevel`; it becomes a union keyed on `api` when panel props first change in a major, because a one-member union adds nothing.
- Hooks and settings keys are import- and resolver-bound, so an adapter cannot intercept them. They are additive within a level: a renamed hook or setting key keeps its old name as a deprecated alias for as long as its level is served, and a breaking change to one ships under a new name.
- Every level stays served until the owner deprecates it, so each breaking panel change adds a level, an adapter and a fixture that stay. A level is served (no `droppedIn`), deprecated (`droppedIn` names the release that will remove it; the warning names that release and CHANGELOG lists it under Deprecated) or dropped (that release removes it and CHANGELOG lists it under Breaking).
- A template on a level that is not the newest logs one development-mode warning per template id per page load; the warning names a removal release only for a deprecated level. The set of warned ids lives at module level, so StrictMode's second render and a remounted workspace do not repeat it; production and a host with no `process` stay silent.
- Each level has a shape: the members of `panel`, `handle` and `manager` it promises, by name and kind, with optional ones marked (`NEWEST_SHAPE` in `panelApiLevel.ts`; an older level's entry carries the shape of what its adapter returns). It is typed against `PanelSummary`, `ViewHandle` and `PanelReader`, so a member added to or removed from one of them fails to compile until the shape says so. The first time a template is rendered at a level in development, `TemplatePanelView` compares the props it built with that shape and logs one `console.error` naming the template, the level and every missing or wrong-kind member. It reads property descriptors only (no getter or method runs), never throws, and is silent in production and where `process` is undefined.
- The runtime check covers the props a view and footer receive, nothing more: hook return values, settings keys, header button items and `params` are not described, and a member's kind is its `typeof`, not its full type. TypeScript carries the rest at compile time.
- A level whose adapter renames or drops a prop supplies its `shape` beside the `adapt`; a table entry with one and not the other does not compile. The first real second level ships with a type test for its shape, as `test/panel-api-level.typecheck.ts` does for the mechanism, and with a test that a view on level 1 receives the same props as before.
- `definePanel`, which every door passes through, also checks that a template does not use a setting or header button member newer than its level. `panelLevelChecks.ts` names the level that introduced every catalog name (typed over `CatalogName`, so a new setting cannot be added without stating its level) and every header button member (typed over `HeaderButtonBase` and `icon`). A valid member newer than the template's level logs one `console.error` per template id in development, listing every such member with the template and level; it never throws and never changes registration, because a valid value that stopped registering after a minor release would break the template the level exists to protect. A malformed value or an unknown key is still `invalid-settings` from the resolver, unchanged. With one level every name is level 1, so the check cannot fire for a real template; it is proven with a two-level description passed in by the test.
- The header button items a view lists with `usePanelHeaderButtons` are described by form (`HEADER_ITEM_SHAPE`, typed against `PanelHeaderIconItem` and `PanelHeaderTextItem`) and checked on the first non-empty list of each template id, with the same once-per-template, `console.error`, production-silent, no-getter machinery as the view props. A template view reaches its level through `PanelLevelContext`.
- Still unchecked at runtime: setting values (the resolver's job), the values the slot hooks return, chrome attribute and part names, and `params`.
- `PANEL_API` is exported from `index.ts` and not from `phonux/testing`.
- `test/fixtures/panel-api-1` holds two panels written against a hand-copy of the level-1 props and against the covered exports above: one that the default frame wraps and one that draws its own frame from the frame components. Each is assigned to a real template, so it compiles only while the real props and exports still provide what it uses, and `test/panel-api-level.test.ts` renders both in a workspace. The `PanelsAPI` rows of the first panel sit in one marked block. From 1.0.0 a change that breaks it breaks level 1: add an adapter and a level, never edit the fixture. Before 1.0.0 it is edited with level 1.

## History, releases and development

The library began as a folder inside phonux-app and was extracted with `git filter-repo`, renaming every path the folder ever had,
so `git log --follow` on a source file runs back through its years inside the app. The first entry of `CHANGELOG.md` names the
phonux-app commit the extraction was taken at.

A release is `npm run release:check`, then the maintainer's own `npm publish` from `dist/` (`npm publish --tag next` for a prerelease version). Nothing in this repository publishes,
and a published version is never edited: a fix is a new version, and `CHANGELOG.md` says what changed. `.github/workflows/ci.yml`
runs the typecheck, the tests, the build, the API report check and the smoke on a pull request into `release` and on dispatch;
a pull request into `main` runs no cloud check.

### Release candidate base

`0.2.0-rc.3` is built from this commit of `main`; library source changed since `0.2.0-rc.1`, and the CHANGELOG sections
for `0.2.0-rc.2` and `0.2.0-rc.3` list what.

```text
base: b1b9a6702574742dadf2a66cf934a8a07d5c678b
```

No real browser has measured this tree. Every claim about real layout, scrolling or painting stays not run; the jsdom and unit
suites are the only evidence behind this candidate.

phonux-app installs the published package from the registry. To try a change there before publishing, install a copy of this
checkout over it: `npm install --no-save --install-links <path to this checkout>` from the app leaves the app's `package.json`
and lockfile untouched, and `npm ci` restores the registry copy. Never `npm link` or a `file:` directory spec: a symlink resolves
this checkout's own `node_modules`, which can give the app a second copy of React. The copy is source (`.ts`); to rehearse exactly
what will be published, run `npm run build`, pack `dist/` and install that tarball instead.

## The dot bar (usePanelDots)

The row's scrollbar can be replaced by a bar of dots, one per drawn panel. `usePanelDots` is headless: it returns each dot's
track place (`left`, `width`, `hollow`), the window oval's `left` and `width`, and two handlers. The library draws no dot and
no oval; the app places and styles them, so no colour, radius or border is set here.

**Geometry.** The track scales the row's strip: a dot sits at its panel's strip offset and is as wide as the panel, so a wide
panel is a wide dot. A dot never narrows below the `minDotPx` the app passes. The oval is the window (`windowWidth`) in track px,
and it fills the track while the window is unmeasured or the row fits. All of it is pure, in `rowDots.ts`.

**Writes.** A click on a dot centres its panel (`centreScroll`, clamped to the row's range); a row that cannot scroll gives no
target and the click does nothing. The oval drag takes the row's claim (`rowScrollerFor(...).claim()`), writes each drag as
`write(dragScroll(...))`, and releases the claim on `end()`. The bar never writes `scrollLeft` itself. A held row (a gesture or
another drag) refuses a new drag with null.

**Reduce Motion.** A click snaps when either the OS query or `MotionConfig` says so, the same two sources the row's own motion
reads.

**History.** The library has no notion of History. The hollow dot is the panel setting `hollowDot`, which the app sets on the
template it marks; the library reads the flag, never a name.
