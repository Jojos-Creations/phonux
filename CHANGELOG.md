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

## 0.1.0

First release. The package was extracted, history kept, from phonux-app at commit `76817a2`.
