// The public surface of the phonux package. A name that moves or changes kind here breaks every consumer.
// test/phonux-barrel.test.ts pins the value names; type names are erased at runtime, so only a consumer's
// tsc checks them. DESIGN.md says why the split exists and why some exports stay off this list.

export {
  DEFAULT_PHONE_SIZE,
  HostMissingProviderError,
  HostProvider,
  useHost,
} from './phoneViewApi.js';
export type {
  PhoneSize,
  DetectedPhone,
  ClosedPageEntry,
  JsonValue,
  PanelSummary,
  CreatePanelOptions,
  SettingsAPI,
  HistoryAPI,
  PanelsAPI,
  PhoneDeviceAPI,
  Host,
} from './phoneViewApi.js';

export { useViewSnapshot, CaptureRegistryContext, CaptureRegistryProvider } from './snapshots.js';
export type { ViewId, ViewSnapshot, SnapshotsAPI, CaptureRegistry } from './snapshots.js';
// Deprecated aliases: same value as their new-name counterpart, kept until removed.
export {
  PhoneAPIsMissingProviderError,
  PhoneAPIsProvider,
  usePhoneAPIs,
} from './phoneViewApi.js';
export type { DeviceAPI, PhoneAPIs } from './phoneViewApi.js';

export { registerView, resolveView } from './panelRegistry.js';
export type { ViewComponent, ViewProps } from './panelRegistry.js';
/** @deprecated use registerView/resolveView/ViewComponent */
export { registerPanelView, resolvePanelView } from './panelRegistry.js';
export type { PanelComponent } from './panelRegistry.js';

export {
  Panel,
  DRAG_CLOSE,
  DragToClose,
  shouldCloseOnRelease,
  WindowOverlay,
  OverlaySlot,
  OVERLAY_Z,
} from './PhoneView.js';
export type {
  PanelProps,
  DragHandleProps,
  OverlaySlotName,
  WindowOverlayProps,
} from './PhoneView.js';
/** @deprecated use Panel/PanelProps */
export { PhoneView } from './PhoneView.js';
export type { PhoneViewProps } from './PhoneView.js';

export { default as PanelFrame } from './PhoneFrame.js';
export {
  PANEL_CORNER_RADIUS_UNITS,
  panelCornerRadiusPx,
  panelFrameScrollSx,
  panelFrameBareSx,
  PanelHeader,
  PanelHeaderRow,
} from './PhoneFrame.js';
export type {
  PanelFrameProps,
  PanelHeaderProps,
  PanelHeaderRowProps,
} from './PhoneFrame.js';
/** @deprecated use PanelFrame, PanelHeader, PanelHeaderRow and their PANEL_ and panel-prefixed siblings above */
export { default as PhoneFrame } from './PhoneFrame.js';
export {
  PHONE_CORNER_RADIUS_UNITS,
  phoneCornerRadiusPx,
  phoneFrameScrollSx,
  phoneFrameBareSx,
  PhoneFrameHeader,
  PhoneFrameHeaderRow,
} from './PhoneFrame.js';
export type {
  PhoneFrameProps,
  PhoneFrameHeaderProps,
  PhoneFrameHeaderRowProps,
} from './PhoneFrame.js';

export { PHONE_MODELS, findPhoneModel, vendorLabelForUsbVendorId } from './phoneModels.js';
export type { PhoneModel } from './phoneModels.js';

export { PhoneDetectPrompt } from './PhoneDetectPrompt.js';
export type { PhoneDetectPromptProps } from './PhoneDetectPrompt.js';

export { createDefaultTheme } from './defaultTheme.js';
