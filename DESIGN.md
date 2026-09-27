# shared/phone: design notes

This folder is the seam between the app and any view -- Settings, History, a live web panel, or a future
third-party one. It is meant to split out into its own package/repo boundary eventually, so nothing here may
depend on the app that hosts it.

## Import boundary

`hostApi.tsx`, and the rest of this folder, import only React, MUI, motion and itself -- never
`localStorage`, the desktop IPC bridge, or any other app-internal module. A view written against these
contracts must work under ANY host, not just this one.

## The provider is rebuilt every render

`HostProvider` (renamed from `PhoneAPIsProvider`)'s `host` value is never memoised, on either side: the host's handlers close over
render-time state (the panel list, the column count), so a memoised bag would hand a view a stale closure.

## Testing without a host

`fakeHost.ts` lives beside the contracts, not in the app's test folder, specifically so a third-party
view (with no access to the app's own test utilities) can still write a test against these APIs. It records
every call rather than simulating real behavior, since simulating real behavior would require importing the
app's own logic -- exactly what this boundary exists to avoid.

## Behavior flags cross this boundary as data only

The app's own panel model adds behavior flags (`collapsible`, `listed`, `view`, ...) to decide overflow,
listing and rendering -- but `PanelSummary` (this folder's own view of a panel) exposes only what a view
needs to render a row: id, url, title, live, locked, formFactor, size. A view never sees or reasons about the
flags that decided whether a panel is in `panelList` at all.

## The panel-view registry: never a crash, never a silent substitution

`registerView` (renamed from `registerPanelView`)/`resolveView` (renamed from `resolvePanelView`) (`viewRegistry.tsx`) let `PanelWindow.view` be an open string
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
left at its default (or set explicitly to `'web'`) still resolves to LivePanel.tsx, which otherwise wraps
EVERY panel in a framework drag-to-close handle unconditionally. LivePanel.tsx reads its own `collapsible`
through the same per-slot context LivePanels.tsx already provides for the reorder exemption
(`usePanelCloseEligible`, alongside `usePanelReorderEligible`) and renders no DragToClose wrapper -- no grab
bar at all -- when it reads false, exactly like History's own locked Panel today.

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

`PanelSummary.formFactor`/`size` are themselves optional, not required, even though the app's own
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

`panelWindow.ts` (`client/src/desktop/panels/`) is desktop code, not part of this folder's import boundary --
it may import anything the rest of the desktop app can. The constraint that actually shaped its default is
different: `panelWindow.ts`'s own functions (`appendPanel`, `createHistoryPanel`, and everything else in the
file) are pure, taking no device-state argument, and are tested that way (`test/panel-window.test.ts` builds
panels with no device store initialized at all). Reading `phoneSizeStore`'s live, module-level `current` size
inside these functions would make them impure and would need a new parameter threaded in from
`usePanelManager.ts`/`useProvidePanels.ts`. So the default here is
`phonux`'s own `DEFAULT_PHONE_SIZE` constant (390x700) -- the SAME value `phoneSizeStore.ts`'s own `current`
starts at before any resize -- rather than a second hardcoded literal or a live read. It is a value, not yet a
behavior: nothing renders a panel at its own `PanelWindow.size` today (`Panel`/`PanelFrame` still read
`useHost().device.size` when their `size` prop is omitted), and a phone panel never passes it: a phone
panel's width is always the live phone width (see "The width source" below), so this placeholder never
reaches a pixel.

## `PanelsAPI.move` is directional (move-by-one), not "move to index"

`move(id, 'left' | 'right')` swaps `id` past whichever OTHER shown panel currently sits toward that side,
rather than taking a raw target index. A raw index is meaningless across the `panelList`/internal-array
split (`panelList` only ever lists panels, `collapsible: false` columns like History are never addressable
targets) and would leak the internal array's own indexing into the public surface. The row's own
drag-to-reorder gesture (LivePanel.tsx) converts a pointer's cumulative offset into a step count and calls
`move` that many times in the same direction -- the same primitive a future keyboard/single-pointer
alternative (WCAG 2.5.7) would call once per key press. Panels can differ in width, so the step count is not
`offset / one slot`: a hop past a neighbour moves the dragged panel by that NEIGHBOUR's span (its width plus
the gap), so each hop lands half-way across the next neighbour's span (`reorderStepsForOffset`, over the
neighbour widths the row supplies per slot). With equal widths this is exactly one hop per slot.

