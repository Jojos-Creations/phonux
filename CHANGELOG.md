# Changelog

## Unreleased

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
