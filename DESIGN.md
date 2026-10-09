# phonux: design notes

This package is the seam between a host app and any view -- Settings, History, a live web panel, or a
third-party one. Nothing here may depend on the app that hosts it.

## Import boundary

`hostApi.tsx`, and the rest of this folder, import only React, MUI, motion and itself -- never
`localStorage`, the desktop IPC bridge, or any other app-internal module. A view written against these
contracts must work under ANY host, not just this one.

## The provider is rebuilt every render

`HostProvider`'s `host` value is never memoised, on either side: the host's handlers close over
render-time state (the panel list, the column count), so a memoised bag would hand a view a stale closure.

## Testing without a host

`fakeHost.ts` lives beside the contracts, not in the app's test folder, specifically so a third-party
view (with no access to the app's own test utilities) can still write a test against these APIs. It records
every call rather than simulating real behavior, since simulating real behavior would require importing the
app's own logic -- exactly what this boundary exists to avoid. It has no test-runner dependency and
imports only the contracts and the data-only phone model list.

## Behavior flags cross this boundary as data only

The panel model (`PanelWindow`, `panelWindow.ts`) adds behavior flags (`collapsible`, `listed`, `view`, ...)
and, for an entry made from settings, the resolved `settings` and a `key`, to decide overflow, listing,
permissions and rendering -- but `PanelSummary` (a view's own read of a panel) exposes only what a view needs to
render a row: id, url, title, live, locked, formFactor, size. A view never sees the entry, its flags or its
settings. What it may ask is what its own panel permits, and that crosses as data too: `usePanelCapabilities()`
returns the five booleans and the tier list a person can act on (`closable`, `draggable`, `placeable`,
`resizable`, `formFactors`), read from the slot context `panelSlotContext.ts` holds, never a reference to the
entry. A view mounted outside a row is told the library defaults.

### An entry carries the settings it was made under

`effective(p)` (`panelSettings.ts`, internal) is the one reader of an entry's settings: `p.settings` itself when
the entry has them, otherwise values read from the fields a hand-built entry carries (`locked` gives `closable`
and, with `collapsible`, `clearable`; `collapsible` gives `parkable`, `draggable`, `placeable` and `resizable`; a
collapsible entry's `overflow` is 'park', a fixed column's 'scroll'), with every other key at its library
default. So a hand-built 0.1.0 entry behaves as it did. `applyTemplate(entry, resolved, mode)` is the one writer
of the fields that mirror the settings: 'create' writes `locked` (`!closable`), `collapsible` (`parkable`),
`listed`, `layer`, `anchoredEnter`, `formFactor`, its `size`, `title`, `settings` and `key`; 'reconfigure'
writes only `locked`, `listed`, `layer`, `anchoredEnter`, `title`, `settings` and, for a parkable flip,
`collapsible`, and leaves the tier, size, anchor, `live`, `hostData` and `key` as the person and the row left
them. `appendPanel`, `restorePanel` and `hydrateWorkspaceState` write no `key`, so a hand-built entry has none
and a reader uses `p.key ?? p.id`. Every guard that decides a permission reads `effective(p)`: `movePanel`
(`draggable`, and `crossable` of every array slot from the source to the target, parked ones included),
`reanchorPanel` (`placeable`), `setFormFactor` (`resizable` and `formFactors`), the `clearAll` filter
(`clearable`), and the close path (`locked`, which `applyTemplate` writes). Reads of `.collapsible` that remain
are about presence and parking, and test/source-invariants.test.ts lists the functions that make them.

## The panel-view registry: never a crash, never a silent substitution

`registerView`/`resolveView` (`viewRegistry.tsx`) let `PanelWindow.view` be an open string
instead of a closed union, so a host or a third party can spawn any registered component by name.
`resolveView` never returns nothing: an unregistered key -- a typo, or a plugin that failed to
register -- renders a visible, inert placeholder naming the title and the key, rather than throwing (which
would take the whole row down with it) or silently falling back to the built-in web panel (which would
render a blank webview shell for what is actually broken, more confusing than an honest placeholder). `view`
is read ONLY at this one render-selection site; every overflow/collapse/close decision elsewhere reads
`collapsible`/`listed`/`locked` instead, never `view`, so widening it to an open string cannot change any of
those decisions.

## Position, layer and enter-direction are per-panel metadata, not per-view rules

`PanelWindow.anchor`/`layer`/`anchoredEnter` replace three separate hard-coded special cases for History
(always the leftmost column, a higher zIndex, entering unconditionally via the anchor formula) with one field
each, read by exactly the site that decides that one behavior: `anchor` by the function that orders the row
(see "Row order is anchor metadata" below), `layer` by the row's per-slot zIndex, `anchoredEnter` by the row's
enter-direction choice, which resolves against that panel's own anchor target. `layer` and `anchoredEnter` are
set once at creation; `anchor` is set at creation and changed by `reanchor` and by a drag. A custom panel can
opt into any of History's behaviors without becoming History-shaped in any other way -- `listed`,
`collapsible` and `locked` stay independent of all three.

### `permanent` is the one door to a collapsible:false column

`CreatePanelOptions.permanent` (`AppendPanelOptions.permanent` underneath it) is the only way a spawned panel
can become a permanent column -- there is no raw `collapsible` or public `locked` key. Setting it forces
`listed:false` regardless of any `listed` the caller also passes: the framework's History-row trash
(suppressed by `listed:false`, History's own precedent) must never be the close affordance for a column whose
own component owns its own close control. It adds no fourth field alongside `anchor`/`layer`/`anchoredEnter`
above -- those three already work on any entry, collapsible or not, unchanged (`create({ permanent: true,
anchor })` places the column like any panel). A permanent column is exempt from every row gesture, capacity
park, `reanchor` and from being dragged, for free, by already being `collapsible:false`, the same way History
already is. Other panels can still be dragged past it -- see `PanelsAPI.move`'s own section below.

The "own control only" guarantee also has to hold for the built-in 'web' view, not just a custom one: `view`
left at its default (or set explicitly to `'web'`) still resolves to the host's own panel component, which otherwise wraps
EVERY panel in a framework drag-to-close handle unconditionally. That component reads
`usePanelCloseEligible`, which is false for a column with `collapsible:false` and for an entry whose `closable`
setting is false, through the same per-slot context (`panelSlotContext.ts`) that gives `usePanelReorderEligible`
its answer from `draggable`. It renders no DragToClose wrapper -- no grab bar at all -- when it reads false,
exactly like History's own locked Panel today.

## `size?` is additive: omitted means "read the shared device size, exactly as before this prop existed"

`Panel`/`PanelFrame` (`Panel.tsx`/`PanelFrame.tsx`) each gain an optional `size?: PanelSize`
(`FormFactor`/`PanelSize`, `hostApi.tsx`, beside `PanelSummary`). A caller that omits it -- every
caller today -- gets exactly what it got before this prop existed: `useHost().device.size`, read live, so it
still reacts to a phone-size change the same way. This is the whole point of making it optional rather than
required with a default: a third-party view compiled against an OLDER phonux (one with no `size` prop at
all) is still a valid caller of the current `Panel`/`PanelFrame` -- passing nothing is not a special case, it
is the type's own default state, so there is no version where "the new field" could be missing versus
"explicitly opted out." The omitted default is never a static per-tier constant (e.g. a fixed "phone" pixel
size) -- it is the live, shared value every panel already read, so a host that resizes its window mid-session
never leaves a size-less view rendering stale dimensions.

`PanelSummary.formFactor`/`size` are themselves optional, not required, even though
`panelWindow.ts` always sets them on every entry it creates (`createHistoryPanel`, `appendPanel`) -- the same
choice already made for `anchor`/`layer`/`anchoredEnter` on the internal `PanelWindow` record. A `PanelSummary`
is a structural type: any object shaped like one satisfies it, including hand-built test fixtures that predate
this feature and never set these two fields. Required fields would force every such fixture, in this app and
any third party's, to add them just to keep compiling, for a schema addition that changes no rendered pixel
by itself (`Panel`/`PanelFrame` never read `PanelSummary.size`; only their own separate `size` prop, passed
explicitly by the view, does -- see `setFormFactor` below). The app's projection (`summarisePanel()`) follows the same rule in
the other direction: it forwards `formFactor`/`size` when the record carries them and omits the key when it
does not, never a key present with the value `undefined` -- so a summary never lists a field its record never
had, and a view testing `'size' in panel` gets the same answer as `panel.size !== undefined`.

### Where `PanelWindow`'s own default size comes from, without importing desktop code into phonux

`panelWindow.ts` is part of this folder: the `PanelWindow` record and every pure transition over a
`PanelWindow[]` (`appendPanel`, `createHistoryPanel`, `closePanel`, `restorePanel`, ...). It sits inside the
import boundary above, so it imports only its siblings and never the desktop app. The main barrel exports
`PanelWindow` and `reorderStepsForOffset` from it; every other name stays `@internal`, reached by no
entry point, and the package's own tests import `panelWindow.ts` by relative path.
Its functions are pure, taking no device-state argument, and are tested that way (`test/panel-window.test.ts`
builds panels with no device store initialized at all). Reading a live device size inside them -- the
host's device-size store holds one that changes with every resize -- would make them impure, would
need an import of host code this package may not have, and would need a new parameter threaded in from
`usePanelManager.ts`/`useProvidePanels.ts`. So the default is `DEFAULT_PANEL_SIZE` (`panelTiers.ts`): the
phone tier at `DEFAULT_PHONE_SIZE`'s (`hostApi.tsx`) 390x700 -- the SAME value a host's device-size store,
like `fakeHost.ts`'s, starts at before any resize -- rather than a second hardcoded literal or a live read. A tablet or
desktop panel takes its tier's size from `TIER_SIZES` (also `panelTiers.ts`). The default is a placeholder, not
a drawn size: a phone panel never passes its stored `size` on, because its width is always the live phone width (see
"The width source" below), so the default never reaches a pixel.

## `PanelsAPI.move` is directional (move-by-one), not "move to index"

`move(id, 'left' | 'right')` swaps `id` past whichever OTHER shown panel currently sits toward that side,
rather than taking a raw target index. A raw index is meaningless across the `panelList`/internal-array
split (`panelList` only ever lists panels, `collapsible: false` columns like History are never addressable
targets) and would leak the internal array's own indexing into the public surface. The row's own
drag-to-reorder gesture (the host's panel component) converts a pointer's cumulative offset into a step count and calls
`move` that many times in the same direction -- the same primitive a future keyboard/single-pointer
alternative (WCAG 2.5.7) would call once per key press. Panels can differ in width, so the step count is not
`offset / one slot`: a hop past a neighbour moves the dragged panel by that NEIGHBOUR's span (its width plus
the gap), so each hop lands half-way across the next neighbour's span (`reorderStepsForOffset`, over the
neighbour widths the row supplies per slot). With equal widths this is exactly one hop per slot.

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

## `PanelsAPI.setFormFactor`: one panel's own tier, resized in place

`setFormFactor(id, next)` gives ONE panel a new tier. Every other panel keeps its own size; panels to its
right slide over by the width change. It is a size change, never a park: the panel stays live and mounted,
its content stays the same DOM node, and nothing is captured or evicted for it. If the wider panel no longer
fits, OTHER panels park by the host's ordinary capacity rule (as few as a narrower window would park), never
the one just resized, and in the same update, so no frame shows the row overflowing; when it alone cannot
fit, it stays live anyway (the row always keeps at least one panel).
Shrinking it gives the room back, and parked panels return as for a wider window. No-op for an unknown id, a
permanent column such as History (it always stays phone-sized, like `move`'s own exemption), or a panel
already at `next`. A parked panel may change tier and stays parked. `create({ formFactor })` opens a panel at
a tier directly (ignored with `permanent`). The host replaces the panel's `size` with a new object each time;
the default size object is shared by every panel and never changes.

Several calls in one handler (resizes, `create`, `activate`) each keep their own panel live the same way.
When they cannot all fit together, the earlier calls keep their room and a later panel parks, as it would had
it come second. A row gesture or a close later in the same handler prices the resize at its new width.

### The tier table

One table, `TIER_SIZES` (`panelTiers.ts`), holds the tablet and desktop sizes and a phone placeholder (the real
phone size is the live model's, see "The width source" below); these numbers are tunable, the rest of this
section is not:

| tier | width | height |
| --- | --- | --- |
| phone | the live phone model's width | the live phone model's height |
| tablet | 768 | `'fill'` |
| desktop | 1200 | `'fill'` |

`'fill'` is the row's own height: the same box a phone panel's height sits in. So a bigger tier is wider and
exactly as tall as the row, never taller than the window. 768 is the common tablet-portrait CSS width, the
smallest width sites treat as "not a phone". 1200 is a common desktop-layout breakpoint. Both are MAXIMUMS:
see "The fit cap" below.

### The fit cap

A tablet or desktop panel is never wider than the widest ONE live panel can be beside the fixed columns in
the current window: `min(tier width, max(phone width, row width - 2 x gap - fixed columns - gap))`
(`computeMaxLiveWidth`, from the same budget arithmetic the row's fit count uses). So a wide panel always
fits in the row instead of overflowing it, at every window size. With History as the only fixed column and a 390 phone:

| window width | cap | desktop panel | tablet panel |
| --- | --- | --- | --- |
| 1280 (the default) | 842 | 842 | 768 |
| 1920 | 1482 | 1200 | 768 |
| 844 (the window minimum) | 406 | 406 | 406 |

The floor is the phone width: when not even a phone fits beside the fixed columns, a narrower "tablet"
would not fit either, so a bigger tier is then just phone-wide. A phone panel is never capped (the window
minimum already fits History plus one phone). The cap moves with the window, so a capped panel widens and
narrows as the window does. Before the first measurement there is no cap.

A panel at the cap fills the row beside the fixed columns, so nothing else fits beside it, which is also
true of the same panel at its raw tier width. The capacity rules therefore park and reveal exactly the same
panels either way, for the panels whose `overflow` is 'park'; the cap changes how wide the panel is drawn,
never which panels are live.

A row whose entries carry settings with `overflow: 'scroll'` (the library default for every panel built through
the settings cascade) has no such cap on a fixed column's account: `computeRowNumbers` prices it from the window
alone. The window is the container less one gap each side; a desktop panel is clipped to it (968 of 1200 at a
container of 1000) and a tablet panel is not (768). Every drawn entry is laid out, and a strip wider than the
window scrolls instead of parking anything. The shell, the row and the capacity all read that one result, so they
cannot disagree: `ProvidedPanels.rowNumbers`.

### Row numbers and overflow

`computeRowNumbers` is the one place a row's widths, resting offsets, margin and strip width are derived. It
reads `p.settings?.overflow`, never `effective(p).overflow`: a hand-built fixed History reads 'scroll' under
`effective()`, and a row of hand-built entries must keep its 0.1.0 numbers (`computeMaxLiveWidth` and
`computeRowLayout`'s margin). Within a scrolling row the margin is 0 once the strip is wider than the window and
centres it otherwise; before the first measurement the window is unbounded and nothing scrolls.

Only an entry whose `overflow` is 'park' is parked for room. Its capacity is `computeRowLayout` over the widths
of the live park entries, with the widths of every other drawn entry (the fixed columns and the scroll panels)
subtracted as `reservedWidths`; the existing floor of one park panel stands, so a crowded row overflows and
scrolls instead of refusing a panel. A park exit in a scrolling row travels one span from the slot's own rest, not
to the row's origin, because the strip extends far past the window.

The container's horizontal overflow follows `tuning.rowGesture`: 'step' scrolls with the scrollbar hidden,
'free' scrolls with it visible, 'off' hides the overflow. A row with no settings is always hidden.

`PanelsAPI.panelList` reports each panel's stored tier `size`. The `panel` prop a resolved view receives
carries the size it is drawn at, so a view that passes `panel.size` to `Panel`/`PanelFrame` stays inside
its slot.

### Scrolling to a panel

`rowScroller.ts` holds one `RowScroller` per scroll container and it is the only writer of that container's
`scrollLeft`: a glide (the slide duration, instant under `animated: false` and reduced motion), `stop`, and `claim()`,
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

With `rowGesture` `step` one swipe burst, Shift+wheel or arrow key asks for a step. On a scrolling row whose strip is
wider than its window the step goes through `gestureTarget`: it shows the nearest hidden panel in the direction when
its `revealOnScroll` allows and no live panel lies between the window's edge and its slot, and otherwise scrolls to
the next panel start, from the in-flight glide's target. A row with nothing to scroll toward keeps the 0.1.0 swap
(`scrollRow`). The gesture does nothing while a claim is held.

`tuning.initialScroll` runs once per mount, in a layout effect gated on the restore having settled, on a measured row
with an entry, with no animation, and not at all when a wheel, a pointer-down or a glide got there first.

#### The seam for a custom scrollbar

A custom scrollbar is deferred. Nothing here blocks it: it would read the strip from `computeRowNumbers`
(`windowWidth` and `stripWidth`) and the position from `scrollLeft` through the same `RowScroller`, scroll by
`claim()` the way edge scrolling does, and be switched on by a new workspace tuning key beside `rowGesture`. Three
tested facts hold the seam: `rowScrollerFor` returns one object per element, `claim()` is exclusive, and a claim's
writes keep the scroller's last-value bookkeeping so a glide never mistakes them for foreign scrolls. `RowScroller`
stays internal until the scrollbar exists.

### The width source

A `'phone'` panel's width is ALWAYS the live phone width -- the model the user picked, `device.size` -- and
never its stored `size`: that stored value is a placeholder, and reading it would freeze every phone panel at
390 whatever the model. Only `'tablet'`/`'desktop'` use their stored `size.width`. One host helper
(`panelWidthOf`) owns this rule and the fit cap, and every width sum reads through it: the row's capacity,
the row's centring margin, each slot's position and width, the size box, and the
neighbour widths a drag crosses. A view follows the same rule: pass `panel.size` to
`Panel`/`PanelFrame` only for a non-phone tier, and omit it for a phone one so the device size applies.

### How the resize animates

The row's slot (`PanelRowSlot`) owns the enter/exit animation, so the resize never lives on the slot
itself: Motion's docs warn against `layout` and `exit` on one element. It lives on an inner size box
(`PanelSizeBox`) that the built-in web view renders inside its slot, under its drag box. That box is Motion
`layout="size"`, a transform-based resize over the same 0.4 s transition the slots slide with; `"size"`
because the slot's own `x` already animates position. It is the panel's own width and the row's own height,
so a `'fill'` view's percentage height resolves inside it. A column that is not collapsible (History, a
permanent column) never changes tier and renders no size box. A third-party view may change tier too: its
slot, position and the row's capacity follow, but its content snaps to the new size, since only the built-in
view renders a size box. The row's centring margin glides with the resize even right after a window resize,
when a window-driven margin change would snap.

The size box follows any change of the panel's width, not only a tier change. Choosing a different phone
model resizes every PHONE panel's size box too, so their width and height glide over the same 0.4 s while
the slots slide to their new positions; History, which has no size box, takes the new size at once. Every
panel lands exactly on the new phone size. A window resize that moves the fit cap resizes a capped panel the
same way.

### The size control, and how a view reads its own tier

The built-in web view's header carries one size control beside its other actions. Each press moves that
panel one tier along phone -> tablet -> desktop -> phone by calling `setFormFactor(panel.id, next)`, and the
click does nothing else. All three tiers are offered: the fit cap keeps a desktop panel inside the row at
every window size, so no tier needs holding back. The control is a plain button with a fixed accessible name,
"Panel size"; the current tier is its description and its glyph (a phone, a tablet or a desktop screen), so
focus never lands on a control that renamed itself. It renders only on a collapsible panel: History and a
permanent column never change tier.

A view reads its own tier from the `panel` prop it is rendered with: `panel.formFactor ?? 'phone'`. The
field is optional, so a summary without it is a phone panel. `panel.size` is the size the panel is drawn at,
already within the fit cap; pass it to `Panel`/`PanelFrame` for a non-phone tier and omit it for a phone
one (see "The width source"). A third-party view can offer its own control the same way, through
`useHost().panels.setFormFactor(panel.id, next)`; its slot, its neighbours and the row's capacity follow,
while its content snaps (see above). Keep such a handler to `setFormFactor` alone: a close in the same
handler can leave panels the resize parked unable to return to the row.

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
`anchor`/`layer`/`anchoredEnter`/`collapsible`, but every component it resolves through the registry --
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
the `npm publish` command for the maintainer to run with their own login; it never publishes. `npm publish --dry-run` is not
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
`Panel` slots sized phone, tablet or desktop, and each `Panel` renders one `View` -- the component a
developer writes and registers. This folder owns `PanelRow`, the `Panel` shell and the `View` registry, plus
the host contract that connects them; the `Panel` shell and the `View` registry are the two levels a View
author actually touches.

`PanelRow` lives in this folder; `Workspace` is a phonux component too. This section names the split the `Workspace`
extraction moves code against, so that extraction is a rename-and-relocate pass, not a fresh design.

**What phonux owns: `PanelRow`.** `PanelRow` renders N animated slots from a plain entries array --
`PanelRow.tsx` (the composition) and `PanelRowSlot.tsx` (one slot's motion), over this folder's own animation
primitives -- with the row's order math (`panelRowOrder.ts`), tier widths (`panelTiers.ts`) and fit math
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

## Naming rules R1-R4

- **R1. Name by the hierarchy.** A `Panel` slot's own parts are named `Panel*`, what a developer writes is
  named `View*`, and the bag a `View` reaches the host through is named `Host*`.
- **R2. Phone-only things keep "Phone".** A name keeps "Phone" when the thing it names is phone-specific no
  matter how big its panel gets -- the phone-model catalog, USB phone detection, the phone size -- so the
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
  id: string;
  view: string;
  url: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  live: boolean;
  anchor: { panel: string; position: 'left' | 'right'; priority: number };
  formFactor?: FormFactor;
  permanent?: boolean;
  layer?: 'base' | 'raised';
};
```

`version` is a literal `1`, bumped only on a breaking shape change; an unrecognized value is handled in
"Versioning and failure" below. `panels` holds one entry per saveable panel, in row order; the host's own root
column (History today) is never one of them (see "Permanent columns" below). `id` is FILE-SCOPED ONLY: it
resolves another entry's `anchor.panel` within this same array during hydrate, and is always replaced with a
fresh runtime id on restore -- a saved id is never reused verbatim, since panel ids restart at 1 each launch.
`view` is the registry key; an unrecognized key renders the existing placeholder, the same as it does outside
restore, never dropped. `params` is opaque and view-supplied, carried verbatim and never interpreted, and the
guard does not look inside it. `listed` defaults to `true` when a panel isn't `permanent`, but `permanent:true`
forces `listed:false` regardless of any `listed` also present in the same saved entry -- the identical forcing
rule `appendPanel` already applies at create time, and hydrate applies it again rather than trusting a saved
`listed` value on a permanent entry. A saved entry with `permanent:true` and `listed:true` together is not a
shape-guard failure (both fields individually type-check); it is a combination `create()` itself can never
produce today, most likely from a hand-edited file, and hydrate resolves it silently by letting `permanent`
win, exactly as `appendPanel` would if both were passed to it. `live` is honored verbatim on restore, except on
a permanent column (see "Permanent columns" below). `anchor` composes through the existing anchor-fallback logic
when its `panel` is dangling or cyclic (see "How hydrate builds the list" below). `formFactor` defaults to
`'phone'`. `permanent` and `layer` are covered in "Permanent columns" and "What's saved, and what's never" below.

### What's saved, and what's never

- **Saved.** `id` (file-scoped only, remapped on restore), `view`, `url`, `title`, `params`, `listed`, `live`,
  `anchor`, `formFactor`, `permanent`, `layer`. `listed`, `layer` and `formFactor` are written whenever the panel
  has them, `title` and `params` only when defined, and `permanent` only when true; no key is ever written as
  `undefined`. A panel with no anchor of its own is saved with the one its position in the row implies.
- **Never saved -- `hostData`.** The host's own opaque per-panel data, which a host may use for its
  runtime handles (a live web view's id, say). No runtime handle is ever saved, and phonux cannot tell a handle from any other
  value inside the blob, so none of it is saved: `WorkspacePanelState` has no field for it. A restored panel
  gets `defaultHostData()` like a created one, so a host that needs a fresh handle per panel builds it there;
  with no `defaultHostData`, or when it returns `undefined`, the panel has no `hostData` key at all.
- **Never saved -- `size`.** Always recomputed from `formFactor`, never round-tripped.
- **Never saved -- `locked`.** Mirrors the `closable` setting (`locked` is `!closable`) and is written only by
  `applyTemplate`; `appendPanel`, which every restore goes through, writes `false`. It is rebuilt on restore, never
  round-tripped.
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
  save(state: WorkspaceState): void;
};
```

`projectWorkspaceState` and `hydrateWorkspaceState` are pure and phonux-owned, operating on `PanelWindow`, the
panel model in `panelWindow.ts`; `rootId` is threaded through like every function there, because which entry is
the root is the app's choice. `WorkspaceStorage` is phonux's own contract, not an implementation: the host
supplies a real `load`/`save` pair. `save` is fire-and-forget and must not throw: phonux does not guard it, the
same rule the provider's other host callbacks already state. The provider validates whatever `load()` resolves
with, so a host may hand it unvalidated JSON.

### How hydrate builds the list

Hydrate draws a fresh id for EVERY saved entry before it does anything else, so a saved id that happens to
equal a fresh one is never reused. It then builds each entry through `appendPanel`, the one creation function,
so every default and every creation rule (`permanent` forcing `listed:false` and the `'phone'` tier, a tier's
size from the tier table) has no second copy, and overwrites `anchor` and `live` from the file. It copies only
the keys it knows, which is what makes a later optional field additive (see "Versioning and failure" below).

An anchor's target is mapped as follows: the root stays the root; a saved id maps to the fresh id of that entry;
anything else (an entry closed before the file was written, or a hand-edited id) maps to ONE id drawn lazily
after the entries, which no panel holds. A saved id kept as it stood could equal a fresh one -- both count up
from 1 each launch -- and would attach the panel to a stranger; with the unheld id, `computeRowOrder`'s own
fallback for a missing target applies (the root's right side, the priority kept), the same one a self-anchor or a
cycle gets. Hydrate then runs ONE `computeRowOrder` over the whole set: placing the entries one at a time would
rewrite an anchor that names a later entry.

### Save timing

Once the initial restore attempt has settled, phonux computes `projectWorkspaceState` on every committed panels
change and compares its JSON with the last one saved (or, before any save, with the restore's baseline, see
below); an equal projection is skipped. Otherwise it schedules `save()` 500 ms later (`WORKSPACE_SAVE_QUIET_MS`)
and every further change restarts that wait, so a drag is one save and a change that puts the row back to what
was saved saves nothing. The baseline advances when the timer fires.

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
`WorkspaceStorage.save(state): void` is called only from that debounced, settled-gated path, never from any other
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
panel, whose declaration is the source of truth), `overrides` (`anchor`, `formFactor`, `parkable`: what a person did
with a gesture), `applied` (the `placeOnAdd` that placed the entry last) and `closable: false` when the panel is
locked. The file also carries `dismissed` (at most 256 keys of declared panels a person closed, the oldest dropped) and
`root` (the root entry's `key`). All of them are additive, so a 0.1.0 reader ignores them and a 0.1.0 file restores
unchanged.

- **Ownership.** An entry with no `overrides` is a 0.1.0 entry and owns its anchor and tier as saved. With `overrides`
  it owns each key present, applied as a user layer on top of the cascade. The gestures that write them
  (`move`, `reanchor`, `setFormFactor`) call `recordOverride` in the same updater as the change; `clearOverrides`
  empties them. Only those two and `reconcileWorkspace` write `overrides` on an entry, and `projectWorkspaceState`
  builds the saved member.
- **Gestures are gated, restoring is not.** A stored `formFactor` or `anchor` restores although the template now says
  `resizable: false` or `draggable: false`. A tier outside `formFactors`, or `parkable: false` at a tier above phone,
  is dropped with an `override-dropped` note and is absent from the next save.
- **`applied`.** An entry with no override keeps its saved place only while the resolved `placeOnAdd` equals
  `applied.placeOnAdd`; when the default changed it is placed again. `rememberLayout: false` records and applies
  nothing and always places by `placeOnAdd`, but stored overrides stay in the file, dormant, so turning it back on
  applies them.
- **`persist: 'session'`** entries are not saved. Anchors that named one are rewritten from the order of what is saved,
  so the neighbours keep their order.
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

### Versioning and failure

- **Missing.** A missing file -- no saved data at all -- is treated the same as first launch: no saved state, nothing restored.
- **Corrupt.** A corrupt file -- unparsable JSON, or content that fails the shape guard -- likewise yields no saved state, logged once and otherwise silent.
- **Version.** An unrecognized `version` yields no saved state and no migration path: hydrate never guesses at an old shape, and the next save overwrites that file.
- **Extension rule.** `version` stays `1` while the format only grows. A later optional field is additive: `isWorkspaceState` ignores keys it does not know and hydrate copies only the keys it knows. Only a breaking change bumps `version`, and a build that then meets a version it does not know sees no saved state.
- **Not a new failure case: anchors and view keys.** A dangling or cyclic `anchor.panel` and an unregistered `view` key are not new failure cases: hydrate composes through the existing anchor-fallback and view-placeholder mechanisms already used at runtime, the same ones either can hit outside restore.
- **Not a new failure case: formFactor fit.** A restored panel whose `formFactor` no longer fits the live window width is likewise not a new failure case needing its own fit-checking: `usePanelManager`'s capacity-reconcile effect already fires on any panels-array change, including a bulk restore, and parks the overflow the same way it parks an ordinary width overflow.

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

## The header-to-frame gap is one constant, and the grab bar fills exactly it

`PANEL_HEADER_GAP_PX` (`PanelFrame.tsx`) is the one number both `PanelHeader`'s `bottom` offset and
`Panel`'s grab-bar element measure themselves against -- the same reason `PANEL_CORNER_RADIUS_UNITS` is a
named export rather than a literal inlined twice: two independently-tuned numbers drift out of sync the
moment either changes on its own, and here the drift would show up as a visible seam or overlap between the
header pill and the grab bar beneath it.

`Panel`'s `grabProps` is a separate prop from `headerProps`, not a field folded into it, because the header
and the grab bar are two different elements: the header keeps only its title/actions and cosmetic `sx`,
while `grabProps`'s `onPointerDown`/`sx` reach the grab bar instead, so clicking the title text or an action
icon is never mistaken for a drag start. Omitting `grabProps` renders no grab bar at all, which is the
correct shape for a locked view (nothing to drag).

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
the pointer vertically and only downward. On release `shouldCloseOnRelease` decides: close (the box leaves
downward, then the latest `onClose` runs) or snap back on a spring. Motion's drag machinery does the pointer
work, with its events on `window`, so a drag survives leaving the handle.

**Coexistence.** `touch-action` is `pan-x` on the handle: a horizontal swipe still scrolls the row, a vertical
one is the gesture's. A press on a button, link or field is left alone, and only the primary button grabs.
While a drag is live every vertically scrolling ancestor is locked (`overflow-y: hidden`, because a
transformed box would add a scrollbar). The lock ends with the spring back (or a press that stops it) and
when the box unmounts.

**Tuning and closability.** Inside a row the box reads its numbers from the slot it sits in: the close rule, the
direction lock and the snap-back spring from the panel's `dragToClose`, and the exit's length from its
`slide.closeExitSeconds`, which the slot's own down exit shares so a trash-button close and a drag close read as one
motion. Outside a row it reads the library defaults. It also reads the slot's `closable` (alone: not `collapsible`,
which only decides whether the view wraps a box at all) at the release and again when the exit animation ends. A
release that finds `closable` false starts no exit; one that finds it turned false at the end of the exit does not
call `onClose` and springs the box back to rest, unlocks the scroll ancestors and takes presses again.

**A close is final for the box.** A close never unlocks (the box is parked below the fold), so `onClose` must
remove the view. Once a release has decided to close, the box takes no more presses: one would stop the exit
and the close would never run. If the caller brings the box back while `AnimatePresence` still holds it (the
same key returns, as on an undo), it becomes a fresh box at once: at rest, unlocked, taking presses, its
pending exit stopped.

**Reduced motion.** No exit animation and no spring: a far drag calls `onClose` at once, and a short one (or a
horizontal reorder release) puts the box back at once.

**Reorder on the same handle.** With `reorder` set, the handle also drags horizontally. Both axes stay enabled
for the whole gesture (`drag={true}`, never toggled: a ref-driven axis prop never re-renders, so Motion would
keep reading the value from before the gesture began). The first `DIRECTION_LOCK_PX` of movement decides
which axis wins, and the losing axis's own MotionValue is zeroed on every tick after that. A gesture locked
horizontal never evaluates `shouldCloseOnRelease`, so residual vertical jitter can never close the view; one
locked vertical, or one that never locks (a sub-threshold jiggle), runs the close logic unchanged. Without
`reorder`, for a handle that only closes (History's bar, never a reorder source), `drag` stays `'y'`.

**Edge scrolling.** A mouse or pen drag that locks horizontal in a scrolling row (the slot's `dragScroll`, built from
the panel's `scrollOnDrag`, `tuning.edgeScroll` and `animated` and the row numbers) takes the row scroller's claim,
found by its `data-row-scroller` mark and never by computed overflow, so a hidden-overflow container is found too. A
`requestAnimationFrame` loop then scrolls it while the pointer rests inside a band of `zonePx` at either edge of that
container (`edgeScrollSpeed`, a linear ramp to `maxPxPerSec`; `edgeScrollStep`, one frame capped at 50 ms), and the
claim's bound is the row numbers' `maxScroll`, never `scrollWidth`, which the box's own transform inflates. Under
reduced motion or `animated` false the row instead jumps to the next panel start every `reducedStepMs` the pointer
stays in a band. The box is drawn at Motion's `x`, which the loop sets to the pointer offset, plus the scroll distance
as the CSS `translate` property, which Motion's rewrites of `transform` never touch; the release reports the pointer
offset plus the scroll distance, so the hop rule sees where the box really is, and one spring takes both home, since
two springs over distances this different would land in different frames. The claim goes back before the hop is
reported, so the scroll the hop causes is not dropped; a `pointercancel`, which a native pan sends, ends the hold with
no hop. A touch drag never edge-scrolls: the handle is `touch-action: pan-x`, so a touch swipe is a native pan.
The hold keeps the mode and the three edge numbers (`zonePx`, `maxPxPerSec`, `reducedStepMs`) the drag locked with,
so a `configure` made while the pointer is down reaches the next drag; the bound, the panel stops and `animated` are
read again every frame, and the hold ends when the row stops scrolling.

**Alternatives to the gesture.** WCAG 2.5.7 asks for a single-pointer alternative: offer a button that calls
the same `onClose`, as History's trash buttons do. The row's drag-to-reorder needs one too; `PanelsAPI.move`
exists for it, but no such control is built.

## PanelFrame's inset, scrollbar and header pill

Every view renders inside `PanelFrame` so each section reads as one phone silhouette; a view that grew its
own border/radius/background declarations would drift from the others. The frame is the phone's size unless
`size` or `expanded` says otherwise: a slot never grows to fill space.

**Equal inset with or without a scrollbar.** Content sits `CONTENT_INSET_PX` (12px) from the border on all
four sides whether or not a scrollbar is painted, with nothing measured at runtime: `scrollbar-gutter:
stable` reserves the bar's strip permanently and the right padding is pre-shrunk by that strip
(`SCROLLBAR_PX`, 8px), so the right side is (12 - 8) + 8 = 12px in both states, the bar flush against the
border.

**Why a classic scrollbar.** Chromium's default here is an overlay scrollbar: it floats over content,
reserves no layout width (`offsetWidth === clientWidth` on a scroller with real overflowing content) and
draws with its own built-in inset from the scroller's edge, which no padding or box-model change on this
side can remove. Splitting the frame into an outer box (border, radius, size, `overflow: hidden` clipping, no
padding) and an inner scroll container (the padding, `flex: 1`, `minHeight: 0`) is therefore not enough on
its own. The explicit `::-webkit-scrollbar` rules force a classic scrollbar, which reserves real width
(`offsetWidth - clientWidth` equals the declared `width`) and sits flush against the edge like a web page's
own scrollbar. Those rules style only the element they are set on, so a nested scroller needs its own copy
or it falls back to Chromium's default-width bar and breaks the arithmetic above.

**Never reserved twice.** A caller that scrolls one level deeper (an embedded web view, a transcript under a pinned
input bar) spreads `panelFrameBareSx`, which cancels both the padding and the gutter. Keeping either leaves a
phantom gap outside the inner scrollbar and an uneven inset (28px on the right against 12px on the left).
Its properties are longhands because MUI resolves `p`/`pr` and `overflow`/`overflowY` independently, so a
shorthand spread over a longhand does not reliably win.

**border-box.** Row-layout width math treats `device.size` as the frame's real rendered size. Under
content-box the border and padding land on top of it: a 390px phone rendered 416px wide by
`getBoundingClientRect()`, about 26px of silent under-fit per phone.

**The header pill.** `PanelHeader` floats above the frame (it needs a `position: relative` parent) and bakes
in one look: Paper `variant="outlined"`'s bgcolor and border, shaped as a pill; a radius
equal to the phone's own corner radius and a height of twice it, so each end is an exact semicircle with the
phone's curvature, both from the theme rather than a raw 24/48; and a fixed height, so wrapping content never
changes the shape. Its horizontal padding equals the frame's content inset so header text lines up with the
frame's own content. Internal layout is left to callers (`sx`), since one centers an ellipsis title and
another spaces out an icon row. `PanelHeaderRow` is the shared title-left/actions-right layout, so call sites
stop re-implementing flex/ellipsis markup, and it substitutes placeholders for a falsy `title`/`actions` (a
dimmed "Untitled", a dimmed "more" glyph) so the pill never blanks or changes shape. Its emptiness check
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
trigger. A panel's `snapshot` setting says which events ask: 'both' (the default), 'park', 'close' or 'never',
and 'never' also skips the evict call. The three eviction paths differ in timing: `clearAll` evicts every dropped panel's picture at once, because
a dropped panel can never be shown again; a closed panel's picture waits for its undo window (Undo keeps it;
the window's natural elapse evicts it); and switching a panel's `snapshot` to 'never' through `configure` asks the host to evict its
picture once, from the commit's layout effect and never from the configure updater (React may run it twice). A `configure` on a
closed record asks nothing at the call, and the end of its undo window evicts the picture of a panel that closed reading a value
other than 'never'. Known limit: a capture already in flight can still store its picture after
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
survive an app restart: a pure in-memory store, no desktop bridge, no local storage. Surviving a park is the
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
layer. The library picks no policy: each default reproduces what 0.1.0 did, except the few the table words
otherwise. A test (`test/panel-settings-catalog.test.ts`) holds the descriptors, the defaults and the table below
equal, so a changed default is a one-value edit in the constant and in its table row, and the test fails until both
are done.

### Layers and the cascade

Lowest to highest: library defaults, workspace defaults, template, host (what a view asked for in a Host-bag
`create`), instance, and the person's own overrides. The last defined value wins field by field and `undefined`
never overrides. `placeOnAdd`, `placeOnShow`, `placeOnReturn`, `undoPlacement`, `formFactors`, `pinning` and
`pinningWhenNotLive` are replaced whole; `tuning` merges per leaf and member; `headerButtons` merges per slot id (a
later layer's slot replaces that id whole, `false` removes it). The resolver's `source` map names the winning layer
for every key: one of `library`, `workspace`, `template`, `host`, `instance`, `user`, `derived` (filled from another
resolved field) or `forced` (overridden by a coupling rule, which runs last and so wins over every layer).

`mergePatch(layer, patch)` is the one pure step that edits the instance layer: `null` deletes a value (and, inside
`tuning` or `headerButtons`, one leaf or slot), `undefined` changes nothing, and a patch that changes nothing returns
the very same layer object. Deleting an instance value lets the host's ask, then the rest of the cascade, show
through again.

### Derived defaults and coupling rules

`draggable`, `placeable` and `listed` follow `parkable`; `clearable` follows `parkable` and `closable`. Any layer may
set them, and a value a layer sets is never forced.

| Rule | When | Forces |
| --- | --- | --- |
| C1 | `parkable: false` (a fixed column) | `resizable: false`, `formFactors: ['phone']`, `formFactor: 'phone'`, `overflow: 'scroll'`, `startVisibility: 'live'`, `restoreVisibility: 'live'`, `keepMounted: false` |
| C2 | `closable: false` | `clearable: false` |
| C3 | `persist: 'session'` | `rememberLayout: false`, `afterClose: 'return-next-launch'` |
| C4 | `formFactor` not in `formFactors` | `formFactor` is the first allowed tier |
| C5 | the root | `parkable: false`, `closable: false`, `draggable: false`, `placeable: false` |
| C6 | `viewState: 'reset-on-park'` | `keepMounted: false` |

The root's rule runs first because it feeds C1 and C2. A conflict is recorded only when a template, host or instance
layer asked for a value a rule overrides; the same collision caused by the library or the workspace defaults is
overridden silently, with source `forced`. A conflict carries `key`, `layer`, `kind`, `asked`, `applied` and
`message`, plus `rule` and `forcedBy` when the kind is `forced`. Two more kinds exist: `wrong-scope` (a template-scope
key or a workspace-only tuning key at the instance or host layer, ignored) and `not-view-settable` (a key a view may
not set, at the host layer, ignored).

Notes never throw: `park-lever-inert` when a layer sets a park lever (`capacityReturn`, `returnPriority`,
`evictionRank`, `evictionOrder`) on a panel that resolves to `overflow: 'scroll'`, `pin-unlists` when a pinned half
names `parkable: false` and `listed` is unset, `override-dropped` when the person's tier is outside `formFactors` or
a fixed column would not be on the phone tier, and `invalid-saved-setting` for each key a lenient resolve dropped.

### Who may set what

The `doors` of a descriptor name the configure call that accepts the key: `instance` (`configure(id)`), `template`
(`configureTemplate`: `hostCreatable`, `multiple`, `maxInstances`) and `tuning` (`configureTuning`). Seven tuning
leaves are workspace-only (`rowGap`, `saveQuietMs`, `gestureLockMs`, `returnTieBreak`, `dropTieBreak`, `rowGesture`,
`initialScroll`); four are per panel and also workspace-wide (`dragToClose`, `slide`, `hopFraction`, `edgeScroll`).
A workspace-only leaf at the template layer throws, at the instance or host layer it is a `wrong-scope` conflict, and
any tuning key in the workspace defaults throws. A view's own door, the host layer, accepts only `title`, `listed`,
`layer`, `formFactor`, `placeOnAdd: { anchor }` and `enterFrom: 'anchor'`.

### Configure

`configure(id, patch)` plans against the panel's layers (`planInstance`), refuses whole before anything is written, and
hands the engine one update that replaces the entry; the call takes a manager token on the panel, so a second verb on it
in the same turn answers `busy` and a close excludes every other call. `configureTemplate` stores an override layer for
the three template keys that only future creations read, and `configureTuning` stores the workspace tuning input,
re-pricing the row in one commit when `rowGap` moves. A tuning leaf set on a panel outranks the workspace's. A configure
queued behind another call's update of the same entry in one turn applies to the entry that update left, planned from the
layer the call saw; a panel the update removed stays removed. What a view asked for at a Host-bag `create` is kept apart for
the session as the panel's host layer, under the instance layer: `null` on a key the view asked for shows the ask again with
source `host`, and the file keeps the ask merged into the instance layer, so a new launch reads it as the instance layer's own.

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
(`GAP` is a re-export of `ROW_GAP`), and `test/rowconstants-drift.test.ts` asserts that no row file writes a second copy.

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
| `closable` | true, false | true (root: false) | NOW. L, T: true->false removes the drag-down close and makes close() answer not-closable at this commit; clearable re-derives false (C2); a DragToClose release already decided re-checks at its animation end and snaps back. false->true restores them. K, H: History row only. Root: closable:true is settings-conflict (C5); explicit clearable:true beside closable:false is settings-conflict. |
| `parkable` | true, false | true | STATE. L, T: true->false needs the phone tier (tier-not-allowed) and no conflicting explicit value (settings-conflict); listed, draggable, placeable, clearable re-derive false at this commit unless named; the row re-prices and the reconcile settles it (two commits). false->true lifts C1. K, H: per pinningWhenNotLive (place-only and refuse: would-reshape-row; show: shown true then flips; apply-on-next-show: stores deferredPin { parkable }). C, U: place-only, refuse, show answer is-closed; apply-on-next-show stores on the record. A person's overrides.parkable outvotes the flip (shadowed). |
| `draggable` | true, false | derived: parkable | NOW. L, T: true->false removes the reorder grab and makes move() a same-array no-op from this commit; a drag in flight ends with no hops. K, H: stored. Root: true is settings-conflict. |
| `crossable` | true, false | true | NOW. L, T: the next drag of any other panel sees it at once; a drag already released is judged by movePanel (changed:false). K, H: a non-crossable parked panel is a barrier for the next drag too. |
| `placeable` | true, false | derived: parkable | NOW. L, T, K, H: false makes reanchor, place and a placement-bearing pin() refuse (not-placeable) from this commit. Row: nothing moves. Root: true is settings-conflict. |
| `resizable` | true, false | true (C1) | NOW. L, T, K, H: true->false freezes the tier (setFormFactor refused); the tier and the person's saved tier are never changed or dropped by this call. C1: true on a fixed column is settings-conflict. |
| `formFactors` | non-empty subset of phone, tablet, desktop | all three (C1) | STATE. Widening: ok. Narrowing on L, T, K, H: ok only if the CURRENT tier stays inside, else tier-not-allowed; the tier is never changed by this call. A patch leaving the initial formFactor outside is settings-conflict. An empty set throws. |
| `clearable` | true, false | derived: parkable and closable (C2) | NEXT. Read by the next clearAll. C2: clearable:true with closable:false is settings-conflict; null re-derives it. |
| `hostCreatable` | true, false (template scope) | true | SCOPE (configureTemplate). Applies to the next Host-bag create naming the template; existing instances and code addPanel are untouched. configure(panelId) and configureTuning answer wrong-scope; an unknown template throws. Before ready: not-ready. |
| `multiple` | true, false (template scope) | false | SCOPE (configureTemplate). false->true: ok. true->false: ok only if every existing instance (row, declared closed records, undo-window records) is the singleton whose id equals the template id, else instance-limit with the count; nothing is closed or renamed. |
| `maxInstances` | integer >= 1, unlimited (template scope) | unlimited | SCOPE (configureTemplate). Raising it or null: ok. Lowering below the instances that exist: instance-limit with the count; no instance is closed. Moot without multiple (a note). |
| `listed` | true, false | derived: parkable | NOW. L, T, K, H: the panel appears in or leaves panelList at this commit; its slot and state do not change. false on a hidden panel whose hold the gesture cannot release leaves it showable by code only (note). |
| `startVisibility` | live, parked | live (C1) | NEXT. Governs panels created after the commit; every existing panel keeps its state. C: used by the next open(). C1: parked on a fixed column is settings-conflict. |
| `hideStickiness` | sticky, until-room | sticky | NEXT. Governs hides after the commit. A hidden panel keeps the hold it has; configure shows nothing. K: unaffected. L, T: the next hide() uses the new value. |
| `hideWhenLast` | allow, refuse | allow | NEXT. Read by the next hide(). Panels already hidden stay hidden; no reveal. |
| `capacityReturn` | auto, manual | auto | NEXT. Governs parks decided after the commit. A panel on the stack stays returnable; one already held stays held; no reveal. |
| `returnPriority` | integer | 0 | NEXT. Read when the stack is next walked. K: changes its place in the next walk. H: moot. Nothing returns at configure. |
| `overflow` | scroll, park | scroll for every panel built through the cascade (a template, workspace defaults, a Host-bag create, or a restore inside a workspace; C1: scroll for a fixed column); a hand-built 0.1.0 entry in a row with no workspace defaults: park | NEXT. Read at the next park decision. L: park->scroll protects it from then on; scroll->park makes it eligible; nothing parks, returns or scrolls at configure. K, H: stored; a K panel already on the stack still returns. C1: park on a fixed column is settings-conflict. |
| `evictionRank` | integer | 0 | NEXT. Read at the next park decision. Nothing is re-evaluated now. T: skipped whatever its rank. |
| `evictionOrder` | farthest, nearest, leftmost, rightmost | farthest | NEXT. Read when this panel next needs room. Nothing moves now. |
| `revealOnScroll` | edges, any, never | edges (a design default the owner never fixed; Q1 holds under it) | NEXT. Read by the next gesture. K: edges->any makes an engine-parked panel reachable. H: edges and any reach it. Nothing is revealed by configure. |
| `scrollOnOpen` | into-view, start, center, none | into-view (owner-confirmed, Q21) | NEXT. Read by the next open, show or click of this panel. L, T, K, H: stored. No scroll happens at configure. Use handle.scrollTo() to scroll now (its align defaults to this setting, 'into-view' when it is none). |
| `scrollOnMove` | follow, none | follow (owner-confirmed, Q21) | NEXT. Read by the next move, place, setFormFactor, pin, unpin or resetLayout of this panel. L, T, K, H: stored. Nothing scrolls at configure. |
| `scrollOnDrag` | edge, none | edge (Q19: the owner asked for a per-panel switch and 'Yes, scroll at the edge'; the library default is edge) | NEXT. Read at the next drag start of this panel; a drag in flight keeps the mode it began with. L, T, K, H: stored. Nothing scrolls at configure. |
| `toggleWhenClosed` | ignore, reopen | ignore | NEXT. Read by the next toggleVisibility() on a closed declared panel. C, U: the record's value is used by the next toggle. |
| `showWhenClosed` | refuse, reopen | refuse | NEXT. Read by the next show() on a closed declared panel. C, U: the record's value is used. |
| `viewState` | keep, reset-on-park | keep | STATE. The latch is set at each park commit, so a change reaches the NEXT park only. With keepMounted resolved true, reset-on-park is settings-conflict (C6): patch keepMounted:false in the same call. |
| `keepMounted` | true, false | false (C1, C6) | STATE. Read through the park latch. L, T: false->true: the next park hides the view instead of unmounting it; true->false: the next park unmounts. K: true waits for the next show and park. H (latched, mounted): true->false unmounts at this commit (zero-duration exit; picture and viewState untouched). With viewState reset-on-park, true is settings-conflict (C6). |
| `placeOnAdd` | row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor} | row-end | NEXT. Read by the next add of this panel and by resetLayout; no live, parked or hidden panel moves (use place()). in-place throws invalid-settings; a missing target uses placeFallback. |
| `placeOnShow` | the same plus in-place | in-place | NEXT. Read by the next show. K, H: configure does not re-place or reveal. |
| `placeOnReturn` | in-place, row-start, row-end, parkable-start, parkable-end, after-fixed, order, {before}, {after}, {anchor} | in-place | NEXT. Read by the next automatic return. K: takes the new value when it returns. H: moot. |
| `placeFallback` | row-start, row-end, parkable-start, parkable-end, after-fixed | row-end | NEXT. Read when a placement target is missing or self-naming. A value outside the named positions throws invalid-settings. |
| `undoPlacement` | old-slot or any placeOnAdd value | old-slot | NEXT. Read when undoClose restores a panel; a configure inside the undo window changes where that undo puts it. U: stored on the record. |
| `layer` | base, raised | base | NOW. L, T: the z-index changes at this commit; a slot mid-exit keeps the one it left with. Row order and widths do not change. |
| `enterFrom` | auto, left, right, anchor | auto | NEXT. Read at the next enter; a slide in progress keeps its start side. |
| `exitTo` | auto, left, right | auto | NEXT. Read at the next park; an exit in progress is unchanged. |
| `closeExit` | down, left, right | down | NEXT. Read at the next close of this panel; a close in the same turn is busy. |
| `animated` | true, false | true | NEXT. Read at the next enter, exit, park or scroll; an animation running finishes as started. |
| `formFactor` | phone, tablet, desktop | phone (C4) | NEXT. Changes the DEFAULT tier only (next open(), a restore without a saved tier, resetLayout); never resizes a live, parked or hidden panel; the person's recorded tier wins (shadowed). A tier outside formFactors is settings-conflict. |
| `title` | string | none ('Panel N' for the bag) | NOW. L, T, K, H: the summary title changes at this commit (header pill, History row); the closed-pages log entry keeps the old title. U: undo rebuilds with it. null restores the cascade value. |
| `pinning` | object { pinned: PinHalf, unpinned: PinHalf }; PinHalf = { placement?, parkable? }; valid only if readable after a drag (6A); empty = no pin | { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } (0.1.0's one pin rule) | NOW. PanelState.pinned and a slot's pressed state re-read at this commit; nothing moves, parks, shows or scrolls. A deferred pin keeps its direction. An unreadable definition or in-place throws. |
| `pinningWhenNotLive` | place-only, refuse, show, apply-on-next-show; or { parked?, hidden?, closed? } (closed: refuse or apply-on-next-show) | place-only | NEXT. Read by the next pin change. A stored deferred pin is neither applied nor dropped by a flip of this setting. C, U: the record's value governs. |
| `headerButtons` | object: slot id (1-32 chars a-z0-9-) to HeaderButton or false; HeaderButton = { icon, label, onClick, side?, order?, pressed?, description?, tooltip?, disabled?, hidden?, sx? } (section 6) | {} (no button drawn) | NOW. L, T: a slot appears, changes or disappears at this commit; a focused button that leaves moves focus to the header row; a press already dispatched completes. K, H: stored, first drawn when it returns. null deletes the instance entry; false removes the slot. |
| `persist` | saved, session | saved | NEXT. Takes effect at the next save projection; no row effect. saved->session: the entry leaves the file; dependents get derived anchors; an explicit rememberLayout:true is settings-conflict. session->saved: written at the next save. |
| `rememberLayout` | true, false | true (C3) | NEXT. true->false: gestures are not recorded and, at restore, stored overrides are not applied; nothing moves; the file keeps them. false->true: recording and applying resume. C3: true under persist:session is settings-conflict. |
| `restoreVisibility` | saved, live, parked | saved (C1) | NEXT. Read only at the next launch's restore. C1: anything but live on a fixed column is settings-conflict. |
| `afterClose` | stay-closed, return-next-launch | stay-closed (C3) | NEXT. Read when the panel next leaves the list. An existing tombstone is neither added nor removed by the flip. C3: stay-closed under persist:session is settings-conflict. |
| `undoWindowMs` | integer ms; 0 = no undo | 10000 | NEXT. Read by the next close of this panel. An open undo window keeps the end it has; a 0 affects only later closes. |
| `reportClose` | true, false | true | NEXT. Read by the next close; log entries already reported stay. |
| `snapshot` | both, park, close, never | both | NEXT. Read at the next park or close. Switching to never asks the host to evict this panel's stored picture once, from the commit's layout effect. |
| `tuning.rowGap` | integer px 0 to 200 (workspace only) | 16 (GAP) | NOW (configureTuning only). The whole row re-prices at this commit; in park mode a smaller capacity parks the fewest park panels through the reconcile effect; a scrolling row only re-prices and clamps scrollLeft. Slides in progress retarget. Unmeasured: stored. Busy while any panel has a token. Outside 0-200 throws. |
| `tuning.dragToClose` | object: distanceFraction [0.05, 1], minDistancePx >= 8, flickMinDistancePx >= 8, flickVelocity >= 100, cancelVelocity <= -50, directionLockPx integer [2, 64], snapBack { stiffness [50, 2000], damping [5, 200] }; panel or workspace | 0.25, 80, 40, 700, -300, 8, { 520, 42 } (DRAG_CLOSE; DIRECTION_LOCK_PX) | NEXT. Panel door: configure(id, { tuning: { dragToClose } }); workspace door: configureTuning sets the default. Read at the next release; a drag in flight is judged by the values current at release. Leaves merge; null removes a panel leaf. |
| `tuning.slide` | object: durationSec [0, 10], ease (four numbers, x1 and x2 in [0,1]), closeExitSeconds [0, 5]; panel or workspace | 0.4, [0.2, 0, 0, 1], 0.18 (SLOT_TRANSITION, DRAG_CLOSE.exitSeconds) | NEXT. Panel and workspace doors. Read at the next enter, exit, close or scroll; animations running keep their timing. animated:false still wins. |
| `tuning.hopFraction` | number in (0, 1]; panel or workspace | 0.5 | NEXT. Panel and workspace doors. Read by the dragged panel's view at its next release. Outside (0, 1] throws. |
| `tuning.edgeScroll` | object: zonePx integer [8, 200], maxPxPerSec integer [100, 5000], reducedStepMs integer [100, 5000]; panel or workspace (a key derived from Q19; the numbers are owner-confirmed, Q21) | 48, 900, 500 (owner-confirmed, Q21; the numbers live in rowConstants.ts) | NEXT. Panel door: configure(id, { tuning: { edgeScroll } }); workspace door: configureTuning sets the default. Read at the next drag start; a drag in flight keeps its numbers. Leaves merge; null removes a panel leaf. |
| `tuning.saveQuietMs` | integer ms >= 0 (workspace only) | 500 | NEXT (configureTuning only). A timer already armed keeps its deadline; the next arm uses the new value. Session-only. |
| `tuning.gestureLockMs` | integer ms >= 0 (workspace only) | 350 | NEXT (configureTuning only). A lock already armed keeps its remaining time. Session-only. |
| `tuning.returnTieBreak` | latest-first, earliest-first, row-order (workspace only) | latest-first | NEXT (configureTuning only). Read at the next stack walk; nothing returns now. |
| `tuning.dropTieBreak` | leftmost, rightmost (workspace only) | leftmost | NEXT (configureTuning only). Read at the next capacity drop or resize; nothing parks now. |
| `tuning.rowGesture` | step, free, off (workspace only; a design-derived key from Q15, not requested) | step | NEXT (configureTuning only). The listener set is re-read at the next render; a gesture in flight finishes; no panel moves. Session-only. |
| `tuning.initialScroll` | start, end, root, { panel: PanelId } (workspace only; a design-derived key from Q15, not requested) | start (the library default, a design default the owner did not rule on; phonux-app sets 'end', owner Q20: the newest closable panels in view at launch) | NEXT (configureTuning only). Read at the next mount; nothing scrolls now. Session-only. |
<!-- catalog:end -->

## Placement, the root marker, key-aware undo and motion

### Where a panel lands

`panelPlacement.ts` holds the pure half. `resolvePlacement(row, rootId, self, value, o)` turns one value into an
anchor request against the row without the panel itself, and `placePanel(row, id, value, o)` applies it to a panel
already in the row. The row is then ordered by `computeRowOrder`, so a placement is only ever an anchor. It is the
developer's own ask: nothing here reads `placeable`, and no placement is recorded as a person's override.

Every "immediately next to" request carries priority -1. Only -1 lands nearest, because an equal priority on the
right of the anchor goes to the entry earlier in the row and on the left to the later one. `row-end` has no priority,
so the far end of the root's right side is filled, which is where 0.1.0 put a new panel. `parkable-start` and
`parkable-end` are the first and last parkable entry, and resolve like `row-start` and `row-end` when that entry is
already at the edge of the row. `after-fixed` is the last non-parkable entry, or the row start when there is none.
`order` lands after the nearest earlier name of the developer's list that is in the row, else before the nearest later
one. A target that is missing or is the panel itself, and an `order` that cannot place it, lands at `placeFallback`
and raises one `placement-fallback` note.

`placeOnShow` is applied in `activate` before `promoteToLive`, so the panel that room-making parks is the one farthest
from where the shown panel will stand. `placeOnReturn` is applied in the same update that flips a returned panel
live, on both automatic returns (a capacity rise, and the reveal after a close). `undoPlacement` is applied by
`undoClose`; `old-slot` is `restorePanel` at the recorded index. The show path never reads `placeOnReturn`.

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

`enterFrom` `left` and `right` are constants and beat the engine's mark and the anchor formula. `auto` is today's
order: a mark, then the formula for an entry entering via an anchor, then the right. `anchor` is the 0.1.0
`anchoredEnter` flag as a setting. `exitTo` `left` and `right` beat the exit-right marks and `auto` follows them;
a closing panel always uses `closeExit`. `layer` sets the stacking, and `animated: false` gives a slot a
zero-duration transition on enter, exit and close, with the targets unchanged; the default transition is the shared
`PANEL_TRANSITION` object itself.

### Parked but mounted: `keepMounted`

A parked entry whose `keepMounted` is true keeps its view mounted in the slot it had, so its state, DOM, canvas and
media live on. Whether it does is decided once, by a latch at the commit that parks it, from the entry's setting then
and its `viewState` (the same moment the `viewState` latch is read): a later change to turn it on waits for the next
show and park, one made during the exit slide still unmounts that exit, and one that turns it off unmounts the view at
once with a zero-duration exit. An entry that was never live in this row never mounts a kept view, so a restored or
`startVisibility` parked panel renders nothing until it is first shown. A fixed column is never parked and `reset-on-park`
resolves `keepMounted` to false (C1, C6), so neither takes this path.

The kept slot is not a second kind of slot. `PanelRow` keeps the entry in the rendered list in array order, and computes
everything else from `present` alone: the widths, rests, row width, capacity and the neighbours a drag may cross do not
see it. It remembers the rest and width the entry last had so the slot can slide out from there and back in.

The slot slides out and in with imperative moves on its own element, not with `animate`, `initial` or `exit`: dropping
only `animate` would send the slot back to `initial`, so both are dropped while it is kept or reviving and the slide
starts in a passive effect. Hidden follows the promise of the exit move, so `animated: false`, a zero-duration slide,
reduced motion and a park target the slot already stands on all reach `display: none` without waiting for a frame. The
slot is `inert` from the start of the exit, and `display: none` with `aria-hidden` once it ends. A revive lifts all three
in its first commit and starts from its enter side when the exit left toward another side or position.

`usePanelHidden()` is true only while the slot is `display: none`; it is false while live (in view or scrolled out), while
exiting and outside a row. `Panel` unregisters from the capture registry while hidden, because a `display: none` root has
no box to photograph: the host's park capture is issued at the park commit, before the exit ends, so it still sees the
view.

A kept view ends at a close, `clearAll`, a re-render with `keepMounted` false, or the row's own unmount. Nothing about it
is saved. There is no cap on how many views are kept: each one holds its memory, and a view that does continuous work
should stop it while `usePanelHidden()` is true.

jsdom proves structure only: that the slot carries the attributes and the view stays mounted. Whether the browser lays out,
paints or skips the hidden slot, and the timing of the slide, belong to the app's real-layout gate.

## The workspace core is React-free, and a row only reads it

`createWorkspace` keeps everything a workspace is outside React: the template registry, the declared panels, the options and the last committed list. `useProvidePanels({ workspace })` is its one consumer: it attaches in a layout effect that runs once, and it publishes the committed list and a few controls (`create`, `lateRegister`) in a layout effect that runs after every commit. Both are written after commit, never during render, so a handle read from an event handler sees what the screen shows.

- **Intents, not calls.** `addPanel` before the row is ready records an intent; the restore replays the intents as declared panels when it settles, so a saved file and code agree on one list. After ready, the call goes straight to the controls the hook published. A first paint therefore never scrolls, and an `addPanel` after ready asks for the scroll of the panel's `scrollOnOpen`.
- **A narrow surface.** Handles and the reader read through one internal source, and a verb reaches the engine through the controls the hook published, never through an export. A handle's members are fixed by a source test: the reader's handle has five read members, the handle a view receives has those and the nine verbs, and no export name may match `/controls/`. A view's handle has no manager, so it can only act on its own panel.
- **Render-phase observation.** The core is told the list a render is about to draw (`observe`) so a handle read during the same render, before the layout effect publishes, answers from it instead of `pending`. Nothing is notified from there; the publish effect does that.
- **Tombstones.** A declared `stay-closed` panel that leaves the list is added to the file's `dismissed`; a panel back in the list is removed. The restore skips a dismissed declared panel unless the template is no longer closable or no longer `stay-closed`, and then drops the tombstone and saves. The diff is on the list, so an unmount, which empties nothing, is never a mass close.
- **Pin state.** `PanelState.pinned` is the pure `isPinned(entry, row, definition)`: a definition naming `parkable` in both halves reads the resolved `parkable`, one naming `row-start` against `row-end` or `after-fixed` reads the side of the root, and both are read when both are named. Nothing stores it, so a drag that re-anchors entries cannot change it.
- **Errors.** A storage whose `save` throws or rejects reaches `onError`, or `console.error` when it is unset; the row and the next save are unaffected.

## Operations on a handle

A verb names a panel, never a row index, and resolves it on every call: a handle holds a key and asks the core what is behind it now (live, parked, closed, pending), so a handle taken before a close still answers after it. The answer is a `PanelResult`: `ok` with whether anything was dispatched, or a refusal whose code is a `PanelRefusal`. A refusal is decided before the engine is touched, so it changes no list, schedules no commit and records no scroll.

- **The table.** Each verb reads the panel's state and its settings and gives the outcome listed here. `show` on a live panel only scrolls (`changed` is true only when a scroll was recorded); on a parked one it activates, places at `placeOnShow` and scrolls. `toggleVisibility` is `hide` on a live panel and `show` on a parked one. A closed declared panel is reopened by `open`, by `show` when `showWhenClosed` is `reopen`, and by `toggleVisibility` when `toggleWhenClosed` is `reopen`; a closed anonymous instance, which no code can name again, answers `is-closed`. `close` on a closed panel is accepted with nothing to do.
- **The gate.** Every accepted call takes a token on the engine ids it touches before it calls the engine and gives it back after, so a second call on the same panel in the same turn answers `busy`. A close is exclusive: while a handle close holds a token every other handle call is busy, and a close is busy while any handle call holds one. `scrollTo` takes no token and is never busy. The tokens are deleted by the first commit rendered after the call finished, never by a commit inside it, so a `flushSync` in the call cannot clear its own token and the table gives the same answers from a handler, a timer, a promise continuation and a passive effect.
- **Raw mutators.** `ProvidedPanels.close`, `undoClose`, `activate`, `move`, `reanchor` and `setFormFactor` take a raw token the same way and never refuse, but a raw call on a panel a handle call holds does nothing. `create` and `clearAll` take no token. Two raw calls on one panel still apply in call order, and two raw closes before a re-render still undo in the wrong order (`LIMIT:3`); only the handles prevent it.
- **hideWhenLast.** `hideWhenLast: 'refuse'` counts the panels this turn's other hides and closes are already removing, so `hide A` then `hide B` on a row of two leaves one panel and refuses the second with `would-empty-row`. A row with a root, or a fixed column, never empties.
- **Closed records.** Closing a panel code can name again (a declared one, or one added with an explicit id) leaves a record, which `open` uses; closing any other instance retires it, and a retired handle keeps answering `closed` from a small cache. A thousand add and close cycles therefore leave the snapshot at the declared panels plus the live ones. `open` on a key whose close sits in the undo window drops that record, so `undoClose` has nothing to skip or report for it.
- **Reapply.** `undoClose` asks the core to rebuild the closed entry from the panel's current layers (`applyTemplate` with `reconfigure`) and to say where it goes: `undoPlacement` `old-slot` keeps the recorded index, any other value re-places the entry, with its live flag kept. Without a workspace the entry returns unchanged, as in 0.1.0.
- **Source.** Every verb takes an internal last parameter, `'code'` (the default) or `'person'`. A person's `move`, `place` or `setFormFactor` records the override a gesture records; code leaves the person's arrangement alone.
- **Scroll.** An accepted `move`, `place` or `setFormFactor` on a panel in view follows it per `scrollOnMove`; `show` of a parked, hidden or out-of-view live panel and `open` of a closed declared one record one `scrollOnOpen` request.

### Pinning and reset

- **Applying a half.** `pin` and `unpin` apply the panel's pinning definition in one commit, all or nothing. `pin` places (gated by `placeable` as the panel is now), then fixes; `unpin` frees first, then gates `placeable` on the freed panel, then places, so a fixed pin can always be unpinned. A fixing half needs the phone tier (`tier-not-allowed`) and no explicit setting the fix would override (`settings-conflict`, with the offending catalog name in `setting`). A fixed pin never needs room: there is no `no-room` refusal.
- **Not live.** `pinningWhenNotLive` answers for a parked or hidden panel: `place-only` applies a placement-only half in place and answers `would-reshape-row` for a half naming `parkable`; `refuse` always answers `would-reshape-row`; `show` shows the panel and applies the half in one commit; `apply-on-next-show` stores the half on the entry. A closed declared panel stores it on its record instead.
- **Deferred pins.** A stored half is applied inside the update of every path that makes the panel live: `show`, a History click, a Host-bag activate, the row gesture, an automatic return, an undo and `open`. It is re-checked there and dropped with the note `deferred-pin-dropped` when it no longer applies. A fixing half sets `live` so a fixed column is never parked. It is session only and never saved.
- **The person's pin.** A person's pin records `overrides.anchor` (every id, when the half names a placement) and `overrides.parkable` (when it names `parkable`) through `recordOverride`; a code pin flips `parkable` for the session and records nothing.
- **Reset.** `resetLayout` writes `overrides` only through `clearOverrides`, clears stored deferrals and re-places each named panel by its resolved `placeOnAdd`. `'all'` scrolls nothing; one id follows `scrollOnMove`.

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
`ViewStateProvider`, `PANEL_HEADER_GAP_PX`, `OverlayProvider`, `OverlayStore` (with its `Item` and `Entry`),
`CaptureRegistryContext`, `PanelRowSlot`, `shouldCloseOnRelease` (with its `ReleaseMeasure`), `computeRowOrder`,
`deriveAnchorsFromOrder`, `summarisePanel`, `computeMaxLiveWidth` and `vendorLabelForUsbVendorId` are exported
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

`headerButtons` is a map from a slot id to `{ icon, label, onClick, side, order, pressed, description, tooltip, disabled, hidden, sx }`
or `false`. It cascades like any setting: a template's slot and an instance's slot both apply, `false` on a later layer removes that
id, and a layer never holds `null` (a patch's `null` removes the instance's own slot, which gives the template's back). The
validator in `panelSettings.ts` checks every field of a slot, so a bad slot throws `invalid-settings` naming its layer. A label
function that returns an empty string is the one value it cannot judge; that slot is hidden at runtime.

PanelRow puts the resolved slots and the panel's own handle in the slot context, and `Panel` draws them: buttons of `side: 'start'`
before the title, the view's own `actions` first among the end side, then the end buttons, each a plain MUI IconButton of size
small. A slot with only icon, label and onClick renders exactly the markup of such a button written by hand. A panel that declares
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

## History, releases and development

The library began as a folder inside phonux-app and was extracted with `git filter-repo`, renaming every path the folder ever had,
so `git log --follow` on a source file runs back through its years inside the app. The first entry of `CHANGELOG.md` names the
phonux-app commit the extraction was taken at.

A release is `npm run release:check`, then the maintainer's own `npm publish` from `dist/`. Nothing in this repository publishes,
and a published version is never edited: a fix is a new version, and `CHANGELOG.md` says what changed. `.github/workflows/ci.yml`
runs the typecheck, the tests, the build, the API report check and the smoke on a pull request into `release` and on dispatch;
a pull request into `main` runs no cloud check.

phonux-app installs the published package from the registry. To try a change there before publishing, install a copy of this
checkout over it: `npm install --no-save --install-links <path to this checkout>` from the app leaves the app's `package.json`
and lockfile untouched, and `npm ci` restores the registry copy. Never `npm link` or a `file:` directory spec: a symlink resolves
this checkout's own `node_modules`, which can give the app a second copy of React. The copy is source (`.ts`); to rehearse exactly
what will be published, run `npm run build`, pack `dist/` and install that tarball instead.