`collapsible: false` panels are excluded as a drag SOURCE only: they render no grab bar, through a plain React
context LivePanels.tsx provides per slot (a resolved view only ever receives `PanelSummary`, which carries no
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
- **In memory only.** Row order and anchors are workspace state (see "Workspace state, in memory first"
  below): held in memory, never written anywhere. `PanelSummary` never carries `anchor`, so a view reads the
  resulting order from `panelList`, never anyone's anchor.

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

The host owns one table, `TIER_SIZES` (`panelWindow.ts`); these numbers are tunable, the rest of this section
is not:

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
panels either way; the cap changes how wide the panel is drawn, never which panels are live.

`PanelsAPI.panelList` reports each panel's stored tier `size`. The `panel` prop a resolved view receives
carries the size it is drawn at, so a view that passes `panel.size` to `Panel`/`PanelFrame` stays inside
its slot.

### The width source

A `'phone'` panel's width is ALWAYS the live phone width -- the model the user picked, `device.size` -- and
never its stored `size`: that stored value is a placeholder, and reading it would freeze every phone panel at
390 whatever the model. Only `'tablet'`/`'desktop'` use their stored `size.width`. One host helper
(`panelWidthOf`) owns this rule and the fit cap, and every width sum reads through it: the row's capacity,
`SettingsAPI.fitCount`, the row's centring margin, each slot's position and width, the size box, and the
neighbour widths a drag crosses. A view follows the same rule: pass `panel.size` to
`Panel`/`PanelFrame` only for a non-phone tier, and omit it for a phone one so the device size applies.

### How the resize animates

The row's slot (`LivePanelSlot`) owns the enter/exit animation, so the resize never lives on the slot
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
interpret. `JsonValue` (not `unknown`) is the type on purpose: a future persistence layer needs every panel's
data to already be serializable, and starting from `unknown` would mean redesigning the field the day
persistence is attempted.

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

`LivePanels.tsx` holds the internal `PanelWindow` record (not `PanelSummary`) because it alone reads
`anchor`/`layer`/`anchoredEnter`/`collapsible`, but every component it resolves through the registry --
built-in or third-party -- is written against `PanelComponent<P>` (renamed to `ViewComponent<P>`) `= ComponentType<{ panel: PanelSummary<P>
}>`. It narrows through the same `summarisePanel()` projection `PanelsAPI.panelList`/`recentlyClosed` use
(`panelWindow.ts`), so a view can never read a desktop-only field (`webContentsId`, `collapsible`,
`anchor`, `layer`, `anchoredEnter`) just because it happens to be a plain variable, not an object literal,
and so escapes TypeScript's excess-property check at the call site.

## The package lives in place, with no build step for in-repo use

This folder is a package (`phonux`) in place, not under `packages/phonux/`, because splitting it out
today would need a build and a version to track before the export surface has ever been used by an
outside consumer -- moving it once, after the surface has proven itself, costs less than maintaining a
build for a surface still being drafted. `package.json`'s `exports` map points `.` straight at
`index.ts` source: there is nothing to compile here, so a consumer's own toolchain (tsc, tsx, Vite)
compiles this folder exactly as it would compile any other module in the tree, and a change here is
visible to this repo's own dev and test without a publish step.

Packing for an outside consumer is a separate, opt-in step, never run as part of this repo's own build
or test: `npm run build:phonux` compiles to `dist/` and generates a throwaway `dist/package.json` with
its paths rewritten relative to `dist/` (never hand-edited, never committed); `npm run smoke:phonux`
proves the packed tarball actually installs and resolves in a throwaway app outside this repo.

## `index.ts` splits values from types on purpose

TypeScript's `interface` and `type` declarations produce no JavaScript: they are erased before a module
ever runs, so a runtime membership check (`Object.keys(namespace)`) can only ever see the value half of
this file's exports. `index.ts` re-exports values with `export { ... }` and types with
`export type { ... }` as two separate statements per source file specifically so that split is visible
in the file, not just in the type checker's head -- a reviewer (or a future editor) can tell which half
of a name governs a runtime test versus a compile-time one just by which statement it is in.

## `directionalTransition` and the test fakes are subpaths, not part of `.`

`./internal/directionalTransition` stays out of the main barrel because it is an animation timing helper
for this app's own slot components, not a contract a view is meant to depend on -- exposing it on `.`
would invite a consumer to couple to an implementation detail that owes nothing to any view contract.
`./testing` exists as its own subpath, rather than being re-exported from `.`, so that importing the
production barrel can never pull test-only fake implementations into a real bundle; a consumer opts into
fakes by importing the subpath explicitly, and a bundler that only ever sees `.` never sees them at all.

## `createDefaultTheme` carries the no-motion rule only, never the brand

The optional default theme ports phonUX's own no-animation MUI settings (disabled
`transitions.create`, and a CssBaseline reset scoped to `transition`/`animation`, never
`transform`/`opacity`) because a consumer's phonux views run the same slide animations
that rule protects. It deliberately leaves out phonUX's palette, typography and
per-component style overrides: those are this product's own branding, not something a
third-party consumer should inherit just by taking the default.

