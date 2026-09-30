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
app's own logic -- exactly what this boundary exists to avoid. It has no test-runner dependency and
imports only the contracts and the data-only phone model list.

## Behavior flags cross this boundary as data only

The panel model (`PanelWindow`, `panelWindow.ts`) adds behavior flags (`collapsible`, `listed`, `view`, ...)
to decide overflow, listing and rendering -- but `PanelSummary` (a view's own read of a panel) exposes only
what a view needs to render a row: id, url, title, live, locked, formFactor, size. A view never sees or
reasons about the flags that decided whether a panel is in `panelList` at all.

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
through the same per-slot context PanelRow.tsx already provides for the reorder exemption
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
import boundary above, so it imports only its siblings and never the desktop app. The app reaches it only
through the `phonux/internal/panelModel` subpath, never the main barrel (see "The API reports in `etc/`").
Its functions are pure, taking no device-state argument, and are tested that way (`test/panel-window.test.ts`
builds panels with no device store initialized at all). Reading a live device size inside them -- the
desktop app's `phoneSizeStore.ts` keeps one in a module-level `current` -- would make them impure, would
need an import of desktop code this folder may not have, and would need a new parameter threaded in from
`usePanelManager.ts`/`useProvidePanels.ts`. So the default is `DEFAULT_PANEL_SIZE` (`panelTiers.ts`): the
phone tier at `DEFAULT_PHONE_SIZE`'s (`hostApi.tsx`) 390x700 -- the SAME value `phoneSizeStore.ts`'s own
`current` starts at before any resize -- rather than a second hardcoded literal or a live read. A tablet or
desktop panel takes its tier's size from `TIER_SIZES` (also `panelTiers.ts`). The default is a placeholder, not
a drawn size: a phone panel never passes its stored `size` on, because its width is always the live phone width (see
"The width source" below), so the default never reaches a pixel.

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

`PanelRow.tsx` takes the row-only `PanelRowEntry` record (not `PanelSummary`) because it alone reads
`anchor`/`layer`/`anchoredEnter`/`collapsible`, but every component it resolves through the registry --
built-in or third-party -- is written against `PanelComponent<P>` (renamed to `ViewComponent<P>`) `= ComponentType<{ panel: PanelSummary<P>
}>`. It narrows through the same `summarisePanel()` projection `PanelsAPI.panelList`/`recentlyClosed` use
(`panelRowEntry.ts`), so a view can never read a row-only or host-only field (`hostData`, `collapsible`,
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

`directionalTransition` shares the timing, easing and opacity contract between the app's animated slots, not
their position math. A live panel is absolutely positioned (`index * (phoneWidth + GAP)`) and leaves for two
reasons: a close slides down, and an auto-collapse slides left to a fixed spot behind the sidebar whatever the
panel's own index. A History row sits in normal flow and has one exit, its trash button. One generic `exit`
would either lose the index-independent collapse target or grow conditionals History never needs, so this is
a shared preset, not a shared wrapper component. It returns `initial`/`animate` (both callers enter the same
way: `distance` past rest, faded out), the shared `transition`, and a symmetric `exit` that History uses
as-is; `PanelRowSlot` builds its own two exits and takes only `transition`.

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

**What phonux will own once `Workspace` is extracted.** `Workspace` is the shell around the row: the scroll
container, the centered/animated-margin math `workspaceShellStyle` (in `client/src/shared/phone/Workspace.tsx`)
computes, and the `OverlaySlot` mounts. Like `PanelRow`, it does not consume `PanelSummary`.

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
The shape, the ownership split and the save/restore timing are now designed -- see "Workspace state
persistence: shape, ownership and timing" below -- but nothing is built yet: this Workspace still keeps no
file, still loads nothing and still saves nothing today.

**Files the `Workspace` extraction touches.** `workspaceShellStyle` (out of `client/src/desktop/row/useRowShell.ts`)
moves into this folder, and `test/phone-boundary.test.ts`'s `MIN_PHONE_FILES` goes up to the number of files the shared/phone folder
scan then reads. Naming them here lets a later entry's own touches be checked against this list instead of
re-deriving it.

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

## Workspace state persistence: shape, ownership and timing

This section designs phonux's own half of workspace-state persistence: the saved `JsonValue` shape, the pure
project/hydrate functions, phonux's own storage-hook contract, and the save/restore timing. It defines no
`WorkspaceGrid` mechanism -- one workspace, no grid, a single `{version, panels}` envelope is enough, per the
owner's no-grid ruling -- and it does not design where or how the data reaches disk; the host's own choices
there are out of scope (see "Ownership and scope" below).

### The shape

Declared as `type`, never `interface`, for the same reason `viewRegistry.tsx`'s documented rule already gives:
an interface has no implicit index signature, so it silently fails to satisfy `JsonValue` the moment anything
typed as `JsonValue` touches it.

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
  row?: number;
  permanent?: boolean;
  layer?: 'base' | 'raised';
};
```

`version` is a literal `1`, bumped only on a breaking shape change; an unrecognized value is handled in
"Versioning and failure" below. `panels` holds one entry per saveable panel; the host's own root column
(History today) is never one of them (see "Permanent columns" below). `id` is FILE-SCOPED ONLY: it resolves
another entry's `anchor.panel` within this same array during hydrate, and is always replaced with a fresh
runtime id on restore -- a saved id is never reused verbatim, since panel ids restart at 1 each launch. `view`
is the registry key; an unrecognized key renders the existing placeholder, the same as it does outside
restore, never dropped. `params` is opaque and view-supplied, carried verbatim and never interpreted. `listed`
defaults to `true` when a panel isn't `permanent`, but `permanent:true` forces `listed:false` regardless of any
`listed` also present in the same saved entry -- the identical forcing rule `appendPanel` already applies at
create time, and hydrate applies it again rather than trusting a saved `listed` value on a permanent entry. A
saved entry with `permanent:true` and `listed:true` together is not a shape-guard failure (both fields
individually type-check); it is a combination `create()` itself can never produce today, most likely from a
hand-edited file, and hydrate resolves it silently by letting `permanent` win, exactly as `appendPanel` would
if both were passed to it. `live` is honored verbatim on restore (see "Restore behavior" below). `anchor`
composes through the existing anchor-fallback logic when its `panel` is dangling or cyclic (see "Versioning
and failure" below). `formFactor` defaults to `'phone'`; `row` defaults to `0`, reserved ahead of
add-second-panel-row-support landing a real `row` field on the panel model. `permanent` and `layer` are
covered in "Permanent columns" and "What's saved, and what's never" below.

### What's saved, and what's never

- **Saved.** `id` (file-scoped only, remapped on restore), `view`, `url`, `title`, `params`, `listed`, `live`,
  `anchor`, `formFactor`, `row`, `permanent`, `layer`.
- **Never saved -- `hostData`.** The host's own opaque per-panel data, which the desktop host uses for its
  Electron runtime handles. No runtime handle is ever saved, and phonux cannot tell a handle from any other
  value inside the blob, so none of it is saved: `WorkspacePanelState` has no field for it, and a restored
  panel starts without one.
- **Never saved -- `size`.** Always recomputed from `formFactor`, never round-tripped.
- **Never saved -- `locked`.** Always `false` at create time for anything saveable, never independently set
  on a saveable panel today.
- **Never saved -- `collapsible`.** Not an independent stored fact: it is `appendPanel`'s own `!info.permanent`
  derivation, recomputed from the saved `permanent` field on restore rather than round-tripped.
- **Never saved -- `anchoredEnter`.** A creation-time enter-animation hint, defaulted on restore, not a fact
  about the panel worth persisting.
- **Never saved -- History's own entry.** Host-supplied and reseeded fresh every launch (see "Permanent
  columns" below).

### Ownership and scope

phonux owns the `WorkspaceState`/`WorkspacePanelState` type, the pure `projectWorkspaceState`/
`hydrateWorkspaceState` function pair, and a small `WorkspaceStorage` (load/save) contract phonux defines but
never puts on the public `Host`/`PanelsAPI` bag. Keeping a capability off the public bag has a real precedent
already in this package: `CaptureRegistryContext` keeps the write side of a picture out of `Host`/
`SnapshotsAPI` entirely, as its own second context that app code mounts AROUND `HostProvider` (see "Snapshots"
below) -- `HostProvider` itself never mounts `CaptureRegistryContext`. `HostProvider` does mount two contexts
internally, for its own concerns kept off the public bag: `OverlayProvider` and `ViewStateProvider` (see
"useViewState" below). `WorkspaceStorage` follows the same "keep it off the public bag" idea as all three, but
not any of their context-based wiring: unlike `CaptureRegistryContext` and `ViewStateProvider`, each reached by
arbitrary descendant `Panel`/view instances independently, `WorkspaceStorage` is consumed at exactly one call
site -- inside the future panel-behavior provider itself, the only thing that ever calls `load()`/`save()` --
so a plain injected value on that provider's own input is enough and no context is needed. That is the same
single-call-site injection an existing dependency already uses on that same provider's input today
(`useProvidePanels.ts`'s `PanelsInput.capture`). The host owns the storage entirely: the file's real name and
on-disk location, the IPC channel names, and the write mechanics (including whether the write is atomic) are
the host's own choice, out of this design's scope.

```ts
declare function projectWorkspaceState(panels: readonly PanelWindow[]): WorkspaceState;
declare function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string): PanelWindow[];

