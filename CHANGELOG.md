# Changelog

## Unreleased

### Added

- `PanelWindow` and `PanelRowEntry` gain the optional `marker`: an entry with `marker: true` holds the anchor point
  of a row without a History panel and is never drawn, priced, counted as a fixed column or hopped over.
- `usePanelCapabilities()`: what the panel a view sits in lets a person do (`closable`, `draggable`, `placeable`,
  `resizable` and the allowed `formFactors`); outside a row it returns the library defaults.
- `PanelWindow` and `PanelRowEntry` gain the optional `settings` (the resolved settings an entry was made under)
  and `key`. A hand-built entry has neither and behaves as before.
- `PanelsInput` gains `tuning` (a partial `WorkspaceTuning`; the engine reads `saveQuietMs`, `gestureLockMs`,
  `returnTieBreak` and `dropTieBreak`, each defaulting to today's value) and `onNote`, which receives the notes the
  engine raises while it works and swallows whatever it throws.

### Changed

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
  - `vendorLabelForUsbVendorId`: `PhoneDetectPrompt` renders the label; `PHONE_MODELS` and `findPhoneModel` stay.

## 0.1.0

First release. The package was extracted, history kept, from phonux-app at commit `76817a2`.