## The hierarchy: `WorkspaceGrid` > `Workspace` > `PanelRow` > `Panel` > `View`

A `WorkspaceGrid` holds many `Workspace`s, a `Workspace` holds one or more `PanelRow`s, a `PanelRow` holds
`Panel` slots sized phone, tablet or desktop, and each `Panel` renders one `View` -- the component a
developer writes and registers. This folder owns the `Panel` shell and the `View` registry, the two levels a
View author actually touches, plus the host contract that connects them.

`Workspace` and `PanelRow` are still host code today. This section names the split a later entry moves code
against, so extraction is a rename-and-relocate pass, not a fresh design.

**What phonux will own once extracted.** `PanelRow` renders N animated slots from a plain entries array --
today's `client/src/desktop/panels/LivePanels.tsx` (the composition) and `LivePanelSlot.tsx` (one slot's
motion), both already written against this folder's own animation primitives. `Workspace` is the shell around
it: the scroll container, the centered/animated-margin math `client/src/desktop/row/useRowShell.ts` computes
today, and the `OverlaySlot` mounts. Neither consumes `PanelSummary`: the row needs fields that decide
overflow and motion (id, view, collapsible, layer, anchoredEnter, its row) that a View must never see, so
extraction adds a new, row-only entry type rather than reusing the View-facing one.

**What stays host.** The Electron drag-strip chrome (the draggable title-bar region and macOS traffic-light
clearance) and every other window-chrome concern; the IPC calls a panel's own actions make; and mounting the
real `<webview>` inside a resolved View. None of that is row layout, and none of it can move here without
this folder depending on Electron.

**The second row is one field, not a second shape.** An entry's `row: number` (default 0) groups the flat
panel array into one `PanelRow` per group, instead of restructuring the array into rows-as-list-of-lists. A
second row appears once the fit count -- the same pure function of container width and panel widths a single
row already uses -- says more panels fit than one row should hold; there is no fixed pixel threshold for when
a second row starts. One field keeps every function that already operates on the flat array (append, close,
restore, promote) working unchanged, filtered by row, instead of duplicated per row.