type WorkspaceStorage = {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): void;
};
```

`projectWorkspaceState` and `hydrateWorkspaceState` are pure and phonux-owned, operating on `PanelWindow`,
the panel model in `panelWindow.ts`. `WorkspaceStorage` is
phonux's own contract, not an implementation: the host supplies a real `load`/`save` pair, injected into the
future panel-behavior provider the same single-call-site way an existing injectable dependency already works
on that provider's own input (`useProvidePanels.ts`'s `PanelsInput.capture`).

### Save timing

phonux computes `projectWorkspaceState` on every committed panels change, debounces a short quiet period
(never fired per-drag-hop), and gates the whole thing behind its own "initial restore attempt has settled"
flag -- set once `load()` resolves, whether or not it found data -- before ever calling `save()`. The hazard
this gate exists for is real: `appApis.ts`'s synchronous seed initializer runs before any async `load()` can
possibly resolve, so an unconditional save fired before the gate would let that transient boot state clobber a
real saved file.

### Restore timing and the storage-hook contract

`load()` is necessarily async, so first paint is always the app's existing default (the synchronous seed), and
the restored array applies via one later state update inside a mount effect once `load()` resolves -- never
inside a synchronous initializer. `WorkspaceStorage.load(): Promise<WorkspaceState | null>` is called once, at
mount; `null` (or a caught rejection) means nothing saved. `WorkspaceStorage.save(state): void` is
fire-and-forget, called only from phonux's own debounced, restore-settled-gated change signal described above,
never from any other call site.

### Restore behavior

Restore honors each panel's saved `live` flag verbatim, unconditionally and with no prompt: a panel that was
showing a page reloads it, a parked panel stays parked. Capacity still applies after a bulk restore exactly as
it does for any width change: `usePanelManager`'s capacity-reconcile effect parks live overflow on the current
panels array regardless of what produced that array, so a restore that brings back more live panels than the
current width holds gets parked the same way an ordinary resize does, with no separate fit-checking logic
needed in hydrate.

### Versioning and failure

- **Missing.** A missing file -- no saved data at all -- is treated the same as first launch: no saved state, nothing restored.
- **Corrupt.** A corrupt file -- unparsable JSON, or content that fails the shape guard -- likewise yields no saved state, logged once and otherwise silent.
- **Version.** An unrecognized `version` yields no saved state and no migration path: `version` is bumped only on a breaking shape change, and hydrate never guesses at an old shape.
- **Not a new failure case: anchors and view keys.** A dangling or cyclic `anchor.panel` and an unregistered `view` key are not new failure cases: hydrate composes through the existing anchor-fallback and view-placeholder mechanisms already used at runtime, the same ones either can hit outside restore.
- **Not a new failure case: formFactor fit.** A restored panel whose `formFactor` no longer fits the live window width is likewise not a new failure case needing its own fit-checking: `usePanelManager`'s capacity-reconcile effect already fires on any panels-array change, including a bulk restore, and parks the overflow the same way it parks an ordinary width overflow.

A panel closed inside the undo window does not survive a restart or quit, by design: `usePanelClosing`'s
`close()` removes the panel from the live panels array synchronously, and the separate closed/undo state that
keeps it available for the undo window is never saved.

### Permanent columns

A view-created permanent column is saved with `permanent: true` and restored as permanent, and only the host's
root column (History today) is never saved, because the host reseeds it fresh every launch. No app code
creates a permanent column at mount today, so a view-created one would otherwise vanish on restart, against
the owner's every-saved-panel-comes-back ruling; if a host later creates a permanent column at mount itself, it
must not also be restored from saved state, a case to revisit then.

Saving `permanent` needs the same kind of caveat "The shape" already gives `row`: `PanelWindow` has no
`permanent` field to read today, only `collapsible` (set once at creation from `appendPanel`'s own
`!info.permanent` derivation and never itself retained as `permanent`), so until a real `permanent` field
lands on the panel model, `projectWorkspaceState` derives the saved value as `!collapsible`, excluding the
host's own root column, which is never saved at all regardless of its `collapsible` value.

### Known limitation, not fixed here

There is no way to update a panel's `params` after it is created, so persistence freezes a view's resumable
content at the moment the panel was created -- worth a follow-on stub, not a blocker for this design.

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
never gains a `snapshot` field for the same reason `PanelWindow`'s host-only fields never leak into it
(see "A resolved panel component only ever sees a `PanelSummary`" above): a picture is read on demand through
`useViewSnapshot`, not pushed into every row's own summary object.

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
folder; anything outside it reaches this folder only through a bare `'phonux'` import (see the phone-boundary
suite), so both travel through the SAME public entry point `useViewState` already does, not a separate one.

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

## The API reports in `etc/`

`etc/phonux.api.md`, `etc/phonux-testing.api.md`, `etc/phonux-internal.api.md` and
`etc/phonux-panelModel.api.md` are API Extractor's reading of this package's surface, one per `exports` key in
`package.json` (`.`, `./testing`, `./internal/directionalTransition`, `./internal/panelModel`). They are
committed so that a change to what a consumer can import shows up as a diff in review. Only
`npm run api-report:update` writes them. `npm run check:api-report` regenerates each one in a temp folder and
fails if it differs from the committed copy, so a hand edit fails the next check.

There are four `api-extractor*.json` configs, the fourth being `api-extractor.panelModel.json` for
`./internal/panelModel`, because API Extractor analyses one entry point per run. The
report script checks the `exports` map against the configs key by key, so an entry point with no config, or
two configs pointed at each other's entry, fails before anything runs. The declarations it reads are emitted
into `client/api-extractor-temp/`, a sibling of `client/src`, so they never reach `typecheck:app`, the
file-size ratchet or the phone-boundary scan.

`./internal/directionalTransition` is tracked and tagged `@internal`, not excluded: `HistoryRowSlot.tsx`
imports it from outside this folder (`PanelRowSlot.tsx`, inside it, imports the module directly), so it is a
real entry point whose changes deserve the same diff. API Extractor wants every `@internal` name to start
with an underscore, but these names are already imported under their current spelling, so
`ae-internal-missing-underscore` is switched off in `api-extractor.internal.json` only, instead of renaming them. The switch covers that whole config, not one name, so a future `@internal` export
without an underscore passes silently there too. `.` and `./testing` still enforce the rule: nothing they
reach is `@internal`, and an underscore-less `@internal` tag on one of their exports fails the check.

`./internal/panelModel` is the same kind of entry point: `panelWindow.ts` (the `PanelWindow` record and its pure
transitions, plus `effectiveMaxPanels` re-exported from `panelCapacity.ts` so one config covers both),
imported as `phonux/internal/panelModel` by `appApis.ts`, `LivePanel.tsx` and the panel hooks outside this
folder. It is tracked and tagged `@internal`, and `api-extractor.panelModel.json` carries its own
`ae-internal-missing-underscore` switch-off, because a config does not inherit another's, so the caveat above
holds for it too. `panelWindow.ts` also re-exports `FormFactor`, `JsonValue`, `PanelSize`, `PanelAnchor` and
`NeighborWidths`, which its signatures name, so that the report has no `ae-forgotten-export`.

Neither `@internal` subpath ships. `npm run build:phonux` skips every key in `INTERNAL_ONLY_EXPORT_KEYS`
(`tools/phonux-build.mjs`), which holds `./internal/directionalTransition` and `./internal/panelModel`, so
`dist/package.json`'s `exports` lists only `.` and `./testing`: an outside consumer has no use for either, and
the app resolves them in place.

Every declaration an entry point reaches carries exactly one release tag in its own doc comment: `@public`
for `.` and `./testing`, `@internal` for `./internal/directionalTransition` and for what `./internal/panelModel`
declares itself, plus `effectiveMaxPanels`, which is `@internal` in `panelCapacity.ts` (the five types it
re-exports keep their own `@public`, so that report lists them as `@public`). A deprecated alias keeps
`@deprecated` beside its tag. A tag above a re-export line (`export { X } from ...`) does nothing, because API
Extractor reads only the declaration's own comment.
`ViewStateProvider` and `PANEL_HEADER_GAP_PX` are exported for this package's own files and tests but reached
by no entry point, and are tagged `@internal` to say so.

A public signature pins every type it names. Each one must be exported by the same entry point (otherwise
`ae-forgotten-export`), which is why `fakeHost.ts` re-exports `Host`'s whole type closure and
`windowOverlay.tsx` exports `Item` and `Entry` for `OverlayStore`. Each one must also be at least as public as
the signature (otherwise `ae-incompatible-release-tags`), which is why `ReorderHandle`, named by
`DragToClose`'s public `reorder` prop, is `@public` rather than `@internal`. It is a type, so it never joins
the runtime values the barrel test pins.

The script fails on warnings written into the reports, not only on API Extractor's exit code or stdout.
Several messages, `ae-forgotten-export` among them, go into the report file instead of the console, some only
into its trailing "Warnings were encountered" footer. Once such a report is committed, the next check
regenerates the same text, matches it, and API Extractor exits 0. So the script also scans each committed
report for an embedded warning or message id, and fails on any.

## Splitting into its own repo: path discovery, the climb-check, and the identity that's already settled

This package moves out of this repo into its own eventually. Three mechanical pieces make that move a single
automated step instead of a manual one, and the repo's identity and license are settled well enough that
neither needs revisiting when the move happens.

### Path discovery replaces the hardcoded three-level join

`tools/phonux-build.mjs`, `tools/phonux-pack-smoke.mjs`, and `tools/phonux-api-report.mjs` each compute their
own `PHONE_DIR` from the root `package.json`'s `workspaces[0]` entry, instead of hardcoding
`join(REPO_ROOT, 'client/src/shared/phone')`. All three keep resolving to wherever this package actually sits,
at whatever nesting depth, without hand-editing any of them on every relocation. `DIST_DIR` stays relative to
whatever `PHONE_DIR` resolves to, unchanged, since `dist/` has always been this package's own subdirectory,
not a sibling that needs its own discovery.

TEMP_DIR stays the literal `client/api-extractor-temp` path unconditionally. It lives beside `client/src`,
outside this package, and a package relocation does not move it, so it is never derived from `PHONE_DIR` and
needs no discovery logic of its own; `.gitignore`'s existing entry for it needs no edit either.

### The climb-check extends the pre-existing check to `reportTempFolder`

`tools/phonux-api-report.mjs`'s `describeConfig`/`entries` functions fail loud, before API Extractor ever
runs, when a config's `mainEntryPointFilePath` climb no longer matches this package's real depth. The
climb-check is additive to that existing `mainEntryPointFilePath` comparison in `describeConfig`/`entries`,
not a new parallel mechanism: the same two functions carry one more per-config comparison, covering
`apiReport.reportTempFolder`, resolved the same way and checked against `join(TEMP_DIR, 'report')`. Before
this comparison existed, a stale `reportTempFolder` climb was caught only late, once the expected report file
turned up missing after a run; the climb-check now catches it before API Extractor runs at all, next to the
entry-point check it extends.

### Repo identity and license, settled

The library's repo is `Jojos-Creations/phonux`, private. The app repo is already `Jojos-Creations/phonux-app`,
so the split adds no rename step, and no checkout's `origin` URL changes at the split. The library's own
`package.json` gets `"license": "UNLICENSED"` added at split time, since it stays private and no LICENSE file
is needed while it does.

### History and link mechanism for the move

The move uses `git filter-repo` with `--path`/`--path-rename` for the folder plus every inbound file's old
paths, not `git subtree split`. Both produce a byte-identical tree at the claim commit, but `git filter-repo`
also keeps the inbound files' real pre-move content history (every content-changing commit; only pure,
100%-identical-content rename hops that collapse onto the same target path are lost), for a modest size cost
over `git subtree split`'s history-truncating result; `git subtree split --rejoin` is not needed, because the
link below does not depend on which extraction method produced the library's first commit.

The inbound file set and the `--path`/`--path-rename` list are re-derived at the move's own claim-time commit,
not carried forward as a fixed list from whenever this design was written: files move into and out of this
folder's history over time (recent examples already have), so the move re-runs the same `git log --follow
--name-only` scan this design's own test-file partition uses as its model, against the folder's actual
content at claim time, rather than trusting a stale enumeration.

The two-way link between phonux-app and the library is established by exactly one hand-made commit in
phonux-app, made immediately after the library repo is created, carrying `git-subtree-dir`,
`git-subtree-mainline` and `git-subtree-split` trailers in the same format `git subtree split --rejoin`
itself writes (built by hand here since filter-repo's commit hashes are foreign to `git subtree`, which has no
automatic way to attach a link to an already-populated directory). That link commit's folder diff against its
own mainline parent must be empty -- a non-empty diff there means the library tip's tree was not actually
byte-identical to the folder's, and something was silently changed or lost -- and the first `git subtree push`
after the link must be ancestry-clean (`git merge-base --is-ancestor <library tip before> <pushed tip>` true)
before anyone relies on the link for a real pull or push. Once both hold, plain `git subtree pull` and `git
subtree push` work as ordinary git operations from then on, including normal merge-conflict behavior when both
sides touch the same location.

The library's README (or, if no README exists yet, its first commit) records the phonux-app commit the split
was taken at. phonux-app's own pre-split history for the folder and its inbound files is not deleted or moved
anywhere -- it stays exactly where it already is, in phonux-app, at the same commit content but different
hashes (filter-repo rewrites hashes), findable by matching author, author-date and subject rather than by
hash.

A `CHANGELOG.md` starts in the library at the split, its first entry naming the split's phonux-app source
commit. CI is not added to the library at the split: every phonux change is still made in phonux-app and flows
out to the library by `git subtree push`, and phonux-app's own strict gate already covers those changes before
they ever leave it. CI is added to the library once it first receives a commit that was not made through
phonux-app, or gains an outside consumer -- whichever comes first.

### Ongoing consumption: two mechanisms, one per audience

This repo's own dev loop keeps consuming the package as an npm workspace: `git subtree` is the mechanism for
moving commits between the two repos in either direction, and nothing about the workspace symlink or the bare
`'phonux'` import specifier changes because of it. An outside consumer installs the packed tarball that
`build:phonux`/`smoke:phonux` already produce and prove installable, instead of a workspace link; a registry
publish is a later decision, not a precondition for the first outside consumer.

The bare-`phonux`-style import count is a moving target, not a number to hardcode into a design: recounted
fresh (`git grep -F "from 'phonux'"`, `"from 'phonux/testing"`, `"from 'phonux/internal/directionalTransition"`
against `*.ts`/`*.tsx`, cross-checked with `-P`/`-E` for the plain-string case), it changes every time a file
elsewhere in the repo starts or stops importing this package, so the pairing above names the mechanism that
stays true regardless of the count, not the count itself.

### The test-file partition

Files under `test/` that import `'phonux'`, `'phonux/testing'`, or `'phonux/internal/...'` by bare specifier
split into exactly two buckets, not three. MOVE: 4 test files (`phone-frame-header.test.ts`,
`phone-models.test.ts`, `phonux-barrel.test.ts`, `window-overlay.test.ts`) plus 2 fixture files
(`test/support/third-party-overlay-view.ts`, `test/support/third-party-panel-view.ts`) have no direct or
transitive dependency on this repo's app code, and move cleanly. STAY: every other such file either imports
this repo's app code directly (desktop/panel/history/ipc/sessions/theme modules) or depends on
`test/support/dom-harness.ts`, which itself reaches into this repo's device, settings and ipc modules; none of
those moves as-is. Whether a STAY file is later duplicated into the new repo's own suite, rewritten against
fakes, or left host-only is not decided here -- that call belongs to whichever work actually performs the
move, not to this design. This partition is re-derived by re-running the same two greps above and re-checking
each hit against `dom-harness.ts`/app-internal imports, not carried forward as a fixed file list, because a
new phonux-touching test file added after this design was written still needs the same classification applied
to it.

### Readiness checklist

One command or check per item, each independently verifiable without further design work:

1. `build:phonux` exits 0 run from a relocated depth -- a scratch copy at a different nesting level from
   today's.
2. `smoke:phonux` reports 3/3 from the same relocated depth.
3. `check:api-report` fails loud from the same relocated depth while its four path-sensitive configs
   (`tsconfig.build.json` and the three `api-extractor*.json` configs) are left unedited, naming the
   mismatched config and field; it exits 0 once those configs are hand-fixed to the new depth.
4. The `git filter-repo` result's tip tree equals `<claim sha>:client/src/shared/phone`, checked fresh at
   whatever commit the move actually claims against, not assumed from an earlier run; the link commit's
   folder diff against its mainline parent is empty; and the first `git subtree push` after the link is
   ancestry-clean.
5. The commit that performs the move removes the `workspaces` entry and the physical folder together, in one
   commit; `node_modules/phonux` shows no dangling symlink afterward.
6. All seven gate commands stay green afterward, with `npm test`'s pass count unchanged from immediately
   before the move.
7. A real-repo mutation of one config's `apiReport.reportTempFolder` -- the one field with no pre-flight check
   before the climb-check above existed -- makes `check:api-report` fail, naming that config specifically,
   then pass again once reverted.
