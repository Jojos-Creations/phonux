# shared/phone: design notes

This folder is the seam between the app and any view -- Settings, History, a live web panel, or a future
third-party one. It is meant to split out into its own package/repo boundary eventually, so nothing here may
depend on the app that hosts it.

## Import boundary

`phoneViewApi.tsx`, and the rest of this folder, import only React, MUI, motion and itself -- never
`localStorage`, the desktop IPC bridge, or any other app-internal module. A view written against these
contracts must work under ANY host, not just this one.

## The provider is rebuilt every render

`PhoneAPIsProvider`'s `apis` value is never memoised, on either side: the host's handlers close over
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

`registerPanelView`/`resolvePanelView` (`panelRegistry.tsx`) let `PanelWindow.view` be an open string
instead of a closed union, so a host or a third party can spawn any registered component by name.
`resolvePanelView` never returns nothing: an unregistered key -- a typo, or a plugin that failed to
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
built-in or third-party -- is written against `PanelComponent<P> = ComponentType<{ panel: PanelSummary<P>
}>`. It narrows through the same `summarisePanel()` projection `PanelsAPI.panelList`/`recentlyClosed` use
(`panelWindow.ts`), so a view can never read a desktop-only field (`webContentsId`, `collapsible`,
`insertAt`, `layer`, `anchoredEnter`) just because it happens to be a plain variable, not an object literal,
and so escapes TypeScript's excess-property check at the call site.

## The package lives in place, with no build step

This folder is a package (`phonux`) in place, not under `packages/phonux/`, because splitting it out
today would need a build and a version to track before the export surface has ever been used by an
outside consumer -- moving it once, after the surface has proven itself, costs less than maintaining a
build for a surface still being drafted. `package.json`'s `exports` map points `.` straight at
`index.ts` source: there is nothing to compile here, so a consumer's own toolchain (tsc, tsx, Vite)
compiles this folder exactly as it would compile any other module in the tree, and a change here is
visible to a consumer without a publish step.

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

## No `PhoneView` alias yet

The barrel exports `PhoneView` under its existing name. A rename (or an added alias) is parked until the
UX-system split has an actual design for the wider naming scheme; adding one alias now, ahead of that
design, would commit this package to a name nothing else has settled on yet.