**Workspace state, in memory first.** A Workspace's open panels, their order and their row assignment stay in
the same plain, unsaved `useState` the app's panel list already lives in -- no file, no load, no save.
Persisting workspace state is not built yet: the shape, the file and the rehydrate timing are each their own
later, separate design, and folding persistence into the extraction would tie decisions that do not have to
move together.

**Files the eventual extraction touches.** `client/src/desktop/panels/LivePanels.tsx`, `LivePanelSlot.tsx`,
`client/src/desktop/row/useRowShell.ts` and `src/panel-layout.ts`'s row-layout math move into this folder;
`test/phone-boundary.test.ts`'s `APP_SIDE` map loses their entries and its `MIN_PHONE_FILES` count goes up.
Naming them here lets a later entry's own touches be checked against this list instead of re-deriving it.

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
until every consumer that imports this package has moved off it. Whoever wires those consumers is the only
one positioned to know once nothing outside still resolves the old name, so removal is never scheduled here.

This is why a rename here is never a breaking change by itself: an existing import keeps compiling and keeps
returning the same value, only flagged deprecated, for as long as the alias stays in place.

## Workspace state, not "session"

A `Workspace`'s own saved state -- which panels are open, their order, sizes and params -- is named
*workspace state* in this package, never "session". "Session" already names something else: the app's
persisted front-page sessions (`electron/sessions.ts`), a url plus titles and turn strings, stored in a file
that must never change shape. The two are different data owned by different code, so reusing one word for
both would leave every future name ambiguous about which it meant.

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
far enough, call `onClose`". Its render prop hands out a handle for `Panel`'s `grabProps`:

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

**Never reserved twice.** A caller that scrolls one level deeper (a `<webview>`, a transcript under a pinned
input bar) spreads `panelFrameBareSx`, which cancels both the padding and the gutter. Keeping either leaves a
phantom gap outside the inner scrollbar and an uneven inset (28px on the right against 12px on the left).
Its properties are longhands because MUI resolves `p`/`pr` and `overflow`/`overflowY` independently, so a
shorthand spread over a longhand does not reliably win.

**border-box.** Row-layout width math treats `device.size` as the frame's real rendered size. Under
content-box the border and padding land on top of it: a 390px phone rendered 416px wide by
`getBoundingClientRect()`, about 26px of silent under-fit per phone.

**The header pill.** `PanelHeader` floats above the frame (it needs a `position: relative` parent) and bakes
in one look: Paper `variant="outlined"`'s bgcolor and border, the same pill as the goal-input bar; a radius
equal to the phone's own corner radius and a height of twice it, so each end is an exact semicircle with the
phone's curvature, both from the theme rather than a raw 24/48; and a fixed height, so wrapping content never
changes the shape. Its horizontal padding equals the frame's content inset so header text lines up with the
frame's own content. Internal layout is left to callers (`sx`), since one centers an ellipsis title and
another spaces out an icon row. `PanelHeaderRow` is the shared title-left/actions-right layout, so call sites
stop re-implementing flex/ellipsis markup, and it substitutes placeholders for a falsy `title`/`actions` (a
dimmed "Untitled", a dimmed "more" glyph) so the pill never blanks or changes shape. Its emptiness check
mirrors JSX's own falsy-child rules, so `0` or whitespace still counts as content.

## Snapshots: a picture is data, capturing one is not

`snapshots.ts` splits a view's picture into two surfaces on purpose. `ViewId` (a panel's id, or a fixed
`'settings'`/`'history'`), `ViewSnapshot` (`src`/`width`/`height`/`extent`/`capturedAt`/`stale`) and
`SnapshotsAPI` (`get`/`subscribe`) are plain data plus a read/subscribe contract -- `Host.snapshots?:
SnapshotsAPI` (optional: a host mid-rollout, or one that never wires this, degrades to "no picture" rather
than being forced into a no-op implementation) and `useViewSnapshot(viewId)` (a `useSyncExternalStore` wrapper)
are the only way a view ever touches a picture. Neither this file nor any view ever decides WHEN a capture
happens or HOW pixels are produced -- that is a second, independent surface:

