# phonux: design notes

This package is the seam between a host app and any view: the app's own panels or a third party's. Nothing here may
depend on the app that hosts it.

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


`stubRowDom` (on `phonux/testing`) is for a host that keeps its own jsdom window and clock. It patches the window it is given
and imports neither jsdom nor the engine, so the fake's entry stays light. Only what the row reads is filled in, and the row's
offsets are read back from the px the row writes inline, so the stub cannot disagree with the row about where a marker is. The
`phonux/testing/row` entry fills in the same gaps, but not the offsets, on the window it installs.
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
so nothing reads `maxSlots === slots` as "not resizable".

### An entry carries the settings it was made under

`effective(p)` (`panelSettings.ts`, internal) is the one reader of an entry's settings: `p.settings` itself when
the entry has them, otherwise values read from the fields a hand-built entry carries (`collapsible` gives
`parkable`, `closable`, `movable`, `resizable` and `clearable`), with every other key at its library
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

`PanelWindow.anchor`/`layer`/`anchoredEnter` replace three separate hard-coded special cases for the root
(always the leftmost column, a higher zIndex, entering unconditionally via the anchor formula) with one field
each, read by exactly the site that decides that one behavior: `anchor` by the function that orders the row
(see "Row order is anchor metadata" below), `layer` by the row's per-slot zIndex, `anchoredEnter` by the row's
enter-direction choice, which resolves against that panel's own anchor target. `layer` and `anchoredEnter` are
set once at creation; `anchor` is set at creation and changed by `reanchor` and by a drag. A custom panel can
opt into any of the root's behaviors without becoming root-shaped in any other way -- `listed`,
and `collapsible` stay independent of all three.

### `permanent` is the one door to a collapsible:false column

`CreatePanelOptions.permanent` (`AppendPanelOptions.permanent` underneath it) is the only way a spawned panel
can become a permanent column -- there is no raw `collapsible` key. Setting it forces
`listed:false` regardless of any `listed` the caller also passes: a host's list-row trash
(suppressed by `listed:false`, the root's own precedent) must never be the close affordance for a column whose
own component owns its own close control. It adds no fourth field alongside `anchor`/`layer`/`anchoredEnter`
above -- those three already work on any entry, collapsible or not, unchanged (`create({ permanent: true,
anchor })` places the column like any panel). A permanent column is exempt from every row gesture, capacity
park and from being dragged by a person, for free, by already being `collapsible:false`, the same way the root
already is. Other panels can still be dragged past it -- see `PanelsAPI.move`'s own section below.

The "own control only" guarantee also has to hold for the host's default view, not just a custom one: `view`
left unset resolves to `PanelsInput.defaultView` (with none, the unregistered-view placeholder), a host's own panel component, which otherwise wraps
EVERY panel in a framework drag-to-close handle unconditionally. That component reads
`usePanelCapabilities().closable`, which is false for a column with `collapsible:false` and for an entry whose
`closable` setting is false, through the per-slot context (`panelSlotContext.ts`). It renders no DragToClose wrapper -- no grab bar at all -- when it reads false,
exactly like the root's own Panel today.

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
`PanelWindow[]` (`appendPanel`, `createRootPanel`, `closePanel`, `restorePanel`, ...). It sits inside the
import boundary above, so it imports only its siblings and never the desktop app. The main barrel exports
`PanelWindow` and `reorderStepsForOffset` from it; every other name stays `@internal`, reached by no
entry point, and the package's own tests import `panelWindow.ts` by relative path.
Its functions are pure and take no device-state argument (`test/panel-window.test.ts` builds panels with no device store
initialized at all). A size would need the live device size, so the record holds none: a panel is its `slots`, and its
size is derived where it is drawn, from the slots and the measured phone width (see "The width source" below).
`DEFAULT_PANEL_SIZE` (`panelTiers.ts`) stays exported as the built-in phone size.

## `PanelsAPI.move` is directional (move-by-one), not "move to index"

The handle's `move(by, source)` takes that step as a signed count, `by` slots in one gated call, so a drag crossing several neighbors is one call and one `PanelResult`; it stops at an end or at a panel that cannot be crossed, and is accepted unchanged at an end or for 0. The Host bag's `move(id, 'left' | 'right')` swaps `id` past whichever OTHER shown panel currently sits toward that side,
rather than taking a raw target index. A raw index is meaningless across the `panelList`/internal-array
split (`panelList` only ever lists panels, `collapsible: false` columns like the root are never addressable
targets) and would leak the internal array's own indexing into the public surface. The row's own
drag-to-reorder gesture (the host's panel component) converts a pointer's cumulative offset into a step count and calls
`handle.move(steps)` once -- the same primitive a future keyboard/single-pointer
alternative (WCAG 2.5.7) would call with 1 or -1 per key press. `usePanelDragProps()` hands `DragToClose` that close and that reorder for the panel it is called in; the default frame spreads it. Panels can differ in width, so the step count is not
`offset / one slot`: a hop past a neighbor moves the dragged panel by that NEIGHBOR's span (its width plus
the gap), so each hop lands half-way across the next neighbor's span (`reorderStepsForOffset`, over the
neighbor widths the row supplies per slot). With equal widths this is exactly one hop per slot.
The same count drives a live preview during the drag (see "Live reorder" under `DragToClose`), so the panels the drop would cross
already sit where the drop leaves them.

`collapsible: false` panels are excluded as a drag SOURCE only: they render no grab bar, through a plain React
context PanelRow.tsx provides per slot (a resolved view only ever receives `PanelSummary`, which carries no
`collapsible` field to check locally), and `move` is a no-op on their id. As a NEIGHBOR they are crossable
like any other panel: a drag passes the root or a permanent column, one hop per that column's own span, so a
drag is one way a panel ends up left of the root. After every `move` each panel's anchor is re-read from the
row as it then stands -- see "The drag contract" in the next section.

## The row runs on Embla Carousel

The row is one strip on Embla Carousel 8.6 (`emblaRow.ts`, pinned: the row writes `internalEngine()`, guarded by
`test/embla-internals-contract.test.ts`). The window is sized to whole slots; one invisible marker per slot is Embla's slide,
so every slot edge is a stop, a wide panel's inner ones included. Wheel and trackpad (through wheel-gestures), a mouse drag on
the row's surface, the bare arrow keys, the dot bar and moves by code all move that one strip; nothing parks for room, and
`tuning.maxLivePanels` unloads far panels to placeholders of their width. A change of the strip keeps the view still
(`keptScroll`), and a slot that moves on screen glides there.

Where the row rests is saved with the panels: a person's move (a wheel the row owns, a primary press, a key or `stepRow` step, the
dot bar) starts `watchEmblaRest`, which waits until the row has stood still for 150 ms with no glide, press, wheel gesture or
drag hold, and the provider records the rest as `{ panel, offset }` (the first panel the window shows, and the offset from its
left edge in phone widths and gaps). The persistence hook's debounced save writes it; a relaunch starts there with no glide,
over `tuning.initialScroll`. A move by code is not recorded.

## Row order is anchor metadata: `{ panel, position, priority }`

Every panel's place in the row comes from its own anchor, never from a fixed rule about the root. The root
carries no anchor, and every other panel sits on one side of one panel. For a view, the one
shape is `{ panel?: string; position: 'left' | 'right'; priority?: number }`.

- **Where it is set.** `CreatePanelOptions.anchor` when a panel is created, and
  `PanelsAPI.reanchor(id, anchor)` for a panel that already exists, live or parked. `reanchor` is a no-op for
  an unknown id or a permanent column (the root included). Both reorder the row at once.
- **Defaults.** `panel` omitted means the root; otherwise it is another panel's `PanelSummary.id`. `priority`
  omitted means one past the highest priority already on that side of that panel: the far end. `create()`
  with no `anchor` at all is `{ position: 'right' }`, so a plain create lands at the row's far right end.
  `{ position: 'left' }` on a row with nothing left of the root puts the panel immediately left of the root; a
  second one lands farther left.
- **Priority.** Within one (panel, side), priorities compare numerically and LOWER is NEARER the anchor, on
  both sides; ties keep the current row order. After every placement the host renumbers each side 0, 1, 2 ...
  from the nearest, so `-1` always means "nearest": `{ position: 'right', priority: -1 }` opens a panel
  immediately right of the root, whatever is already there.
- **Anchored to another panel.** A panel anchored to P sits next to P, before P's other neighbors on that
  side: with [root, A, B], opening C with `{ panel: A, position: 'right' }` gives [root, A, C, B].
  When P closes, every panel anchored to P takes over P's own anchor, so they close up in the place P held.
  An anchor naming a panel that is not in the row, or one that closes a cycle, falls back to
  `{ root, 'right' }` with its own priority -- never a crash, never a lost panel.
- **Placement only, never protection.** `reanchor` never parks or reveals by itself: whether the live panels
  fit depends only on their widths and how many there are, never their order. A panel anchored left of
  The root parks by the same rules as any other -- a capacity drop, for one, parks the leftmost of equally
  wide panels first, and that can be it.
