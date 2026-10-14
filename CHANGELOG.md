# Changelog

## Unreleased

### Fixed

- A trackpad swipe on a stepping row is one step. Its deltas ramp up before they fade, and every rising event after the 60 ms
  lock used to step again, so one swipe ran through several stops and a wide panel skipped its 1, 2, 3 slot sizes. After a step
  an event steps again only on a reversal, or when it is 1.5 times, and at least 4 units above, the smallest delta seen since the
  deltas fell (a new swipe in the tail). A plateau of equal deltas no longer steps repeatedly: a held mouse wheel is one step per gesture.

### Changed

- A panel has one public id, its key. A template panel's `panel.id` was the row's counter (`3`) while `handle.id`, `PanelState.id` and `usePanelState` used the key (`web~3`), so an id from one place failed silently in another. Now `panel.id`, `PanelSummary.id` (`panelList`, `recentlyClosed`), every `PanelsAPI` verb, `useActivePanel` (its value and its setter), the id the snapshot trigger is given and `tuning.initialScroll.panel` all use the key. A hand-built entry's key is its id, so a view that never used templates sees no change. **Migration:** a view that held `panel.id` and passed it to a handle, manager or `usePanelState` needs nothing; one that stored the counter id (saved, or in a `viewId` for pictures) stores the key instead.
- `tuning.shrinkOutOfView: 'off'` (the default) now shows the neighbour of a stop cut off by the window edge, at its full size. Before, a stepping row faded that
  neighbour out, so Off looked like Hide at rest. A panel is inert only when the window does not reach it, and a click or focus in the cut-off neighbour
  settles the row onto a stop afterwards. `'visible'` and `'hidden'` are unchanged. `RowNumbers` gains `showPartial`.

### Deprecated

- The row's counter id as a panel id. `PanelsAPI` verbs, `useActivePanel`'s setter and `tuning.initialScroll.panel` still accept the counter id a view held before keys were the only id, with one development warning per id naming the key; it stops resolving in 0.3.0.

### Added

- A column of workspaces, one above the other. `createWorkspaceColumn(options)` renders itself like `createWorkspace`, and
  `column.addWorkspace(options)` is the one call that creates a workspace, adds it and returns its `WorkspaceHandle`. ArrowUp and
  ArrowDown move between workspaces (never while focus is in a field, widget, editor or dialog, or during a keyboard drag, and never
  with a modifier, a repeat or an IME composition); a button at the top and bottom centre names the neighbour and moves there, and
  reads "Create new workspace" where there is none. Each workspace has a name input above its panels. A workspace now has an `id`
  that never changes, a `name` (default `Workspace <n>`) and `rename(name)`; `WorkspaceOptions` takes `id`, `name` and `onRename`.
  `ColumnStorage` keeps the list, the names and the current workspace, and the panels of each workspace under its id. New
  `PhonuxLabels` keys: `newWorkspace`, `goToWorkspace` and `workspaceName`. `WorkspaceColumn` draws a column for an app that mounts itself. `addWorkspace` takes `id`, `name` and `index` only: the column has one content, and `ColumnStorage.workspace(id)` is the one door to a workspace's panels.
- `tuning.phoneFit` (`'off'` by default, or `'fit'`) with `tuning.phoneFitMin` (0.82) and `tuning.phoneFitMax` (1.13): the default mount scales the
  phone (width and height together, whole pixels) so whole slots fill the window, within that band of the preferred size, and never cuts a panel at rest.
  `usePhoneSize()` returns the size a panel is drawn at; `useHost().device.size` stays the preferred size. Off, nothing changes.
  A hand-wired flow calls `usePhoneFit(containerRef, containerWidth, preferred, tuning, topInset?)` and gives the size to `useProvidePanels`
  and, with the new `Workspace` prop `phoneHeight`, to `Workspace`.
- A template may declare the panel API level it was written against: `definePanel({ id, view, api: 1 })`. Leaving `api` out
  means the newest level, `PANEL_API` (also new, with the `PanelApiLevel` type). A level is the package major version the
  panel was written for. Before 1.0.0 level 1 moves with the prereleases; at 1.0.0 it is frozen. A level the library does not serve throws `invalid-template` from `definePanel`, `createWorkspace` and
  `registerTemplate`. Nothing changes for a template that sets nothing: there is one level today, and every level stays served until it is deprecated. In development the first render of a template logs one console.error when the props its level hands the view and footer lack a member the level promises or hold one of the wrong kind; `definePanel` and the header button items a view lists get the same treatment, and a setting or header button member newer than the template's level is reported the same way (nothing is newer with one level).

### Fixed

- After a reload, a panel made by `addPanel` or New view could take the key of a restored panel (`web~4`), because the counter behind default ids restarts at launch. `addPanel` then returned the restored panel and two rows could share one saved entry and one lock. A restore now moves the counter past every restored key. A workspace with its own `newId` is unchanged.
- An arrow key a control already used no longer also steps the row. A resize grabber that narrowed a panel with ArrowLeft or ArrowRight
  stepped the row the same way, so the leftmost panel left the window on each press (and, under Hide or Off, the resized panel could be faded).
  The row now skips a keydown whose default was prevented, so a control that handles an arrow key calls `preventDefault()` on it; an arrow nothing handles steps as before.

## 0.2.0-rc.3

### Breaking

- `createWorkspace` renders itself. With a `document` it now creates a full-window element on `document.body` (or renders into the
  `mount` element you give it), measures it and mounts `HostProvider`, `Workspace` and `PanelRow` for you, so `definePanel`,
  `createWorkspace` and `addPanel` are a whole app. **Migration:** an app that renders the workspace itself passes
  `mount: false` to `createWorkspace`; without it the workspace mounts a second root and the first `useProvidePanels` to
  attach wins. A `PanelRow` given a workspace that also mounts itself warns once in development, naming `mount: false`.
  Without a `document` (node, SSR) nothing is mounted. The components and `useProvidePanels` stay public for a custom flow.