`CaptureRegistry`/`CaptureRegistryContext`/`CaptureRegistryProvider` let `Panel` (`Panel.tsx`) hand its own
root DOM node to whatever real registry the host mounts, without that capability ever becoming part of
`Host`/`SnapshotsAPI`. This is the same pattern `HostProvider` already uses internally for `OverlayProvider`
(`hostApi.tsx`: `<HostContext.Provider value={host}><OverlayProvider>{children}</OverlayProvider></HostContext.Provider>`)
-- a second context, mounted alongside the first, for a concern that is not part of the public host bag. A
view rendered under a bare `<HostProvider>` (the common case in a test) sees no `CaptureRegistryContext`
provider at all, so `Panel`'s registration effect is a no-op and nothing here ever throws for a missing
registry, the same "missing capability degrades gracefully" convention `Host.snapshots` itself uses.

The two contexts nest in opposite directions. `HostProvider` mounts no `CaptureRegistryProvider`, so the
real one may wrap it; but it always mounts its own `OverlayProvider`, so a caller's
`<OverlayProvider store={...}>` (a test reading `ids()`/`notifications`) must sit INSIDE `<HostProvider>`,
around the `OverlaySlot`s and the views. Placed as `HostProvider`'s ancestor instead, it is shadowed by the
nearer built-in provider and silently receives nothing, with no error.

Only `client/src/desktop/capture/` (app-side, never this folder -- see "Import boundary" above) implements a
real `CaptureRegistry`, the DOM-redraw pixel engine, and the `SnapshotsAPI` store those pixels land in, and
only it renders `<CaptureRegistryProvider registry={realRegistry}>`, wrapping `<HostProvider>`. `PanelSummary`
never gains a `snapshot` field for the same reason `PanelWindow`'s desktop-only fields never leak into it
(see "A resolved panel component only ever sees a `PanelSummary`" above): a picture is read on demand through
`useViewSnapshot`, not pushed into every row's own summary object.

## `useViewState`: per-view state that outlives a park, not a restart

`viewState.ts` gives a view a `[value, setValue]` pair -- the same tuple shape `React.useState` returns --
that survives its OWN panel being parked (`live: false`; `LivePanels.tsx`'s `present` filter fully unmounts a
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
closed during a long-running session would keep its state until the app quits. The host's row reports the ids
it can still show by calling `useViewState.useRetainOnly(ids)` on every render. The release runs one task
after that render's commit, and any newer commit cancels it. That delay is load-bearing: when restoring a
live panel parks another one to its right, `undoClose` commits once with `recentlyClosed` already cleared
and the restored id not yet back in the row. A view still mounted when its panel is released, such as one
mid exit animation after `clearAll`, keeps showing its value, and its cells go when it unmounts. Nothing is
stored for a key until its first `setValue`, so until then each mount reads its own `initial`.

`useViewState(key, initial)` takes no id argument at all: a view never wires its own identity. The id is
ambient, read from a context set exactly once, at the ONE place a resolved View is actually rendered
(`LivePanels.tsx`'s `<Component panel={summarisePanel(p)} />`) -- never by the view itself. That setter is
exposed as `useViewState.Provider`, a property of the hook function, rather than a second value on the phonux
barrel, and `useViewState.useRetainOnly` travels the same way: the barrel's public surface stays the two names
a view genuinely depends on (`useViewState`, `ViewStateMissingProviderError`); the ambient id and the release
are host-render-loop wiring a view never touches directly, and a bare `'phonux'` import is the only way
`LivePanels.tsx` (desktop-side) may reach into this folder at all (see the phone-boundary suite), so both
still have to travel through the SAME public entry point `useViewState` already does, not a separate one.

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