- **The drag contract.** A user drag -- and `PanelsAPI.move`, which the drag calls -- re-derives EVERY panel's
  anchor from the row as it then stands, relative to the root: each panel becomes `{ root, the side it is on,
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
permanent column such as the root (it always stays one slot, like `move`'s own exemption), a panel that is not
`resizable`, or a panel already at the clamped count. A parked panel may change its count and stays parked.
`create({ slots })` opens a panel at a count directly (ignored with `permanent`). The record holds the count only; its size is derived.

Several calls in one handler (resizes, `create`, `activate`) each keep their own panel live the same way.
When they cannot all fit together, the earlier calls keep their room and a later panel parks, as it would had
it come second. A row gesture or a close later in the same handler prices the resize at its new width.

### The fit cap

(Every row is a scrolling strip and caps a panel at the window instead: see "Row numbers".) A panel is never wider than the widest ONE live panel can be beside the fixed columns in
the current window: `max(phone width, row width - 2 x gap - fixed columns - gap)` (`computeMaxLiveWidth`, from the same
budget arithmetic the row's fit count uses), and it is drawn at the whole slots that fit that width. So a wide panel always
fits in the row instead of overflowing it, at every window size. With the root as the only fixed column, a 390 phone and a
16 px gap:

| window width | cap | slots that fit | widest panel drawn |
| --- | --- | --- | --- |
| 1280 (the default) | 842 | 2 | 796 |
| 1920 | 1482 | 3 | 1202 |
| 844 (the window minimum) | 406 | 1 | 390 |

The floor is the phone width: when not even a phone fits beside the fixed columns, a wider panel is just one slot. A
one-slot panel is never capped (the window minimum already fits the root plus one phone). The cap moves with the window, so a
capped panel widens and narrows as the window does; the chosen `slots` is never rewritten. Before the first measurement there is no cap.

Every row is one scrolling strip (the `overflow` setting is removed, owner ruling 2026-11-14), so no fixed column caps a
panel on its own account: `computeRowNumbers` prices it from the window alone. The window is the container less one gap
each side; a panel is as many whole slots as fit it (see "Slot sizing": two slots, 796 of 968, at a container of 1000).
Every drawn entry is laid out, and a strip wider than the window scrolls instead of parking anything. The shell and the
row read that one result, so they cannot disagree: `ProvidedPanels.rowNumbers`.

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
window at that minimum draws a larger phone, and the guarantee breaks (a second fixed column and the root at gap 24 and phone 390 price to 1504
from the 320 px smallest phone; there the fit draws 346 px, and two 346 px slots beside the fixed columns need 1556). What a floor
under `phoneFit` must meet is this: at the reported minimum, with the phone the fit draws there, N phone slots fit beside the fixed
columns and a tablet panel is uncapped. Holding that is the job of the plan that gives a host a floor under `phoneFit`; until it
lands, a host with `phoneFit` on sets no window minimum from this value. A phone width that is not a positive finite number leaves
`PanelsAPI.minWorkspaceWidth` unset, because the function throws on it and a number a host only reads must not take the row down.

### Row numbers

`computeRowNumbers` is the one place a row's widths, resting offsets, margin and strip width are derived. Every row is
a scrolling strip, a row of hand-built 0.1.0 entries included (owner ruling 2026-11-14: such a row may draw at slightly
different widths than 0.1.0 did). The margin is 0 once the strip is wider than the window (the first stop's margin in a
stepping row, see below) and centers the strip otherwise; before the first measurement the window is unbounded and
nothing scrolls. No panel is parked for room: every drawn width is in `reservedWidths`, and `parkLiveWidths` is empty.
A park exit (a host's hide) travels one span from the slot's own rest, not to the row's origin, because the strip
extends far past the window.

#### The live panel cap

`tuning.maxLivePanels` (an integer of 1 or more; `null`, the default, is no cap) limits how many panels keep their
content loaded, never how many are live: every panel keeps its slot on the strip. The panels in view are always loaded;
past them, nearest first, the others within the row's near band load until N are loaded in all (`loadedNear` in
`emblaRow.ts`). It applies to every collapsible panel, whatever built it; a fixed column (the root, a panel with `parkable: false`) and the panel being dragged are always loaded and take nothing from the cap. With no cap a template-built row loads every panel, and only a row of hand-built 0.1.0 entries unloads its far collapsible panels past the near band.

#### Whole-panel stops

In a scrolling row with `rowGesture` `'step'` whose strip is wider than the window, `computeRowNumbers` (called with `wholePanels`) returns `stops`: one rest per step of the one-phone grid, `k * (phone + gap)` from 0 up to the row's end, so a panel of N slots takes N steps to pass. Every rest centers the whole slots it shows, the ends included: half the window's leftover past its whole slots, `((window + gap) mod (phone + gap)) / 2`, sits before the strip (`rowMarginLeft`) and the same after it (`endPad`), so the leftover is split evenly on both sides of the shown whole panels, not around each panel on its own. Flush ends left the whole leftover on the far side of an end rest, where the cut neighbor is hidden, so the row read as off-center there. Every step is then exactly one phone width, and a row of slot-sized panels ends on the grid. A panel that no rest shows whole (one sized off the slot grid) gets a rest at its left edge. The space after the strip is a spacer element, a sibling of the strip inside the scroll container so a drag's end cap still reads the strip's own edge. The element is `endPad` plus the row gap wide on every scrolling row, and the container's right padding is 0 there, because engines disagree on what the scrollable width counts: WebKit leaves a flex item's end margin out, and Firefox an empty box (so the element has no `height: 0`). A non-empty element is counted by all three, whatever each does with padding, and `maxScrollOf` is then the browser's range. A row that does not scroll keeps its padding to center in.
The strip's margin snaps instead of gliding while stops exist, or `scrollWidth` would lag `maxScrollOf`, except in a panel resize: a grow that overflows the window adds its stops in the render that moves the margin, so the margin glides there (a panel's width changed under an unchanged container width, or a width is held), and the settle onto a stop waits for the slide. A window resize keeps the snap. A strip that fits the window keeps its centering and has no stops; an `off` row has none either, so its margin is 0 on overflow.

Padding does not clip scrolled content, so a neighbor of the shown set peeks `m_i` px at each edge, cut by the window
edge. Nothing fades, shrinks or is hidden: the strip carries a `clip-path` at the slot grid's edges (`gridEdgesOf`: the margin on each side), written from the row's numbers and the strip's x on every move, so a whole panel in the grid draws whole, a panel crossing a grid edge in a glide, a slide or the end bump is cut there, and nothing draws in the margins. A strip panel beside a held or stuck panel is cut at that panel's gap by its own clip (`slotCutAt`). Reach is judged from the numbers too, never from a measured box. A slot wholly outside its strip window is `inert` and takes no
pointer events, so Tab and find-in-page cannot scroll the row off a stop; Workspace writes that on scroll events and on every
render. A click or focus in the cut-off neighbor makes the browser scroll, and the row then settles onto the nearest stop that
shows that panel. Steps, `scrollTo`, the initial scroll, a drag released after edge scrolling and the settle after a change of
stops (a resize, a close, a reorder) all land on a stop; `scrollTo` with `align` `'start'` or `'center'` lands on
the nearest stop that shows the panel, not at that alignment.

A change that ends the row left of where it is scrolled (a close that brings the whole row into view, or one that shortens
it) would be clamped by the browser in one jump, in the frame the strip shrinks or the closing slot leaves. So in that commit
the end element keeps the old scroll range, plus whatever of the centering margin is still to glide in, and it gives the
range back on each frame of the settle's glide. A row that fits has one rest, 0, and the settle glides there. When the slots
slid in that change (a close, an open, a reorder) the settle uses the slide's own curve, `slide.ease`:
a panel that both slides and scrolls then moves one way only. Any other glide of the Embla row follows Embla's own physics (0.2.0 removed `slide.glideEase`). With
nothing to glide (reduced motion, or a drag holding the row) the hold is dropped at once.

#### Step stops

`stops` are one rest per step of the one-phone grid, `k * (phone + gap)` from 0. The inner rests move back by the half leftover, and
the last is the row's end (`maxScrollOf`). A step moves to the next rest. That is one phone width between inner rests, and the same
shorter step at either end. A window cut through a wide panel shows the next phone width of it, and a drag release, resize and pin release land on the grid through `snapToStop` and
`nearestStop`. A row that does not scroll has no stops and keeps the old step.

#### Whole panels only

Panels are whole slots, so the window holds a whole number of slots `u = floor((window + gap) / (phone + gap))`. A grid stop shows
the greedy run of whole panels from its point, and the window edge cuts the neighbor in the margin, which is not drawn while the row rests unless it is wider than a phone. There is no other mode:
the Shrink (`'visible'`) and Hide (`'hidden'`) values of `tuning.shrinkOutOfView` are removed, and a row never resizes a panel to fit
the window.

A panel as wide as the window shows alone, and the next stop would start at the panel after it, dropping the wide one at the first step. So whenever a panel follows it, a stop is added after it that slides the panel left. The slide leaves the window ending at the edge of the whole panels that fit beside its right part (at least a phone's width of it stays); when no whole panel fits there, it slides one slot (phone width plus gap), so the panel keeps all but one slot of the window and the next panel's first slot comes in as the cut neighbor. The step after that starts at the next panel.

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
moves and every size box resizes in no time (`tracking` in the slot context), the centering margin is the one the numbers give, which
is unchanged for the whole drag, and calls within one animation frame draw once with the last value. The height is the slots the width
rounds to, so it steps half a slot in, the point the release snaps to, and the panels around it realign on the same frame. `pin` names the
edge that stays still: `'start'` leaves the left edge and the panels before it where they were, so the right edge follows a grabber on the
right; `'end'` shifts the whole strip left by the growth, so the right edge and every panel after it stay where they were and the panels
before make room, which is what a grabber on the left needs, with the row box (and so the scroll extent) as long as before. The release is
`setSlots(nearest)`, then `setDrawnWidth(null)`, then `setResizing(false)`: the first fixes what the panel is, the second lets it
glide from the held width to that one (a snap under Reduce Motion, which also snaps the centering margin), and the third lifts the hold,
so the row settles once onto a stop. When the release moves the centering margin, that settle starts once the margin's slide has ended. Ending the mark, or the panel leaving the row, drops a
width still set.

The settle holds the edge `pin` named. When the mark begins the Workspace reads that panel's rect from the element, after its claim has
stopped any scroll glide, so a centering margin still gliding or a panel drawn shrunk counts as drawn; the numbers can be ahead of it.
The pin is latched while a width is drawn, because the host clears the width before it ends the mark. At the release the row lands on the
stop nearest the scroll that puts the pinned edge back where it was read: the right edge for `'end'` (a grabber on the left), the left edge
for `'start'`, one rule for both. With no width drawn, or a panel that is not in the row, it is the stop nearest the scroll it has, as
before. The target needs numbers that carry the new slot count: when `setSlots` comes before the mark ends, as in the order above, they
already do; when it comes in a later commit the settle waits for the commit in which the panel's width changes, and runs on the next
frame at the latest if none does. The edge comes to rest on a stop, so it is held exactly only where a stop is at that scroll; otherwise it
rests within half the gap between the two stops around it. A row whose panels all fit has no stops and nothing scrolls.

`head` is slots before the always-shown columns. They move the whole row right so the root can reach the center: a step left with nothing parked on that side opens one, parking the rightmost drawn panel when the row has no slot to spare, and stops when another slot would pass the center. A click on the root's dot takes those steps, then a half step when the window has an even count of slots (`head` and `tail` each gain a half). A step right closes them and the panels parked come back. A row whose panels do not return on a step never opens one.

### The root leaves and is summoned

### Sticky panels

A sticky panel takes its slots out of the scrolling row and never moves. The row is read left to right as `[start group][scrolling row][end group]`:
the sticky panels whose `sticky` is `'start'` in row order, the strip Embla moves, then the ones whose `sticky` is `'end'` in row order.
`panels.rowSegments` gives the same reading as data: a `{ kind: 'sticky', panelId, slots, side }` segment per sticky panel, and one
`{ kind: 'scroll', slots, panelIds }` segment for the scrolling row, which is left out only when it has no room and no panel.

- `stickyPlanOf` (`rowNumbers.ts`) decides which sticky panels are in effect, in whole slots. The window holds `floor((window + gap) / (phone + gap))`
  slots, the window being the container less one gap each side. A sticky panel takes as many slots as it is wide. The scrolling row keeps at least
  `tuning.minScrollSlots` slots (default 1), and at least one while any panel is left in it. A panel that is sticky takes its slots whether or not the
  row would overflow, so a row of five slots with one sticky panel is `[sticky | row of 4]`.
- `stickyRank` is an integer, 0 by default, and the higher rank stays sticky longer. While the sticky panels and that minimum do not fit, the panel with
  the lowest `stickyRank` goes back into the scrolling row and is drawn there at its own place; of equal rank, the later panel in the row gives up first. It is sticky again by itself when room returns, and its setting never changes.
  A window of one slot has no sticky panels. With `minScrollSlots` 0 every slot may be sticky and the scrolling window has no width; as soon as a
  panel is not sticky, the lowest-ranked sticky panel goes back so that panel has a one-slot row, and nothing is hidden.
- Nothing about a sticky panel is drawn per frame. `PanelRow` renders `[start group][Embla window][end group]` as flex siblings, a group being a box as wide
  as its panels with a gap between them and one gap before the strip. The strip's clip (`emblaCut`) reaches one gap past the window and so never over
  a group. A sticky slot is therefore never `inert` (`markAwaySlots` reads only the window's slots), never cut, keeps the full phone height, and a row
  scroll cannot move it. The numbers keep `held` (each sticky panel's group, width and offset in the group), `leftInset`, `rightInset` and `stripWindow`;
  the Embla window is sized to the whole slots of `stripWindow`, and a strip that fits makes the window as wide as the strip, so a short row stays centered
  as a whole.
- A panel that turns sticky, or stops being sticky, is drawn again in the other place: the slot leaving and the one arriving take no time
  (`HandoffContext`), and the view is mounted again with its `useViewState` state read back by its key.
- A sticky panel is not draggable, and a drag does not cross it (a drag stops at a sticky neighbour). Tab reads the start group, the strip, then the
  end group. Arrow keys and `stepRow` move the strip only, from anywhere in the row; with focus in a sticky panel they step the strip beside it, and
  `focusEdgePanel` treats a sticky active panel as in view.
- The dot bar has no dot for a sticky panel. `PanelDots.sticky` lists them by side for the app to draw as a small square at that end of the bar, and
  `selectDot(id)` with one of their ids focuses the panel.
- `edgeHold` is the deprecated name. A settings layer, a saved instance layer and a `configure` patch read `edgeHold: 'left'` as `sticky: 'start'` and
  `'right'` as `'end'`; `'both'` (a panel that stuck when scrolled past) no longer exists and reads as `'off'`, all with a development warning. A
  `sticky` in the same layer wins. A resolved value (`getSettings().value`) keeps a read-only `edgeHold` derived from `sticky` (`'start'` reads `'left'`,
  `'end'` reads `'right'`, `'off'` reads `'off'`); it is not enumerable, so it is not part of the value's key set. It is removed before 0.2.0 final
  (the alias policy).

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
a drag holds the claim is dropped with `scroll-dropped-during-drag`. A resize holds the claim too, but its release settles the row
first, so a scroll asked for during that hold is kept (the last one) and runs once the settle has moved the row. A panel created hidden, a restore, a first paint
and an automatic return record nothing.

With `rowGesture` `step` a sideways wheel, Shift+wheel or arrow key asks for a step. (0.2.0 removed `tuning.gestureLockMs` with the old stepper.) **A swipe moves the row as far as it travels** (since 2026-11-08, the owner's "we need scrolling to be a smooth experience"; before, a swipe was one step and its momentum stepped nothing while a glide was in flight, so a wide panel passed one slot per landed glide and the row stood still about 40 percent of the frames of a steady swipe): the first event of a gesture steps at once, and every further `stepPx` (a phone and a gap) of travel in the same direction steps again, while the glide is still in flight too, keeping the remainder. Each such step passes `paceSec`, the time the swipe took to travel it (at most 1.5 s), and the step glides over that time, retargeting a glide in flight with its speed carried, so a steady swipe moves the row at its own pace, about one px per px of travel, through narrow and wide panels alike, and the last step still lands on a stop. A swipe slower than one phone width in the slide's time (about 680 px/s) still lets the first glide land before the second step. Measured in headless Chromium (one event per frame, 12 px each, 5 s): 0.57 px per px of travel with 138 of about 295 frames standing still before, 1.015 with 1 after, on 1-slot, wide and mixed rows alike. The trough rule this paragraph described next is the 0.1.x one; the gate is now the notch rule (`NOTCH_GAP_MS`) and the travel count. A finger drag on the row feeds the same accumulator: a horizontal drag is the wheel's travel with its sign flipped (a finger moving left asks for the step right), and a drag that starts vertical is left to the page for the whole touch. Per gesture the hook keeps the previous magnitude, its sign and a trough (the smallest magnitude seen since the last step, once the deltas have fallen; null until then). An event steps when the lock is over and it is the first of a gesture (nothing before it in `tuning.gestureQuietMs`), or it reverses direction (which also arms the next event, even one that arrives inside the lock), or the trough is set and the event is at least 1.5 times the trough and at least 4 delta units above it, a new swipe starting in the tail (the floor keeps a tail rounded to whole pixels, 1, 1, 2, 1, from stepping). Every step clears the trough. A ramp up, a plateau of equal deltas and jitter in a tail (14, 12, 13, 11) never step again, so a held mouse wheel is one step per gesture and each notch after a quiet gap is a fresh one; where a plateau and a mouse wheel cannot be told apart the swipe wins. The rule reads ratios only, so Firefox's whole-line deltas (`deltaMode` 1) take the same path. `tuning.gestureQuietMs` (150 ms) without a wheel event starts a fresh gesture. On a scrolling row whose strip is
wider than its window the step goes through `gestureTarget`: it shows the nearest hidden panel in the direction when
no live panel lies between the view's edge and its slot (the view is the slot grid, `gridEdgesOf`: a panel in the margin beside it is out of view) (under 'edges', also none beyond the window on that side, the root excepted: a root scrolled off holds no parked panel back), and otherwise scrolls to
the next stop (the next panel start in a row without stops), from the in-flight glide's target. A row with nothing to scroll toward keeps the 0.1.0 swap
(`scrollRow`). The gesture does nothing while a claim is held. A step
that would swap back the other way waits for the last swap to land (`slide.durationSec`): one started over a swap in
flight reverses its enter and exit half-run, and a fast back-and-forth leaves panels growing and shrinking in place.
Swaps the same way take every step as it comes.

The row's own overflow is `overflowY: hidden` for every rowGesture: a vertical wheel over the row or a plain panel does nothing to the row, so it cannot move up off its workspace. A panel's own inner scroller still scrolls, because the wheel reaches it first.

The row owns sideways wheel scrolling wherever the pointer is, over a panel's content too: its wheel listener runs in the capture phase on the row, so it sees a wheel before anything inside a panel, and a sideways wheel it takes is cancelled and stopped there. A panel's own horizontal scroller (a carousel, a wide table) does not take a swipe first; the person holds Option (Alt) at the gesture's first event to give that whole gesture to the content, and the gesture stays the content's until `tuning.gestureQuietMs` passes with no wheel. Once the row has taken a gesture, its vertical wobble is cancelled too, so the content under a swipe does not drift. A vertical wheel is never cancelled. The cost is a non-passive listener: the browser waits on it for every wheel over the row, and it returns at once for a vertical one. Touch is unchanged: a finger has no Option key, so a panel's own horizontal scroller still takes a drag it can move, and the touch listeners stay passive.

Content whose input never reaches the page (an Electron `<webview>`, a cross-origin `<iframe>`) is out of the row's reach, so its own script decides: a capture-phase, non-passive `wheel` listener on its `window`, registered before the page's scripts, that cancels a sideways gesture without Option and passes the deltas to the host, which calls `feedRowWheel(element, deltas)`. That dispatches a bubbling `WheelEvent` on the element, which the row reads like any other; the row never checks `isTrusted`, and `feedRowWheel` is the supported way to rely on that.

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
the row's centering margin, each slot's position and width, the size box, and the
neighbor widths a drag crosses. A view follows the same rule: pass `panel.size` to
`Panel`/`PanelFrame` only for a panel of more than one slot, and omit it for a one-slot one so the device size applies.

### How the resize animates

The row's slot (`PanelRowSlot`) owns the enter/exit animation, so the resize never lives on the slot
itself: Motion's docs warn against `layout` and `exit` on one element. It lives on an inner size box
(`PanelSizeBox`) that the built-in web view renders inside its slot, under its drag box. That box takes its new width and
height once, in the commit, and draws its size easing from the size on screen to the new one, over the same 0.6 s transition
the slots slide with, growing from the left edge because the slot's own `x` already animates position. It is not Motion's
`layout="size"`: that animation starts in the frame after the commit while the slot's slide starts in the commit,
so a commit that janks (the default frame's MUI render does) would draw the box and its neighbor from different
moments. The box starts its glide in the commit's layout effect, and both it and the slot's slide are given that same
commit's time as their `startTime` (`slideStart()`), because Motion otherwise starts a slide from the moment its
keyframes resolve when that is over 40 ms after the commit; so a neighbor of a growing panel stays one gap from it
at any frame rate. It is the panel's own width and the row's own height,
so a `'fill'` view's percentage height resolves inside it. A column that is not collapsible (the root, a
permanent column) never changes its slot count and renders no size box. A third-party view may change its slot count too: its
slot, position and the row's capacity follow, but its content snaps to the new size, since only the built-in
view renders a size box. The row's centering margin glides with the resize even right after a window resize,
when a window-driven margin change would snap.

The drawn size is a Web Animation of the box's real width (and height while that eases), on the row's shared start time, so the
content is laid out at the size it is drawn at on every frame: the frame's 1 px edge, its corners, a glow behind it and the header's
buttons stay on the moving edge, and a cover-fit picture keeps its centre. Two cheaper drawings were tried and given up on the
owner's eye: a `transform: scale()` drew the content stretched until it landed, and a `clip-path` of content laid out at the
larger size cut the frame's edge, corners and glow at the moving edge (a dark band in dark mode) and jumped the picture to its new
framing at the start or end. Easing the real size was first dropped because a phone-model change relays every panel at once; in
the app (pictures, no webviews) seven panels resizing together drew the same frames as the clip did. A height of the slot's own
(`'100%'`) has no number to ease, so only the width eases then. A glide that is cut off part way starts the next from the eased
size on screen.

The size box follows any change of the panel's width, not only a slot-count change. Choosing a different phone
model resizes every panel's size box too, so their width and height glide over the same 0.6 s while
the slots slide to their new positions; the root, which has no size box, takes the new size at once. Every
panel lands exactly on its slots at the new phone size. A window resize that moves the fit cap resizes a capped panel the
same way.

`usePanelSizeGlide()` reports the glide (its
start and end size) from the commit that starts it until it lands, for a host that handles the content itself, such as holding
a page's load back until the size is still. It is state on the box, set in the layout effect that starts the glide, so a
consumer re-renders twice per glide, never per frame. A window that draws no frames does not advance a glide, so a host that
waits on its end also caps the wait.

### How a view reads and changes its own width

A view reads its own count from the `panel` prop it is rendered with: `panel.slots ?? 1`. The field is optional, so a
summary without it is a one-slot panel. `panel.size` is the size the panel is drawn at, already within the fit cap; pass
it to `Panel`/`PanelFrame` for a panel of more than one slot and omit it for a one-slot one (see "The width source").
`panel.maxSlots` and `panel.fitSlots` give the widest count the panel may take and the widest that fits the window now,
so a size control offers counts up to the smaller of the two. A view can offer its own control through
`useHost().panels.setSlots(panel.id, next)`; its slot, its neighbors and the row's capacity follow, while its content
snaps (see above). Keep such a handler to `setSlots` alone: a close in the same handler can leave panels the resize
parked unable to return to the row.

### Slot sizing

An entry that carries `slots` is n whole slots wide. A slot is one phone width, and the row gap sits between
slots, so `n` slots are `n x phone + (n - 1) x gap` wide and every edge lands on the row's stop grid. The count drawn is
`min(slots, maxSlots, fit)`, where `fit = floor((maxLive + gap) / (phone + gap))` and `maxLive` is the window (the
container less one gap each side) or, in a parking row, what is left beside the fixed columns. The choice (`slots`) is
never rewritten to the drawn count, so a window that grows gives the width back. A panel keeps the phone height at any slot count.
A panel's frame is never shrunk to fit; extra chrome (headers, tabs, footers) grows the panel's total height instead, and the
host reserves that room in the page around the row.
The slot-out motion of a closing panel drops by the row height. The root keeps its own size and is centered like the rest.
Unmeasured widths use `UNMEASURED_SLOTS` (3).

At 844, 1280 and 1800 px windows the fit is 2, 3 and 4 slots.

`ALL_SLOTS` (64) is the hard cap: `slots` and `maxSlots` validate as whole numbers from 1 to it, and a consumer may rely on it as the upper bound. `slots` defaults to 1 and `maxSlots` to `ALL_SLOTS`, both plain library defaults. A request for more than
the fit or `maxSlots` is clamped silently. An entry built without `slots` (a hand-built one) is one phone width;
`appendPanel` always writes `slots`, and the settings cascade does too.

`PanelsAPI.setSlots(id, slots)` and the handle verb resize by a count, clamped to `maxSlots` and refused with
`not-resizable` when the panel is not `resizable`. A person's resize is saved as `overrides.slots` and, on the panel, as `slots` when
it is not 1. The root's count is saved as `rootSlots`.

C1 is relaxed for the size settings as a group (`resizable`, `slots`, `maxSlots`): when the
panel's own template, host or instance layer asked a fixed column for any of them, they all stand (the root is resizable
when the app says so); otherwise they are forced to one slot. A workspace
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
The hook also returns the container width and height budget it settled on, and the host hands those, not its live measurement, to
`useProvidePanels` and `Workspace` (`containerWidth`, `heightBudget`). A window resize then changes nothing until the window holds still,
and lands as one slide of the row's place, its vertical place, its capacity and the phone size; the live width would recenter and park at
once and leave the size to follow a settle later.

`fitPhone` (`phoneFit.ts`, pure) takes the window width, the row's height budget (`RowHeightContext`'s value: the container
less its padding), the preferred size, the gap, the edge space (the row gap) and the band `phoneFitMin` to `phoneFitMax`
(0.82 to 1.13, 320 to 441 px on 390, inside the real phone range). With W the window less the edge space each side, N slots
are `floor((W + gap) / N) - gap` px wide each (whole pixels, so the sums compare exactly) and the height follows the width at the preferred
aspect. The height cap is the height budget over the preferred height, never above the band's top. Then, in order:

1. the smallest N whose scale is inside the band and under the cap: the exact fill;
2. else the most slots inside the band at the cap's scale, whole slots with the leftover centered as the row centers it;
3. else the band's minimum wins, with as many slots as fit at it (at least one), and the row scrolls vertically. A phone below the minimum is
   unreadable, and one slot would leave the window empty.

No count ever cuts a panel at rest. Exact fill is not promised where the height cap binds. `rowCount` is a parameter of the function
(each row gets an equal share of the height and all share one scale), not a tuning key: the plan that lays out two rows adds it.

The count follows the window only once width and height have held still for the resize settle (`resizeSettleSlides` slide
durations; at once under the OS Reduce Motion setting, which the mount reads itself because it sits above any `wrap`), so between settle events the previous count and widths hold and a webview is not re-laid out per
frame. A change of count also needs margin: a step to more slots needs that count's scale at least 2 percent above the band's minimum, and a
step back needs the larger phone at least 2 percent under the cap. The panel's size box glides the new size on the slide timing,
as any size change does.

## Unfocused panels rest at one phone

With `tuning.shrinkUnfocused` on, a panel wider than one phone is drawn one phone wide whenever it is not the panel in use.
Two things rest it: another panel becoming active (a press or a focus inside it, the same moment `useActivePanel` changes),
and a press outside every panel, which leaves none active and takes keyboard focus out of the row's panels (the panel rests in
view). A press on the dot bar is not one of them. Moving the row rests nothing: a wide panel keeps its width and slides past the
window's edge (a sticky panel sits outside the window, so nothing is drawn under it), so a wide panel can rest part off screen until the next step. A resting panel keeps the count it goes back to in `savedSlots`, which a view also reads on its `PanelSummary` (a size control shows `savedSlots ?? slots`), and the next press or focus inside it resizes it
back (a press on a button or grab bar of its own header or footer does not: such a control acts on the panel as drawn), with the same capacity rule as `setSlots`, and centers it in the row as near as the ends allow. Any `setSlots` while it rests replaces that count. The workspace file
saves the count it goes back to, never the resting one, so a reload never loses a chosen width, and a launch
restores every wide panel at its saved width, resting none. The rest is a resize from
code, so the person's recorded `overrides.slots` stays as it was. The next activation brings a resting panel back even
after the tuning is turned off, so no panel is left at one phone.

## The first press can be made to only put a panel in use

A template's own `firstPressFocusOnly`, when set, wins over the workspace's `tuning.firstPressFocusOnly` for its panels, so a
host can turn it on for the row and off for one kind of panel (a workspace panel whose lists should act on the first press),
or the reverse. It is a template field, not a setting layer, because it describes the kind of panel and never changes per panel.

By default a press on a panel that is not in use puts it in use and reaches the content in the same press, so a button or
link under it works at once. With `tuning.firstPressFocusOnly` on, a pointer press on a panel that is not in use puts it in use and does nothing else: the control under it gets no mousedown
and no click, a link is not followed, and keyboard focus leaves the panel that was in use. The next press reaches the content. A
press on a button or grab bar of the panel's own header or footer acts at once, as it does for a resting wide panel. The
pointerdown itself still bubbles, because the row, the window and a host read it to learn where a press landed; only a
handler that acts on pointerdown inside the content sees the first press. The release lands on a transparent cover laid over
the slot until the click, which is how a touch's late mouse events and click miss the content too. A frame (`iframe`,
`embed`, `object`) inside a panel not in use takes no pointer, since a press inside one never reaches this document; a wheel
over it scrolls nothing until the panel is in use. A keyboard focus is never swallowed.

## A touch template

`touch: true` on a template is for a panel built for a phone: on a desktop, while that panel is in use and the pointer is
inside it, a mouse drag scrolls the content under it and coasts on release, the scrollbars are hidden and the cursor is a
finger dot. It is declared on the template, not a setting, so every panel of that kind is handled one way and no layer
changes it. Only the content scrolls: the drag never steps the row, which stays the wheel's, the keys' and a real finger's.
The drag is taken after 4 px, under the 6 px every panel, tile and grab-bar drag waits for, and its moves stop at the window,
so none of those drags starts; a press that does not move stays a click. A press on a panel not in use only puts it in use
(see above) when `tuning.firstPressFocusOnly` is on, and touch then begins with the next press. Option (Alt) held at the press, text fields and sliders keep the mouse.
`touch: true` covers the whole panel, header and footer included, so a drag there scrolls nothing and its buttons still
click; `touch: 'content'` takes only the panel's frames, and the header, grab bar and footer keep the mouse's cursor and
drags. One set of window listeners and one stylesheet serve every touch panel, mounted with the first and removed with the last.

## Vertical drag is a template option, off by default

In a row a grab bar drags only sideways, to reorder. `verticalDrag: true` on a template gives its panels' grab bars the
up-and-down drag as well: the drag-down close that `tuning.dragToClose` judges and, for a `DragToClose` given `previewOut`, the
lifted tile. Off, a drag the direction lock would read as vertical moves the box sideways only when it can reorder and not at
all when it cannot, and its release never closes; Delete on the grab bar and the header's close button still close. It is
declared on the template, like `touch`, so every panel of that kind handles the grab bar one way. The templateView provides it
as `PanelVerticalDragContext`, which `DragToClose` reads; a row slot with no template above it (a permanent column, a slot
built by hand) has it off. Outside a row `DragToClose` always drags vertically, since there it is only a drag-down box.

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

## `phonux build`: one command for every device

The build tool is a `bin` in this package rather than a second package, so it versions in lockstep with the library and
an app gets it by installing phonux. It lives in `cli/`, outside `index.ts`, and imports nothing from the library, so no
consumer bundle ever carries it.

**One build per platform.** Apple and Google each ship one app file for phones and tablets, so the list offers devices
but the plan makes one Android job and one iOS job. Picking only iPhone or only iPad sets Xcode's
`TARGETED_DEVICE_FAMILY` on the command line, leaving the project file alone. Android tablets need no different build.

**Checks before work.** Each platform is checked first (Capacitor packages and config, the web script, Java 21 and the
Android SDK, a Mac with Xcode 26). A platform that fails is skipped with plain sentences saying what to install, and the
rest still build; the exit code is non-zero, so a skip is never mistaken for a pass. The check looks inside Android
Studio for its bundled JDK and in each OS's default SDK folder, so a developer who only installed Android Studio needs
nothing else.

**Scheduling.** Jobs form a small graph: the web build first, then Android and iOS (each `cap add` once, `cap sync`, then
Gradle or `xcodebuild`), with desktop alongside from the start. At most one job per two cores runs, capped at three, and
the jobs' rough memory peaks must fit in half the machine's memory, except that one job always runs, so a small machine
builds in sequence. `--jobs` lowers the cap for a machine shared with other work. Each job writes a log under
`.phonux/build/logs/`, and the terminal shows one line per start and finish, because interleaved Gradle and Xcode output
cannot be read.

**Test builds first, release when signed.** With no signing in `package.json` the result is a debug APK and a simulator
app, which need no accounts. With signing the same command makes an AAB through `cap build` and an App Store export
through `xcodebuild archive`. Printed command lines hide keystore passwords.

**Publish slots in later.** Every list entry carries `stage: 'build'`. A publish entry (an app store, Flathub, Snap) will
carry `stage: 'publish'` and name the build it uploads, and becomes a job that depends on that build's job, so the
scheduler needs no change.

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
absolutely positioned (`index * (phoneWidth + GAP)`), and the slot builds its own entrances and exits from the panel's `enterFrom`
and `exitTo` (see "Motion"); from the preset it takes only `transition`. A host that animates rows of its own builds them over the
public `PANEL_TRANSITION`, the same object as `SLOT_TRANSITION`.

## `createDefaultTheme` carries the no-motion rule only, never the brand

The optional default theme ports phonux-app's own no-animation MUI settings (disabled
`transitions.create`, and a CssBaseline reset scoped to `transition`/`animation`, never
`transform`/`opacity`) because a consumer's phonux views run the same slide animations
that rule protects. The reset skips the workspace column's own slide element (`[data-workspace-column] > div`),
whose transition is the one slide that is written as `transition`; `test/default-theme-column-slide.test.ts` holds that line. It deliberately leaves out phonux-app's palette, typography and
per-component style overrides: those are this product's own branding, not something a
third-party consumer should inherit just by taking the default.

## The hierarchy: `Workspace` > `PanelRow` > `Panel` > `View`

A `Workspace` holds one `PanelRow`, a `PanelRow` holds `Panel` slots of one or more phone widths, and each `Panel`
renders one `View` -- the component a developer writes and registers. The `Panel` shell and the `View` registry are
the two levels a View author actually touches.

`PanelRow` and `Workspace` are both phonux components. There is no grid of workspaces in the library: a host that
needs several workspaces holds several `Workspace` values itself.

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
`initialEntries` too (the root column is one, and it is still host code). `entries` is the raw list with
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

`removeWorkspace(target)` takes out a workspace, given its handle or its index, and disposes it. Its saved panels stay in storage, since the
saved list no longer names the workspace; deleting them is the app's job. The one below becomes current, or the one above when the
removed one was last. It returns `false` and changes nothing for the last workspace, an unknown target, a column still reading its saved
list, and a disposed column.

`reorderWorkspace(target, toIndex)` moves a workspace to another index and saves the order. The current workspace stays the same
workspace, so the view does not move; only its index changes. It refuses the same cases as `removeWorkspace` except the last workspace.

**Identity and names.** A workspace has a stable `id`, unrelated to its name. The id is the storage key: `ColumnStorage.workspace(id)`
gives the panel storage of that workspace, so a rename never moves saved panels. An app that already has a workspace adopts it as
the first one with `addWorkspace({ id })` and a `workspace(id)` that returns its existing storage for that id. `addWorkspace` takes
no storage or content of its own: the list saves only ids and names, so a workspace rebuilt from it could not find them, and the column has one content. `Workspace <n>` is
chosen at creation (the smallest number no name in the column uses) and stored, so a later delete or move never renumbers. The rename rules
(`workspaceName.ts`): the name is trimmed and cut to `MAX_WORKSPACE_NAME` (60) characters; a name empty after trimming changes nothing and
the input shows the old name again; Escape discards the draft; two workspaces may share a name. Deleting a workspace is out of scope.

**Switch motion.** Every way of moving the column (the app's key bound to `step`, the neighbor buttons, `scrollTo`, `step`, and a new workspace made current) changes the track's `translateY` with the slide from `resolveWorkspaceTuning(...).slide`. The track snaps instead when Reduce Motion is on, from MotionConfig or from the system query alone, and the regression tests pin each source (`test/workspace-switch-scroll*.test.ts`). A row that moves horizontally inside a workspace is a separate mechanism (`rowScroller.ts`) and is not part of this.

**Saved list.** `ColumnState` is `{ version: 1 | 2, workspaces: [{ id, name }], current, side? }`; `side` and version 2 are explained in "Side by side". It is read once; workspaces code added before it
arrived keep their handle and take the saved name, the saved order wins, and any that the list does not know follow it. A record that
fails the guard reads as nothing saved. Saves run one after another after each change to the list, a name or the current workspace.

**Moving.** The column is moved only by `step`, `scrollTo`, the keys and the two buttons, never by a wheel or trackpad, so it cannot chain
a scroll out of a panel. Its track slides by `translateY` with the workspace slide tuning and snaps under Reduce Motion (the system
setting or an app `MotionConfig`). A button where there is no neighbor reads `labels.newWorkspace` and creates one on that side, then scrolls to it.
`step('down')` at the last workspace does nothing: only a button creates.

**Moving a panel.** `column.movePanel(from, panelId, to)` is the one way a panel changes workspace. A workspace keeps its panels in the row it is drawn into and saves them from there, so the move is made through both rows, not through their storage: the target creates the panel (`CreateRequest.carried` carries its `uid`, title and size) and the source removes it with `EngineOps.release`, which skips the closed-panel log and the undo window because the panel did not close. Both sides are checked before either acts, and the target adds before the source removes, so a failure in between could leave the panel twice and never lose it. The panel lands at the end of the target's row whatever its template's `placeOnAdd` says, because the person chose the workspace, not a place in it; the old row's anchor means nothing in the new one and is not carried, and neither is the person's choice of whether the panel may be parked. A size the person chose is recorded as theirs in the target, as a resize there would. The current workspace never changes: the answer carries the target workspace, its index and the panel's id, so a host that wants to follow calls `scrollTo` on it. Moving a panel code declares at every launch (`addPanel` before the workspace is ready) is allowed only when its `afterClose` is `stay-closed` and it is closable, because only the tombstone keeps it from being declared into the source again; any other would be back at the next launch, so it answers `not-movable`. `useViewState` values live in the `HostProvider` of one workspace's tree and do not move: the view starts again from its `initial`. A workspace keeps its panels in its drawn row, which is why both ends must be drawn and loaded. `hostData` is session data and is built afresh by the target's `defaultHostData`; a parked panel arrives live, as any new panel does. A refusal is an answer, not a throw, as for every operation a person's gesture can reach, and the result type adds `unknown-workspace` and `same-workspace` to `PanelRefusal`. `addWorkspace({ index: 0 })` and `addWorkspace({ index: workspaces.length })` already place a workspace above the first and below the last without moving the current one.

**Who opened whom.** Each entry records the engine id of the panel whose view opened it (`PanelWindow.openedBy`), read publicly as the opener's id in `PanelState.openedBy`. It is stamped once, at create, and only through the `addPanel` of the view's own `useWorkspace()`: the row gives each drawn panel's view its own `ViewWorkspace` (`PanelViewContext.workspaceFor`), so the library knows the caller without asking for it. The host's `addPanel` and a panel declared before the workspace is ready record none, because no view asked; asking for a panel that already exists returns it and leaves its opener alone. A drag, a reorder or an `anchor` change never touches it: order and parentage are separate facts. Every change to the panel list passes through `keepOpeners` (`panelOpener.ts`) in the provider, so a panel that leaves the row by any path (close, eviction, a move) hands the panels it opened to its own opener, and a grandchild never points at a panel that is gone. The file names the opener by its uid, as `anchor.panel` does, and writes it only while the opener is saved too; a file without it restores panels with none. `PanelManager.familyOf(id)` is the panel plus every descendant, in row order.

**Moving a family.** `movePanel(from, id, to, { withFamily: true })` moves `familyOf(id)` with the one existing verb, not a second one: every member is checked by the source (`leaving`) and, as a set, by the target (`arriving`, which counts the members of one template together against its limit), then the target adds them all at the end of its row in their row order and the source releases them all in one `EngineOps.release`, which holds the turn's close token once for the whole set. The answer's `panelIds` lists them. Links inside the family are kept by mapping each member's source engine id to the one it lands under; the top's link to its old opener is cut, so it tops its own family in the target. The undo window and the closed-pages log are untouched, as for a single move. A move never fails for lack of room, because the target makes room as it does for any new panel (its cap parks, and eviction picks the least recently touched); a workspace that still cannot take every panel being moved is never offered as a target, which is what `canMovePanel` (the same checks, nothing moved) is for. So "nothing moves" is a safety net a host should never hit, and when it is hit the message names the member that stood in the way.

**Keys.** The column binds no key: an app binds one to `step` (Option+Up/Down in phonux-app). An app binding an arrow applies the row's guard, `arrowKeyBelongsElsewhere`, which is false for a key that is none of: a handler already took the key (`defaultPrevented`), a modifier is
held, the key repeats or an IME composes, the target or the focused element is an input, textarea, select, contenteditable or an element
with a role that owns the arrows (textbox, searchbox, combobox, listbox, slider, spinbutton, menu, menubar, tablist, tree, grid,
radiogroup, or a separator with `aria-valuenow`, the divider between spaces), the item is pressed under dnd-kit's keyboard drag, a panel is being dragged, or a modal dialog is open. A web view swallows keys, so the buttons are the way out of one.

**Mounted, inert, focus.** Every cell stays mounted, so panels keep their state, and the cells that are not shown are `inert` and
`aria-hidden` (with `sideBySide` off the only shown cell is the current one). When the current cell changes while focus was inside the one left, focus moves to the new cell (`tabIndex -1`), so the arrow keys keep working.

**Vertical budget.** Each cell is as tall as the column. The numbers below are the default bands' (see "Column bands and slots"). The column's `topInset` is clearance for chrome the app draws over the window (0 by default): the controls start below it, and the row's top padding is `topInset` plus `COLUMN_TOP_BAND` (76) plus the row gap (16), 92 px with no inset. Every control is 24 px high, the least pointer target. A panel's header hangs 56 px above its 700 px body, so from the window's top edge down: the button naming the workspace above at 0 to 24 px, the name input at 24 to 48 px, the headers from 48 px, the bodies, then the bottom button 24 px high ending 2 px above the bottom edge (`COLUMN_BOTTOM_BAND` is 26). The phone keeps its height. Measured in Chromium (`phonux-workspace-column-proof`): at 832 px high the headers start at 48, the bodies run 104 to 804 and the bottom button 806 to 830, so nothing overlaps and 832 is the least window height for that. With a `topInset` the least height is the inset plus 830: at 832 with an inset of 32 the input ends at 80 over headers that start at 68. At 1080 the row is centered in the 972 px between its paddings: headers at 172, bodies 228 to 928, bottom button 1054 to 1078. Under 832 the row sits at the top of its padding and the headers climb under the name input; the phone never shrinks for it.

## Column bands and slots

Every cell of a column draws two bands, one between the column's `topInset` and the row and one between the row and the
window's foot (`columnBands.tsx`). A band is an ordered list of named slots (`ColumnSlot`: `id`, `height`, `component`,
`align`), and the column takes its bands once, from `ColumnOptions.bands`; unset, it draws `DEFAULT_COLUMN_BANDS`: the link
to the workspace above and the name input above the row, the link to the workspace below under it. Those three are exported as
components (`NeighbourAboveSlot`, `WorkspaceNameSlot`, `NeighbourBelowSlot`) so an app can wrap one rather than redraw it.

**Changing them.** An app never edits a default. `withSlotChanges(bands, { replace, hide, add, above, below })` returns new
bands: `replace` swaps a slot's component by id (and optionally its height), keeping the old component as `base`, which the
slot receives as its `Default` prop; `hide` takes slots out; `add` puts new ones `before` or `after` an id, or last in their
band; `above` and `below` set a band's `size` and `justify`. The ids are the contract: markup, attribute names and styles
inside a default may change in any release. An id that names no slot is skipped with one console warning per id, never
thrown, so a default renamed upstream leaves an app's change undone instead of breaking the app. A slot that should differ
between workspaces reads `workspace`, `index` or `active` from its props and returns null, or its `Default`, where it does
not apply.

**Room.** A slot's height is declared, not measured, so the room the row keeps is known before anything paints and cannot
move when a slot's content changes. `columnBandRoom(bands)` is each band's `edge` (its distance from its window edge: 0 above,
under the column's `topInset`, and 2 below by default) plus its slots' heights, plus 28 px between the band above and the
row: 76 and 26 for the defaults, which are still `COLUMN_TOP_BAND` and `COLUMN_BOTTOM_BAND`. The library's
own row takes `room.above` as its column top, and a band below taller than the default's adds the difference to the row's
bottom padding and to the phone fit's reserve (`Workspace.bottomPadding`, `usePhoneFit`'s `bottomInset`). An app that draws
its own row reads `columnBandRoom` itself. A band given a `size` (a CSS length such as `var(--row-above)`) spreads its slots
through that height by `justify`; the room is still the slots' sum, the least the band needs.

**Clicks.** A band is laid over the cell and passes pointer events through; only a slot's content box takes them, so a
band's empty width never blocks the row under it. Each band carries `COLUMN_BAND_ATTRIBUTE` and each slot's box
`COLUMN_SLOT_ATTRIBUTE`, set to its id.

## Side by side

A column made with `sideBySide: true` can show several workspaces at once, each a cell of its own with its own row, its own sticky
panels and its own dot bar, in the window's width. Without the option nothing here applies: one cell is shown, `shown` lists the
current workspace alone, and every method below answers `not-enabled`. The arithmetic is `columnSplit.ts` (React-free); the column
handle keeps the saved intent and `WorkspaceColumn` draws the cells and `ColumnDivider`.

**Slots.** The window is counted in whole slots of one phone plus one gap (`phone + gap`, 406 px with the defaults): `max(1, floor((width -
gap) / pitch))`, 6 at 2560 px. A cell is `rowSlots` (the scrolling row, a sticky panel that went back into it included) plus the slots of its
sticky panels in effect, drawn `slots * pitch + gap` wide with the row's own padding, so adjacent cells overlap by one gap and no panel
of either is cut at rest. Slots are priced at the preferred phone width, so `phoneFit: 'fit'` does not change the count. Six slots
divide as 2 spaces of 3, 3 of 2 or 6 of 1; seven spaces do not fit six slots, and `showSide` answers `no-room`.

**The intent and the plan.** The column saves an intent, the shown workspaces left to right with the row slots each was given, and a plan
derived from it and the window width. The plan is recomputed, never saved: narrowing the window changes what is shown, widening it restores
the intent, so a window dragged narrow and back loses nothing. A workspace's sticky panels count in its cell, so a cell's slots can exceed its
saved `rowSlots`.

**Narrowing order.** When the intent and the sticky panels ask for more than the window holds: (1) sticky panels go back into their rows,
lowest `stickyRank` first, of equal rank the later panel, the column read as one row left to right (the rule of `stickyKept` and
`returnsBefore`; no space is favoured by being near the current one), so a sticky panel is given up before any space shrinks; (2) the
sides the person is not in give up row slots, the widest first and of equal width the one farthest from the current space, each down to
its least (`max(1, tuning.minScrollSlots)`); (3) only then the current side gives up row slots, down to its least too; (4) a window too
narrow for every side to keep its least drops the space farthest from the current one, one at a time, and it returns when the window
widens. A split of 4 and 2 with the left side current narrows to 4|1 at five slots and 3|1 at four. A window with slots to spare deals
them out one at a time, to the current space first and then the nearest ones. A single space alone gets every slot and the row's own
rule for its sticky panels. The current workspace is always shown. A cell is exactly its row slots plus its sticky slots, and a cell tells
its row `rowSlots` as the least scrolling room (`RowFloorContext`, internal), so the row works out from its own width the same sticky
panels the column planned and nothing is ever cut.

**The column handle.** `shown` lists `{ workspace, slots, rowSlots }` per cell (a new array only when the plan changes, so it is safe
to read in a render and `subscribe` fires when the window shows something else, not when only pixels moved). `showSide(workspace, { at? })`
shows another workspace: it takes half of the current space's row slots (its own sticky panels counted), is put right of the current space
or at the cell position `at` (0 is left of all), and does not change the current workspace. `hideSide(workspace)` takes a side out of the
window, not out of the column, and gives its slots to the current space. `setSplit(rowSlots[])` sets every cell's row slots at once. These
answer `{ ok: true }` or `{ ok: false, code, message }` and never throw, since a person's gesture reaches them. Codes: `disposed`,
`not-enabled`, `not-ready` (the saved list is still being read), `not-measured` (the window has no width yet), `unknown-workspace`,
`already-shown`, `not-shown`, `current` (the current workspace cannot be hidden), `no-room` (the current space has fewer than two sides' worth
of row slots) and `invalid-split` (wrong count, a side under the least, a non-integer, or more than the window holds; the message names which).
A refused call changes nothing.

**The divider.** Between two adjacent cells is a `role="separator"` that is focusable and reads as a slider: `aria-valuenow` is the left
side's row panels, `aria-valuemin` and `aria-valuemax` the least and most it may have while the right side keeps its least, and `aria-valuetext`
is `labels.splitValue(...)`, such as "Research 2 panels, Trip food 2 panels". Left and Right move it one slot, Home and End to the minimums, a
double click evens the split out, and a pointer drag moves it by whole slots (`Math.round(dx / pitch)` from where the drag began, so a
move of under half a slot changes nothing and the sides never show a partial slot). The divider owns its arrows: the row's key handlers ignore
a key aimed at a separator. Its accessible name is `labels.splitDivider(left, right)`, which names the two spaces it parts ("Resize Research and Trip food"), so two dividers differ, and `aria-controls` names the cell on its left, the pane whose row panels `aria-valuenow` counts. Geometry snaps between whole-slot sizes and never glides, so there is no frame in which a panel is cut and no motion
for Reduce Motion to turn off.

**Keys and focus.** A press or focus inside a cell that is not current makes it the current workspace (`scrollTo`). `focusSide('left' | 'right')`
moves current to the shown space on that side, and returns `false` where there is none. `step('up' | 'down')` moves to the next workspace in
the list that is not shown, from the current one, so it never lands on a space the window already shows. A workspace the window does not show becomes current and keeps its own saved side, so the window plans again around it; the one it replaces keeps its saved side too. One that left for lack of room therefore comes back to its own place when the window widens: saved 2, 2, 2, narrowed to two slots (Space 1 | Space 2), stepped down (Space 2 | Space 3) and widened to six gives three spaces of two again. A workspace with no saved side takes the current one's, and that side is gone (five spaces, saved 2, 2, 2, two slots, step down twice, widen to six: Space 1 | Space 2 | Space 4, with Space 3's side gone). The row's arrow stepping acts only
on the row it belongs to: `keyBelongsToRow` says a key aimed at a cell goes to that cell's row, and a key aimed at the page to the current
workspace's row (the cell marked `data-workspace-active`). Scrolling one row never moves another row or any sticky panel. Cells are never moved in the DOM: they stay in the list's order, keyed, and the geometry puts them on screen, because a node React moves is restarted by the browser (a web view reloads and every scroll position inside it resets), even for a space that stays in view or on a plain window resize. Tab and Shift+Tab are steered instead (`columnTabOrder.ts`), and the column alone decides the order across cells. The stops are, in screen order, each shown cell and the divider after it; a cell the window does not show is inert and never a stop.

**The column never reads what a cell holds.** Inside a cell the browser alone moves focus (and inside the cell's row, the row: `panelRowTabOrder.ts`), so everything the browser stops at is stopped at: the controls of a web component, open or closed, the buttons of an audio or video player, the fields of a date input, editable text, a scroll container. A Tab pressed on anything inside a cell is never cancelled and never moves focus from here. What the column does know exactly is its own elements, and it acts only on those. While several spaces show it renders zero-size sentinels of its own (`data-column-sentinel`): one first and one last in the column (`start`, `end`) and one first and one last in every cell (`cell-start`, `cell-end`). Like the row's, they carry no `aria-hidden` and no role. A column that shows one space renders none and attaches no handler. The rules:

- **Focus reaching a cell's `cell-start` or `cell-end`** by the browser's own step has left that cell: whatever the cell holds, the step after its last stop lands there. It goes on at once to the stop beside the cell on screen. That is a divider, which takes focus itself, so the walk from a cell to the divider costs no press.
- **A Tab on a divider** heads into a cell, which only the browser can enter at the right element. Focus is parked on that cell's near sentinel (`park`: moved there without the sentinel answering) and the key is not cancelled, so the browser's step carries on from the cell's start (Shift+Tab: end) to the cell's first (last) stop, whatever kind of element that is.
- **A Tab on a cell's own element**, where a step or a space leaving the window puts focus, is parked on that cell's `cell-start` the same way and enters the cell; Shift+Tab there goes to the stop on its left, or out of the column.
- **A Tab on a cell's sentinel**, heading out of the cell, goes to the stop beside it. Focus is there when the cell's row parked it: from a panel that is the row's last on screen and not its last in the DOM, the browser's step would go to a later panel, so `steerTab` parks on the cell's end and leaves the key pending for the column. Where that end is no stop (below) no shown space follows in the DOM, and `steerTab` goes on as a row outside a column does.
- **Past the last stop** only the browser can go on, to the page or to its own interface, which no script can focus. With the key still pending, focus is parked on the column's `end` (`start`) and the browser's step leaves from there in the same press. With the step already spent (it is what brought focus to the cell's sentinel), focus rests on the column's `end` (`start`) and the next press leaves. Focus the browser brings to the column's `start` or `end` from outside rests there too, and the next press is parked on the first (last) cell's near sentinel and enters it.

**Where the screen order and the DOM order agree at an end, the sentinels there are no stops.** When the space drawn first is also the first shown cell in the DOM, the browser's own step into and out of the column at that end is already right, so `start` and that cell's `cell-start` get `tabindex=-1`; the same for the last space, `end` and its `cell-end`. Drawn as mounted (the usual case) the column therefore has no stop of its own and costs no press: only the step between two cells is caught, and it goes to the divider. The one press it can cost there follows a frame that is the last stop of the last space, with nothing tabbable after the column: the step out of the frame is spent, so focus rests on the row's own sentinel. The dividers have `tabindex=-1` for the same reason: they follow every cell in the DOM, where the browser's step out of the last space would land on them, and Tab reaches them only through the rules above.

**The cost, where the two orders disagree at an end** (a space placed first, a step that drew a later workspace on the left): one press on the column's zero-size `start` or `end` when Tab comes into the column at that end, and one when it leaves there. The exception is the pending key the row hands over, which leaves in the same press. A sentinel that focus rests on is not drawn and has no name, so for that one press nothing shows where focus is. The alternative is to pick the element to land on from here, which costs no press and lands wrong whenever that element has stops inside it that a script cannot read; an earlier design did, and each kind of content it misread skipped real controls.

**What is still chosen by a script, and can land wrong:** the row's own hand-over between panels (`panelRowTabOrder.ts`), in a column or out of one. It picks a panel's first or last control from light DOM (`a[href]`, `button`, `input` and so on), so entering a panel it does not pick a control inside a shadow root, a player's inner control or a date input's last field, and it treats a panel's last light-DOM control as the panel's last when a neighbor panel follows on screen. Inside a column that shows several spaces the row stands back where it can: from the last panel in the DOM that Tab can be in (first, for Shift+Tab) it leaves the key to the browser, because the column catches the step out of the cell. And when the browser's step into the row lands in the panel reading order starts at, the row keeps the element the browser picked there. A positive `tabindex` follows the browser's document-wide order, as everywhere else on the page.

A sentinel that refuses focus (everything outside an open modal dialog does) leaves the key to the browser. When the page drops focus the column held (a blur; the element named by a `focusout` with no successor), the browser's next Tab still starts from that element but is pressed on the body, so a document keydown listener applies the rules from the remembered element; any focus or pointer press forgets it. Focus that no Tab caused (a click, a script) never lands on a sentinel and is left where it went. Focus a Tab brings into another cell makes that cell current. Focus that sits in a cell the window stops showing goes to the current space's cell. Each cell has its
own dot bar, so a window of two spaces has two bars; the bar of a cell the window does not show stays mounted but inert and hidden from
assistive technology, like the rest of that cell.

**Saved state.** With `sideBySide` the column writes version 2: `{ version: 2, workspaces, current, side: { shown: string[], split: number[] } }`,
the intent in workspace ids and row slots. A column without `sideBySide` writes version 1 as before and ignores `side` when it reads. A version 1
record reads as only the current workspace shown. A `side` that does not read (wrong shape) is ignored and the workspaces beside it
are kept; ids that name a workspace that is gone are dropped, and a `side` that leaves out the current workspace has it added with one row slot.
Removing a workspace gives its side to the one that becomes current, unless another side shows it already.

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
multi-workspace grid: one workspace, one row, a single `{version, panels}` envelope is enough, by design. It does not say where or how the data reaches disk; the host's own choices there are
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
column (the root) is never one of them (see "Permanent columns" below). `id` is read from an older file and never written: it was the panel's counter id, the name another entry's
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
  `undefined`. A panel with no anchor of its own is saved with the one its position in the row implies. `openedBy` names the
  opener as `anchor` names its target, and is written only while that opener is in the row (see "Who opened whom" under the
  workspace column).
- **Never saved -- `hostData`.** The host's own opaque per-panel data, which a host may use for its
  runtime handles (a live web view's id, say). No runtime handle is ever saved, and phonux cannot tell a handle from any other
  value inside the blob, so none of it is saved: `WorkspacePanelState` has no field for it. A restored panel
  gets `defaultHostData()` like a created one, so a host that needs a fresh handle per panel builds it there;
  with no `defaultHostData`, or when it returns `undefined`, the panel has no `hostData` key at all.
- **Never saved -- `size`.** Always recomputed from `slots`, never round-tripped.
- **Read from an older file -- `formFactor`.** A new file never writes `formFactor`. A file that has one, on an entry or in
  `overrides.formFactor`, is still read as a slot count: `phone` is 1, `tablet` 2 and `desktop` `ALL_SLOTS` (64, which the fit
  and `maxSlots` clamp). When an entry or its `overrides` holds both `formFactor` and `slots`, `slots` wins. An
  `overrides.formFactor` that is none of the three is dropped with an `invalid-saved-setting` note (`overrides.formFactor:
  expected phone, tablet or desktop; dropped`); an entry's own such value fails the shape guard like any other malformed field.
- **Never saved -- `collapsible`.** Not an independent stored fact: it is `appendPanel`'s own `!info.permanent`
  derivation, recomputed from the saved `permanent` field on restore rather than round-tripped.
- **Never saved -- `anchoredEnter`.** A creation-time enter-animation hint, defaulted on restore, not a fact
  about the panel worth persisting.
- **Never saved -- the root's own entry.** Host-supplied and reseeded fresh every launch (see "Permanent
  columns" below).

### Ownership and scope

phonux owns the `WorkspaceState`/`WorkspacePanelState` types, the guard `isWorkspaceState`, the pure
`projectWorkspaceState`/`hydrateWorkspaceState` function pair, the restore and save timing, and a small
`WorkspaceStorage` (load/save) contract phonux defines but never puts on the public `Host`/`PanelsAPI` bag. The
three types and the guard `isWorkspaceState` are public, exported from the package entry point so a host can implement
the contract and validate a file it imports; the pair `projectWorkspaceState`/`hydrateWorkspaceState` lives in
`workspaceState.ts` and stays inside the package, because only `useProvidePanels` (through its persistence hook,
`panels/useWorkspacePersistence.ts`) and the tests call it. Keeping a capability
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
size, derived from `slots`) has no second copy, and overwrites `anchor` and `live` from the file. It copies only
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
earlier one is nearer on the right. Restored panels come after the ones already there, so on the right of the root
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
  fixed column is live whatever it says.
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
root column (the root) is never saved, because the host reseeds it fresh every launch. A permanent column is
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
- **A panel restored parked has no picture in the host's list** until it has been live once this session. phonux takes a
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
both ways, so changing the gap never shrinks the handle. The footer has the header's height.

The header and the footer each sit on a solid band (`chromeBandSx`, `chromeBand.ts`): the frame's own surface
(`background.paper`) with its 1 px divider edge, opaque in light and dark. They float over whatever is behind the row (the
app's background, a background picture or ad), so a bare row of words had no contrast it could count on; on the band their
`text.primary` and `text.secondary` read as they do inside the frame. The band is drawn on the header's and footer's own
absolutely placed boxes, so it adds no height to the panel. A caller's `sx` still layers over it.

The footer floats `HEADER_GAP_PX` below the frame, mirroring the header's gap above it, and is `BAR_HEIGHT_PX` (36, `panelChromeSize.ts`) tall, the same constant the header's height reads, in every theme. The row's bottom padding and the phone-fit height budget both use `rowBottomReservePx(gap)` = `max(gap, FOOTER_ROOM_PX)` (`panelChromeSize.ts`, 4 + 36 = 40), so the footer's whole box lies inside the row and a click at its center reaches it. `test/footer-room.test.ts` and `test/phone-fit-reserve.test.ts` pin the chain.

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
the pointer vertically, up and down; in a row only for a template with `verticalDrag: true` (see "Vertical drag is a template option, off by default"). On release `shouldCloseOnRelease` decides: close (the box leaves
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
drag) are Embla's: they follow its own physics, not a tuning curve (0.2.0 removed `slide.glideEase`). The slots' stacking tiers are the exported `ROW_LAYER_Z` (base 1, raised 100, dragged 200), below
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
`reorder`, for a handle that only closes (the root's bar, never a reorder source), only the vertical offset is followed.

**Vertical preview (`previewOut`, `exitFor`).** With `previewOut` set, a vertical drag does not move the box until it passes `PREVIEW_OUT_PX`; past it a tile of the given `width` and `height` is drawn in the body at the pointer and follows it. The box stays in its slot. On release `exitFor(end)` picks the side: `'top'` or `'bottom'` slides the real box out that way and then calls `onClose`; `null` drops the tile and the box stays where it is. A release before the threshold moves nothing. The tile is portalled to the body, because the box is transformed and would make a fixed position relative to it. The horizontal lock and the drag-close rule without `previewOut` are unchanged.

**Live reorder.** While a horizontal drag is held, the box publishes its offset to the row (the slot's `previewReorder`): the
release's own expression, the pointer offset (edge-held) or the drag offset, plus the row's scroll distance, never the drawn
`x`, which `cap` may clamp. The box applies no hop rule itself; `PanelRow` turns the offset into hops with
`reorderStepsForOffset`, keeps `{ id, steps }` as state (a frame that changes no hop count changes no state) and moves each
panel the drop would cross by the DRAGGED panel's width plus the gap, left when dragged right and right when dragged left, as
the `leftOffset` handed to its `PanelRowSlot` only: the row numbers, the rests a parked entry keeps and the order are untouched,
so a refused or no-op drop leaves nothing to undo. The crossed ids and the widths `reorderStepsForOffset` reads come from one
walk (`neighborsAt`), so the preview and the release cannot disagree. Nothing is published for a panel that is not `movable`. The root is no exception: with `movable: true` it publishes like any panel, and the panels it would cross slide aside by its span.
Panels render in the order they first appeared, not in reading order, so a reorder moves no DOM node: a node that React moved would restart what it hosts (a web view reloads). Position on screen comes from `leftOffset` alone. Tab order would then follow the open order, so `PanelRow` handles Tab and Shift+Tab at a panel's last or first tabbable element and hands focus to the drawn neighbor's (`panelRowTabOrder.ts`); inside a panel and past the row's ends the browser's own movement runs. A Tab pressed inside an iframe (a web view) goes to the iframe's own document, so the row sees no keydown; a slot that holds an iframe (or frame, embed, object; watched by a MutationObserver) therefore renders a zero-size `tabindex=0` sentinel first and last, and the browser's step out of the iframe lands on it in this document, where the same hand-over runs (`steerSentinel`). A sentinel carries no `aria-hidden` (a focusable element must not) and no role, and it forwards focus at once, so it rests only at the end of the document, one extra stop before the browser's own chrome. Inside a column showing several spaces the column catches every step out of a cell, so from the last panel in the DOM that Tab can be in `steerTab` does nothing and the browser steps; from any other panel the browser's step would enter a panel later in the DOM that reading order has already passed, so with no row sentinel to park on `steerTab` goes to the next stop after the row; when that is the cell's own sentinel it parks there and cancels nothing, so the column takes the pending step ("Side by side"). With nothing tabbable after the row in the page, in a column or out of one, there is nowhere to send the step and no sentinel to park on, so `steerTab` parks on the row's last tabbable element in the DOM (Shift+Tab: first), from where the browser's step leaves the page. The cost is that this element, in another panel, takes focus and loses it within the one press, so its focus and blur handlers run. Left to the browser, the step would go to the panel later in the DOM, whose hand-over sends focus back, and Tab would go round between the two for good. A press with focus resting on a panel's far sentinel, where a step out of a frame found nowhere to go on to, leaves the row by the same rules as a press on the panel's last element. A panel's last or first tabbable element is one the browser would stop at: not disabled, not inert, with a box, not `visibility: hidden`, and not kept unrendered by a closed `details` or by `content-visibility: hidden`, which leave an element its box (`checkVisibility` tells). Taking such an element for a panel's last stop would leave the real last stop without its hand-over, and the panel drawn next would be passed by. A hand-over cancels the key only when its target took focus: one that refuses (everything outside an open modal dialog does) leaves the key to the browser. Slots without a frame render none. Focus arriving from outside the row is redirected to the first (Shift+Tab: last) tabbable element in reading order only when a Tab key press caused it (recorded by a capturing document keydown listener, so a first Tab from the page or browser chrome counts too); focus from a click or a script is left where it went. One entry is not reordered: when the Tab comes from browser chrome into a row whose DOM-first (Shift+Tab: DOM-last) panel holds a frame, Chromium reports no source element, which looks the same as a step out of an iframe, so focus stays in the panel the browser chose.
The dragged slot is drawn at `zIndex` 3 from the first publish until the spring home ends (the box publishes `null` there, when
a press stops the spring, on a revive and under reduced motion at the release). The release publishes offset 0 (no hops) after
`reorder.onDragEnd` returns, so the host's `move` calls and the cleared preview land in one React batch and the neighbors
already rest where the new order puts them. This holds for a host that applies `move` synchronously (a
`handle.move(steps)` from a row's view, or a raw `move` loop); a host that applies it later sees the neighbors slide back and forward
once. A host with a different hop rule gets a preview that does not match its drop.
Under Reduce Motion (the system setting, which the drag box reads itself, or the app's `MotionConfig`) the slot hands Motion an instant
transition inside its animate target for as long as a preview is set, so the neighbors' shifts, their return and the dragged slot's move to
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
read again every frame. Where the row cannot scroll further toward the band (a row that fits its window has a bound of 0),
the band swaps instead: every `slide.durationSec` the pointer stays in it, the nearest hidden panel on that side comes in
by the scroll gesture's swap (`scrollRow`), with the dragged panel kept live. The box rides
its slot's own travel on screen, not the scroll distance alone, so a swap that moves the slot leaves the box under the
pointer and the release counts hops from where the box is. A root that is not `crossable` and starts the strip is a wall:
the box stops at its right edge plus the gap, and the left band ends there rather than at the window's edge.

**Alternatives to the gesture.** WCAG 2.5.7 asks for a single-pointer alternative: offer a button that calls
the same `onClose`, as a host's own close buttons do. The row's drag-to-reorder needs one too; `handle.move(1)` and `handle.move(-1)`
exist for it, but no such control is built.

## A drag that starts outside the row: `usePanelRowDrop`

A tile in a view (a workspace list's tile) drags a panel into the row with `usePanelRowDrop()`: `begin(id, source)`, `update(clientX)`,
`end()` and `cancel()`. PanelRow provides the controller through a context, so the hook works in any view the row renders and answers
false, doing nothing, outside one.

**One hop rule.** The header drag and this drag count hops through the same `stepsFor(entry, offset)` in PanelRow
(`reorderStepsForOffset` over `neighborsAt`), and part the row through the same `partShifts`, so for the same offset the neighbors
sit in the same places. The offset counts from the center of the panel's slot, or, for a panel that is not in view, from the center of the
gap it would hold at its place in the array. The preview is state in PanelRow; the order changes only at the drop.

**A panel in view** is drawn at the slot its hops end in, the crossed neighbors slide aside by its span, and `end()` is one `move`. **A parked or
hidden panel** is not in the row, so the row holds a gap its own width (`dropParts`): every present panel after its place in the array moves right
by the span and the ones the drag crossed take that back. The gap is a transient element carrying `data-panel-row-drop-gap`, not a public contract.
`end()` lands it with `landPanelIn`, an internal verb of the workspace core: place and show are two gated verbs that answer `busy` to each other
in one turn, so one gated engine op (`land`) does both in one update. A live panel handed to it is only placed.

**Refusals.** `begin` refuses an unknown, closed or pending panel, the root, a second drag while one runs, and a panel whose `movable` is false when
the source is `'person'` (the default; `'code'` is not limited by `movable`, as the handle verbs are not). A panel that is not `crossable` stops the
walk.

**Edge scroll.** The drag takes the row scroller's claim at `begin` and runs the same frame (`stepEdgeHold`, with `edgeScrollSpeed` and
`edgeScrollStep`) that `DragToClose` runs; the two share `panelRowDropScroll.ts`. The hop count is read again every frame, because the row scrolls
under a pointer that has not moved. The claim goes back at `end`, `cancel` and when the row unmounts.

## PanelFrame's inset, scrollbar and header

Every view renders inside `PanelFrame` so each section reads as one phone silhouette; a view that grew its
own border/radius/background declarations would drift from the others. The frame is the phone's size unless
`size` or `expanded` says otherwise: a slot never grows to fill space.

**The view owns its content.** `PanelFrame` applies no padding, scrollbar or scroll behavior to what it holds, and the
library exports no look value for it: no inset, no scrollbar width, no scroller recipe. Its inner box is a
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

**The header.** `PanelHeader` floats above the frame (it needs a `position: relative` parent) with no background, border or shadow: the title and header buttons sit on the panel's own surroundings, and their color is the theme's `text.primary`, so a light theme reads and the dark default stays white. Its height is `BAR_HEIGHT_PX` (36) in every theme, fixed, so wrapping content never changes it. Its horizontal padding is 13px (the 1px edge plus the 12px inset the frame used to give content), so header
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
fragments with no wrapper element. Hoisting matters because a view's own box is the wrong place: the root's
column is a `zIndex: 2` stacking context (capped under the 1400 drag strip), and every live panel sits inside
a transformed slot, which re-anchors `position: fixed` to itself.

The layer adds no wrapper, so it cannot enforce the contract the CONTENT must keep:

1. Its root element is `position: fixed` and sets its own zIndex from `OVERLAY_Z`. A non-fixed root would
   become a flex item of the row and mis-center it.
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
(a host's own button over a view) and is meant to be clipped to it.

## Snapshots: a picture is data, capturing one is not

`snapshots.ts` splits a view's picture into two surfaces on purpose. `ViewId` (a panel's id, or a host's fixed
name for a column of its own), `ViewSnapshot` (`src`/`width`/`height`/`extent`/`capturedAt`/`stale`) and
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

`CaptureTrigger` -- what `useProvidePanels` calls at a park, a close or just before a panel slides, to (re)capture a
view's picture or to drop it -- is declared in `snapshots.ts`, beside `CaptureRegistry`. phonux only says WHEN. A provider with no `capture`
input uses `noopCaptureTrigger`, so phonux never captures by itself; a host that wants real pictures passes its own
trigger. A panel is captured at a park, at a close and at the start of each slide, while the picture still shows
the rest it had. The slide capture fires only under the library's fixed snapshot policy `'both'`, the one that asks for pictures at a slide. The two eviction paths differ in timing: `clearAll` evicts every dropped panel's picture at once, because
a dropped panel can never be shown again; and a closed panel's picture waits for its undo window (Undo keeps it;
the window's natural elapse evicts it). A capture already in flight cannot outlive an evict: the store keeps a generation per view id, bumped by each
evict, and a capture that finishes under an older generation drops its picture instead of storing it. So a panel
parked and then cleared within one engine call ends with no picture.

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

Every behavior that can differ between panels is a named setting. Each setting is three things that must agree: a
descriptor in `PANEL_SETTINGS_CATALOG` (exported data), a library default in `LIBRARY_PANEL_DEFAULTS` or
`LIBRARY_TUNING_DEFAULTS`, and a check in `resolvePanelSettings`, the one pure function that interprets a settings
layer (internal: it is not exported from the package). The library picks no policy: each default reproduces what 0.1.0 did, except the few the table words
otherwise. A test (`test/panel-settings-catalog.test.ts`) holds the descriptors, the defaults and the table below
equal, so a changed default is a one-value edit in the constant and in its table row, and the test fails until both
are done.

A setting enters the catalog only when a consumer sets it or a handle, ViewPatch or PanelsAPI verb reads it; the
next section lists who. A behavior nobody varies is a constant in the code, not a setting, so the 1.0 freeze
covers only what a panel author can use.

### Who reads each setting

Set by the reference app: `title`, `multiple`, `hostCreatable`, `restoreVisibility`, `startVisibility`,
`showWhenClosed`, `placeOnAdd`, `listed`, `layer`, `slots`, `resizable`, `movable`,
`crossable`, `closable`, `headerButtons`, `hollowDot`, `enterFrom` and `exitTo`. The second known consumer is not
in this repository, so only these are proven in use. `sticky`, `stickyRank` and `tuning.minScrollSlots` are read by the row itself; no app sets them yet.

Read by a verb or a view patch: `parkable`, `slots`, `maxSlots`, `movable`, `crossable`,
`startVisibility`, `placeOnAdd`, `placeOnShow`, `scrollOnOpen`, `showWhenClosed`,
`toggleWhenClosed`, `afterClose`, `enterFrom`, `clearable` (`clearAll`) and `maxInstances` (`configureTemplate`).

### The capability flags limit a person's gestures

`closable`, `movable` and `resizable` say what a person may do by gesture: the drag-down close (under `verticalDrag`) and the close button,
the reorder drag and a drop at a placement, the resize grabbers. They never limit the developer's own calls. Every
engine operation knows its source (`'person'` from a gesture, `'code'` otherwise, see `PanelOpSource`) and checks the
flag only for `'person'`, answering `not-closable`, `not-movable` or `not-resizable`; `close()`, `move()`, `place()`
and `setSlots()` from code succeed whatever the flags say. What stays enforced for code is
structure, not these flags: the root cannot be closed (`not-closable`) and cannot be anchored to itself, so `place()`
on it answers `root-fixed` (whatever its `movable` says, so it is not `not-movable`); `move()` reorders the root like any panel (it re-anchors the panels
around it, never the root), whatever its `movable` says, and `movable` on the root gates only the person's drag.
`maxSlots` clamps every slot count, `crossable` still bars a hop across a neighbor, and `parkable: false` still
refuses `hide()`. `movePanel`, `reanchorPanel` and `setSlots` (the pure functions) read none of the three flags.
`usePanelCapabilities().closable` is also false for an always-shown column (`collapsible: false`), since the row's
close gesture is never offered for one; it is the one place a view reads whether a close is offered.

### Layers and the cascade

Lowest to highest: library defaults, workspace defaults, template, host (what a view asked for in a Host-bag
`create`), instance, and the person's own overrides. The last defined value wins field by field and `undefined`
never overrides. `placeOnAdd` and `placeOnShow` are replaced whole; `tuning` merges per leaf and member; `headerButtons` merges per slot id (a
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
| C1 | `parkable: false` (a fixed column) | `resizable: false`, `slots: 1`, `maxSlots: 1` (all three stand when the panel's own template, host or instance asked for any of them), `startVisibility: 'live'`, `restoreVisibility: 'live'` |
| C2 | `closable: false` | `clearable: false` |
| C4 | `slots` above `maxSlots` | `slots` is `maxSlots` |
| C5 | the root | `parkable: false`, `closable: false` (`movable` is not forced: it follows the fixed column to `false` until a layer sets it) |

The root's rule runs first because it feeds C1 and C2. A conflict is recorded only when a template, host or instance
layer asked for a value a rule overrides; the same collision caused by the library or the workspace defaults is
overridden silently, with source `forced`. A conflict carries `key`, `layer`, `kind`, `asked`, `applied` and
`message`, plus `rule` and `forcedBy` when the kind is `forced`. Two more kinds exist: `wrong-scope` (a template-scope
key or a workspace-only tuning key at the instance or host layer, ignored) and `not-view-settable` (a key a view may
not set, at the host layer, ignored).

Notes never throw: `override-dropped` when the person's fixed column would be wider than one slot, `max-instances-moot` when `configureTemplate` names `maxInstances`
on a template that resolves to `multiple: false`, `hold-unlisted` when a hold lands on an unlisted panel (a hide, or a
panel added or restored parked; through `onNote`, once per panel) and when a `configure` call leaves a held panel
unlisted (`{ listed: false }`, or a `null` that restores an unlisted derived value, also while a flip of `parkable`
waits; in `ConfigureResult.notes` and through `onNote`, once per call; none when
the same call shows the panel or is refused), and `invalid-saved-setting` for each key a lenient resolve dropped.

### Who may set what

The `doors` of a descriptor name the configure call that accepts the key: `instance` (`configure(id)`), `template`
(`configureTemplate`: `hostCreatable`, `multiple`, `maxInstances`) and `tuning` (`configureTuning`). These tuning
leaves are workspace-only (`rowGap`, `saveQuietMs`, `gestureQuietMs`, `resizeSettleSlides`, `rowGesture`,
`initialScroll`, `maxLivePanels`, `chrome`, `phoneFit`, `phoneFitMin`, `phoneFitMax`); these are per panel and also workspace-wide (`dragToClose`, `slide`, `hopFraction`, `edgeScroll`).
A workspace-only leaf at the template layer throws, at the instance or host layer it is a `wrong-scope` conflict, and
any tuning key in the workspace defaults throws. A view's own door, the host layer, accepts only `title`, `listed`,
`layer`, `slots`, `closable: false`, `placeOnAdd: { anchor }` and `enterFrom: 'anchor'`. A view can lock its own panel at any time and
remove the lock with `null`, but never set `closable: true`; the root still answers `settings-conflict` to `closable: true` through the instance door.

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

A `configure` of `parkable` on a panel that is not live is refused: `would-reshape-row` for a parked or hidden panel, `is-closed` for a closed one.

### Restore reads leniently

A saved file may hold settings an older or newer build wrote, the removed `pinning` and `pinningWhenNotLive` among them. With `lenient`, the instance and user layers drop an
invalid or unknown key with an `invalid-saved-setting` note and keep the rest; the workspace and template layers are the
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
default and class word with the descriptor. The class word opens the on_configure cell: NOW (a button, a host's list row,
a z-index or the row's price changes at that commit), NEXT (stored, read by the next event that uses it), STATE (a
flip with a transition rule of its own) or SCOPE (a template-scope key).

<!-- catalog:start -->
| Setting | Values | Default | On configure |
| --- | --- | --- | --- |
| `closable` | true, false | true (root: false) | NOW. L, T: true->false removes the drag-down close and makes a person's close answer not-closable at this commit (close() from code still works); clearable re-derives false; a DragToClose release already decided re-checks at its animation end and snaps back. false->true restores them. A view may set false or null on its own panel at any time. K, H: The root row only. Root: closable:true is settings-conflict; explicit clearable:true beside closable:false is settings-conflict. |
| `parkable` | true, false | true | STATE. L, T: true->false needs a panel of one slot (slots-above-max) and no conflicting explicit value (settings-conflict); listed, movable, clearable re-derive false at this commit unless named; the row re-prices and the reconcile settles it (two commits). false->true lifts C1. K, H: would-reshape-row. C, U: is-closed. A person's overrides.parkable outvotes the flip (shadowed). |
| `movable` | true, false | derived: parkable | NOW. L, T: true->false removes the reorder grab and makes a person's move or placement answer not-movable from this commit; a drag in flight ends with no hops; move() and place() from code are not limited. K, H: stored. Root: false until a layer sets true, which is accepted and gates only the person's drag; move() from code reorders the root whatever it says, and place() on it answers root-fixed. |
| `crossable` | true, false | true | NOW. L, T: the next drag of any other panel sees it at once; a drag already released is judged by movePanel (changed:false). K, H: a non-crossable parked panel is a barrier for the next drag too. |
| `resizable` | true, false | true | NOW. L, T, K, H: true->false removes the resize grabbers and makes a person's resize answer not-resizable (setSlots() from code still resizes, within maxSlots); the size and the person's saved size are never changed or dropped by this call. C1: forced false on a fixed column unless the panel's own layers asked for a size. |
| `slots` | integer >= 1 | 1 | NEXT. The panel is that many phone widths wide with the row gap between them, drawn at no more than `maxSlots` and no more than fit the window; the next layout pass draws it. A person's drag-resize writes it, and it is saved with the workspace. Above `maxSlots` it is forced down to `maxSlots`. |
| `maxSlots` | integer >= 1 | every visible slot | STATE. L, T, K, H: lowering below the panel's current slots needs the panel to be narrower first (slots-above-max); raising lets the panel be resized wider. C1: a fixed column is one slot. A host-set `resizable` with `maxSlots` 1 is kept and noted (resizable-capped). |
| `clearable` | true, false | derived: parkable and closable | NEXT. Read by the next clearAll. C2: clearable:true with closable:false is settings-conflict; null re-derives it. |
| `hostCreatable` | true, false (template scope) | true | SCOPE (configureTemplate). Applies to the next Host-bag create naming the template; existing instances and code addPanel are untouched. configure(panelId) and configureTuning answer wrong-scope; an unknown template throws. Before ready: not-ready. |
| `hollowDot` | true, false (template scope) | false | SCOPE (configureTemplate). The dot bar draws this panel's dot hollow; the library reads the flag, never the panel's name. Applies to the next render of the dot bar. configure(panelId) and configureTuning answer wrong-scope. |
| `multiple` | true, false (template scope) | false | SCOPE (configureTemplate). false->true: ok. true->false: ok only if every existing instance (row, declared closed records, undo-window records) is the singleton whose id equals the template id, else instance-limit with the count; nothing is closed or renamed. |
| `maxInstances` | integer >= 1, unlimited (template scope) | unlimited | SCOPE (configureTemplate). Raising it or null: ok. Lowering below the instances that exist: instance-limit with the count; no instance is closed. Moot without multiple (a note). |
| `listed` | true, false | derived: parkable | NOW. L, T, K, H: the panel appears in or leaves panelList at this commit; its slot and state do not change. false on a hidden panel whose hold the gesture cannot release leaves it showable by code only (note). |
| `startVisibility` | live, parked | live | NEXT. Governs panels created after the commit; every existing panel keeps its state. C: used by the next open(). C1: parked on a fixed column is settings-conflict. |
| `sticky` | off, start, end | off | NOW. L, T: the panel takes its slots at the start (`start`) or the end (`end`) of the row at this commit, and the row re-prices; `off` puts it back in the scrolling row. The window gives it back to the scrolling row on its own while the sticky panels and `tuning.minScrollSlots` do not all fit, lowest `stickyRank` first; the setting is not changed. K, H: stored, and read at the next render. Nothing scrolls at configure. `edgeHold` is the deprecated name. See "Sticky panels". |
| `stickyRank` | integer | 0 | NOW. L, T: read at this commit, when the window next has to choose which sticky panel goes back into the scrolling row (the lowest rank first; of equal rank, the later one in the row). K, H: stored, and read at the next render. |
| `scrollOnOpen` | into-view, start, center, none | into-view | NEXT. Read by the next open, show or click of this panel. L, T, K, H: stored. No scroll happens at configure. Use handle.scrollTo() to scroll now (its align defaults to this setting, 'into-view' when it is none). |
| `scrollOnMove` | follow, none | follow | NEXT. Read by the next move, place, setSlots or resetLayout of this panel. L, T, K, H: stored. Nothing scrolls at configure. |
| `toggleWhenClosed` | ignore, reopen | ignore | NEXT. Read by the next toggleVisibility() on a closed declared panel. C, U: the record's value is used by the next toggle. |
| `showWhenClosed` | refuse, reopen | refuse | NEXT. Read by the next show() on a closed declared panel. C, U: the record's value is used. |
| `placeOnAdd` | row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor} | row-end | NEXT. Read by the next add of this panel and by resetLayout; no live, parked or hidden panel moves (use place()). in-place throws invalid-settings; a missing target uses placeFallback. |
| `placeOnShow` | the same plus in-place | in-place | NEXT. Read by the next show. K, H: configure does not re-place or reveal. |
| `layer` | base, raised | base | NOW. L, T: the z-index changes at this commit; a slot mid-exit keeps the one it left with. Row order and widths do not change. |
| `enterFrom` | auto, left, right, anchor, top, bottom, fade, expand | auto | NEXT. Read at the next enter; a slide in progress keeps its start side, and an entrance in progress keeps its style. |
| `exitTo` | auto, left, right, top, bottom, fade, shrink | auto | NEXT. Read at the next park or close; an exit in progress keeps its style. |
| `title` | string | none ('Panel N' for the bag) | NOW. L, T, K, H: the summary title changes at this commit (header pill, a host's list row); the closed-pages log entry keeps the old title. U: undo rebuilds with it. null restores the cascade value. |
| `headerButtons` | object: slot id (1-32 chars a-z0-9-) to HeaderButton or false; HeaderButton = { icon?, label, onClick, side?, order?, pressed?, description?, tooltip?, disabled?, hidden?, sx? } (section 6); with icon the label is the accessible name, without it the label is the text drawn | {} (no button drawn) | NOW. L, T: a slot appears, changes or disappears at this commit; a focused button that leaves moves focus to the header row; a press already dispatched completes. K, H: stored, first drawn when it returns. null deletes the instance entry; false removes the slot. |
| `restoreVisibility` | saved, live, parked | saved | NEXT. Read only at the next launch's restore. C1: anything but live on a fixed column is settings-conflict. |
| `afterClose` | stay-closed, return-next-launch | stay-closed | NEXT. Read when the panel next leaves the list. An existing tombstone is neither added nor removed by the flip. |
| `tuning.rowGap` | integer px 0 to 200 (workspace only) | 16 (GAP) | NOW (configureTuning only). The whole row re-prices at this commit; in park mode a smaller capacity parks the fewest park panels through the reconcile effect; a scrolling row only re-prices and clamps scrollLeft. Slides in progress retarget. Unmeasured: stored. Busy while any panel has a token. Outside 0-200 throws. |
| `tuning.rowTop` | integer px 0 to 400, or null (workspace only) | null (the default room) | NOW (configureTuning only). The room above the row, which the mount uses for the row's top padding and the phone fit alike; taken as given, so a value under 40 px (a panel header and its gap) can push headers off the top of the screen. Null keeps the default room, never less than 40 px. Outside 0-400 throws. |
| `tuning.phoneHeight` | 'fit', 'auto' (workspace only) | 'fit' | NOW (configureTuning only). Under `phoneFit: 'fit'`, 'auto' makes the frame as tall as the row's room and the width still fits. Other values throw. |
| `tuning.dragToClose` | object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50 (workspace only) | 0.25, 80, 40, 700, -300 (DRAG_CLOSE) | NEXT (configureTuning only). Judges only panels whose template sets `verticalDrag: true`. Read at the next release; a drag in flight is judged by the values current at release. Leaves merge. The direction lock, rest time, velocity window and snap-back spring are constants in rowConstants.ts. |
| `tuning.slide` | object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5], closeExitEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers) (workspace only) | 0.6, [0.4, 0, 0.2, 1], 0.18, 'easeIn' (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds, CLOSE_EXIT_EASE) | NEXT (configureTuning only). Read at the next enter, exit, close or scroll; animations running keep their timing. The edge-scroll drag settle and a header dot click glide along `glideEase`. |
| `tuning.hopFraction` | number in (0, 1] (workspace only) | 0.5 | NEXT (configureTuning only). Read by the dragged panel's view at its next release. Outside (0, 1] throws. |
| `tuning.edgeScroll` | object: zonePx integer [8, 200], maxPxPerSec integer [100, 5000], reducedStepMs integer [100, 5000] (workspace only) | 48, 900, 500 (the numbers live in rowConstants.ts) | NEXT (configureTuning only). Read at the next drag start; a drag in flight keeps its numbers. Leaves merge. |
| `tuning.saveQuietMs` | integer ms >= 0 (workspace only) | 500 | NEXT (configureTuning only). A timer already armed keeps its deadline; the next arm uses the new value. Session-only. |
| `tuning.gestureQuietMs` | integer ms >= 1 (workspace only) | 150 | NEXT (configureTuning only). A quiet timer already running keeps its length; the next wheel event arms the new one. Session-only. |
| `tuning.resizeSettleSlides` | number [0, 10], multiplies slide.durationSec (workspace only) | 1/3 | NOW (configureTuning only). 0 settles at once. A settle timer already running keeps its length; the next width change arms the new one. Session-only. |
| `tuning.rowGesture` | step, off (workspace only) | step | NEXT (configureTuning only). The listener set is re-read at the next render; a gesture in flight finishes; no panel moves. Session-only. |
| `tuning.fastScroll` | coalesce, jump (workspace only) | coalesce | NEXT (configureTuning only). Read at the next step or dot; a glide in flight finishes; no panel moves. Session-only. |
| `tuning.initialScroll` | start, end, root, { panel: PanelId } (workspace only) | start (the library default) | NEXT (configureTuning only). Read at the next mount; nothing scrolls now. Session-only. |
| `tuning.chrome` | object: where 'outside' or 'inside', mode 'always' or 'hover-or-active', fadeMs integer [0, 10000], fadeEase ('easeIn', 'easeOut', 'easeInOut', 'linear' or four numbers, x1 and x2 in [0,1]), fitVisibleMaxSlots integer [1, 64] (workspace only) | always, 120, easeOut, outside, 2 (CHROME) | NOW (configureTuning only). `fitVisibleMaxSlots` lays the header and footer of a panel 2 to that many slots wide across the part the window shows while its edge cuts the panel, never narrower than one phone; the frame is untouched. `inside` draws pills in the frame, which `mode` governs as outside and a scroll down also slides away. A member patch keeps the other members. The chrome shows or hides at this commit; a fade in progress retargets. `easeOut` is the curve Motion applies to a fade given only a duration, measured in Chromium. The header gap, grab handle, header inset and footer padding are constants in rowConstants.ts; a developer restyles them through the `sx` of `PanelFrame` or `PanelFooter`. Session-only. |
| `tuning.maxLivePanels` | integer >= 1, or null for no cap (workspace only) | null (no cap) | NOW (configureTuning only). A lower value unloads the far panels past the cap at this commit (none parks); a higher one or null loads them again. Unmeasured: applies. Outside integers of 1 or more throws; null removes the cap. Session-only. |
| `tuning.phoneFit` | off, fit (workspace only) | off (PHONE_FIT) | NOW (configureTuning only). Whether the default mount fits the phone size to the window; see "Phone fit". Other values throw. |
| `tuning.phoneFitMin` | number above 0 and up to 1 (workspace only) | 0.82 (PHONE_FIT_MIN) | NOW (configureTuning only). The smallest scale of the preferred phone size the fit gives; see "Phone fit". Other values throw. |
| `tuning.phoneFitMax` | number from 1 to 4 (workspace only) | 1.13 (PHONE_FIT_MAX) | NOW (configureTuning only). The largest scale of the preferred phone size the fit gives; see "Phone fit". Other values throw. |
| `tuning.defaultEnterFrom` | auto, left, right, anchor, top, bottom, fade, expand (workspace only) | expand | NEXT (configureTuning only). Read at each panel's next enter; an entrance in progress keeps its style. |
| `tuning.defaultExitTo` | auto, left, right, top, bottom, fade, shrink (workspace only) | shrink | NEXT (configureTuning only). Read at each panel's next park or close; an exit in progress keeps its style. |
| `tuning.shrinkUnfocused` | boolean (workspace only) | false | NEXT (configureTuning only). Read at the next activation or row scroll; a panel already at one phone keeps the width it goes back to. See "Unfocused panels rest at one phone". |
| `tuning.firstPressFocusOnly` | boolean (workspace only) | false | NEXT (configureTuning only). Read at the next press on a panel not in use. See "The first press can be made to only put a panel in use". |
| `tuning.minScrollSlots` | integer of at least 0 (workspace only) | 1 | NOW (configureTuning only). The fewest slots the scrolling row keeps beside the sticky panels; the next layout pass gives sticky panels back to the scrolling row until it has them. 0 lets every slot be sticky. See "Sticky panels". |
<!-- catalog:end -->

## Panel boxes are reported, never drawn over

A native view a host draws over a panel (an Electron WebContentsView, a Capacitor webview) needs the panel's box
while it moves. phonux reports boxes and owns no native view; `PanelsInput.onPanelRect` is the one channel out.

Each `PanelRowSlot` runs its own frame loop (`createRectReporter` in `panelChrome.ts`) only while its slot is moving:
its own slide (Motion's start and completion, `onAnimationStart`/`onAnimationComplete`), a drag or resize of its panel
(the store's marks), a row scroll (`subscribeEmblaRows`: Embla's draws, direct writes and stop changes, with the strip's
translate read from where Embla draws it), or a drawn
width. Each change reports `moving`; once nothing is moving and the box has stood still for a frame, one `settled`
reports the box it stopped at. A slot that mounts at rest reports one `settled`. The loop never runs at rest.

The slot dispatches `phonux:panel-rect` on its own element (bubbling). `useProvidePanels` listens on `window` and
forwards only the ids it rendered, keyed by `panelKey`, so two providers that render the same panel id on one page
would both forward it. A slide also dispatches `phonux:panel-slide` before Motion starts, which is the capture moment.

Known gap: `DragToClose` moves its own box inside the slot, so a vertical close drag reaches the reports only when the
slot itself moves.

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
formula: the formula reads the slot's neighbors, and a root-less row has none. A row without a root panel reads
every entry as the root's right side, so such a row renders and orders as it did.

### The root marker

An entry with `marker: true` (collapsible false) holds the anchor point of a row with no root panel. It orders the
row like a root and nothing else reads it: `isPresent(p)` is `marker !== true && (!collapsible || live)`, and it is
the one reader of presence. The row draws, prices and offsets only present entries, so `[marker, A, B]` is two slots,
a row 796 wide, and `usePanelNeighborWidths` for A sees `{ left: [], right: [390] }`. `movePanel` hops over the
entries that are not present, so the first present panel cannot go left of the marker. The marker is not a fixed
column: `fixedViewCount` is 0 beside it, and a root panel still counts 1.

### Key-aware undo

`undoClose` takes the batch from a ref that the first call empties, so a second call in the same handler finds
nothing and reports nothing. A closed panel whose key (`panelKey`: its `key`, else its id) is already in the row is
skipped and its log id is not reported.

### The undo-close toast

Every mounted workspace draws one toast, open while the undo window holds a close the person made (a close with source
`'person'`: the title-bar close, a drag-down close, or a host's own control passing it; the deprecated `PanelsAPI.close` counts
too). Its Undo calls `undoClose`: the panel comes back at its old place, at its old size, with its view state. A close from
code (a host tidying its row, a placement pushing a panel out) raises none, because the person did nothing to undo. Every
app gets it without wiring, so there is one toast and no second way to build it. Its words are the `undoCloseMessage` and
`undo` labels. It renders beside the row inside the `wrap`, at the snackbar band, bottom center. A host that shows its notices
its own way passes `undoToast: false` and reads `closedByPerson` instead.

### Motion

The row's motion follows one set of intentions, so every change reads the same way whatever caused it:

- **Open.** A new panel grows from its own center, drawn beneath the whole row, so it never paints over the panel sliding
  out of the slot it takes.
- **Close.** A closing panel shrinks into its own center, which keeps to the point where its neighbors meet, tucked under
  the neighbor nearer the row's middle (see "Layering").
- **Park** (a panel leaving by one side of the window). It shrinks into the edge it leaves by and stays at its rest while it
  does, tucked under the neighbor sliding onto its spot.
- **Reveal** (a parked panel returning from a side: an entry with a side mark, or one entering via its anchor). It grows out
  of the edge on the side it comes in from, tucked under the neighbor still sliding off that spot: the mirror of a park.
- **One clock.** Every move to a new rest, every scale and every size glide takes the workspace's `slide`: 0.6 s on the in-out
  curve `[0.4, 0, 0.2, 1]`, the shared `PANEL_TRANSITION` object while `slide` is at its defaults. Neighbors move on the same
  clock as the slot that grows or shrinks, so the gap it grows into or leaves never lags it, and every entrance and exit fades
  the opacity as a slide does. The slot keeps its full box and scales it, so the content is never reflowed.
- **The row's own place.** A strip that fits is centered by its container, so a panel coming, going or changing width moves the
  row itself by half the change. `recentreRow` (`rowRecentre.ts`) reads where the commit laid the row out, puts it back where it
  was drawn with a `translate` added on top of any glide still running, and eases that to 0 on the slide's curve and the commit's
  shared start: the root and every other panel ride the same clock as the panel that caused the move. A clip that narrows glides
  from where it is drawn to the new one, so a panel sliding into a closed one's place is never cut. A change of room (a window
  step) and Reduce Motion land at once, and so does the commit the restore lands in; until the restore settles the row is
  hidden, so the root drawn alone never jumps aside on screen.
- **A set swap** (`PanelManager.swap`, and `showPanels` over it: a host's tab change). The hides and the shows land in one
  update, priced against the row without the hides, so the old set leaves, the new set arrives and the row re-centers in one
  commit and on one clock. A leaving panel shrinks into its center as a close does, an arriving one grows from its center as an
  open does, drawn as those are, and the root glides at most once, straight to the new rest. Nothing is scrolled to. Two updates
  would re-center the row twice: once around the root alone, then back around the new set.
- **The swap gate.** A scroll step at the row's end swaps a hidden panel in. A step that would swap back the other way while
  the last swap is still in flight waits for that swap to land (`swapAllowed` in `useProvidePanels`): a reversal would run
  the enter and the exit half-way and leave panels growing and shrinking in place. Steps the same way never wait, so
  sustained scrolling stays as fast as the input. Reduce Motion clears the gate at once. This is the one motion the row skips.
- **The end bump.** A step with nowhere to go (past the last or first stop, or on a row that fits with no hidden panel to
  swap in on that side) pushes the strip `ROW_BUMP_PX` (36) in the step's direction on an ease-out, holds it there while
  the scrolling goes on, and springs it back critically damped once it stops: the iOS rubber band, so the input is answered
  rather than ignored. Every wheel event and finger move toward that end (`keepBump`), and every further step, extends the
  hold to `tuning.gestureQuietMs` (150 ms) from now, the quiet that ends a gesture, so a wheel's momentum tail keeps the panels
  pushed out until it dies away. The push and the return together take `ROW_BUMP_SEC` (0.45 s). It is an additive term in the
  strip's one `translateX` animation (`RowScroller.bump`), so it rides the compositor with any glide and never touches the
  offset, the stops or the dot bar. A bump asked while a glide is landing starts when it lands, as momentum carries into an
  edge; one asked while the last springs back pushes out again from where it is. A blocked swap reversal (the swap gate) is
  not a dead end and does not bump. Reduce Motion skips it.

**Settings.** A panel's entrance is its `enterFrom` and its exit, for a park and a close alike, its `exitTo`. Each has one
workspace-wide default, `tuning.defaultEnterFrom` and `tuning.defaultExitTo`: a panel whose own value is `auto` takes the
workspace's, and any other value of its own wins. The workspace defaults are `expand` and `shrink`, which give the intentions
above; set either to `auto` for the sideways park and downward close below. `anchor` is the 0.1.0 `anchoredEnter` flag as a
setting, and that flag counts as the panel's own `anchor`.

Entrances. `auto` is the row's order: a mark, then the formula for an entry entering via an anchor, then the right. `anchor`
takes the formula at every enter. `left`, `right`, `top` and `bottom` slide in from that side (a vertical slide travels the
row's height), `fade` fades in at the slot's rest, and `expand` scales the slot up from 0, width and height together: about
its center for an open (it starts half a span left and reaches its rest on the same clock, so its center stays where the
neighbors part) and about the entry edge for a reveal. `expand-left` and `expand-right` grow about that edge whatever the
entry. Every value but `auto` and `anchor` is a constant that beats the engine's mark and the anchor formula.

Exits. `auto` parks toward the exit-right marks, else left, and closes downward along `slide.closeExitSeconds` and
`slide.closeExitEase`, the curve a drag close shares. `left`, `right`, `top` and `bottom` slide out to that side, `fade`
fades out at the rest, and `shrink` scales the slot to 0, width and height together: about its center for a close and about
the exit edge for a park. `shrink-left` and `shrink-right` shrink into that edge whatever the exit. An explicit `exitTo` is
the same for a park and a close.

**Layering.** One rule holds for every speed and direction (`rowSlotZ.ts`): a slot's z-index is its tier (`layer`:
`ROW_LAYER_Z.BASE` 1 or `RAISED` 100) plus twice its rank, the number of slots between it and the nearer end of the row, so
the stack peaks at the row's middle and falls toward both edges. A slot entering or leaving sits one level under its own
rank, between it and the next rank out, so an entry or an exit at an edge always tucks under its inner neighbor, however many
are in flight on that edge and whichever way the last step went. The rank is ranked over the drawn order, the present slots
with each leaving slot kept at the place it had (a context, since AnimatePresence renders a leaving slot with the props it
left with): two slots leaving by one edge keep their row order, and the one that left first stays under the second. An open
sits one under the base tier until its expand completes, under the whole row; a dragged slot is `DRAGGED` (200), above all.
A slot present at the row's first render never animates in, so it is never entering. DOM order is birth order and never
decides the stacking: every pair that can overlap differs in z-index.

Reduced motion is honored as the slide honors it: a slide's move lands at once and its fade still runs, so an `expand` or
`shrink` scale lands at once and the fade still runs. A slot that mounts at its rest (a restored panel, or one added while a
width is held) does not grow.

Both settings are NEXT: the style is read when the panel next enters or leaves, and one in progress keeps its style. An
interrupted scale carries on from the one on screen: a panel that returns mid-shrink scales back up from where it is, and a
panel that leaves mid-expand leaves from the size it has reached.

### A parked view unmounts

A parked panel's view is unmounted and mounts again, fresh, when the panel is shown.

So anything a view starts (audio, a web view, a socket) stops when its panel parks or closes. The one way to keep it running is to put it in `createWorkspace({ wrap })`: `wrap` renders once above every panel and never remounts, so a service there outlives every view. The panel renders controls that read it through a context. On a phone the player is a native plugin reached the same way, and a service that must survive a closed panel lives in `wrap` too, never in a view or a footer.

## The workspace core is React-free, and a row only reads it

`createWorkspace` keeps everything a workspace is outside React: the template registry, the declared panels, the options and the last committed list. `useProvidePanels({ workspace })` is its one consumer: it attaches in a layout effect that runs once, and it publishes the committed list and a few controls (`create`, `lateRegister`) in a layout effect that runs after every commit. Both are written after commit, never during render, so a handle read from an event handler sees what the screen shows.

- **Intents, not calls.** `addPanel` before the row is ready records an intent; the restore replays the intents as declared panels when it settles, so a saved file and code agree on one list. After ready, the call goes straight to the controls the hook published. A first paint therefore never scrolls, and an `addPanel` after ready asks for the scroll of the panel's `scrollOnOpen`.
- **A narrow surface.** Handles and the reader read through one internal source, and a verb reaches the engine through the controls the hook published, never through an export. A handle's members are fixed by a source test: the reader's handle has the read members only, the handle a view receives has those and every verb, and no export name may match `/controls/`. A view's handle has no manager, so it acts on its own panel only; to act on another it calls `useWorkspace()`, which gives the operable manager (`get(key)` returns a handle with the verbs) and `addPanel`, and none of the workspace's `dispose`, `update` or `rename`. Outside a row that has a workspace it is `undefined`. The reader `useWorkspaceManager()` stays read-only. Every workspace draws its own Undo toast after a close (see "The undo-close toast"), so a host never builds one.
- **Render-phase observation.** The core is told the list a render is about to draw (`observe`) so a handle read during the same render, before the layout effect publishes, answers from it instead of `pending`. Nothing is notified from there; the publish effect does that.
- **Tombstones.** A declared `stay-closed` panel that leaves the list is added to the file's `dismissed`; a panel back in the list is removed. The restore skips a dismissed declared panel unless the template is no longer closable or no longer `stay-closed`, and then drops the tombstone and saves. The diff is on the list, so an unmount, which empties nothing, is never a mass close.
- **Errors.** A storage whose `save` throws or rejects reaches `onError`, or `console.error` when it is unset; the row and the next save are unaffected.

## Two layers: the workspace mounts itself, and the components stay public

The default start is `definePanel`, `createWorkspace` and `addPanel`: the workspace creates its own full-window element (`position: fixed; inset: 0`, appended to `document.body`, removed by `dispose()`), measures it, calls `useProvidePanels` and renders `HostProvider`, `Workspace` and `PanelRow` itself. A custom flow writes out the same three components and the same hook, so there are two layers and one implementation: `autoMount.tsx` is built from the exported components and hooks and takes no `@internal` shortcut, and a test renders the same panels both ways and compares the DOM. The mount maps what `useProvidePanels` returns onto the props of the shell and the row in two small functions (`workspaceProps`, `rowProps`), so a prop the row gains has one place to be added.

- **Turning it off.** `mount: false` is the migration for a caller that renders the workspace itself. A `document`-free run mounts nothing either. A `mount` element is rendered into a child of its own and is never emptied. The mount module is loaded by a dynamic `import()` from `workspaceCore.ts` only when a mount happens, so importing the workspace module never requests `react-dom/client`; a test proves it from a child process that records every module request. Mounting is therefore async by a microtask: `addPanel` before and after it behaves as before, and a failed load reaches `onError`.
- **Said once.** A `PanelRow` given a workspace that also mounts itself warns once in development, naming `mount: false`.
- **Always with a workspace.** The components (`PanelRow`, `Workspace`, `HostProvider`) and `useProvidePanels` stay public, but a row is always fed by a workspace: `PanelRow`'s `workspace` prop and `PanelsInput.workspace` are required, and a plain component is `definePanel({ id, view })`, not a registered view. A custom flow differs from the mount by who writes the tree, never by where the rules come from.
- **The theme.** The mount draws one `ThemeProvider` and one `CssBaseline`, with `theme(mode)` when the app gave that option and `createDefaultTheme(mode)` when it did not. `mode` is the window's `prefers-color-scheme`, the only mode source: an app whose mode is chosen some other way needs a later option. The function runs once per mode change; a throw, or a value that is not a `PhonuxTheme`, reaches `onError` once and the default theme is drawn. A `wrap` must not draw its own `ThemeProvider` or `CssBaseline`, which would reset twice. A column draws the theme once above every cell (`ColumnOptions.theme`); the cells a `WorkspaceColumn` renders with its default cell draw none of their own, and a workspace inside a column takes the column's theme. The theme reaches the page as CSS custom properties: `PhonuxThemeProvider` writes `--phonux-primary`, `--phonux-background`, `--phonux-foreground`, `--phonux-card`, `--phonux-border` and `--phonux-radius` under `:where(:root)`, so any rule that sets one wins, and the MUI theme it builds uses `var(--phonux-*)` for its palette and corner with `nativeColor` on, so MUI derives hover and contrast shades from the variables with CSS relative colors. MUI's own variables take the `--phonux-mui-` prefix, apart from an app's, and the page's `color-scheme` is left to the app. One set of variables per page is the contract: two mounts with different themes on one page share whichever wrote last. There is no second TypeScript path for the same override.
- **Absence.** `snapshots` and `labels` are optional on `Host`, and a view reads each with a fallback. The first frame of an auto-mounted workspace holds exactly the values given to `createWorkspace`, so a caller that has them at creation passes them there, and one whose data arrives later renders that frame without it and calls `workspace.update` when it lands. There is no second door that defers the first paint. `createFakeHost({ absent: ['history', 'snapshots'] })` renders the absent frame in a view test.
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
option on `createWorkspace`. The members of `WorkspaceLive` (`device`, `snapshots`, `labels`, `topInset`,
`panels`) are the starting values and the only ones `workspace.update(live)` can change; `root`, `templates`, `storage`, `mount`,
`wrap` and the other options are fixed for the workspace's life, and `update` naming one throws `invalid-options` and applies
nothing, not even the live members named beside it. The option names are the `Host` member names, so an option and the same value in
a hand-built `Host` give the same view result. `panels` is `Partial<PanelsInput>`
minus what the mount measures (`phoneWidth`, `containerWidth`, `overflowContainerRef`) and what the workspace supplies (`workspace`,
`rootId`, `storage`, `templates`, `declared`, `workspaceDefaults`, `tuning`, `initialEntries`) and `labels`, which is its own
option, so there is no member list to keep in step with the hook. `topInset` is an option (the `Workspace` top padding), not a
tuning leaf: the catalog holds 23 tuning leaves, counted from `PANEL_SETTINGS_CATALOG`, and a test pins the number.

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
title (`labels.untitledPanel` when it has none), the grab bar of the reorder drag (and of the drag-down close under `verticalDrag`), the phone frame and the
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

**Who gets the grab bar.** The frame follows `PanelRow`'s own rule: a panel that cannot be closed (`closable: false`, or not parkable) gets the header and the phone frame but no grab bar and no `DragToClose`, and a panel that cannot be moved (`movable: false`) keeps the grab bar but not the reorder, so its grab bar drags only under `verticalDrag`. The grab bar carries both gestures, so a panel with `closable: false` and `movable: true` has no reorder handle in the default frame, and the root has none even when its `movable` is on: a root view that wants to be dragged draws its own `Panel`, gives `grabProps` the `DragToClose` handle and spreads `usePanelDragProps()` onto `DragToClose`, which gives it the reorder and the Arrow keys and no close.

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

### Configure of parkable and reset

- **Configure of parkable.** A `configure` that names `parkable` on a parked, hidden or closed panel is refused: `would-reshape-row` for a parked or hidden panel, `is-closed` for a closed one. A flip that changes nothing the panel reads, as when the person's override outvotes it, is never refused. A panel that becomes a fixed column is live.
- **Reset.** `resetLayout` writes `overrides` only through `clearOverrides`, re-places each named panel by its resolved `placeOnAdd`. `'all'` scrolls nothing; one id follows `scrollOnMove`.

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

A window resize snaps the row to the live width on every step: the strip, its scroll and its vertical place follow at once, at
the old phone size. Once the width and height have held for `tuning.resizeSettleSlides` (1/3) slide durations, about 200 ms, the
phone size is fitted again, and only a changed phone size glides. Under Reduce Motion the fit lands at once. The row never holds
its old layout in a resized window, so there is no end-pad hold or clamp undo. A host without `heightBudget` gets the same snap
from `useResizeSettled`; a `rowResizeSettled` the host supplies wins.

## Safe areas and a touch drag in a web view

A Capacitor page runs in WKWebView on iPhone and in the Android System WebView. Three things follow from that.

- **Insets need the host's opt-in.** `env(safe-area-inset-*)` is 0 unless the page's viewport meta says `viewport-fit=cover`, and
  the library cannot write that meta. The Workspace row reads the top and bottom insets as a margin and a height shrink, so its
  measured height (`useRowHeightBudget`) already leaves them out. The side insets are not applied: the row's stops and widths are
  computed from `gap` alone, and a side inset would move every stop. The column's links and name input add the same top and
  bottom insets to their offsets.
- **The header and footer have room inside the row.** Both are drawn outside the frame, so the row pads 40 px (the bar plus its
  gap) above and below the frames, or the row gap when that is more, and the phone fit prices the height from the same numbers.
  A phone's height is the binding side, so without the top room the header of a frame that fills the row sits off screen.
  A dev's `tuning.rowTop` is the one exception: an explicit room is the dev's and is never raised, even below 40 px.
- **A fitted phone is never taller than its row.** The row never scrolls vertically, so a row too short for the minimum phone
  draws it at the minimum width and the row's height, shorter than the preferred shape, rather than cutting its bottom off.
- **Exit distance uses the visible bottom.** `visibleViewportBottom()` (`dragToClose.tsx`) is the visual viewport's bottom, so a
  dismissed panel leaves the screen while a pinch or the on-screen keyboard has shrunk what is visible. `100dvh` is a CSS unit and
  cannot give a pixel distance to a spring.
- **A touch never drags the grab bar.** The grab bar is `touch-action: pan-x`, so a vertical touch on it is the page's pan, and the
  browser cancels the pointer once it pans. A touch press therefore never reaches the drag sensor, and a held touch cannot close a
  panel. Where the page cannot pan, no cancel comes and the moves keep arriving, so a touch press is never engaged either: the
  box stays at rest under the finger. A mouse or pen is unchanged and starts past the direction lock; the press is taken on the handle, not the sensor, because
  the sensor's activator is one per event name and would drop the mouse's. The workspace's tile drag is separate and still holds a
  touch for 250 ms.

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

## Header buttons

The title bar's buttons are generic: the library draws no built-in button.

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
draws its own button as well as declaring a slot for the same action shows two buttons: the library does not merge them.

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
| The slot context hooks a view calls (`usePanelTuning` and the rest) and `useViewState`, snapshots | Workspace tuning options and the theme |
| Header button items, the chrome attribute and part names | The saved workspace format, which has its own `version` |
| The template's own `settings` keys and `params` | Peer dependency ranges (React, MUI) |
| `useHost().panels` (`PanelsAPI`): the verbs a view calls and the summaries they return | The workspace-only tuning options (`rowGap`, `rowTop`, `phoneHeight`, `saveQuietMs`, `gestureQuietMs`, `resizeSettleSlides`, `rowGesture`, `fastScroll`, `initialScroll`, `maxLivePanels`, `chrome`, `phoneFit`, `phoneFitMin`, `phoneFitMax`, `dragToClose`, `slide`, `hopFraction`, `edgeScroll`, `defaultEnterFrom`, `defaultExitTo`, `shrinkUnfocused`, `firstPressFocusOnly`, `minScrollSlots`): a host sets them on the workspace, and a view only reads what `usePanelTuning` returns |
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

A release is `npm run release:check`, then a publish: either the manual `.github/workflows/publish-release.yml` run (it waits for approval in the `npm-release`
environment, then publishes `dist/` under the right dist-tag through npm trusted publishing), or the maintainer's own
`npm publish` from `dist/` (`npm publish --tag next` for a prerelease version). For a
`0.x.y-rc.N` version, release:check first fetches `origin/rcN` and refuses when HEAD lacks any of it, naming each missing pull request; the
command it prints starts with `node tools/phonux-rc-branch-check.mjs` so the same comparison runs again at the moment of publishing,
because the branch can take a merge between the two. A fetch that fails is a refusal, not a pass. A push to `main` publishes nothing,
and a published version is never edited: a fix is a new version, and `CHANGELOG.md` says what changed. `.github/workflows/ci.yml`
runs the typecheck, the tests, the build, the API report check and the smoke on a pull request into `release` and on dispatch;
a pull request into `main` runs no cloud check.

### Release candidate base

A release candidate is cut on a branch named `rcN`, the same name in this repository and in phonux-app, with both versions at
`0.2.0-rc.N`. The `Dist branch` workflow (on a push to `main`, or dispatched for a branch) tags each build it makes
`dist-<source sha>`, so a pinned build stays fetchable after the `dist` branch moves on, and the app's `rcN` branch git-pins the
tag of this branch's head. The published `0.2.0-rc.N` is the head of `rcN` at publish, and the CHANGELOG section for that
version lists what changed since the one before. The head this text was last checked against:

```text
base: 9a793f58d28047c71036dc515bd2d9f747f83f1e
```

No real browser measures this tree in CI: the jsdom and unit suites are the automated evidence behind a candidate, and the
owner's Safari check of the app built from the exact head is the one real-browser check before a publish.

phonux-app installs the published package from the registry. To try a change there before publishing, install a copy of this
checkout over it: `npm install --no-save --install-links <path to this checkout>` from the app leaves the app's `package.json`
and lockfile untouched, and `npm ci` restores the registry copy. Never `npm link` or a `file:` directory spec: a symlink resolves
this checkout's own `node_modules`, which can give the app a second copy of React. The copy is source (`.ts`); to rehearse exactly
what will be published, run `npm run build`, pack `dist/` and install that tarball instead.

## The dot bar (usePanelDots)

The row draws no native scrollbar; a bar of dots stands in for it, one dot per panel. `usePanelDots` is headless: it returns
each dot's track place (`left`, `width`, `hollow`), the window oval's `left` and `width`, the bar's `width`, and the handlers
and props the bar, the oval and each dot spread. The library draws no dot and no oval; the app places and styles them, so no
color, radius or border is set here.

**Geometry.** The bar is the row's ruler drawn small, in `rowBar.ts`. Every panel the bar counts lies on the ruler in row order, one
dot slot (a 22 px dash and an 8 px gap) to one row slot, so a dot's left is its panel's ruler x scaled and a wide panel is a wide dot.
The oval is the window's grid on that ruler: its left comes from the scroll alone, at one rate, and its width is the slots a rest shows,
no wider than the panels on screen. Dots do not move as the row moves; the oval does. The library sets no minimum dot width; the app
decides one when it draws the dot.

**Parked panels have dots.** Each parked panel a scroll can bring in (`live: false`, not a marker) gets a
dot at its place on the ruler, so with more panels than fit the hidden ones are still counted and the oval moves. A click on a parked dot
steps the row toward it until it is drawn. A panel parked inside a run of panels the row moves waits just outside that run, on the side
a step reaches it from (`waitsLeft`), because the window on a ruler is one span.

**Riding dots.** A panel that stays on screen as the row moves (held at an edge, stuck, or an always-shown root the drawn panels have moved
away from) keeps to the oval's end and lies over the dots beneath it, marked `riding`. Its home slot stays empty on the ruler, and a dot
it covers cannot be pressed until the oval moves off it. A root that stepped aside is parked, so it sits at home.

**Writes.** A click on a dot centers its panel (`centreScroll`, clamped to the row's range), through `applyRowIntent`; a row that cannot scroll gives no
target and the click does nothing. The oval drag takes the row's claim (`rowScrollerFor(...).claim()`), writes each drag as
the start scroll plus the pointer's travel over the bar's scale, and releases the claim on `end()` and when the bar unmounts mid-drag, so a bar that never got its
pointerup cannot hold the row. A row whose claim is held marks itself `data-row-held`, so a row that refuses steps can be
told from one that never got the input. The bar never writes `scrollLeft` itself. A held row (a gesture or another drag)
refuses a new drag with null.

**Bar, oval and dot props.** `barProps` goes on the element holding the dots and the oval: a press that moves past a few px
drags the oval, one that does not selects the dot it began on, and the pointer is captured so the drag follows it off the
bar. A drag carried past the row's end, or on a row that cannot scroll, steps the row one stop per dot it travels, bringing
hidden panels in as a scroll at the row's edge does; a wheel over the bar, either axis, steps the row the same way.
`ovalProps` makes the oval a focusable slider (0 to 100 along the row), `dotProps(id)` marks a dot and selects it on a
keyboard activation, and `cursor` says what the pointer shows where it rests.

**Reduce Motion.** A click snaps when either the OS query or `MotionConfig` says so, the same two sources the row's own motion
reads.

**Root.** The library has no notion of the app's Workspace panel. The hollow dot is the panel setting `hollowDot`, which the
app sets on the template it marks; the library reads the flag, never a name.

## Open placement: `addPanel(template, { place })`

Without `place`, a panel lands where its `placeOnAdd` says, by default `row-end`: the far right of the row, the leftmost panel
in view leaving when there is no room. `place` is a developer's function from the row (`OpenRow.inView`: the ids of the
panels in view, left to right, always-shown columns left out) to an `OpenPlacement`: the `slot` the new panel takes (0 at the
left; at or past `inView.length` lands right of the last), what the panel already there does (`occupant`: `'shift-left'`
moves it and everything left of it one slot left, the default; `'shift-right'` moves it and everything right of it one slot
right; `'close'` closes it), and optionally the entrance (`enterFrom`). The panel pushed past the row's end leaves view.
`resolveOpen` in `openPlacement.ts` is the pure half: it turns the answer into the anchor the engine places by (a neighbor
that stays, never the occupant, which still holds its room while its close plays) and the panel that leaves. The reference
app reopens a closed page from its Workspace timeline in the middle slot with `'shift-right'`, then centers it in the row; a plain open
keeps the far right.

## Maximize

`usePanelMaximize(anchor, { topInset, onRefused })` lets the panel that draws `anchor` fill the window and shrink back, on
the glide a panel resize uses; Reduce Motion jumps. The browser's own fullscreen is not used: its transition is the operating
system's (a swipe to a new space on macOS) and no page can change it. The root goes to the top layer through the popover
attribute, so no ancestor's transform, clip or stacking order can hold it, and it never leaves its place in the DOM, which a
web view inside it would answer by reloading. While a panel fills the window, Escape shrinks it unless something inside
already used the key, focus returns to `anchor` on the way out, and `MAXIMIZED_ATTRIBUTE` (`data-panel-maximized`) is on
its root for styling. A panel unmounted while maximized goes back to its slot at once. `toggleMaximize(target?)` serves a
host's shortcut: it grows or shrinks the maximized panel, else the maximizable panel holding `target`, else the active
panel, and answers whether it found one, so the key is the host's to claim even when the browser then refused (`onRefused`
hears of it). `useMaximizedPanel()` reports `maximized` and `settled`, so a host hides floating controls over a grown panel.
`maximizedPanel()` and `reportMaximized` are the store behind them (`MaximizePhase`: `home`, `growing`, `maximized`,
`shrinking`), kept apart from React and motion so a test can stand in for a grown panel.

## Row keys and `stepRow`

A bare ArrowLeft or ArrowRight on the page steps the row one stop. When the panel in use has scrolled out of view, the key
instead lands focus on the panel at the far edge of the view on the side that would scroll toward it, so the row never
scrolls away from the panel the person is using; a panel with less than a sliver showing counts as off screen.
`stepRow(event, direction)` gives a host's own chord (the reference app binds Option+Arrow) the same answer, from the row in
the workspace cell holding the event's target, else the row in view. It answers false and does nothing when the key belongs
elsewhere (a text field, a widget that takes arrows, an open dialog, an IME, a keyboard drag, a key already handled) or no
row is in view; modifiers are the host's to judge.

## Waits instead of timers

A panel takes one operation a turn: a second call on it in the same turn answers `busy`, and a panel just added or shown is
live only once the row has drawn it. `panelWaits.ts` replaces the timer polling a host wrote around that. `whenAccepted(panels,
op)` runs a handle call now and again whenever the workspace changes and at the turn's end, while it answers a refusal a
later turn can clear (`busy`, `is-pending`, `not-live`, `not-ready`, `not-attached`). `whenPanel(panels, id, test)` resolves
with the panel's state once `test` passes (by default: live). `showPanels(panels, show, hide)` puts the hides away before the
shows, each as the row takes it, since a show in the same turn would still count the hides against the room.
`whenColumnReady(column)` resolves once the column and every workspace in it have read what was saved, so a default
workspace is never shown and then replaced. Each gives up after `WaitOptions.timeoutMs`.

## Published DOM attributes

`rowDom.ts` exports the attribute names the library draws, so a host's styles and listeners never repeat a string a library
change would break without a word: `ROW_SLOT_ATTRIBUTE` (`data-row-slot`, the slot's rest offset), `ROW_ID_ATTRIBUTE`
(`data-row-id`, the engine id of the panel in the slot; `rowPanelIdOf(target)` reads it from any element inside),
`ROW_SCROLLER_ATTRIBUTE` (the scroll container), `ROW_STRIP_ATTRIBUTE` (the strip holding the frames),
`WORKSPACE_COLUMN_ATTRIBUTE` and `WORKSPACE_CELL_ATTRIBUTE` (a column and each workspace's page; a cell out of view is
inert) and `PANEL_ROOT_ATTRIBUTE` (every `Panel`'s root; `panelRootOf(target)` finds it). `ACTIVE_ATTRIBUTE`,
`DRAGGING_ATTRIBUTE`, `CHROME_ATTRIBUTE`, `MAXIMIZED_ATTRIBUTE`, `COLUMN_BAND_ATTRIBUTE` and `COLUMN_SLOT_ATTRIBUTE` follow
the same rule for the panel chrome, maximize and the column bands.

## The frames' band and the chrome sizes

A host that lays its page out around the row needs to know where the frames sit, which only the mounted row knows.
`useRowFrameBand(page, scroller, onBand)` reports the px from the page's top edge to the frames' top and from their bottom
to the page's bottom, once mounted and again whenever the frames, the scroller or the window change size; `onBand` is a
callback, not state, so a host can write custom properties without a re-render. `PANEL_BAR_HEIGHT_PX` (the header's and
the footer's height, in every theme), `PANEL_FOOTER_ROOM_PX` (the footer's offset plus its height: the room under a frame)
and `rowFootReserve(gap)` (the gap, or the footer's room when that is more, which the phone fit's height budget counts) are
the numbers the row prices with, so a host centering the row in its page counts them the same way.

## `PanelLoader`

A panel is never an empty space while it loads. `PanelLoader` puts a placeholder up on the first frame and mounts its children when `load` resolves. The host's `placeholder` has `windowMs` (200 by default) to answer; a later answer is dropped so the placeholder never swaps late. The generic blocks are still until that window closes, then pulse, so a quick load shows no motion. An error or a timeout ends in a view with Try again, and content that arrives after a timeout still comes in.

## `PanelSizeControl`

One width control for every resizable panel: a header button that shows the panel's own width (`savedSlots ?? slots`, so a
panel resting at one phone shows the width it goes back to) and opens a View Size menu of the widths that fit (Phone, Fold,
Tablet, Desktop, Ultrawide, then `N phones`) and Fullscreen. A pick goes through `setSlots`, so it runs the same size glide
as a drag. The menu grows from the button's edge toward the panel's middle and is no wider than the panel. `Panel` draws it
first among a titled, resizable panel's actions; `sizeControl={false}` leaves it to a view that places it in its own
toolbar. Its names are the `viewSize`, `sizeName`, `fullscreen`, `couldNotResize` and `couldNotFullscreen` labels.

## The row

The row is one strip drawn by Embla Carousel. How it was built, step by step, and what each step measured.

Far-off pages sit on one continuous strip, with far web pages unloaded behind same-size placeholders (step 7). The steps
below record what each one delivered and measured.

> **Step 8d (2026-11-09, owner: "We can retire the old row."):** the old row ('own') is deleted and Embla is the only row. The
> `rowEngine` switch described in the steps below no longer exists (`Workspace`, `useProvidePanels`, `WorkspaceOptions`); the
> sections keep their history as written. See CHANGELOG, Unreleased, "Removed (breaking)".

### Step 1: an Embla row behind a switch

`<Workspace rowEngine="embla">` runs the row on `embla-carousel` 8.6.0, with `wheel-gestures` 2.3.0 reading the wheel (both pinned
exactly; `embla-carousel-wheel-gestures` 8.1.0 until "The wheel without a press", below: the later oval drag uses Embla's `internalEngine()`, which semver does not cover). The default is `'own'`, the row as
before; with the switch off nothing renders or listens differently.

What the switch does (`emblaRow.ts`, and a branch each in `Workspace.tsx` and `PanelRow.tsx`):

- The container carries `data-row-engine="embla"`, and the old row's wheel, touch and key listeners
  (`useRowScrollGesture`) and the Workspace's arrow-key edge focus return at once for it.
- The Workspace renders no `[data-row-window] > [data-row-strip]`, so the old row scroller finds no strip and draws nothing.
- `PanelRow` draws the same slots (the same `PanelRowSlot`, contexts, enter and exit animations) inside a window that is
  `fit` whole slots wide (`emblaWindowOf`), centered, and cut one gap past each edge as the old grid cut was. Its box is
  Embla's container, as wide as the window, and holds one zero-height marker per slot (`slotMarkerLefts`), which Embla takes
  as its slides: every slot edge is a stop, a wide panel's inner ones included (`align: 'start'`, `containScroll:
  'trimSnaps'`, `skipSnaps: true`).
- Wheel and trackpad: one listener on the window, through wheel-gestures, moves Embla's target directly ("The wheel without a
  press", below). A wheel handed in by `feedRowWheel` bubbles to the same listener, so it moves the row like a wheel over it; it
  returns true for a sideways wheel and false for a vertical one. A pause or a stop is settled by the row ("A wheel that pauses or
  stops", below). Option held at a gesture's first event leaves the whole gesture to the content.
- Pointer drag: Embla's own. A mouse press starts one only on the row's surface (a gap, not a panel), so a panel's text,
  controls and header grab keep the mouse; a touch starts one anywhere but on a control, an editable field or a frame.
- Arrow keys: a bare ArrowLeft or ArrowRight steps one slot (`scrollPrev`, `scrollNext`), under the old row's
  `arrowKeyBelongsElsewhere` filter.
- Focus: a panel focused while partly out of the window comes in by the least move.

Measured with `node --import tsx tools/proof/embla-row-proof.ts --engine embla` (headless Chromium 151, 1800 x 900, rows
narrow 24 x 1, wide 3,2,..., mixed 1,3,1,2,...; the Workspace panel is the strip's first slot):

| what | Embla row | today's row (fix1-new.json, same rows) |
| --- | --- | --- |
| row px per input px, page.mouse.wheel D6 / D12 / D24 (two runs) | 0.989-1.000 / 0.988-0.996 / 0.989-0.997 (three runs) | same script at 1926006: 1.33-1.35 / 1.26-1.27 / 0.995-1.009; scratchpad baseline at 90ee803: 0.760 / 0.564-0.573 / 0.376-0.389 |
| spread narrow / wide / mixed | 0-0.8% | 0.6-1.9% |
| handed in by feedRowWheel, one per frame, D12 (2.5 s) | 0.991-0.995, spread 0-0.4% | 0.993 / 1.077 / 0.993, spread 7.8% (fix1-new.json, 5 s: 1.015 all three) |
| frames a wheel reached that stood still while the row moved, of ~150 (drawn transform, after step 2) | 0 in every row and stream | 0-21 (mouse.wheel), 0 (feedRowWheel), read off the old scroller |
| rests on the slot grid | every run | every run |
| mouse drag on the row surface, 600 px | 596.6 px at release, trails by at most 30.6 px (Embla's drag spring), rests on the grid | (no mouse drag of the row) |
| a mouse drag that starts on a panel | row moves 0 px | |
| ArrowRight x3, ArrowLeft | rests 406, 812, 1218, 812 | |
| window 1800 > 1400 > 2300 > 1800 | left-edge panel moves 0 px in every frame, no one-slot panel cut in any frame, rests on the grid | |
| window 1800 > 1000 | fixed in step 2 (below) | |

The stalled frames step 1 reported were the proof reading the wrong number. `tools/proof/embla-wheel-trace.ts` records, each
frame, the wheels that arrived, the plugin's untrusted mousedown, mousemove and mouseup, and the row's move. On a steady stream
handed in by `feedRowWheel`, a steady `page.mouse.wheel` stream and a trackpad-shaped stream (ramp, plateau, exponential tail,
skipped frames, three gestures), the plugin started and released each gesture exactly once (1/1, 1/1, 3/3), and it passed a move
in every frame that stood still: the momentum guess never cut a gesture short. Embla advances its `location` in fixed 60 Hz steps
and draws a translate interpolated between the last two, so `location` stands still in a frame whose interval is short and the
drawn strip does not. Read off the drawn transform, the same runs have 0 stalled frames; read off `location`, 13, 6 and 35. The
proof page now reads the drawn transform. Nothing in the row changed for this.

### Step 2: the view stays still across a change left of it

`keptScroll` (emblaRow.ts): the anchor is the first panel, in strip order, that reaches past the window's left edge and is still
in the strip after the change; the scroll moves by as much as that panel moved, clamped to the strip's ends. `PanelRow` computes
it in the render that carries the change, snaps every slot to its new rest in that render (instead of gliding), and in its layout
effect rebuilds Embla's stops from the new markers and jumps there with `jumpEmbla`, which writes Embla's internal location so
the jump is drawn in the same frame (Embla's own `scrollTo(i, true)` lands a frame later). It covers a panel opened, closed,
moved or resized left of the view, and a wide panel clamped when the window narrows. A change to the left-edge panel itself
keeps its left edge where it is; panels after it move over.

`test/embla-row-keep-still.test.ts` is the random-sequence test the redesign document (section 5) proposed: 500 sequences of
20-60 operations (stepL, stepR, setWindow, open, close, reorder, resize) on a model of the row, checking after each operation
stillness, whole slots and rests on the grid, and stepR-then-stepL reversibility. Its second test runs the same property with no
keep-still rule and requires it to fail on stillness.

Measured on the real row with the switch on (`embla-row-proof.ts`, mixed row resting at slot 5):

| change | scroll | left-edge panel, worst move in any frame | frames cutting a one-slot panel |
| --- | --- | --- | --- |
| window 1800 > 1400 > 2300 > 1800 | 2030 throughout | 0 px | 0 |
| window 1800 > 1000 (the 3-slot panel left of the view clamps to 2) | 2030 > 1624 | 0 px (406 px before step 2) | 0 (25 before step 2) |
| the 3-slot panel left of the view narrowed to 2, then widened back | 2030 > 1624 > 2030 | 0 px | 0 |
| a panel left of the view moved 3 places right, past the window | 2030 > 1624 | 0 px | 0 |
| a 3-slot panel left of the view closed | 1624 > 406 | 0 px | 0 |

Changes under a gesture or a glide (after the steps 1-2 audit). The keep runs only in a render that changed the strip layout or
the window, so a re-render while a drag pulls the row past its end leaves it there. Embla's own slide watcher is off: it rebuilt on
every child change of the box (slots and the drop gap, not only markers), back to the selected stop, and a rebuild drops a press or
wheel gesture (it rebuilds the drag handler and the wheel plugin). `moveEmbla` now applies a change: the keep's shift, and a rebuild
when the markers or the window changed. While a gesture holds the row the shift moves Embla's positions in place and the rebuild
waits for the release (`pointerUp`); a rebuild keeps the drawn position, and a glide goes on to the stop nearest its target. The
resize watch rebuilds only for a box width the row did not set itself (a row shown after it was hidden).

| `--only gesture` (mixed row) | before (ad43009) | now |
| --- | --- | --- |
| drag pulls the row to about -155 px, viewport +2 px re-renders | row snaps to 0, drag ends | stays at -150.8, drag goes on to -256.6, rests at 0 |
| wheel stream D12, last panel closed 1 s in (control: stream alone steps back 5.5 px at its settle) | steps back 240 px, row ends at 0.1 (gesture lost) | worst step back 0.9 px, moved 406 |
| same, last panel resized 2 > 1 slot | steps back 239.9 px | worst 1.75 px, moved 406.1 |
| from slot 5, wheel stream, the 3-slot panel left of the view narrowed mid-stream | (case added with the fix) | a panel in view moves at most 7.3 px a frame; 406.7 px without the in-place shift |
| ArrowRight glide from 2030, the 3-slot panel left of the view narrowed 120 ms in | rests at 1802, off the grid | rests at 2030, on the grid |

Embla internals still used, and why: `writeEmbla` (the oval drag's direct write; a rest off any stop needs it), the drawn-position
restore after a rebuild (without it the release rebuild steps the row back 14-26 px, measured), the in-place shift under a gesture
(406.7 px jump without it, measured) and `dragHandler.pointerDown()`. A jump at rest to a stop uses the public `scrollTo(i, true)`.
`test/embla-internals-contract.test.ts` pins 8.6.0 and fails if any member used changes. The property test now also pins closing
the left-edge panel itself (the panel after it becomes the anchor and stays put); a test requires the audit's surviving mutant
(keep the scroll when the anchor closes) to fail it.

Not covered yet: opening a panel left of the view in the browser (the model test covers it; the proof page has no second template).

### Step 7: one strip, far pages unloaded

`useProvidePanels({ rowEngine: 'embla' })` (pass the same value as the Workspace's `rowEngine`) makes the row one strip: `rowPricing`
gives an infinite capacity on a strip, so nothing parks for room or for `tuning.maxLivePanels`, and a panel parked for either comes
back in place (a host's own hide stays). With the switch off nothing changes. On Embla, `PanelRow` draws a placeholder of the same
width (`data-row-unloaded`) instead of the content of a parkable panel (overflow 'park', the panels that park today) that lies
`rowNearSlots` or more slots past the window's edge (`Workspace` prop, default 2: a step, an arrow key or a short flick moves one to
three slots, so those never meet a placeholder). `tuning.maxLivePanels` becomes the most parkable panels loaded at once, nearest
first, never fewer than the window shows. A loaded one stays until a whole slot further (no flip-flop on the line). `loadedNear` is
the pure rule; `test/embla-row-strip.test.ts` covers it.

Measured (`embla-row-proof.ts --only strip`, 24 parkable one-slot panels, cap 8, 1800 x 900):

| check | result |
| --- | --- |
| slots on the row | 25 of 25, none parked (control: the own row with the same settings shows 9) |
| wheel stream D12, px per input px | 0.994, 0 stalled frames of 149-152, rest on the grid |
| panel moves along the strip while panels unload and load (2-3 changes in the run) | 0 px in every frame |
| parkable panels loaded in any frame | at most 8 (the cap) |

The "unregistered view" defect this step shipped with was the proof page, and a library gap behind it. The page created its
workspace without `mount: false`, so the library's auto mount rendered a second row; its `useProvidePanels` called the workspace's
`observe` with the root alone during its render, then failed to attach (`already-attached`, reported to `onError`, not a page
error). That list replaced the attached row's, so the next `PanelRow` render (the first unload's) found no handle for any panel;
views drawn before kept theirs, which is why nothing broke with nothing unloaded or on a row that never re-rendered. `useProvidePanels`
now skips `observe` while another hook holds the workspace (`heldByOther`; a test harness that draws its own list still observes) (`test/workspace-lifecycle.test.ts`: fails on 4af3f06,
passes now), and the page passes `mount: false`, as the app does. The app was not affected (it passes `mount: false`).

Measured after the fix (`--only strip`): near p2 keeps its state (count 7, 1 mount) at slot 4; far at slot 12, unloaded; back at
slot 0 it mounts again (2 mounts); at most 8 parkable panels loaded; 0 px movement along the strip in every frame; `rowNearSlots` 0
leaves 4 loaded with four in view.

### Step 3: the dot bar on Embla's position

`usePanelDots` on an Embla row (`emblaDots.ts`) reads the strip `PanelRow` publishes and where Embla draws it this frame: one dot per
panel at its place scaled to dots (a one-slot dot is 22 px, as before), the oval over the panels in view. A store change re-renders
the bar in a microtask, so the oval is drawn in the frame the strip moved. Dragging the oval writes Embla's position directly
(`writeEmbla`), from the press, so the oval keeps the place it was grabbed at; release glides to the nearest stop. A pointer held
past the bar's visible end (its box cut by every clipping ancestor and the viewport) moves the row each frame, 0.1 slot/s per px past
the start of a 6 px zone, at most 12 slots/s. A dot press glides to show its panel. The old bar is unchanged off Embla.

Measured (`--only dots`, same parking row; bar drawn as the app does, clipped and kept over the oval for the hold):

| check | result |
| --- | --- |
| dots | 25 for 25 panels; the oval's ends meet the first and last dot in view at slot 0 and 7 (0 px) |
| fast oval drag, 6 px a frame, 132 frames | worst oval-to-pointer 0 px, strip 4791 px, rest on the grid |
| control: Embla's eased drag (the proof page's, routed in by its build; shipped code has no seam) | worst 36.2 px, median 31.8: the check fails as it should |
| pointer held 20 px past a 300 px bar's end for 1 s | row moved 1040 px, 0 of 59 frames still |
| control: held mid-bar | 0 px |
| dot press on p20 | glides to show it |

### Step 4: Workspace summon, dismiss and step-aside

Superseded by the owner ruling of 2026-11-09 ("The Workspace as an ordinary page", below): the summon described here, its dismiss,
the step-aside and the step-away dismiss were deleted. This section and the summon parts of the audit passes below are the record.

On a strip the summon and the step-aside change what the row draws, never the list (`useProvidePanels`, `stripSummon` and
`stripAside`): nothing is saved, the host's panel list keeps every panel live, and a reload shows the row as the list has it. With
the switch off the old row's summon runs as before.

- Summon (`panels.summonRoot()`, the window bar's button) with the root off to the left brings it into the far left slot; off to the
  right, the far right slot. The panels between the root and the view, and the one in that edge's slot when it fits the slot, come
  off the strip (`emblaSummonPlan`); a wider page there stays and moves over by the root's slot. The commit carries a mark
  (`markEmblaRow`) that rests the view with the root at that edge, the pages in view stand still, the root glides in from one slot
  outside the window, and the page that steps out runs its own exit from where it was drawn.
- The same press (`dismissRoot()`) puts them back and rests the view on the page that was at that edge before; the root glides out
  over that edge and the returning page fades in where it lands.
- A step toward the root (an arrow key, a wheel, a drag) leaves the summon standing. Anything that carries the root wholly out of
  the view (a scroll, a dot press) ends it: the pages come back beside the root, out of view, and the keep-still rule holds the view.
- Step-aside: after a window or size change, when the root stands whole in the view and a page beside it is cut, cannot fit the
  window beside it and fits alone (`emblaAsideFor`), the root comes off the strip and the view rests with that page whole. The row
  moving toward the root (or a step key toward it at the strip's end) brings it back where it was; a window wide enough for both
  brings it back into view beside the page; a summon draws it beside the page (which moves over), and its dismiss steps it aside
  again. The root coming back is not itself a change that steps it aside.
- `rootView()` on Embla: 'summoned' while a summon stands, 'away' while stepped aside or not whole in view where the row is heading.

Embla internals: none new; the provider reads Embla's `target` (where a glide or drag is going), already pinned by the contract test.

Measured (`embla-row-proof.ts --only summon`, 1800 x 900, 24 one-slot pages and the root, eight pages left of it, window of 4 slots;
each check fails on 43bf248 with the switch on, 17 failures across all 13 checks, and passes now):

| check | result |
| --- | --- |
| summon from the left, view p14..p17 | root at 0, view root,p15,p16,p17; p15..p17 move 0 px in every frame; root drawn at 35 places on its way in; list unchanged (nothing saved parked) |
| dismiss | view p14..p17 again, 25 slots, list order as before |
| step toward the root (ArrowLeft) | view p8,root,p15,p16; still summoned |
| a glide carrying the root out | summon over, 25 slots, view p19..p22 where the glide went, rest on the grid, no frame jump past a slot |
| summon from the right, view p1..p4 | root at 1218, view p1,p2,p3,root; p1..p3 move 0 px; dismiss gives p1..p4 |
| a dot press carrying the root out | summon over, 25 slots, p20 in view |
| window 1800 > 1400 beside a 3-slot page | root off the strip, the page whole at 0; ArrowLeft brings the root back at 0; 1400 > 1800 brings it back beside the page |
| size pick 2 > 4 slots beside the root | root off the strip, the page whole at 0; summon: root at 0, page at 406; dismiss: aside again |

Look at the screenshots (`summon-left-mid.png`, `dismiss-right-mid.png` mid-transition, and the rests): the first run of the
left summon drew the pages leaving between the root and the view over the view for a frame (their exits were left at their old strip
place under the jumped scroll); every leaving slot now keeps its screen place.

### Step 5: width changes and maximize

A page's width change on Embla runs as on the old row: its size box eases on the slide (`PanelSizeBox`), the slots after it glide, and
Embla hears of it once, in the commit that starts it (the markers are drawn at their final places, so `moveEmbla` rebuilds the stops
at once and the keep-still rule decides the scroll). What step 5 changed:

- At the strip's end a narrower page shortens the strip under the view, so the keep (clamped to the new end) jumps the scroll. The
  slots snap as any keep does, and those the jump moved on screen then glide there from where they were drawn, on the slide's curve
  and the commit's shared start (`sharedStartTime`), the clock the size box eases on: the right end holds, the page's left edge and
  the pages left of it ease right one gap apart. Only for a width change: the same panels in the same order, in the same window (an
  open, close or move keeps its snap, as a window resize does; gliding a move past the window cut one-slot pages in 26 frames of the
  `change` section), and not under Reduce Motion (the size box snaps there too).
- A page narrowed so the root fits beside it again brings a stepped-aside root back in a second commit in the same task (the
  provider's layout effect). Nothing of the first commit is painted, so the marked commit glides from what was painted (`taskToken`
  tells commits of one task apart), and the root, new on the strip and the mark's pin, slides in over its edge instead of fading in.
  `arriveAndLeave` now uses the slide's curve and shared start for every glide (it used CSS `ease` before).
- Maximize lifts the panel to the top layer and never changes the row's layout, so Embla has nothing to hear. But the panel stays in
  the row's DOM, so its wheels bubbled to the wheel plugin and moved the row behind it, and the restore then shrank into a slot
  somewhere else. While a panel of the row is lifted (`maximizedIn`: a panel root with the popover attribute, from the grow to the
  end of the shrink) the row takes no wheel, arrow key, drag or focus reveal.
- Panels do not shrink when unfocused on Embla (owner ruling); nothing here reintroduces it.
- A width change never stretches a page's content: the size box eases its real width, and Fullscreen the lifted panel's real box,
  so the content is laid out at the drawn size on every frame. A scroll never resizes a page: the `foldStaysOnWheel` case wheels a row past a
  two-slot (Fold) page and checks that it is two slots wide in every frame and at rest, that no frame moves the row against the wheel
  while it holds the row, and that the row rests where the rest rule puts the furthest point the wheel carried it.

Embla internals: none new.

Measured (`embla-row-proof.ts --only width`, 1800 x 900, root and 12 pages `1,1,2,1,3,1,1,2,1,1,1,1` (17 slots), window of four
slots; per frame from before the change to its rest). The four rows below fail on b2a749a with the switch on (7 failures, run from a
`git archive b2a749a` extract with this proof copied in) and pass now:

| case | b2a749a | now |
| --- | --- | --- |
| shrink the left-edge two-slot page at the strip's end (`1,1,2,1,3,1,1,2,1,1`) | its left edge jumps 406 px in one frame, the page shrinks over its neighbor | left edge eases 406 px, worst frame 33.6, last-3-frame max 0.76 vs median 8.6; p9, p10 move 0 px; p7 stays one gap behind |
| shrink a two-slot page mid-view at the strip's end | jumps 406 px in one frame | eases, worst frame 30.8, last-3-frame max 0.83 vs median 8.81; p12 moves 0 px; p10 one gap behind (0 px off) |
| p1 4 > 2 slots with the root stepped aside (`2,1,1,1,1,1,1,1`) | root appears under p1, p2 812 px off p1, p1's right edge steps back in 2 frames | root slides in one gap before p1, p2 one gap after (0.01 px), right edge monotonic |
| maximize p3, 40 wheels + ArrowRight, restore | the row moves 406 px behind it; pages behind move 478.5 px; restore lands elsewhere | row 812 > 812; pages behind 0 px; same view; restore last-3-frame max 1.0 vs median 11.4 |

Guards that already passed on b2a749a (the behaviour was right; kept so a later change cannot break it): a page growing in view and at
the window's left edge, narrowing in view, a two-slot page cut by the left edge narrowing (it leaves the view, the pages after it
slide over one gap behind), a page growing under an ArrowRight glide (rests at 1218, no step back) and under a wheel stream (worst step
back 0.24 px, as the stream alone), and with the Workspace summoned (root moves 0 px, summon stands). In all: changing edge one way,
worst frame 30.6-34.2 px of 406, last-3-frame max under 1.2 px against a median of 7.9-9.3 px, 0 frames cutting a one-slot page standing on
the grid, every rest on the grid.

Look at the screenshots (`width-*-mid.png`): at the strip's end the pages left of the narrowing page slide right with it, the page on
the right stays, no blank. One open observation: in `width-shrinkAside-mid.png` p2 is drawn about 29 px further from p1 than one gap,
while the per-frame measure (the main thread's layout, every frame) shows 0.01 px; the size box's scale runs on the compositor and the
slot glides (`composite: 'add'` translates) do not, so a captured frame can show the scale ahead. Not seen at the strip's end; not
checked on a real display.

Unit tests for step 4's pure helpers (`test/embla-row-summon.test.ts`, 11 tests, two of them properties): `emblaSummonPlan`,
`emblaAsideFor`, `markedScroll`. Mutants: dropping the edge-slot page from a summon's parks fails 3; letting a page wider than the
window step the root aside fails 1; flipping the sign of a right pin's screen offset fails the pin property.

### Audit fixes after step 5

An independent audit at b2a749a found these; each reproduced again at e71796f and each proof check below fails there (run from a
`git archive e71796f` extract with the new proof copied in) and passes now.

- Summon or dismiss pressed mid-glide. `moveEmbla` added the mark's fixed rest to the glide's remaining target (`target + (keepTo -
  location)`). A marked commit now lands the view where the mark says (`moveEmbla(..., land)`); the glide in flight ends and every slot
  that moved on screen glides from where it was drawn (Embla's drawn position, not its location, which runs up to a frame ahead).
  24 one-slot pages, root at index 8, from slot 14: `glideToSlot(18)` then summon 70 ms in rested at slot 21, root never shown
  ('away'); now root at 0, view root,p19,p20,p21, 'summoned'. Toward the root (`glideToSlot(10)`): root at the right edge (1218),
  view p6,p7,p8,root; now root at 0, view root,p11,p12,p13. Dismiss mid-glide (`glideToSlot(6)` from the summon): rested at slot 13,
  view p13..p16; now p14..p17 as before the summon. Summon and dismiss during a mouse-down drag were already right (the in-place
  shift): summon gives root,p13,p14,p15 (the drag had cut p13, which stays and moves over), dismiss p14..p17; kept as guards.
- Reduce Motion. `arriveAndLeave` glided and faded regardless, and Embla's own glides ignored it. Now the slot glides and fades take
  no time, arrow keys, the focus reveal and `moveEmbla` jump (`scrollTo(i, true)`), and a drag or wheel release settles at once
  (`scrollBody.useDuration(0)` on `pointerUp`, already pinned). Root drawn at 35 places on a summon and 36 on a dismiss, p16 at 45 on
  an arrow key, p1 at 35 on a step-aside; now at most 2 each, still keep-still and on the grid. The dot bar already honoured it.
- Step-aside re-check. The provider re-ran the step-aside on any change of the other panels' ids or widths, so closing a far page
  (p8 of `3,1,1,1,1,1,1,1` at 1400 px, the root back at 0 after a wheel toward it) stepped the root aside again and the view jumped
  406 px. It now re-runs only for a window change, a panel's own width change, a change of the root's two neighbours, or the page
  it stepped aside for closing.
- Blank pages at a low cap. The loader read Embla's location, which mid-glide runs ahead of the drawn strip, so the page still drawn at
  the trailing edge was unloaded while in view (cap 4 = the window's fit, p20's dot: 4 of 92 frames). It now reads the drawn
  position, counts what the next 8 fixed steps of travel bring into view and the window where the glide is going as shown (loaded
  whatever `maxLivePanels` says), and Embla's `select` also notifies the loader. Probe after: 0 frames at cap 8, cap 4 and near 0.
- The leaving-slot rule from step 4 had no check: `summon fromLeft` and `fromRight` now require a page leaving from out of view never
  to be drawn in the window, and one leaving from the view to start its exit from its place (0 px now).
- `blank-trials.ts` never ran the Embla row (its page has no `rowEngine`, and its control hides `[data-row-strip]`, which Embla never
  renders). The Embla check is `embla-row-proof.ts --only blank`: a parking row on a magenta page, cap 8 and cap 4 (the window's
  fit), a far dot press (three times at cap 4), a far jump and back, a wheel fling (20 x 60 px) and a summon; every presented frame
  (CDP screencast) must have no band of window columns at least 100 px wide that is page magenta, and every animation frame no
  unloaded placeholder in the window. Control: the same dot press with every slot hidden must read blank (75 of 93 frames, widest
  1604 px), or the run reports that it proved nothing.

| `--only blank` | e71796f | now |
| --- | --- | --- |
| dot press p20, cap 4, three trials: frames with a placeholder in view | 1, 4, 3 of 92 (pixels: 1, 3, 2 frames, widest 284 px) | 0, 0, 0 |
| dot press, cap 8; far jump; wheel fling (cap 8 and 4) | 0 | 0 |
| summon at slot 14, cap 8 and 4: placeholder in view | 0 | 0 |
| hidden control | reads blank | 75 of 93 frames blank |

The summon run shows a band of the page about 220 px wide for 11 frames, at e71796f as now: the edge page shrinks out while the
root slides in from outside the window (`summon-left-mid.png` shows it). No page there is unloaded, so it is recorded, not failed;
whether the root should fill that slot sooner is a design question for the summon, not the loader.

Mutants (one per fix, each from a `git archive` of this branch): the mark's rest dropped from `moveEmbla` fails 3 summon checks; the
Reduce Motion duration in `arriveAndLeave` fails 2; the old ids-sensitive step-aside re-check fails 3; the leaving-slot hold removed
fails 2 (a leaving page drawn 390 px into the window); the loader reading Embla's location instead of the drawn position fails 3 blank
checks (5 of 96 frames at cap 8).

Step-5 leftover, measured: in presented frames (CDP screencast, magenta page) of `shrinkAside`, the gap between p1's drawn right edge
and p2 grows to 78 px (16 at rest) while the per-frame layout says 16.0 px throughout. It is real: p2's glide is a main-thread
(`composite: 'add'`) translate and p1's size box scale runs on the compositor, frames ahead. Not fixed: forcing the size box onto the
main thread with `composite: 'add'` broke it (the DOM gap reached 422 px); the fix needs the slot glides compositable or the size box
and its neighbours on one clock. Open.

### Step 6: drag to reorder, with edge scroll

The plan's first try, dnd-kit with Embla's auto-scroll, fights the row and was dropped: `@dnd-kit/sortable`'s auto-scroll moved the
transform-drawn Embla row 0 px, a 1200 px row move under a still pointer fired 0 over events, and it reorders DOM nodes, which would
reload web views. The fallback the plan named is what shipped: our reorder (the grab strip's drag, `@dnd-kit/core` 6.3.1 for sensors,
Escape and announcements, as before) with its edge loop pointed at Embla.

- `edgeScrollerOf` and `edgeScrollOf` (`panelRowDropScroll.ts`): a drag inside an Embla row's window edge-scrolls that window and counts
  from where the strip is drawn. `openEdgeHold` takes `holdEmbla` (`emblaRow.ts`), the one writer while the hold lasts: it writes the
  drawn position (`writeEmbla`), so the strip and the dragged box move in the same frame and the box stays under the pointer.
- The bands are the window's own edges (no insets, no hidden panels to swap in; the stops are the strip's rests, which a Reduce Motion
  hold jumps between). A release settles on Embla's nearest stop; Escape (`edge.end(true)` in `dragToClose.tsx`) returns the row to
  the stop it started from, with the order unchanged.
- A person's move (a drop, or an arrow key on the grab strip) is noted by the slot (`noteReorder` on `PanelSlotValue`, recorded by
  `usePanelDragProps`) in the task that moves the panel. In the render that draws it, `PanelRow` leaves the view where it is drawn
  instead of keeping the left-edge panel still, and glides (jumps under Reduce Motion) to the nearest stop that shows the moved panel
  whole if the move took it out of view. A note older than 1 s is ignored (the host refused the move).
- The dragged panel is never unloaded (`loadedNear`'s `unloadable` skips it), however far the edge scroll carries it.

Embla internals: none new (`holdEmbla` writes through `writeEmbla`, already pinned).
`test/embla-row-reorder.test.ts` (2 tests): one hold at a time, writes clamped to the strip and drawn at once, nothing written after
release; dropping either guard fails one.

Measured (`embla-row-proof.ts --only reorder`, 1800 x 900, the root and 24 parkable one-slot pages, window of four, cap 8, the proof
page's `grab=1` mode):

| check | result |
| --- | --- |
| p2 held 6 px inside the right edge for 1 s, no mouse motion | row moved 917-958 px, 0 still frames of 71-74 (four runs); p2's content 0.01 px from the pointer |
| control: held mid-row 1 s | row 0 px |
| pages the dragged box never passed over, along the strip, any frame | 0 px (p9..p24, root, p1); passed over p3..p8, each an eased 406 px hop, worst frame 30.8-33.8 px (the release and its settle included) |
| placeholders drawn in the window over the hold | 0 frames; Embla's own drag 0 pointerDowns |
| drop | rests 1218 on the grid, p2 lands at the slot it was let go over, 1 order commit |
| Escape after 497-501 px of edge scroll | row back at 0, every page 0 px off its place, order unchanged, 0 commits |
| p7 dropped into the left-edge slot from slot 5, pointer 145 px into the window | row 0 px held and after, p7 at 0, 1 commit |
| same, pointer 25 px in (inside the 48 px band) | row edge-scrolls 151-158 px while held, the release settles on the nearest stop (2030), p7 lands whole there, other pages 0 px |
| ArrowRight on p1's grab strip | row stays at 0, order moved one place |
| ArrowRight on p3, the right-edge page | p3 out of view, the row glides to 406 (settled at about 1.4 s), p3 whole at 1218 |
| p1 dragged a slot and a half left over the root | same order as the own row (`p1,root,p2,p3`) |
| Reduce Motion: hold at the right edge 1.2 s | 812 px in 2 jumps, drift 0 px, 0 settle frames, rest 1218, 1 commit, 0 blank frames |

The first draft of this section failed three of these on the proof, not the row (frame dumps `reorder-*-frames.json`): it counted
p6 and p7 as "not crossed" because the final order did not include them, but the held page passed over them at the edge and they
glided back when the pointer went mid-row; its left-edge drop stopped the pointer 25 px into the window, inside the band, so the row
edge-scrolled and settled back (158 px out and back); and its key case read the row 900 ms after the press, in Embla's glide tail
(405.46, 406 at about 1.4 s).

Negative control: this proof copied into a `git archive c19c65d` extract (the row before step 6), switch on: 10 failures; every
check above fails there except the root rule, ArrowRight on p1, Embla's own drag staying off and the mid-row control (the
behaviour was already right). On c19c65d the row does not edge-scroll at all, so the drift, pages-not-passed-over and placeholder
checks fail there only through their travel gate (they read 0 px over 0 px of travel); the original pages-not-crossed reading did
see p6's 30.7 px hop, so the per-frame strip measure can see a moving page. Mutant: the
reorder note's branch in `PanelRow` turned off fails 2 (the left-edge drop moves the view 406 px and leaves p7 at -406; ArrowRight
on p3 leaves it cut at 1624).

Look at the screenshots: `reorder-hold-mid.png` and `reorder-leftEdge-band-mid.png` show a page cut at the window's edge while the
row edge-scrolls between stops, as any scroll in motion does; at rest nothing is cut (`reorder-leftEdge-outside-mid.png`,
`reorder-hold-rest.png`). The dragged page is clipped by the window's edge while it is held there (it is not lifted out of the row).

### Step 8: pages out of the window are inert; an opened page comes into view

Two library gaps the app hit when it switched to the Embla row.

- Inert. On the old row a slot off the grid got `inert` (and no pointer events) from the drawing pass (`rowDraw.ts`). The Embla row
  never set it, so a focused page resting out of view kept its focus, and the app's halo (keyed on `[data-row-slot][inert]`) lit the
  gap past the window. `markAwaySlots` (emblaRow.ts) marks every slot drawn wholly outside the window `inert` and clears it as soon
  as any part is drawn inside. It reads each slot's drawn box, so Embla's drawn position (not its location, which runs up to a frame
  ahead), a slot's own glide (a summon, a dismiss, a width change) and a reorder shift all count where they are drawn. It runs on
  every Embla row notice (each drawn frame of a glide, drag or wheel, every direct write and shift) and, after each commit and each
  notice, in a frame loop that lasts 1.5 s and until the slots have stood still for 20 frames. An inert page takes no focus, key or
  pointer; Tab already skipped inert panels (`panelRowTabOrder.ts`). A page focused while partly in the window is not inert, so the
  focus reveal still brings it in whole; a page a dot press glides in is cleared on the first frame any part of it is drawn inside,
  and takes focus at rest. A focused page that a scroll carries wholly out loses focus, as it did on the old row.
- An opened page. `useProvidePanels` ran a scroll request (an open, a show, a host's `panel.scrollTo()`) through the old row's
  scroller, which on Embla has no strip, so nothing moved and a page opened at the strip's end stayed out of view. On a strip it now
  calls `showOnEmbla`: from where the row is heading (`target`), the stop nearest the panel's `scrollOnOpen` place ('into-view' the
  least move, 'start', 'center'), a glide by Embla's `scrollTo` (a jump under Reduce Motion), nothing when it is there. The keep-still
  rule ran first in the commit that drew the page (the pages already there do not move until the glide), so the glide is the only
  move, and carrying the Workspace out of view is that glide. While a press, a wheel gesture or a reorder hold holds the row
  (`emblaHeld`), the scroll waits for the release (`whenEmblaFree`: Embla's `pointerUp`, `holdEmbla`'s release) and then reads the
  strip as it is drawn then. A request whose panel the published strip does not carry yet waits one commit, as before.
- `followPanel` (`scrollOnMove: 'follow'` after a move, a place or a resize) judged "in view" against the old scroller, which reads 0
  on Embla; once scroll requests moved the Embla row, a page resized far left of the view scrolled the row to it (the `change`
  section's left-edge page moved 810 px). On a strip it now reads the drawn strip, and a width change (resize, `setSlots`, a reset)
  does not follow at all: step 5's rule keeps the pages beside a growing page still (`width growInView` moved them 406 px otherwise).

Embla internals: none new (`dragHandler.pointerDown()`, `target`, `scrollSnaps` are already pinned).

Measured (`embla-row-proof.ts --only inert,open`, 1800 x 900, the root and 24 one-slot pages, window of four; each frame read in a
task after it was drawn). Negative control: the same proof copied into a `git archive e2515fc` extract: 14 failures (every inert case
and every open case); passes now.

| check | e2515fc | now |
| --- | --- | --- |
| slot-frames whose inert is not "drawn wholly outside" (rest; glide to slot 6; wheel 40 x 14 px; mouse drag 600 px; summon; dismiss; grab-strip ArrowRight out of view; dot press p20) | 378 / 1972 / 4370 / 3217 / 1375 / 1972 / 2031 / 1984 | 0 in every case (18-213 frames each, 1-35 edge crossings) |
| focus on an inert page | (no page was inert) | refused |
| p20 after its dot press: focus | taken | taken; it is drawn inside from frame 22 |
| focus on the three-slot p2 cut by the right edge | | glides 0 > 406, whole, on the grid |
| open at the strip's end, root in view at 0 | row stays at 0, page at 10150, root in view | glides to 8932 in 102 frames (worst 615 px of 8689), page whole at 1218, root away |
| open 80 ms into a glide to slot 3 | rests 1218, page out of view | rests 9338 (the end), page whole |
| open under a mouse drag held 150 px | after release rests at 0 | row stays at 150 under the pointer, then rests 8932 with the page whole |
| open under Reduce Motion | rests 0 | at once (0 moving frames recorded), page whole |

Mutants: no subscription to the row's notices (marks only after a commit) fails 6 (glide 12, wheel 4, drag 457, reorder 796, dot
press 781 slot-frames, and p20 refuses focus); the deferral dropped (`whenEmblaFree` runs at once while held) fails 2 (under the held drag the row
glides off to 8481 px, and after the release rests at 8526 with the page out of view).

### Second audit fixes (after step 8)

An independent audit at 2c8d40b found these; each check below fails on a `git archive 2c8d40b` extract with the new proof copied in,
passes now, and fails again with one mutant of its fix (each from a `git archive` of its commit). `--cases a,b` runs named cases of a
section (`reorder.wheel`, `width.shrinkAsidePresented`, `blank.summon`, ...).

- Wheel during a reorder drag (`--cases reorder.wheel`). The wheel-gestures plugin took the wheel while the reorder hold wrote the row, so
  Embla's own drag ran beside the one writer. The own row refuses every step while a drag holds its claim (`glideTo` is false under a
  claim), so that is the behaviour kept: the wheel listener (registered before the plugin's, now not passive like the plugin's) stops a
  wheel while `holdEmbla` holds the row and cancels a sideways one. 24 parkable pages, cap 8, p3 held 200 px right, 40 wheels of 12 px:
  at 2c8d40b the row moved 480.5 px, Embla's drag pressed in 174-176 frames (1 pointerDown), the page drifted 5.1-6.0 px off the pointer
  while the wheel ran, and the drop rested at 812 (nearest stop 406). Now 0 px, 0 frames, 0 px drift, rests at 0. Control: the same stream
  after the drop moves the row (168.5 px peak). Mutant (the hold test dropped): fails 3.
- shrinkAside on presented frames (`--cases width.shrinkAsidePresented`, CDP screencast on a magenta page). A 400 ms main-thread block
  mid-shrink settled the cause: p1's right edge kept moving (762 px) while p2 stood still, so the size box's scale ran on the compositor
  and the slot glides (composite 'add') did not. On an Embla row `PanelSizeBox` now adds its scale to the box's own transform
  (composite 'add', which Chrome keeps on the main thread) with `transform-origin` on the box's style for the run; the earlier attempt
  animated the origin additively too, which summed with the base origin. Widest band between two pages in any presented frame: 137 px at
  2c8d40b (77 px in the audit's run), 16 px now (one gap; the limit is 24); the layout measure stays 0.01 px. Under the same block p1 and
  p2 now freeze together (20 px). A clip-kind size box (reveal) on Embla runs on Motion's frame loop instead. Mutant (the box back on
  the compositor): 77 px, fails.
- Summon band (`--cases blank.summon`, now failing on a band wider than 16 + 8 px; it was recorded, not failed). The page leaving the
  slot the pinned root glides into stays at its rest through its exit (`setStayingExit`, read by the slot's exit) and is cut back from
  the root's side by a clip on the root's curve and clock; the gap between root and page closes as the root lands, so root, page and
  next page never show two gaps at once. Widest band: 220 / 228 px at 2c8d40b (cap 8 / 4, 25-26 of 39 frames), 16 / 16 px now. Reduce
  Motion: no glide and no cut, both land at once (the summon section's reduced case passes). Mutant (the leaving page runs its own
  exit): 220 / 216 px, fails. The cut alone (no clip, page held) also reads 16 px: the root then slides over the page instead of beside
  it; that difference is seen in the screenshots (`summon-left-mid.png`), not by a pixel check.

### Third pass (after the second audit)

Each check below fails on a `git archive 8e85487` extract with the new proof or test copied in (or on the unchanged files at the tip
before the fix, where `git diff 8e85487` of the fixed file was empty), passes now, and fails with one mutant of its fix (from a
`git archive` of the fix's commit).

- Dismiss beside a cut wide page (`--cases summon.asideCut`). The root stood aside for a four-slot page; a step right cut that page one
  slot at the left edge; a summon then a dismiss rested on the page's left edge (p1@0, was p1@-406; the app's "wide returns"). A summon
  from a step-aside now records where the page was drawn, and the dismiss rests it there. Mutant (the dismiss reveals the page again):
  fails. The summon section's cases are named now (`summon.fromLeft`, `summon.asideSize`, ...).
- `useRowFrameBand` measured only the old row's strip, so on Embla it never observed anything and never reported (the app's
  `--row-above`/`--row-below`). It takes the Embla window when there is no strip (`test/row-frame-band.test.ts`: 'none' on 8e85487).
  Mutant (strip only): fails 1.
- No page past the cap before the window is measured (`--cases strip.firstCommit`; the page's `late=1` draws the row unmeasured first,
  as the app does). Unmeasured, the window is the whole strip wide, so all 24 parkable views mounted at cap 8 and at cap 4 (the app:
  8 of 5 on a restore). The loader now takes the cap's nearest pages until the window is known: 8 and 4 mounts. Mutant (window
  always known): fails 4.
- Bare-arrow edge focus (`--cases keys.edgeFocus`). The Workspace's handler returned at once on Embla; a bare arrow with the panel in
  use out of view stepped the row (405 px) and focused nothing. It runs on Embla now, and `focusEdgePanel` reads the view as the
  Embla window: the row stays, Right focuses the leftmost page in view (p11), Left the rightmost (p12). `EMBLA_WINDOW_ATTRIBUTE` moved
  to `rowDom.ts`. Mutant (the Embla early return back): fails 2.

Items 5, 6 and 7, left from this pass, are in the fourth pass below.

- ArrowRight after a window-bar summon (app `workspace-summon.mjs`: "a step away returns the row", "stepping left reaches Workspace",
  "one step carries it out" at 1400 and 1800, 6 failures on the 8d42f37 build). The key reached the row and Embla took it, but
  `scrollNext` steps from Embla's selected index, which a direct write (the summon's land) leaves stale, so it named the stop the row
  rested on. A key step now goes one stop from the stop nearest where the row is heading, and a step away from a summoned root
  dismisses it (the own row's "a step away returns the row"). App proof on the 76059ee build: 1787 checks, 0 failed. Library case
  since: `summon.arrowAway` (fourth pass, below).

### The summon's cut, on presented frames

- `--cases summon.clip`: the page leaving the slot a summoned root glides into is cut back from the root's side (PanelRow's
  `arriveAndLeave` clip-path), so the root slides in beside it. Over that slot, on every frame the compositor presents, each column
  reads as the root's fill, page background or page: the root must be seen partly in (25 of 40 frames from each edge at f725aa1), and
  early in the glide background must lie between it and the page. With the clip-path removed it fails from both edges: from the left
  the page hid the root in all 40 frames (it came in under the page), and from the right the root met the page with no background in
  6 of 6 early frames (it slid over it).

### Fourth pass (items 5, 6, 7 and 11)

Each check fails on a `git archive` extract of the commit before its fix with the new proof copied in, passes now, and fails with one
mutant of its fix.

- Arrow after a summon (`--cases summon.arrowAway`, item 11). From the left, ArrowRight returns the row (p14..p17 at 5684, the pages in
  view standing still) and the next ArrowRight rests one stop on; from the right, ArrowLeft returns it and ArrowRight steps to p2..p5.
  At 8d42f37: 6 failures (ArrowRight stepped to 6089.5 with the summon over; ArrowLeft left the root summoned). Mutant (the step-away
  dismiss removed): the same 6. The other half of 76059ee (a step counts from the stop nearest where the row is heading, not Embla's
  selected index) has no proof case: reverting it to `scrollNext` passes the proof, because every library write ends in a `scrollTo`
  that sets the index; the app's window-bar summon (`workspace-summon.mjs`) is its check, and `test/mount-row-engine.test.ts` (the host
  chord, which still stubbed `scrollNext` and failed since 76059ee) now requires one stop from the stop nearest the row's target, and
  fails on the `scrollNext` revert.
- A wheel gesture running when a reorder hold starts (`--cases reorder.wheelBefore,reorder.wheelClick`, item 7). The plugin holds
  Embla's drag with an untrusted press and lets go only when the gesture's tail ends; that release glided the row to a stop under the
  held page (d288b48: 168 px under the hold, Embla pressed in 14 held frames). A person's press now ends the wheel's press and leaves the
  row where it is drawn (as a press stops a native scroll's momentum); its release settles the row on a stop unless a reorder hold took
  it, and the hold ends one too. Now 0 px, 0 frames, 0 px drift; a press and release with no drag: 137.8 px moved under the press at
  d288b48, 0 now, rest on the grid. Mutant (nothing ends the press): both fail. The drift is read off the grab point in the first frame
  recorded after the press, once the pointer stands still (the dragged box follows a pointer move a frame late).
- API (`--cases summon.api`, item 6). `panel.scrollTo()` answered off the old scroller (0 on a strip): from slot 10, a scrollTo of p2
  moved the row to 812 and answered `changed: false`; it now reads where the Embla row is heading (`emblaWouldShow`). A request for the
  Workspace while it stood aside was dropped; it comes back at the edge it left by and is shown (root at 0). `usePanelPresence` never
  read 'scrolledAway' on Embla (0 of 20 inert pages); the row's away store now follows the inert marks (20 of 20). A scroll request no
  longer asks the old scroller whether a drag holds the row: the Embla row's holds defer it (`whenEmblaFree`). At bb5dc10: 3 failures;
  one mutant per fix fails its own check.
- Reduce Motion on the row's own moves (`--cases summon.reducedRelease`, item 5). A mouse drag's release, a wheel release with a strip
  change waiting for it (`moveEmbla`'s rebuild) and a focus reveal land in 1, 0 and 1 moving frames; without Reduce Motion the same
  inputs glide 59-63 frames (control). Mutant (the reduced flag never set): all three fail, and `summon.reduced`'s arrow.
- The loader's look-ahead (`--cases blank.lead`, item 5). Far dot press at cap 4: pages the glide carries into the window load 2-8
  frames before they enter (median 4; the first at 0 as the glide starts). `AHEAD_STEPS = 0`: 14 of 18 enter in the frame they load,
  median 0, fails. The look-ahead stays: it is the time a page (a web view) gets to draw before it is seen.
- Reorder checks tightened (item 5): passed-over range from held frames only, a page passed over only when the box covered more than
  half of it, 70 px per frame for a passed-over page (was 101.5; hops measure 30.8-33.8) in `edgeHold` and both left-edge drops, and
  the band drop must land within half a slot of where it was let go (1873.6 released, 2030 landed).

Not applicable on a strip, with the evidence: `revealOnScroll` brings in a panel parked for room when a step reaches the row's end;
on a strip nothing parks for room (step 7: `rowPricing` gives a strip an infinite capacity, 25 of 25 slots drawn), so there is no
such panel. A host's own hide stays hidden on a strip and is not revealed by a step (the old row's step would): untested, noted. The
settle after a hand resize: on a strip every width commit runs `moveEmbla`, which rests the row on a stop (step 5's width cases rest on
the grid in every run), so no separate settle is needed; a hand resize itself is still untried on Embla.

Not done: a presented-frame pixel check that fails when the summon's leaving-page clip is removed (the screenshots remain the only
evidence that the root slides beside the cut page, not over it).

### A wheel that pauses or stops (the owner's wiggle and drag-back)

Owner's report, after trying the app: "Scrolling has a wiggle/drag back effect when as i scroll the wheel when I lift my finger to
reposition it and when stop scrolling altoghether".

Cause, read off per-frame traces (`--only settle`, each case's frames in `settle-<case>-frames.json`):

- The wheel-gestures plugin ends its gesture at any pause of about 100-170 ms (its end timer is about twice the gap between wheels,
  at least 100 ms), so a finger lifted to reposition ends it, and in Chromium 151 it also ends at the first event flagged
  `WheelEvent.momentum` (a trackpad's lift). Its untrusted mouseup is Embla's drag release: Embla picks the stop nearest the drag's
  target plus a flick guess from the last 170 ms. On a trackpad swipe stopped at 121 px that stop is 0, so the row glided back 24 px
  (7.5 px in one frame) until the next swipe pressed again and turned it forward: the drag-back, then the wiggle. On mouse-wheel bursts
  the flick guess threw the row ahead instead (1,200 px of notches rested at 1,624 or 2,030 px).
- Embla's drag body (friction 0.3, duration 0.75) is an underdamped spring: at the end of every burst it ran 1-2 px past the wheel and
  came back, 10-15 backward frames per run.

The old row never had this (Joe recalled a similar fix there): its gesture (`useRowScrollGesture`) asks for steps in the direction of
travel only, one stop ahead per step, a step mid-glide retargets the glide in flight, and travel against the gesture under a quarter
step (a momentum tail's flicker) is not a reversal. The half-step commits (`8e9e9e0`, `5802c60`) concern where a dot click or a step
rests, not the wheel. The same rule now holds on Embla:

- One wheel gesture is one press of Embla's drag, from its first wheel until the wheel has been idle `WHEEL_IDLE_MS` (500 ms,
  Chromium's own mouse-wheel transaction, `kDefaultMouseWheelLatchingTransaction`: a wheel that soon after the last one is the same
  scroll). The plugin's own release is held back, its next press continues the same drag from where Embla last read it, and a
  momentum tail it drops after its momentum release moves the row by each event's delta, short of the row's ends. No study of how long
  a finger takes to reposition on a wheel was found; a pause longer than 500 ms settles and the next burst continues from the drawn
  position.
- At idle the release rests on the first stop not behind the travel (`stopAhead`, since replaced by `restStop`: "The wheel follows 1:1", below; on a stop within half a px it stays). The direction
  turns only after 8 px of travel against it.
- While a wheel drives it, Embla's body is critically damped (friction 0.1, duration 0.22): it trails the wheel by no more than the old
  spring did (33 px in a 40 px-per-30 ms burst, modelled) and never overshoots.
- A key step during the hold ends it where the row is drawn and steps from there, as a press already did. Keyboard, dot bar, mouse drag
  and summon settles are unchanged.

Measured (`--only settle`, narrow row, pitch 406; wheels handed in on their own timers, a trackpad's one per frame; per frame, backward =
a frame moving more than 0.5 px against the scroll):

| case | 1529ed3: backward frames / px (worst frame), reversals, rest, settle | now |
| --- | --- | --- |
| notches 6 x 40 px, 80 ms pauses, x5 | 6 / 6.0 (1.6), 6, 1218, 435 ms | 0 / 0, 0, 1218, 1066 ms |
| 150 ms pauses | 12 / 10.7 (1.2), 10, 1624 (input 1200), 1097 ms | 0 / 0, 0, 1218, 1035 ms |
| 300 ms pauses | 15 / 11.6 (1.0), 10, 2030, 1062 ms; bursts 1.09-1.13 px/px | 0 / 0, 0, 1218, 1056 ms; bursts 0.99-1.00 |
| 600 ms pauses | 13 / 10.9 (1.2), 10, 2030, 745 ms | 0 / 0, 0, 1624, 1361 ms |
| trackpad, momentum flagged | 5 / 24.2 (7.5), 2, 406 | 0 / 0, 0, 812, 1466 ms; tail 1:1 (1.001) |
| trackpad, tail not flagged | 5 / 23.3 (7.2), 2, 406 | 0 / 0, 0, 812, 1466 ms |
| 440 px, just past 406 | 4 / 4.5 (1.7), 2, 812 | 0 / 0, 0, 812, 1450 ms |
| 360 px, just before 406 | 3 / 2.8 (1.2), 2, 406 | 0 / 0, 0, 406, 1191 ms |

Every case fails at 1529ed3 on its backward frames and reversals. Each burst that starts from a standing row moves 0.99-1.02 px per
input px now; a burst that starts while the settle glides (600 ms pauses) carries up to a frame of that glide and is checked only for
moving one way. The rest-behind and settle-time (1.8 s) checks are guards the tip also passes. Mutant (the release rests on the nearest
stop, `stopAhead(…, 0)`): 4 of 8 cases fail: just past (29.8 px back, rests 406), 600 ms pauses (121.3 px back, 11.8 px in one frame), both trackpads
(9.1 px back, rest 406); the four whose nearest stop is ahead anyway pass, as they should under that mutant.

What this costs: the row now holds still, off the grid, for 500 ms after the last wheel before it settles, and a scroll that stops just
past a stop goes on to the next one (440 px rests at 812, 372 px further), because a stop behind is ruled out; settles take 1.0-1.5 s
after the last wheel (0.4-1.1 s at the tip, which settled sooner by settling backward).

Not covered: a real mouse wheel and a real trackpad (headless takes only synthetic wheels: the streams are shaped, not recorded),
Safari, where the plugin guesses a momentum tail from its deceleration (in Chromium 151 every wheel carries a `momentum` flag, so that guess never runs here; the unflagged case is a tail the plugin passes as plain wheels), a horizontal
tilt wheel's own cadence, and the gap a real finger reposition takes.

### The Workspace as an ordinary page (owner ruling 2026-11-09)

Joe picked "Workspace as a normal page": the Workspace sits in the row and scrolls like any page, reached by scrolling or its dot. His
model of the summon: "Isn't it just a quick reorder of where ever the workspace currently sits to just offscreen, and then normal
scrolling brings it in?" So on Embla `summonRoot()` (the window bar's button and tabs) does two things:

- `emblaSummonMove` (emblaRow.ts) picks the slot just outside the view on the side the root lies on (the left when on neither): next
  to the first page reaching into the view on the left, or the last one on the right. The provider moves the root there with
  `reorderPanel(rootId, hops, true)`, the person's move path (one order commit, recorded as the saved order). The view read is the one
  drawn now, so mid-glide the root never lands inside the view.
- The glide is `requestScroll` of the root (`showOnEmbla`: from where the row is heading, to the nearest stop, a jump under Reduce
  Motion, deferred while a gesture holds the row). A wheel gesture's hold is ended where the row is drawn first (`endEmblaWheel`, as a
  key step does); a person's drag defers the whole summon to its release (`whenEmblaFree`).
- The commit that draws the move snaps the slots it moves (`noteEmblaMove`; all of them are out of the view), so the root stands at
  its new place before the glide brings it in and no page slides on its own. Pages in the view keep their strip places, so the
  keep-still rule leaves the view where it is.

After that the root is an ordinary page. `dismissRoot()` does nothing on Embla and returns false; `rootView()` reads 'shown' or 'away'.
Scrolling to it or pressing its dot only scrolls. With it wholly in view the summon does nothing.

Deleted (emblaRow.ts, PanelRow.tsx, PanelRowSlot.tsx, useProvidePanels.ts): `emblaSummonPlan`, `emblaAsideFor`, `EmblaRowMark`,
`markEmblaRow`, `markedScroll`, `emblaMarkOf`, `setStayingExit`, `staysOnExit`, `onEmblaStep` (the step hook), moveEmbla's `land`,
`stayingEdgeExit`, the summon clip and the marked-commit slide-in and fade-in in `arriveAndLeave`, the provider's `stripSummon` and
`stripAside` state, the step-away dismiss, the step-aside layout effect and the aside branch of `requestScroll`. Unit tests removed:
the five `emblaSummonPlan`, two `emblaAsideFor` and four `markedScroll` tests (test/embla-row-summon.test.ts), replaced by five
`emblaSummonMove` tests (one a 400-run property: the root lands one gap outside the view on its side, every page reaching into the view
keeps its strip place). Proof cases removed: summon.dismiss*, stepToward, scrollOut, dotOut, arrowAway, asideResize, asideSize, asideCut,
apiAside, summonDrag, dismissDrag, dismissMidGlide, reducedAside, unrelatedClose, clip; width.growSummoned; inert's dismiss run.
Renamed: width.shrinkAside to shrinkBesideRoot (the root now stays beside the cut page) and width.shrinkAsidePresented to shrinkPresented.

Also changed: `moveEmbla` shifts a glide in flight in place (positions and target) instead of writing the drawn position and starting a
new glide from rest. The first draft placed the root next to the view the glide was heading for; mid-glide that was inside the drawn
view (the root appeared at 1113 px in the window) and the strip jumped 270 px in one frame (`summon-midGlide-frames.json`).

Proof (`embla-row-proof.ts --only summon`, 24 one-slot pages and the root, window of four). Per frame, over the pages drawn in the
window or one gap past its edges: every page moves by the strip's one shift within 0.5 px (nothing snaps or slides on its own), no
frame moves the strip more than half a slot, the window has no run wider than a gap that no page covers, no unloaded placeholder in it.

| case | result |
| --- | --- |
| fromLeft: root at place 2, view p14..p17 | root moved to place 13 (next to p14), 1 order commit, glides in: view root,p14,p15,p16 at 5278, root drawn at 39 places coming in, fastest frame 118 px, 0 px off the strip shift, widest hole 16 px |
| fromRight: root at place 20, view p3..p6 | root moved to place 6 (after p6), 1 commit, view p4,p5,p6,root at 1218 |
| stays: glide to 20, back to 13, scrollTo(root) from 20 | order unchanged, 0 commits, root at 0 back at slot 13 |
| inView: root in view | summon false, dismiss false, row moved 0 px, 0 commits |
| reduced (Reduce Motion) | lands at once (root at <= 2 places), same order and view, 1 commit |
| midGlide: pressed 90 ms into a glide 14 > 18 | root next to the drawn view (place 14), the glide turns and lands root,p15,p16,p17 at 5684; fastest frame 60 px, 0 px off the shift |
| midWheel: pressed during a 300 px wheel | the hold ends, root at 13, glides back to root,p14,p15,p16 at 5278; fastest frame 124 px |

Full proof (all sections): failed [], empty []. `summon.reducedRelease` (the intermittent focus check) is kept unchanged: it is
not a summon case (a drag release, a wheel release and a focus reveal under Reduce Motion); it passed in this run. Mutant (the
reorder skipped, so the summon is only a glide to the root where it lies): fromLeft and fromRight fail 8 checks (the strip moved
1415 / 1778 px in a frame, order unchanged, 0 commits, view root,p3,p4,p5 / p18,p19,p20,root). Library suite: 3286 tests, 3284 pass,
1 skip, 1 fail (`content that arrives after the timeout still comes in`, panel-loader; 10/10 alone, three runs) against 3292/3291/1:
11 tests removed, 5 added.

Blank (`--only blank`): the summon run is held to the same rule as every other run (no presented frame with a magenta band of 100 px
or more) and to a band no wider than a gap and 8 px. Inert: the summon run as before; the dismiss run is gone.

#### At the row's ends (the owner's snap-back)

Superseded by "The wheel without a press", below: the hold, the stopped set and the wheel's stretch are gone. This records why they were there.

Owner's report, on a mouse wheel: "I scrolled all the way thought the first blue dot, and then it snapped back to where it is!" The
oval rested about ten dots right of the start.

Cause, read off per-frame traces (`--only settle --cases settle.endLeft,...`; each case's frames, with Embla's location and target, are
in `settle-<case>-frames.json`):

- A pointer move by the person reached the held press. The plugin blocks trusted mouse events only while its own gesture runs. The hold
  above keeps Embla's press past the plugin's end, through a finger's pause and the 500 ms after the last wheel. Embla listens for
  `mousemove` on the document. A 1 px move of the mouse under the hand reached Embla's drag, which read it against the plugin's pointer,
  the gesture's whole travel away. In one frame the target went back to where the gesture began: 1,512 px in one frame, and a rest at
  3,248, the start of the scroll.
- The end is where a hand moves: the wheel is ground on past the end, then let go. Mid-strip the same happens on any pause the pointer
  moves in (`settle.midHand`).
- A long grind past the start turned the gesture around. Once the plugin's pointer is half the strip past the end, the plugin ends its
  gesture and passes nothing until the wheel pauses. Each wheel then goes through the row's tail path ("short of the row's ends"),
  which clamped the target into `[0, max]`. From a stretched target (-208) that is a 208 px pull toward the end, against the wheel. It
  turned the gesture's direction, and `stopAhead` from the target left 0.83 px inside rested on the next stop: 406 px off the start
  (`settle.endLeftLong`, 1 of 2 full runs at 97aab2c; the pull itself is in every run, 200-208 px in one frame).
- Ruled out by the traces: the rest computed from an out-of-bounds target, a misread direction, and Embla's own bounds pulling back.
  With handed-in wheels and no pointer (`settle.endLeftFeed`, `endRightFeed`), 9a55bbb rests exactly at each end. The drag stretches the
  row 280-330 px past the end, with Embla's edge resistance, and springs back to the end. The step-aside depends on that stretch: a
  Workspace stepped aside at the start comes back only when the row moves past its rest toward it (`summon.unrelatedClose`). A clamp of
  the wheel at the ends was tried. It broke that case ("the wheel did not bring the root back"), so the stretch stays.

Fix: while a wheel gesture holds the press, a person's trusted `mousemove`, `mouseup`, `touchmove` and `touchend` (the set Embla's
drag listens for on the document from a mouse press, `DragHandler.addDragEvents`) are stopped at the document before Embla's own
listeners. They are registered at mount, ahead of the ones Embla adds at each press. A trusted press inside the row still ends the hold
first (`onPress`), so its own release passes. The tail path never moves the target back toward an end it is
stretched past: a wheel there moves nothing, and Embla's edge resistance and the release bring it back.

Measured. The row is narrow: 25 one-slot pages, the Workspace first unless said, pitch 406, max 8,526. Bursts are six 40 px notches,
30 ms apart. The pauses run 80/300/150/450 ms in turn (one held gesture), or 80/300/150/600 ms. The wheels are real (trusted, at the
pointer), except in the feed cases. "Hand" means the pointer moved 1 px. "Back" counts a frame that moves more than 0.5 px against the
scroll and lands inside the strip:

| case | 9a55bbb: rest, back px (frames, worst frame) | now |
| --- | --- | --- |
| endLeft: from 3,248 to the start and 1,072 px on, hand 200 ms after the stop | 3,248; 3,950 (9, 1,512) | 0; 0 |
| endRight: the same into the right end | 5,278; 4,032 (9, 1,538) | 8,526; 0 |
| endLeftRootFar: endLeft with the Workspace moved to the far end | 3,248; 4,018 (9, 1,538) | 0; 0 |
| endLeftHand: hand in every pause, 600 ms pauses | 2,842, never reached the start; 4,507 (34, 381) | 0; 0 |
| endLeftLong: from 812, 7,200 px with no pause, hand after | 812; 845 (26, 315) | 0; 0 (target back while pressed: 205 px at 97aab2c, at most 8 now) |
| midHand: 960 px from 6,496, hand in the pauses | 6,090; 1,002 (7, 381) | 5,278; 0 |
| endLeftFeed / endRightFeed: handed in, no pointer (controls) | 0 / 8,526; 0 | 0 / 8,526; 0 |
| midUp: midHand with a bare mouse button release in the pauses (a button held on a panel since before the wheel) | at 705f2c1: 5,684, behind the 5,536 reached; 144 (33, 9.5) | 5,278; 0 |

The stretch past the end is reported (`drawnPastEndPx`, 180-353 px at 9a55bbb and 210-321 px now) and not failed.

Independent re-trace (2026-11-09, headless, trusted wheels through CDP, two bursts of six notches with a 300 ms gap, no other input):
at 9a55bbb the row rests on the stop ahead (3,248 from 4,060) at every gap from 50 to 600 ms, so the double scroll alone does not snap
back; a trusted `mousemove` 250 ms after a burst (after the plugin's own end, 168 ms after the last notch in that run, inside the 500 ms
hold) does, even with no travel at all (same x and y: rest 4,060, the exact start, 480 px of target in one frame). A hand that moves
170 ms after the burst is still blocked by the plugin and does nothing. At 705f2c1 the same inputs rest at 3,248. What still reached
the held press at 705f2c1: a bare trusted `mouseup` (Embla's own release to the nearest stop, 132 px back) and a touch outside the row
(its `touchmove` is read against the plugin's pointer, as the move was); a right-click's `contextmenu` runs Embla's release once more
after the press has ended the hold (a 406 px target step to the nearest stop, then the press's own settle, also to the nearest stop).

Mutant (the pointer's move not stopped): 6 of 8 cases fail with the 9a55bbb numbers (endLeft rests 3,248, 1,509 px in one frame).
Mutant 3 (`mouseup` dropped from the stopped set): midUp fails with the 705f2c1 numbers (rests 5,684, 143.9 px back in 33 frames).
The two feed controls pass, as they should with no pointer. Mutant 2 (the tail path's clamp as at 97aab2c): endLeftLong fails,
with the target stepping 205 px against the scroll in one frame while pressed. The check is that no pressed frame steps Embla's target
more than 50 px against the scroll; edge resistance takes up to 26.

What this costs: while a wheel gesture holds the row, the document and the window hear no pointer move. The plugin already withheld
every trusted mouse event during its own gesture.

Not covered:
- A press inside the row during the hold ends it where the row is drawn and rests on the nearest stop, by design; a right-click there
  also runs Embla's own release on `contextmenu` (its root listener), to the nearest stop as well. A press outside the row leaves the
  hold alone, and its release is stopped with the rest.
- The hold itself is the design that lets these in: Embla's press is kept open across the plugin's gaps so that its release does not
  pick a stop behind the scroll. Driving the row by Embla's target directly during a wheel (no press at all) would close every such
  path at once, but loses Embla's edge stretch under a press, which the step-aside's way back reads (above); not done here.
- A touch moving during a mouse wheel's hold: `touchmove`/`touchend` are in the stopped set, and a touch inside the row ends the
  hold as a press; a touch outside the row was traced only at 705f2c1 (the set stops it) and has no proof case.
- The stretch past an end itself: a wheel with no rubber band would need the step-aside to read "toward the root" some other way.

### The wheel without a press (closing the family)

The two sections above held Embla's drag press open through a wheel gesture, and each input that reached the held press had to be
stopped by name (`mousemove` at 705f2c1; `mouseup`, `touchmove`, `touchend` at 34db111). A right-click on the row still ran Embla's
release, and every listener Embla adds at a press was another way in. Joe approved closing the whole family: the wheel no longer
presses at all.

How it works now (emblaRow.ts, `wheelBy`, `settleWheelRun`, `endEmblaWheel`):

- One listener on the window reads each wheel through `wheel-gestures` 2.3.0 (`feedWheel`): px from lines and pages, a cap on one
  event, the momentum flag, and it cancels a sideways wheel, so `feedRowWheel` still answers true. `embla-carousel-wheel-gestures`
  is dropped. It turned the wheel into a synthetic mouse drag, the press this section removes. `wheel-gestures` is its MIT
  normalizer, by the same author, and was already installed under it.
- A gesture starts on a sideways wheel that is not a momentum tail, as the plugin started one, and not under a person's drag of the
  row. Its first wheel stops a glide where the row is drawn, as the press did (a glide going the wheel's way keeps its speed). Each
  wheel adds its delta, 1:1 ("The wheel follows 1:1", below), to Embla's target with the critically damped body
  (friction 0.1, duration 0.22) and starts Embla's animation.
- While a gesture runs the row is held: `moveEmbla` shifts it in place and its rebuild waits, and `whenEmblaFree` waits. At 90 ms
  idle (60 ms after a momentum wheel, 350 ms while the gesture is slow, under `WHEEL_SLOW_PX_PER_MS`, so a pause mid-creep does not
  settle the row under a resting finger) it rests on `restStop` (below; the direction turns only after 8 px against it). The rebuild and whatever
  waited then run.
- Embla's drag adds its document listeners only at a press. So during a gesture no mouse move, release, click or touch reaches
  Embla. Embla's root still runs its release on `contextmenu` and `touchcancel` with no press. A capture listener keeps the wheel's
  target, and Embla's `pointerUp` puts it back with the wheel body.
- A primary press on the row ends the gesture where the row is drawn. Embla's own drag takes over if the press starts one (a gap, or
  a touch). Otherwise the release settles on the nearest stop, as before. A right or middle press leaves the gesture going. A dot
  press, an oval drag, a focus reveal, a key step, a summon and a reorder drag end the gesture where the row is drawn. A dot press
  was ignored until 500 ms after the last wheel; it now works at once.
- The ends (owner ruling 2026-11-09, "just stop"): the wheel's target is clamped to `[0, max]`, so the wheel stops flat at the first
  and last page, with no stretch and no spring back. Embla's own mouse and touch drag keep their edge stretch.

Deleted: `sendMouse`, `ownEvents`, `wheelPressed`, `liveRun`, `wheelMove`, `settleAhead`, `PERSON_INPUT` and its stop,
`onPluginMouse` (the replacement of the plugin's mouse events), `onWheelAfter` (the tail path) and its stretch clamp. Also the
`reInit` re-add of that listener, and the untrusted-press exception in `pressStartsRowDrag`. Its unit test now checks the same
rules without it.

The stretch: nothing on Embla reads it any more. The step-aside that read it ("the wheel did not bring the root back",
`summon.unrelatedClose`) was deleted with the Workspace-as-a-normal-page commits (31e5bc8, case list in 55530d6). Only the own
row's step-aside (`rootStepsAside`, `!strip` only) remains. The proof comments that called the stretch the step-aside's way back
are rewritten.

What a soft stretch would cost to add back: the wheel's clamp would become a damped overshoot past the bound, for example Embla's
`ScrollBounds` friction or the plugin's 0.25-0.75 damping. A timer would then pull back to the end. Without a press, Embla's bounds
constrain the target only when target and location are both past the limit. So that is about 15 lines in `wheelBy` and the settle,
a tuning pass, and the end cases changed back to report the stretch rather than fail it. It would not reopen the family: no press
comes back.

Proof (`--only settle`; frames in `settle-<case>-frames.json`, with `held`, the row's held flag, in the entry's frames):

| case | 705f2c1 | 34db111 | now |
| --- | --- | --- | --- |
| famMove0: mouse move of 0 px in each pause, 200 ms and 700 ms after | pass | pass | rest 5,278; 0 px back |
| famMove1: the same, 1 px | pass | pass | 5,278; 0 |
| famUp: bare mouse button release | 5,684, 143.9 px back in 33 frames | pass | 5,278; 0 |
| famDownOut: a click away from the row | pass | pass | 5,278; 0 |
| famMenuIn: a right-click on a panel of the row | 5,684, 153 px back | 5,684, 153.7 px back in 34 frames | 5,278; 0 |
| famMenuOut: a right-click away from the row | 5,684, 143.9 px back (its button release) | pass | 5,278; 0 |
| famTouchOut: a touch moving away from the row | 812, 1,780 px back, 1,106 px target step | pass | 5,278; 0 |
| endLeft (into the start) | drawn 306 px past the end | 319 px past | 0 px past, rests 0 |

Each family case runs four bursts of six 40 px notches from 6,496, going left, with 80/300/150 ms pauses. The hand acts in each
pause, 200 ms after the last notch (inside the 500 ms hold) and 700 ms after it (during the settle glide). Each case fails if the
trusted event it sends (counted at the window) never arrived. Every mid-strip case must also rest on the first stop ahead of the
wheel's whole travel (5,278 for 5,536).

All settle cases now: notch80/150/300 rest 1,218, notch600 rests 1,624, both trackpads 812, justPast 812, justBefore 406. All have
0 back frames and 0 reversals. Bursts move 0.99-1.04 px per input px; notch600's bursts start from the settle glide and are
excluded, as before. Settles take 1.03-1.47 s after the last wheel. The nine end and mid cases rest at their end, or at 5,278, with
0 px back, 0 px drawn past an end, and a target that never steps back while held.

Mutant (the `contextmenu` keep disabled): famMenuIn fails. The release set the wheel's target to the nearest stop at each
right-click: 166 px target steps, and a rest at 4,872, a page past the scroll. Every snap lay ahead of the travel, so no back-move
check saw it; the rest-ahead check was added for that and committed with the mutant's numbers. famMenuOut passes under the mutant,
as it should: a right-click away from the row never reaches Embla's root.

Gates: full proof (all sections), failed [] and empty []. Library suite: 3,286 tests, 3,285 pass, 0 fail, 1 skip, 264 of 264 files.
The count is unchanged: one unit test was rewritten and none were added. embla-internals-contract: 2 of 2 pass; it now also checks
`useFriction` and `seek`. blank-trials `cast glide 3 12`: 0 blank (201 presented frames). `cast hidden 2 12`: fails, as it must, with
2 of 2 trials blank. `tsc -p tsconfig.json` has one error, in test/compat-0.1.0.typecheck.ts (`closedByPerson`). That error is the
same at 34db111.

Cases changed because they asserted press mechanics, not outcomes:

- settle end cases: `pressedTargetBackPx`, which read Embla's press, is now `heldTargetBackPx`, which reads the row's held flag. They
  also fail a frame drawn past the end, where they used to report the stretch.
- `summon.midWheel`, `reorder.wheelBefore`: "a wheel gesture was running at the press" read Embla's press or its `pointerDown`
  count; they now read the held flag.
- `summon.reducedRelease`: the wheel's release frame was the plugin's `mouseup`; it is now the first frame after the hold.

Not covered:

- A real mouse and a real trackpad: headless takes only synthetic wheels and CDP input.
- The context-menu key was not driven. Embla's root hears the same `contextmenu` from it, so it takes the same keep as the right-click.
- A touch on the row during a gesture: it is a press, which stops the row by design.
- A Ctrl+click on macOS: a primary press that opens a menu, which ends the gesture like any press.
- Safari.

### The wheel follows 1:1

Owner's ruling (2026-11-09), replacing the speed curve and the coast: the row follows the wheel 1:1, with no speed-up and no coast
of the row's own (macOS already accelerates the wheel and gives a trackpad its momentum). His report on the curve and coast: "Slow
scroll will sometimes nudge the panels forward permanently which is incorrect behavior. Other times it will send you flying through
two or three panels, especially long ones." The first was the rest on the first stop ahead of any travel, however small; the second
was the coast (300 ms of the row's speed, up to a page and a third) added past the wheel's own travel.

The wheel path (emblaRow.ts, `wheelBy`, `settleWheelRun`, `restStop`):

1. wheel: `wheels.on('wheel')` hands each sideways wheel (px from lines and pages, at most 700 px an event: wheel-gestures) and its
   momentum flag to `wheelBy`, which adds exactly those px to Embla's target with the critically damped wheel body, clamped flat at
   the row's ends.
2. end: the gesture ends when no wheel has come for 500 ms (`WHEEL_IDLE_MS`, Chromium's wheel transaction), or 150 ms after a
   momentum wheel (a trackpad's momentum ending is its gesture ending). Every wheel restarts the wait, so the row never settles while
   the wheel goes on: settling inside a gesture was one of the two causes of the old wiggle ("A wheel that pauses or stops").
3. rest: `restStop` takes the stop behind and the stop ahead of where the gesture left the row, in its direction (which turns only
   after 8 px against it). The row rests ahead once it covered `BACK_FRACTION` (0.25) of that gap, else it returns to the stop behind;
   within half a px of a stop it stays. The gap is read from the two stops themselves, so a wide page's gap and a short end gap need no
   case of their own. One glide of Embla's own body takes it there.

Where the gesture "left the row" is the furthest of Embla's target and the drawn row in the direction of travel (in practice the
target). The wheel body never runs past its target, so a return moves the row back by less than a quarter of the gap it is in.
Reading the drawn row alone could rest behind a target the wheel had carried past the quarter.

One rule for a mouse wheel and a trackpad; only the wait differs. A wheel that starts while a settle glides the wheel's way keeps the
glide's speed (the target is led by speed x duration / friction), as before.

Measured (`--only settle`, narrow row, pitch 406, so a quarter is 101.5 px; wheels handed in on their own timers):

| case | input px | left the row at | rest | back at the settle | settled after last wheel |
| --- | --- | --- | --- | --- | --- |
| nudge80 (2 notches) / nudge100 (10 x 10 px) | 80 / 100 | 80 / 100 | 0 / 0 | 76.3 / 96.0 px | 1.25 / 1.28 s |
| nudge110 (11 x 10 px) / nudge120 (3 notches) | 110 / 120 | 110 / 120 | 406 / 406 | 0 | 1.42 s |
| justPast (21 slow notches) / justBefore (19) | 840 / 760 | 840 / 760 | 812 / 812 | 24.1 / 0 px | 1.10 / 1.19 s |
| notch80 / 150 / 300 (5 bursts of 6, one gesture) | 1,200 | 1,200 | 1,218 | 0 | 1.03-1.04 s |
| notch600 (5 bursts, each its own gesture) | 1,200 | 1,404.9 (last) | 1,624 | 25.6 px | 1.37 s |
| spin (12 notches 16 ms apart) / spinPaused (two spins, 150 ms apart) | 480 / 800 | 480 / 800 | 406 / 812 | 70.1 / 0 px | 1.24 / 1.00 s |
| trackpad (flagged momentum) / trackpadGuessed | 419.5 | 419.5 | 406 | 8.8 px | 0.68 / 1.02 s |

Every burst not starting in a glide moved the row 0.97-1.0 px per wheel px; no frame moved against the scroll while the wheel held
the row; no settle came between wheels under the wait apart (notch600, whose 600 ms pauses must settle, does: 24 free frames, the
control). The end cases rest at their end, and the mid-strip family cases (`midHand`, `midUp`, `fam*`, 960 px from 6,496) leave the
row at 5,536 and rest at 5,278 (64% of the gap), 0 px back. The wheel, feed and strip streams move the row 1 px per input px (within
3%).

The checks: every settle case rests where the rule puts the travel the row reports, and the proof computes the rule itself
(`ruleRest`), not by importing the row's; a one-gesture case's travel is its start plus its input within 1 px; the nudge and other
listed cases rest on a slot worked out by hand; a one-gesture case rests at most one gap past where its input left the row; no frame
moves against the scroll while the wheel holds the row, and a settle's return is under a quarter of a gap. Negative control:
`BACK_FRACTION` 0 (always ahead) fails nudge80, nudge100 and justPast.

What this costs: a slow scroll that stops just past a stop now glides back to it, and a nudge under a quarter of a page returns.

Not covered: a real wheel and a real trackpad (headless takes synthetic wheels only; feel is Joe's to judge), Safari (where
wheel-gestures guesses momentum from deceleration: a slowing free-spinning wheel read as momentum would end its gesture after
150 ms), Windows, and the gap a real finger reposition takes.

## One share view: the item decides, the host holds the state

`ShareSheet`, `OfferCard` and `SharedList` take a `ShareItem` rather than a file, so a space, playlist, track, page or file is one
sheet. Whether others can edit it is a property of the item (`editable`, defaulting to true for `space` and `playlist`), and it
decides three things: the tab the sheet opens on (People when editable, Link otherwise), the Can edit and Can view choice, and the
role entries in a person's menu. The sheet holds no list of people and no role: the host passes `members` and `people` and hears
`onInvite`, `onChangeRole`, `onRemove` and `onSend`, so a change shows only when the host passes the new list. A kind the library
does not know is drawn with the file glyph and its own word through `PhonuxLabels.shareKind`, and cannot be edited unless the item
says so. The older `file` and `OfferFile` props stay, read as an item of kind `file`.