- A workspace holds its own templates: the module-level template map is gone, so two workspaces on one page can define different
  templates under one id and no workspace sees another's. `resolveView(key)` resolves plain views only; a template renders
  through the row of the workspace that holds it.
- The USB phone-detect prompt is gone, with nothing in its place. Removed from `phonux`: `PhoneDetectPrompt`,
  `PhoneDetectPromptProps` and `DetectedPhone` (also from `phonux/testing`'s re-exports). Removed from
  `PhoneDeviceAPI`: `detectedPhone`, `dismissDetectedPhone` and `resizeForDetectedPhone`, and from `createFakeHost`
  their stubs. Removed from `PhonuxLabels`: `phoneConnected`, `phoneConnectedText`, `phoneModel`, `resize` and
  `dismiss`, which only the prompt read. The phone size, `PHONE_MODELS`, `findPhoneModel` and `chooseModel` stay. A
  host that rendered the prompt deletes it and its `detectedPhone` wiring.

### Added

- A saved panel now carries an optional `uid` (`WorkspacePanelState.uid`, `u_` and 32 hex characters), made once when the
  panel is created and kept through save, restore, a copy of the file to another device and `undoClose`, so a later export,
  import or sync can match panels. It is not the panel's key or id, and nothing a host holds changes. File version stays 1.
  A file saved without uids restores unchanged and is written once with them. A library older than this one drops the
  field on its next save, so the uids are made again.
- The README quickstart is the default start (`definePanel`, `createWorkspace`, `addPanel`) with the hand-built `HostProvider`,
  `Workspace` and `PanelRow` row shown after it. Both blocks are read out of the README by marker, type-checked, and run in
  `test/readme-quickstart.test.ts`; `npm run smoke` builds and runs the packed README's quickstart against the tarball.
- `createWorkspace` takes what an app hands `HostProvider`, `Workspace` and `useProvidePanels` as options: `device`, `settings`,
  `history`, `snapshots`, `labels`, `topInset` and `panels` (`useProvidePanels` inputs such as `onPanelsClosed`, `defaultView` and
  `capture`), plus `wrap`, a component rendered around the row inside the host. `workspace.update(live)` gives the auto-mounted
  host new values; it takes only those members, notifies readers only when data changed, and refuses `root`, `templates`,
  `storage`, `mount` and `wrap` with `invalid-options`. Types: `WorkspaceLive`, `WorkspacePanelsInput`, `WorkspaceWrapProps`.
- Default frame: a template's view that draws no `Panel` or `PanelFrame` is drawn inside the library's frame (header with the
  panel's title, grab bar for the drag-down close and reorder, phone frame, template footer). A view that draws any part of a
  frame itself is unchanged. New per-panel setting `frame` (`'auto'` default, `'none'` opts out). The first panel of a bare
  template mounts its view twice, once bare and once framed. `PanelFooter` now counts as a part of a frame a view draws.
- `HostProvider` takes a `HostInput`: a `Host` whose `settings` and `device` may be left out (a hidden settings column and
  `DEFAULT_PHONE_SIZE`). `useHost()` still returns the resolved `Host`, the same default objects every render.
- `createWorkspace`'s `mount` option: an element to render into, or `false`.
- `usePanelResizing()` has a third item, `setDrawnWidth(px | null, pin?)`: while a panel is marked resizing, a host draws it `px`
  wide with no glide so a grabber follows the pointer, and the panels after it, its height and its size box follow on the same frame.
  It is held between one slot and what fits, never writes `slots` and never reaches the stop list, capacity or the live set. `pin: 'end'`
  keeps the right edge still for a grabber on the left. End the drag with `setSlots(nearest)`, `setDrawnWidth(null)`, `setResizing(false)`. The
  row's centring margin now snaps under Reduce Motion instead of gliding.
- Whole panels only: new workspace tuning `shrinkOutOfView` (`'off'` default, `'visible'`, `'hidden'`) for a row that steps
  (`rowGesture: 'step'`). With `'visible'` the row moves one slot at a time: every panel steps through every size on its way in (1,
  2, ... its own width) and on its way out (its own width, ... 2, 1), drawn smaller where the window would cut it, never cropped, so
  `[2, 2, 2, 2]` takes twice the steps and a panel's page lays out at each size. `slots` is never written; `PanelSummary.drawnSlots`
  and `size` report what is drawn. With `'hidden'` the room stays as margin and no panel is drawn part way, not even mid-glide; `'off'`
  is today's behaviour. New `usePanelResizing()` returns `[resizing, setResizing]` for a resize grabber or any drag: while a panel is
  marked it reads as dragging, no other panel's drawn width changes, and the row does not scroll.
- A header button has two forms, told apart by the `icon` key: with `icon` the label is only the accessible name (as before),
  without it the label is drawn as the button's text (`HeaderButtonIconForm`, `HeaderButtonTextForm`). `icon: undefined` is
  rejected as invalid settings. `usePanelHeaderButtons` items carry `form: 'icon' | 'text'` (`PanelHeaderButtonItem` is now
  a union), with `icon` undefined in the text form. Text longer than 9em is clipped with an ellipsis and, with no `tooltip`
  declared, shows in full as the tooltip.
- Slot sizing: a panel is n whole slots wide, a slot being one phone width with the row gap between slots; its height
  stays the phone height. New per-panel settings `slots` (the choice; `formFactor` becomes its view: 1 phone, 2 tablet,
  3 or more desktop) and `maxSlots`. `PanelSizeBox` snaps its resize under Reduce Motion and for a panel with `animated: false`. `PanelsAPI.setSlots(id, slots)` and a `setSlots` verb on the
  handle resize by a count, clamped to `maxSlots` and to what fits the window; `PanelSummary` gains `slots`, `maxSlots`,
  `drawnSlots` and `fitSlots` (the most slots that fit the window), and `size.height` is the drawn height. A person's resize is saved as `overrides.slots`, and the
  panel's own count on the panel when it is not its tier's own; History's count is saved as `rootSlots`.
- A fixed column (`parkable: false`, History) keeps the size settings its own template, host or instance asked for
  (`resizable`, `formFactors`, `formFactor`, `slots`, `maxSlots` stand together), so History can be resizable. Unasked, a
  fixed column is still one phone slot, and a workspace default never unlocks one. A new `resizable-capped` note says a
  `resizable: true` cannot grow because `maxSlots` resolves to 1.
- `ACTIVE_ATTRIBUTE`, `DRAGGING_ATTRIBUTE` and `CHROME_ATTRIBUTE` (the `data-panel-*` names `Panel` writes), and `CHROME_PARTS` with
  the `ChromePart` type (the values of `CHROME_ATTRIBUTE`: `header`, `grab-bar`, `footer`), are exported from the package
  entry so a host stops repeating the strings. The DOM is unchanged.
- `PanelsAPI.maxFitPanels`: how many phone-width panels, permanent columns such as History included, the window fits at the
  current phone width and row gap, so a host can offer a cap relative to the window without repeating the row's arithmetic.
  `null` until the row is measured; it never reads below the permanent columns plus one, as the row's own floor, and pinned
  panels are not subtracted. Optional on the interface, so a 0.1.0 host still type-checks.
- Panel chrome API, all through the panel API with defaults that reproduce today's look (chrome always drawn):
  - `useActivePanel()` returns `[activeId | null, setActive]`, `usePanelActive()` and `usePanelDragging()` read one panel's
    marks. A press or focus anywhere inside a panel (a portaled dialog it opened and a focused iframe included) makes it the
    one active panel, until another is used or the panel closes or parks; the host may set it. The state is per Workspace,
    never saved, and only the panels that gain or lose a mark render. `Panel` writes `data-panel-active` and
    `data-panel-dragging` on its root so a host can style from them. A panel is dragging from the moment a drag engages on
    either axis until it settles; a horizontal drop that hops ends it at the release.
  - `tuning.chrome` `{ mode, fadeMs, slideMs, slidePx, graceMs }`, a workspace-only leaf, defaults `'always'`, 120, 140, 8, 250.
    With `mode: 'hover-or-active'`, `Panel` fades its header, grab bar and footer out unless the panel is hovered, holds
    focus, is active or is dragged, and always shows them on a device that cannot hover. The fade is opacity only, so a hidden
    part keeps its space, stays hit-testable and stays in the tab order; it runs on Motion, so a theme's global
    `transition: none` does not stop it, and takes no time with `fadeMs` 0, `animated: false` or Reduce Motion (the system
    setting or the app's `MotionConfig`). `slideMs`, `slidePx` and `graceMs` are carried for the host's own icon row and
    read through `usePanelTuning().chrome`; the library draws only the fade.
  - `PanelHeaderButtons` is one roving-focus toolbar (see Changed).
  - `Workspace` derives `rowResizeSettled` itself when the host gives none: the row glides again 1.25 slide durations
    (500 ms at the default slide) after the width last changed, at once under Reduce Motion. A supplied `rowResizeSettled`
    wins, as before.
  - `PhonuxLabels` gains `pin`, `unpin`, `lock` and `unlock` (English defaults Pin, Unpin, Lock, Unlock).

- `tuning.maxLivePanels`: an integer of 1 or more that caps how many unpinned panels the row keeps live (`null`, the default,
  is no cap and changes nothing). The leftmost panels beyond it park, as a narrow window parks them, and in a scrolling row
  such as History's the window's width no longer decides: exactly N unpinned panels are live at any width. A pinned panel is
  neither counted nor parked by the cap. Opening, showing, undoing a close, pinning, unpinning, moving and dropping a panel
  across History keep to it, and `configureTuning({ maxLivePanels })` applies at once. No row that reaches the document holds
  more than N: the panels of a restore, a replayed `addPanel` or a seeded list arrive with the excess already parked, and a
  panel the cap parks is never mounted. With `revealOnScroll` `'never'` on the panels, scrolling the row brings nothing back;
  a hidden panel returns by `show`, a History click or an undo. A raise of `maxLivePanels` through `configureTuning` brings back
  only the most recently capacity-parked panels, in one commit, up to the new value; a panel the host hid is not among them. This is a workspace setting the host chooses; the stored
  per-person max-panels choice retired in 0.2.0-rc.1 (below) stays retired.

- Tuning leaves for values that were literals, each at the value the code always used: `tuning.gestureQuietMs` (150, the
  silence that ends a row-scroll wheel gesture, beside `gestureLockMs`), `dragToClose.restMs` (50) and
  `dragToClose.velocityWindowMs` (100), which decide the speed a drag release reads, `slide.closeExitEase` (`'easeIn'`, or
  `'easeOut'`, `'easeInOut'`, `'linear'` or a cubic bezier) for the curve every close leaves along, and `slide.glideEase`
  (`'cubic-out'`, today's curve, 1 - (1 - t)^3; also `'linear'` or a cubic bezier) for the row's own scroll glides, which do
  not follow `slide.ease`. `ROW_LAYER_Z` exports the slots' stacking (base 1, raised 2, dragged 3), below every
  `OVERLAY_Z` layer. Nothing changes at the defaults.

- Two more values that were literals are tuning leaves, each at the value the code always used: `tuning.resizeSettleSlides`
  (1.25, a workspace-only number from 0 to 10 that multiplies `slide.durationSec` into the wait before the row's centring
  margin glides again after a resize; 0 settles at once) and `tuning.chrome.fadeEase` (`'easeOut'`, the curve Motion applies
  to a fade given only a duration; also `'easeIn'`, `'easeInOut'`, `'linear'` or a cubic bezier). `fadeEase` is a required member
  of the resolved `ChromeTuning`, so a host that builds a whole `ChromeTuning` object (a test double, a fake) now has to give
  it; a patch to `tuning.chrome` or a host that only reads the resolved value is unaffected. The `FadeEase` type is exported.

### Changed

- The default frame animates its size. A bare view's header, grab bar, phone frame and footer are drawn in one box that takes the new
  size at once and eases to it over the slide, so a panel that steps through its sizes no longer jumps to each one while its
  neighbours glide. `PanelSizeBox` is the same scale now instead of Motion's `layout="size"`: it starts in the commit, on the clock of
  the slot's slide, so a neighbour stays one gap from it even when the commit takes longer than a frame. Self-framed views are unchanged.
- Licence: phonux is now PolyForm Noncommercial 1.0.0 (SPDX `PolyForm-Noncommercial-1.0.0`), free for personal and other
  noncommercial use, with commercial use through a separate paid licence. 0.1.0 and 0.2.0-rc.2 stay MIT. The package now
  ships `THIRD_PARTY_NOTICES.md` for the MIT-licensed phone-model entries.
- **Default behaviour change.** A resized panel is now whole slots wide: a tablet is two slots (796 at a 390 phone and a 16 px
  gap, was 768) and a desktop panel is every slot the window fits (two at a 1000 px container, was a 968 px clip), so a
  panel's edges land on the row's stops. An unmeasured row draws a desktop panel three slots wide (was 1200 px). A hand-built
  entry with no `slots` keeps the old tier widths.
- `PanelsAPI.setFormFactor`, the `formFactor` setting and `formFactors` are deprecated in favour of `setSlots`, `slots` and
  `maxSlots`. They keep working through 0.2.0-rc.3 and are removed in rc.4. A person's resize is now saved as
  `overrides.slots`; a file holding only `overrides.formFactor` still reads as that tier's count.
- **Default behaviour change.** The header buttons are now one Tab stop with roving focus, as a toolbar should be: Tab enters
  the row once, Arrow Left and Right, Home and End move along it, a disabled button is skipped and never holds the stop, and
  the row carries `role="toolbar"`, `aria-orientation="horizontal"` and, for a string title, `aria-label`. Before, every button
  was its own Tab stop. Tests that tabbed button by button, and the four header goldens, changed with it.

- A stepping row (`rowGesture` `'step'`, the default) now shows only whole panels: as many as fit the window, the leftover
  width split evenly on both sides, and every step, `scrollTo`, drag release, pin, close and window resize lands on a stop
  where the shown panels are whole, instead of stopping part-way through the first or last panel. The other panels fade
  out, and fade in and out between stops as the row travels, so no neighbour peeks at an edge. `RowNumbers` gains `stops`,
  `stopSpans` and `endPad`, and `computeRowNumbers` takes `wholePanels`; `free` and `off` rows are unchanged.
  `scrollTo` with `align` `'start'` or `'center'` lands on the nearest stop that shows the panel.

- A panel dragged sideways by its grab bar now reorders the row live: the panels the drop would cross slide aside, each by the
  dragged panel's own width plus the row gap, as the pointer passes the same half-way points the release uses, and slide back
  if the pointer returns. The dragged panel is drawn above them until its spring home ends. The order, anchors and saved
  workspace still change only at the drop, by the same hop count, so a host's `usePanelReorderSteps` + `move` loop needs no change.
- With Reduce Motion on (the system setting, or the app's `MotionConfig`), the panels that make room during that drag snap to their
  slots instead of sliding, and the dragged panel's own move to its new slot at the drop snaps too; enter, exit and park slides are
  unchanged.
- `npm run release:check` fails, before it asks the registry, when `package.json` and `package-lock.json` (the top-level
  `version` and `packages[""].version`) disagree on the version, or when the lockfile is missing. The message names both.

### Fixed

- Widening a panel from its left grabber keeps its right edge where it was. A width drawn with `setDrawnWidth(px, 'end')` holds the
  right edge during the drag, but the release settled onto the stop nearest the scroll the row had, so the edge jumped by a stop
  spacing (609 px at 390 px phones and a 16 px gap) under `shrinkOutOfView` 'off' and 'hidden', and under 'visible' the row stayed on a
  stop that drew the widened panel shrunk to one slot. The Workspace now reads the panel's rect from the element when
  `setResizing(true)` is called and, at the release, lands on the stop nearest the scroll that puts that edge back (the left edge for a
  width pinned at `'start'`). The edge rests within half the gap between neighbouring stops of where it began, and exactly where a stop
  is at that scroll. No new option, and a host that ends the mark without a drawn width settles as before.
- While a panel is dragged by its grab bar, the page no longer selects or highlights text or photos across the other panels, and
  a photo no longer starts a native image drag. `user-select`, `-webkit-user-select` and `-webkit-user-drag` are `none` on the
  document element from the press until the release, a `pointercancel` or the unmount, and come back exactly as the host had
  them, so overlapping drags are safe. A selection made before the drag is cleared once the drag begins, and a plain click on
  the grab bar leaves it. There is no setting to turn it off.
- `revealOnScroll` `'never'` now holds in a row whose strip fits its window: a wheel step, Shift+wheel or arrow key there
  used to swap a hidden panel in through the 0.1.0 `scrollRow` path whatever the setting said, and swaps in none now.
- A panel dragged sideways and released over a new slot now appears in that slot at once, with Reduce Motion on or off: before, its slot
  slid to the new place while the box sprang home, so it read as snapping back from the side it came from. A release that hops
  nowhere still springs the box home.
- A plain press (no movement) on a grab bar while the box springs back after a drag no longer leaves the box a fraction of a pixel
  off its slot: the press stops the spring so it is not fought, and when it ends without becoming a drag the box now springs
  the rest of the way home.
- Dragging a panel to the end of the strip no longer widens the row: the dragged box is drawn no further than the row's end, so the
  scroll container's scrollable width (and the scrollbar of a `free` row) holds still during the drag. The release still reports
  the pointer's real offset, so the hop count is unchanged.
- A stepping row now reaches its last stop in Firefox. The row's end space is one element, `endPad` plus the row gap wide, in place
  of the scroll container's right padding and a zero-height box. Firefox left the empty box out of the scrollable width, so the range
  ended one end pad short, the glide to the last stops was clamped, and the row stepped back instead of ending on the stop that
  draws the leaving panel at one slot. The row's layout in WebKit and Chromium is unchanged.
- The size glide keeps the library's chrome true. While a panel eases to a new width the frame's corners, the header pill's ends and the
  grab bar's pill stay circular arcs of the theme radius and the 1 px edge stays 1 px drawn, where the one scale squashed them for
  about 0.4 s of every step. The frame's and the header pill's edge is now an inset shadow with no border, so the content keeps its
  size; the header pill's horizontal padding is 13 px (12 and the 1 px the border held) and its vertical padding 1 px, and a
  caller's own `px` or `py` on a `PanelHeader` no longer includes the edge. A view's own content and the header buttons are still
  scaled by the box.

## 0.2.0-rc.2

### Added

- `PanelTemplate.footer`: a component, given the same props as `view`, that every panel made from the template shows at the
  bottom of its `PanelFrame`, inside the frame and below the scrolling content. `PanelFooter` draws it; `PanelFrame`
  does by default and `footer={false}` leaves it out for a view that renders `PanelFooter` itself.
- `PhonuxLabels`: English defaults for the library's visible strings, replaced through `PanelsInput.labels` (the title of
  a panel `create()` opens), `Host.labels` (the unregistered-view placeholder and the `PanelHeaderRow` empty title) and
  `PhoneDetectPromptProps.labels` (its text and accessible names).

### Changed

- The row's wheel gesture is snappy and continuous: `tuning.gestureLockMs` is now 60 ms (was 350) and starts at a step
  instead of being re-armed by every wheel event, and after it a wheel that is not slowing steps again. A wheel or
  swipe that keeps moving steps panel after panel; a trackpad flick whose deltas fade is still one step.
- `DragToClose` takes its pointer gesture from `@dnd-kit/core` (a new regular dependency) instead of Motion's drag. Its props,
  `DragHandleProps`, `ReorderHandle`, `DRAG_CLOSE`, the close rule, the hop offset, pinning and edge scrolling are as before;
  Motion still draws the box and runs the release spring.
- A host that is not a browser can use the library without stubbing browser concepts. `url` is optional on
  `PanelSummary`, `PanelState`, `ClosedPageEntry` and `WorkspacePanelState`, and a saved file whose panels lack one is
  still loaded. `create()` no longer defaults it to a blank page: the url is the empty string, and the closed-log entry
  carries the panel's own title (the empty string when it has none), so the host decides what an untitled entry shows.
- `Host.history` and the `PhoneDeviceAPI` members `defaultSize`, `models`, `chooseModel`, `detectedPhone`,
  `dismissDetectedPhone` and `resizeForDetectedPhone` are optional. A host holding only `device.size` and `panels`
  (beside `settings`) renders `Panel` and `PanelRow`.
- A `create()` without a `view` opens `PanelsInput.defaultView`; with none it opens a panel with no view, which renders
  the unregistered-view placeholder. The zero-argument overload and the event guard are unchanged.

### Fixed

- Adding a panel whose template declares `headerButtons` after the row is mounted no longer makes React log "The result of
  getSnapshot should be cached": `getState()` returns the same object until the panel's state changes, also before its first commit.
- Pinning a panel under React 19.2 StrictMode left the panel it moved past (History) stuck at its old place, under the
  pinned one, until a reload: a slot that a reorder moves now restarts its slide to its new rest.
- A panel dragged past a neighbour under React 19.2's StrictMode no longer stays at its drag offset, overlapping the
  panel beside it and leaving a gap: the box keeps its release spring running when React runs its effect cleanup and
  setup again.

## 0.2.0-rc.1

### Breaking

- Gone from `phonux`: the 22 deprecated aliases, ten values and three types, `SettingsAPI`'s four max-panels members and
  `PanelsInput.storedMaxPanels`; the Removed list below names each one and what replaces it.
- A panel built through a workspace now scrolls where 0.1.0 parked it at capacity, and its container's `overflow-x`,
  centring margin and `maxLiveWidth` change with it. A hand-built entry keeps parking.
- `ProvidedPanels` gains required members (`rowScroll`, `rowNumbers`, `tuning`, `scrollTo`, `followPanel`), so a typed
  fake of it stops compiling.
- `clearAll` keeps locked entries, `usePanelCloseEligible` is `collapsible && !locked`, `undoClose` consumes its batch
  once and reports only the ids it restored, and a raw call on an id that holds a manager token does nothing.

### Added

- `configure(patch)` on a panel handle, `configure(id, patch)`, `configureTemplate(templateId, patch)` and
  `configureTuning(patch)` on the manager change settings after a panel exists, each in one commit and each refusing
  whole with a typed `ConfigureResult` (`wrong-scope`, `settings-conflict`, `tier-not-allowed`, `instance-limit`,
  `busy`) or throwing `invalid-settings` for an unknown key or a bad value. A view's own handle takes only `title`,
  `listed`, `layer`, `formFactor`, an anchor `placeOnAdd` and `enterFrom: 'anchor'`. The workspace's per-panel tuning
  leaves now reach the panels that resolve their own settings.
- `configureTemplate(id, { multiple: false })` answers `instance-limit` with the count while a declared panel of the
  template is closed, a panel of it is inside the undo window, or an instance not named like the template is in the row;
  `maxInstances` is lowered against the row's entries only.
- `configureTemplate` naming `maxInstances` on a template that resolves to `multiple: false` still stores the limit and
  answers one `max-instances-moot` note in `ConfigureResult.notes` and through `onNote`.
- `headerButtons`: a panel declares generic title-bar buttons as slots keyed by id with `icon`, `label`, `onClick`,
  `side`, `order`, `pressed`, `description`, `tooltip`, `disabled`, `hidden` and `sx`. `Panel` draws them as MUI
  IconButtons (`Panel`'s new `headerButtons` prop, `false` to leave them out; `PanelHeaderRow`'s new `leading` prop holds
  the start side), `usePanelHeaderButtons()` lists them and `PanelHeaderButtons` draws them for a view with its own
  header. A press is the person's gesture. A panel that declares none renders what it did.
- `pin()` and `unpin()` on a panel handle apply the panel's pinning definition in one commit, `pinningWhenNotLive` and a
  deferred pin decide what a parked, hidden or closed panel does, a person's pin is saved as `overrides.parkable`, and
  `resetLayout(id | 'all')` on the manager clears overrides and deferred pins and re-places by default. The result types
  `PinResult` and `ResetResult` are exported; `PanelWindow` gains the session-only `deferredPin`.
- A `configure` of `parkable` on a parked, hidden, closed or undo-window panel follows `pinningWhenNotLive` as `pin()` does:
  it is refused (`would-reshape-row`, or `is-closed` for a closed panel), shows the panel and flips it in one commit
  (`shown: true`), or waits as a deferred pin listed in `later`. A flip that changes nothing the panel reads is never
  refused or deferred, and a `configure` that names `parkable` cancels a waiting flip.
- `PanelWindow` gains the optional `instance`, `overrides`, `applied` and `declared`, and `PanelsInput` gains
  `templates` and `declared`: a workspace file now remembers what a person moved or resized (`overrides`), the
  `placeOnAdd` that placed each panel (`applied`) and the layer a panel was made with (`instance`), so a changed default
  moves only the panels nobody touched. The new keys are additive and a 0.1.0 file restores unchanged.
- A Host-bag `create({ view })` naming a template obeys its `hostCreatable`, `multiple` and `maxInstances`; a restore is exempt.
- TSDoc on every export of `phonux` and `phonux/testing` and on every member of the exported interfaces, so editors show
  what a prop or call means. `npm run check:api-report` now also fails on an `(undocumented)` line in `etc/`.
- `PanelWindow` and `PanelRowEntry` gain the optional `marker`: an entry with `marker: true` holds the anchor point
  of a row without a History panel and is never drawn, priced, counted as a fixed column or hopped over.
- `usePanelCapabilities()`: what the panel a view sits in lets a person do (`closable`, `draggable`, `placeable`,
  `resizable` and the allowed `formFactors`); outside a row it returns the library defaults.
- `PanelWindow` and `PanelRowEntry` gain the optional `settings` (the resolved settings an entry was made under)
  and `key`. A hand-built entry has neither and behaves as before.
- `PanelsInput` gains `tuning` (a partial `WorkspaceTuning`; the engine reads `saveQuietMs`, `gestureLockMs`,
  `returnTieBreak` and `dropTieBreak`, each defaulting to today's value) and `onNote`, which receives the notes the
  engine raises while it works and swallows whatever it throws.
- `usePanelTuning()`: the look tuning of the panel a view sits in (`rowGap`, `dragToClose`, `slide`, `hopFraction`,
  `edgeScroll`); outside a row it returns the library defaults.
- `usePanelReorderSteps()`: `steps(offsetX)` is `reorderStepsForOffset` over the slot's neighbours, the row gap and the
  panel's hop fraction; outside a row it is 0.
- `slideToTransition(slide)`: the Motion transition for a `SlideTuning`, `PANEL_TRANSITION` itself for the default.
- `Workspace` and `PanelRow` gain the optional `tuning` prop, and `ProvidedPanels` gains `tuning`, the resolved
  workspace tuning to hand to a `Workspace`.
- `reorderStepsForOffset` takes an optional fourth argument, `hopFraction` (default 0.5).
- `DragToClose`'s `onClose` is optional: without it a release past the close line snaps back.
- `usePanelHidden()`: true while the panel a view sits in is parked with its view kept mounted and the slot is hidden, so
  the view can pause its own work; false while live, while sliding out and outside a row.
- `computeRowNumbers` and the type `RowNumbers`: one pure result for a row's widths, resting offsets, margin, strip and
  window, which the shell, the row and the capacity all read.
- `PanelsInput.workspaceDefaults`: the workspace's panel settings. Given, a panel made by `create()` and a panel
  restored from `storage` carries the settings they resolve to; without it entries are built as before.
- `ProvidedPanels` gains `rowScroll` and `rowNumbers`, `Workspace` gains the optional `rowScroll` and `rowNumbers`
  props, `PanelRow` gains the optional `rowNumbers` prop, and `RowLayoutInput` gains the optional `reservedWidths`.
- `ProvidedPanels.scrollTo` and `followPanel`. `scrollTo(id, align?)` asks the row to scroll to a panel after the next
  commit, and a new panel, an activated panel, an undone close and a panel that was in view when it was moved, placed
  or resized are scrolled to through the same request, per their `scrollOnOpen` and `scrollOnMove`.
- `createWorkspace(options?)`: a workspace made outside React from templates, an optional root, storage and settings, fed to a row through the new `PanelsInput.workspace`. `addPanel` declares a panel, before or after the row is ready, and returns a read-only `PanelHandle` (`id`, `templateId`, `getState`, `getSettings`, `subscribe`) valid before mount and after unmount. `workspace.panels` is a `PanelManager` (`get`, `list`, `getSnapshot`, `subscribe`) whose snapshot is reference-equal until something changes. `PanelRow` gains the optional `workspace` prop that lets a template's view receive its `handle` and `manager`.
- `usePanelStates(filter?)`, `usePanelState(id)` and `useWorkspaceManager()`: the snapshot, one panel's state and the reader, for a view inside a row that has a workspace.
- A declared panel whose `afterClose` is `stay-closed` is remembered when the person closes it and not created at the next launch; an undo forgets it.
- `memoryWorkspaceStorage(initial?)` from `phonux/testing`: a `WorkspaceStorage` that keeps the file in memory.
- Panel handles gain `show`, `hide`, `toggleVisibility`, `close`, `open`, `move`, `place`, `setFormFactor` and
  `scrollTo`, each returning a `PanelResult`: `{ ok: true, changed }`, or `{ ok: false, code, message }` with a
  `PanelRefusal` code, and a refusal touches nothing. The view of a panel receives the same verbs for itself, with no manager.
  `toggleWhenClosed`, `showWhenClosed` and `hideWhenLast` are enforced through them, `open()` re-adds a closed declared
  panel at its `placeOnAdd`, and a closed anonymous instance answers `is-closed`.
- `PanelResult` is exported as a type.
- `undoClose` restores a closed panel through its current settings: `undoPlacement` decides where it lands, and a
  workspace-less host keeps the 0.1.0 behaviour.
- `configure({ snapshot: 'never' })` asks the host's `CaptureTrigger` to `evict` that panel's stored picture once, from the
  commit's layout effect, for a live, parked, hidden or protected panel. A closed record or a panel inside its undo window
  stores the edit and asks nothing at the call.
- A `configure` call that leaves a held panel unlisted (`{ listed: false }`, or a `null` that restores an unlisted
  derived value, also while a flip of `parkable` waits) raises the `hold-unlisted` note, in `ConfigureResult.notes` and
  through `onNote`, once per call, whatever the panel's `revealOnScroll`; a call that shows the panel or is refused
  whole raises none.
- New runtime values on `phonux`, 19 in all: `PANEL_SETTINGS_CATALOG`, `LIBRARY_PANEL_DEFAULTS`,
  `LIBRARY_TUNING_DEFAULTS`, `resolvePanelSettings`, `mergePatch`, `definePanel`, `PanelManagerError`,
  `usePanelCapabilities`, `usePanelTuning`, `usePanelReorderSteps`, `slideToTransition`, `usePanelHidden`,
  `computeRowNumbers`, `createWorkspace`, `usePanelStates`, `usePanelState`, `useWorkspaceManager`,
  `usePanelHeaderButtons` and `PanelHeaderButtons`; `memoryWorkspaceStorage` is on `phonux/testing`.
- Saved workspace files keep `version: 1` and gain additive keys, written only for entries that carry `settings`: per
  panel `key`, `instance`, `overrides` (`anchor`, `formFactor`, `parkable`), `applied` and `closable`, and at the top
  `dismissed` (at most 256) and `root`. Settings themselves are never saved.

### Changed

- Within one turn (one handler, timer, promise continuation or effect) a second operation on a panel the first one acts on
  now answers `busy` through the handle, a close is exclusive among handle calls, and the raw `close`, `undoClose`,
  `activate`, `move`, `reanchor` and `setFormFactor` of `ProvidedPanels` hold the same gate: a raw call on a panel a handle
  call holds does nothing. Two raw calls on one panel, and `create` and `clearAll`, behave as before. Two closes through
  the handles can no longer undo in the wrong order; the raw pair still can (the pin is `LIMIT:3`).
- The view handle a template receives has fourteen members (`id`, `templateId`, `getState`, `getSettings`, `subscribe` and
  the nine verbs), where it had five.
- A throw inside the restore, once left the workspace unsettled with saving stopped for the session, now takes the
  failed-load path: the workspace settles and the next change saves.
- A parked entry whose `keepMounted` is true keeps its view mounted and hidden (`display: none`, `inert`,
  `aria-hidden`) instead of unmounting it after the park exit, and `Panel` unregisters from the capture registry while
  hidden.
- An entry that carries `settings` is parked, returned and held by its `startVisibility`, `hideStickiness`,
  `hideWhenLast`, `capacityReturn`, `returnPriority`, `evictionRank` and `evictionOrder`, and releases its
  `useViewState` values at a park when its `viewState` is `reset-on-park`. The park levers act only on a panel whose
  `overflow` is `park`. A hand-built entry has none of these and parks, returns and keeps its view state as before.
- `applyTemplate(entry, resolved, 'create')` also writes `live`: `startVisibility` `parked` creates the entry parked,
  and `live` never revives an entry handed in parked.
- A panel that is added parked (restored from a saved workspace, or put back by `undoClose`) is held per its
  `hideStickiness`: it stays parked until shown, as before, and an `until-room` one also returns when room opens.
- The row gesture's lock and the workspace save delay are read from `PanelsInput.tuning`; `WORKSPACE_SAVE_QUIET_MS`
  stays exported from the persistence module as an alias of the one default, 500.
- `clearAll` keeps an entry whose `clearable` setting is false. An entry seeded with `locked: true` and
  `collapsible: true` used to be removed by it; it is kept now, like History and a permanent column.
- `usePanelCloseEligible` is also false for a locked entry, and `usePanelReorderEligible` follows the
  `draggable` setting (true for every collapsible entry unless it is set false).
- A `close` the engine refuses (an unknown or locked id) no longer asks the host's `CaptureTrigger` for a picture.
- `onPanelsRestored` lists only the closes that were reported and restored; it is not called when there are none.
  Before, it listed every id of the batch, including one `undoClose` skipped because the id was already back.
- The undo window ends at the latest of each close's `undoWindowMs` after that close, and no close shortens it;
  with the default 10 000 ms that is the 0.1.0 behaviour, where every close restarted the window.

- An entry that carries `settings` is placed by `placeOnShow` when it is shown, by `placeOnReturn` when it returns on
  its own, and by `undoPlacement` when `undoClose` restores it, with `placeFallback` and an `onNote` note when the
  value cannot be honoured; it enters from `enterFrom`, leaves by `exitTo` and `closeExit`, stacks by `layer` and
  skips its slide when `animated` is false. A hand-built entry places, enters and leaves as before.
- `undoClose` reads its batch from a ref that the first call empties, so a second call in the same handler restores
  and reports nothing (it used to report the same log ids twice), and it skips a closed panel whose key is already
  in the row, not only one whose id is.
- `PanelsInput.tuning` also reads `rowGap`, `dragToClose`, `slide` and `hopFraction`, each defaulting to today's value
  (16, the drag-to-close numbers, the 0.4 s slide with a 0.18 s close exit, 0.5); a member out of range takes its
  default. The gap, the slot travel, the close and snap-back numbers, the slide and the hop rule read the one
  resolved value instead of fixed constants.
- `DragToClose` reads the slot's `closable` at the release and when its exit ends: a box locked in between springs
  back and does not call `onClose`.
- An entry that carries settings scrolls instead of parking unless its `overflow` is `park`: the row lays out every
  such entry, and a strip wider than the window scrolls, hiding its scrollbar under the default `rowGesture`.
- Park exits start from the panel's rest in a scrolling row, one span to either side, instead of the row's origin.
- A hand-built row is unchanged: its entries have no settings, park at capacity and keep their numbers.
- With `rowGesture` `step`, a swipe or arrow on a scrolling row scrolls one panel instead of swapping; a parked panel
  still comes back by the gesture, per its `revealOnScroll`. `free` and `off` install no wheel or key listener.
- The strip is scrolled once per mount to `tuning.initialScroll` after the restore has settled, unless a wheel or
  pointer-down reached the row first.
- Dragging a panel's grab bar to the window edge scrolls a scrolling row (mouse and pen); `scrollOnDrag` `none` and
  `tuning.edgeScroll` turn it off or tune it. A drag already in flight keeps the mode and the numbers it began with;
  a configure of either reaches the next drag.
- `WorkspaceStorage.save` may return a promise as well as nothing. The saved baseline now advances only after a save
  succeeds, so a save that throws or rejects is reported once (`onError`, else `console.error`) and the next change
  saves again; the baseline used to move before the call, and a failed save was not retried until the state changed to
  something else. A save that settles after a newer one started leaves the baseline alone, and no timer retries.
- `WorkspaceStorage.save` is now typed `void | Promise<void>`, so a function whose body is an expression returning
  another value, such as `(s) => log.push(s)`, no longer compiles; give it a block body.
- The step gesture on a scrolling row scrolls by panel where 0.1.0 swapped a parked panel in.
- In a scrolling row `ReorderHandle.onDragEnd`'s offset includes the scroll distance the drag covered, so a hop count
  computed from it matches what the person saw.
- A row built through a workspace sets its container's `overflow-x` to auto when it scrolls, takes its centring margin
  from the row numbers and reads `maxLiveWidth` from `computeRowNumbers`; a hand-built row keeps `overflow-x: hidden`.
- A panel built through a workspace defaults to `overflow: 'scroll'`; set `overflow: 'park'` to keep 0.1.0's parking.
  The `PanelsAPI` doc comments now say parking applies to panels whose `overflow` is `park`.
- Going back to 0.1.0 costs the saved extras: 0.1.0 reads a `version: 1` file and writes only the keys it documents, so
  the person's overrides, the applied placement and the dismissed list are lost at its next save.

### Removed

- The 22 deprecated aliases left by the renames before 0.1.0. Use the current names: `DeviceAPI` ->
  `PhoneDeviceAPI`, `PhoneAPIs` -> `Host`, `PhoneAPIsProvider` -> `HostProvider` (its prop is `host`),
  `PhoneAPIsMissingProviderError` -> `HostMissingProviderError`, `usePhoneAPIs` -> `useHost`,
  `PanelComponent` -> `ViewComponent`, `registerPanelView` -> `registerView`, `resolvePanelView` ->
  `resolveView`, `PhoneView` -> `Panel`, `PhoneViewProps` -> `PanelProps`, `PhoneFrame` -> `PanelFrame`,
  `PhoneFrameProps` -> `PanelFrameProps`, `PhoneFrameHeader` -> `PanelHeader`, `PhoneFrameHeaderProps` ->
  `PanelHeaderProps`, `PhoneFrameHeaderRow` -> `PanelHeaderRow`, `PhoneFrameHeaderRowProps` ->
  `PanelHeaderRowProps`, `PHONE_CORNER_RADIUS_UNITS` -> `PANEL_CORNER_RADIUS_UNITS`, `phoneCornerRadiusPx` ->
  `panelCornerRadiusPx`, `phoneFrameScrollSx` -> `panelFrameScrollSx`, `phoneFrameBareSx` -> `panelFrameBareSx`;
  from `phonux/testing`, `createFakePhoneAPIs` -> `createFakeHost` and `FakePhoneAPIs` -> `FakeHost`.
- The `./internal/panelModel` and `./internal/directionalTransition` keys of the source `package.json`, with
  their two API reports and configs. The published package never exported them; it exports `.` and
  `./testing`, as before.
- Ten values and three types no longer importable from `phonux` (none was reachable from `phonux/testing`); the
  package's own files still use them. Each group and what to use instead:
  - `OverlayProvider`, `OverlayStore` and its types `Item` and `Entry`: `HostProvider` already mounts the overlay
    provider, so `OverlaySlot` and `WindowOverlay` work without it.
  - `PanelRowSlot`: `Workspace` and `PanelRow` mount the slots; `GAP`, `PANEL_TRANSITION` and `PanelSizeBox` stay.
  - `shouldCloseOnRelease` and its type `ReleaseMeasure`: `DragToClose` applies the release rule.
  - `computeRowOrder`, `deriveAnchorsFromOrder`, `summarisePanel` and `computeMaxLiveWidth`: `useProvidePanels`
    orders the row and builds `PanelSummary` values; `computeRowLayout` stays.
  - `CaptureRegistryContext`: mount `CaptureRegistryProvider` instead.
  - `vendorLabelForUsbVendorId`: it only worded the phone-detect prompt, which is gone too (see Breaking under Unreleased); `PHONE_MODELS` and `findPhoneModel` stay.
- `SettingsAPI.maxPanelsOnScreen`, `fitCount`, `minPanelsOnScreen` and `setMaxPanelsOnScreen`, and
  `PanelsInput.storedMaxPanels` (also gone from `createFakeHost`). Breaking, and a design choice listed for
  review in Jojos-Creations/phonux#2. `SettingsAPI` keeps `settingsColumn`. The app passes nothing in place of
  `storedMaxPanels`; a view that needs the window width measures its own container.

## 0.1.0

First release. The package was extracted, history kept, from phonux-app at commit `76817a2`.
