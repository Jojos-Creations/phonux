// The public surface of the phonux package. A name that moves or changes kind here breaks every consumer.
// test/phonux-barrel.test.ts pins the value names; type names are erased at runtime, so only tsc checks them
// (releaseMeasure.typecheck.ts pins one). DESIGN.md says why the split exists and why some exports stay off this list.

export {
  DEFAULT_PHONE_SIZE,
  HostMissingProviderError,
  HostProvider,
  useHost,
} from './hostApi.js';
export type {
  PhoneSize,
  DetectedPhone,
  ClosedPageEntry,
  JsonValue,
  FormFactor,
  PanelSize,
  PanelSummary,
  CreatePanelOptions,
  SettingsAPI,
  HistoryAPI,
  PanelsAPI,
  PhoneDeviceAPI,
  Host,
} from './hostApi.js';

export { useViewSnapshot, CaptureRegistryContext, CaptureRegistryProvider } from './snapshots.js';
export type { ViewId, ViewSnapshot, SnapshotsAPI, CaptureRegistry } from './snapshots.js';

export { useViewState, ViewStateMissingProviderError } from './viewState.js';
export type { UseViewState } from './viewState.js';
// Deprecated aliases: same value as their new-name counterpart, kept until removed.
export {
  PhoneAPIsMissingProviderError,
  PhoneAPIsProvider,
  usePhoneAPIs,
} from './hostApi.js';
export type { DeviceAPI, PhoneAPIs } from './hostApi.js';

export { registerView, resolveView } from './viewRegistry.js';
export type { ViewComponent, ViewProps } from './viewRegistry.js';
/** @deprecated use registerView/resolveView/ViewComponent */
export { registerPanelView, resolvePanelView } from './viewRegistry.js';
export type { PanelComponent } from './viewRegistry.js';

export {
  Panel,
  DRAG_CLOSE,
  DragToClose,
  shouldCloseOnRelease,
  WindowOverlay,
  OverlaySlot,
  OVERLAY_Z,
  OverlayProvider,
  OverlayStore,
} from './Panel.js';
export type {
  PanelProps,
  DragHandleProps,
  ReleaseMeasure,
  ReorderHandle,
  OverlaySlotName,
  WindowOverlayProps,
  Item,
  Entry,
} from './Panel.js';
/** @deprecated use Panel/PanelProps */
export { PhoneView } from './Panel.js';
export type { PhoneViewProps } from './Panel.js';

export { default as PanelFrame } from './PanelFrame.js';
export {
  PANEL_CORNER_RADIUS_UNITS,
  panelCornerRadiusPx,
  panelFrameScrollSx,
  panelFrameBareSx,
  PanelHeader,
  PanelHeaderRow,
} from './PanelFrame.js';
export type {
  PanelFrameProps,
  PanelHeaderProps,
  PanelHeaderRowProps,
} from './PanelFrame.js';
/** @deprecated use PanelFrame, PanelHeader, PanelHeaderRow and their PANEL_ and panel-prefixed siblings above */
export { default as PhoneFrame } from './PanelFrame.js';
export {
  PHONE_CORNER_RADIUS_UNITS,
  phoneCornerRadiusPx,
  phoneFrameScrollSx,
  phoneFrameBareSx,
  PhoneFrameHeader,
  PhoneFrameHeaderRow,
} from './PanelFrame.js';
export type {
  PhoneFrameProps,
  PhoneFrameHeaderProps,
  PhoneFrameHeaderRowProps,
} from './PanelFrame.js';

export { PHONE_MODELS, findPhoneModel, vendorLabelForUsbVendorId } from './phoneModels.js';
export type { PhoneModel } from './phoneModels.js';

export { PhoneDetectPrompt } from './PhoneDetectPrompt.js';
export type { PhoneDetectPromptProps } from './PhoneDetectPrompt.js';

export { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
export type { PanelAnchor } from './panelRowOrder.js';
export { summarisePanel } from './panelRowEntry.js';
export type { NeighborWidths, PanelRowEntry } from './panelRowEntry.js';
export { DEFAULT_PANEL_SIZE, TIER_SIZES, panelWidthOf } from './panelTiers.js';
export { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
export type { RowLayoutInput, RowLayoutResult } from './panelRowLayout.js';

export { createDefaultTheme } from './defaultTheme.js';
