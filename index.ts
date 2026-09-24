// The public surface of the phonux package. A name that moves or changes kind here breaks every consumer.
// test/phonux-barrel.test.ts pins the value names; type names are erased at runtime, so only a consumer's
// tsc checks them. DESIGN.md says why the split exists and why some exports stay off this list.

export {
  DEFAULT_PHONE_SIZE,
  PhoneAPIsMissingProviderError,
  PhoneAPIsProvider,
  usePhoneAPIs,
} from './phoneViewApi.js';
export type {
  MaxViewsMode,
  MaxViewsSettings,
  PhoneSize,
  DetectedPhone,
  ClosedPageEntry,
  JsonValue,
  PanelSummary,
  CreatePanelOptions,
  SettingsAPI,
  HistoryAPI,
  PanelsAPI,
  DeviceAPI,
  PhoneAPIs,
} from './phoneViewApi.js';

export { registerPanelView, resolvePanelView } from './panelRegistry.js';
export type { PanelComponent } from './panelRegistry.js';

export {
  PhoneView,
  DRAG_CLOSE,
  DragToClose,
  shouldCloseOnRelease,
  WindowOverlay,
  OverlaySlot,
  OVERLAY_Z,
} from './PhoneView.js';
export type {
  PhoneViewProps,
  DragHandleProps,
  OverlaySlotName,
  WindowOverlayProps,
} from './PhoneView.js';

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
