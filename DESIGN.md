# shared/phone: design notes

This folder is the seam between the app and any view -- Settings, History, a live web panel, or a future
third-party one. It is meant to split out into its own package/repo boundary eventually, so nothing here may
depend on the app that hosts it.

## Import boundary

`phoneViewApi.tsx`, and the rest of this folder, import only React, MUI, motion and itself -- never
`localStorage`, the desktop IPC bridge, or any other app-internal module. A view written against these
contracts must work under ANY host, not just this one.

## The provider is rebuilt every render

`HostProvider` (renamed from `PhoneAPIsProvider`)'s `host` value is never memoised, on either side: the host's handlers close over
render-time state (the panel list, the column count), so a memoised bag would hand a view a stale closure.

## Testing without a host

`phoneApisFake.ts` lives beside the contracts, not in the app's test folder, specifically so a third-party
view (with no access to the app's own test utilities) can still write a test against these APIs. It records
every call rather than simulating real behavior, since simulating real behavior would require importing the
app's own logic -- exactly what this boundary exists to avoid.

## Behavior flags cross this boundary as data only

The app's own panel model adds behavior flags (`collapsible`, `listed`, `view`, ...) to decide overflow,
listing and rendering -- but `PanelSummary` (this folder's own view of a panel) exposes only what a view
needs to render a row: id, url, title, live, locked. A view never sees or reasons about the flags that
decided whether a panel is in `panelList` at all.

## The panel-view registry: never a crash, never a silent substitution

`registerView` (renamed from `registerPanelView`)/`resolveView` (renamed from `resolvePanelView`) (`panelRegistry.tsx`) let `PanelWindow.view` be an open string
instead of a closed union, so a host or a third party can spawn any registered component by name.
`resolveView` never returns nothing: an unregistered key -- a typo, or a plugin that failed to
register -- renders a visible, inert placeholder naming the title and the key, rather than throwing (which
would take the whole row down with it) or silently falling back to the built-in web panel (which would
render a blank webview shell for what is actually broken, more confusing than an honest placeholder). `view`
is read ONLY at this one render-selection site; every overflow/collapse/close decision elsewhere reads
`collapsible`/`listed`/`locked` instead, never `view`, so widening it to an open string cannot change any of
those decisions.

## Position, layer and enter-direction are per-panel metadata, not per-view rules

`PanelWindow.insertAt`/`layer`/`anchoredEnter` replace three separate hard-coded special cases for History
(seeded at index 0, a higher zIndex, entering unconditionally via the anchor formula) with one field each,
set once at creation and read by exactly the site that decides that one behavior: `insertAt` by the function
placing a new entry into the array, `layer` by the row's per-slot zIndex, `anchoredEnter` by the row's
enter-direction choice. A custom panel can opt into any of History's three behaviors without becoming
History-shaped in any other way -- `listed`, `collapsible` and `locked` stay independent of all three.

## `PanelsAPI.move` is directional (move-by-one), not "move to index"

`move(id, 'left' | 'right')` swaps `id` past whichever OTHER shown panel currently sits toward that side,
rather than taking a raw target index. A raw index is meaningless across the `panelList`/internal-array
split (`panelList` only ever lists panels, `collapsible: false` columns like History are never addressable
targets) and would leak the internal array's own indexing into the public surface. The row's own
drag-to-reorder gesture (LivePanel.tsx) converts a pointer's cumulative offset into a step count
(`round(offsetX / slotWidth)`) and calls `move` that many times in the same direction -- the same primitive a
future keyboard/single-pointer alternative (WCAG 2.5.7) would call once per key press. `collapsible: false`
panels are excluded from the drag itself through a plain React context LivePanels.tsx provides per slot (a
resolved view only ever receives `PanelSummary`, which carries no `collapsible` field to check locally).

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

`LivePanels.tsx` holds the internal `PanelWindow` record (not `PanelSummary`) because it alone decides
`insertAt`/`layer`/`anchoredEnter`/`collapsible`, but every component it resolves through the registry --
built-in or third-party -- is written against `PanelComponent<P>` (renamed to `ViewComponent<P>`) `= ComponentType<{ panel: PanelSummary<P>
}>`. It narrows through the same `summarisePanel()` projection `PanelsAPI.panelList`/`recentlyClosed` use
(`panelWindow.ts`), so a view can never read a desktop-only field (`webContentsId`, `collapsible`,
`insertAt`, `layer`, `anchoredEnter`) just because it happens to be a plain variable, not an object literal,
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

`PANEL_HEADER_GAP_PX` (`PhoneFrame.tsx`) is the one number both `PanelHeader`'s `bottom` offset and
`Panel`'s grab-bar element measure themselves against -- the same reason `PANEL_CORNER_RADIUS_UNITS` is a
named export rather than a literal inlined twice: two independently-tuned numbers drift out of sync the
moment either changes on its own, and here the drift would show up as a visible seam or overlap between the
header pill and the grab bar beneath it.

`Panel`'s `grabProps` is a separate prop from `headerProps`, not a field folded into it, because the header
and the grab bar are two different elements: the header keeps only its title/actions and cosmetic `sx`,
while `grabProps`'s `onPointerDown`/`sx` reach the grab bar instead, so clicking the title text or an action
icon is never mistaken for a drag start. Omitting `grabProps` renders no grab bar at all, which is the
correct shape for a locked view (nothing to drag).
